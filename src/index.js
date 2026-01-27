import {
    ensureInstant,
    toPlainDateTime,
    Temporal,
    floor,
    parseInstant,
    parseDuration,
    parseDurationString,
    add,
} from './temporal_utils';
import { $, createSVG } from './svg_utils';

import Arrow from './arrow';
import Bars from './bars';
import Grid from './grid';
import Popup from './popup';
import Tasks from './tasks';
import Viewport from './viewport';

import { DEFAULT_OPTIONS, DEFAULT_VIEW_MODES } from './defaults';

import './styles/gantt.css';

export default class Gantt {
    constructor(wrapper, tasks, options) {
        this.config = {};
        this.grid = {};
        this.taskStore = new Tasks();
        this.barStore = new Bars(this);

        this.setup_wrapper(wrapper);
        this.setup_options(options);
        this.load_task_list(tasks);
        this.change_view_mode();
        this.bind_events();
    }

    setup_wrapper(element) {
        let svg_element, wrapper_element;

        // CSS Selector is passed
        if (typeof element === 'string') {
            let el = document.querySelector(element);
            if (!el) {
                throw new ReferenceError(
                    `CSS selector "${element}" could not be found in DOM`,
                );
            }
            element = el;
        }

        // get the SVGElement
        if (element instanceof HTMLElement) {
            wrapper_element = element;
            svg_element = element.querySelector('svg');
        } else if (element instanceof SVGElement) {
            svg_element = element;
        } else {
            throw new TypeError(
                'Frappe Gantt only supports usage of a string CSS selector,' +
                " HTML DOM element or SVG DOM element for the 'element' parameter",
            );
        }

        // svg element
        if (!svg_element) {
            // create it
            this.$svg = createSVG('svg', {
                append_to: wrapper_element,
                class: 'gantt',
            });
        } else {
            this.$svg = svg_element;
            this.$svg.classList.add('gantt');
        }

        // wrapper element
        this.$container = this.create_el({
            classes: 'gantt-container',
            append_to: this.$svg.parentElement,
        });

        this.$container.appendChild(this.$svg);
        this.$popup_wrapper = this.create_el({
            classes: 'popup-wrapper',
            append_to: this.$container,
        });
    }

    setup_options(options) {
        this.original_options = options;
        if (options?.view_modes) {
            options.view_modes = options.view_modes.map((mode) => {
                if (typeof mode === 'string') {
                    const predefined_mode = DEFAULT_VIEW_MODES.find(
                        (d) => d.name === mode,
                    );
                    if (!predefined_mode)
                        console.error(
                            `The view mode "${mode}" is not predefined in Frappe Gantt. Please define the view mode object instead.`,
                        );

                    return predefined_mode;
                }
                return mode;
            });
            // automatically set the view mode to the first option
            options.view_mode = options.view_modes[0];
        }
        this.options = { ...DEFAULT_OPTIONS, ...options };
        const CSS_VARIABLES = {
            'grid-height': 'container_height',
            'bar-height': 'bar_height',
            'lower-header-height': 'lower_header_height',
            'upper-header-height': 'upper_header_height',
        };
        for (let name in CSS_VARIABLES) {
            let setting = this.options[CSS_VARIABLES[name]];
            if (setting !== 'auto')
                this.$container.style.setProperty(
                    '--gv-' + name,
                    setting + 'px',
                );
        }

        this.config = {
            ignored_dates: [],
            ignored_positions: [],
            extend_by_units: 2,
            step: {},
        };

        if (typeof this.options.ignore !== 'function') {
            if (typeof this.options.ignore === 'string')
                this.options.ignore = [this.options.ignore];
            for (let option of this.options.ignore) {
                if (typeof option === 'function') {
                    this.config.ignored_function = option;
                    continue;
                }
                if (typeof option === 'string') {
                    if (option === 'weekend') {
                        this.config.ignored_function = (instant) => {
                            const pdt = toPlainDateTime(ensureInstant(instant));
                            return pdt.dayOfWeek === 6 || pdt.dayOfWeek === 7; // Saturday or Sunday
                        };
                    } else {
                        this.config.ignored_dates.push(ensureInstant(option + ' '));
                    }
                }
            }
        } else {
            this.config.ignored_function = this.options.ignore;
        }
    }

    update_options(options) {
        this.setup_options({ ...this.original_options, ...options });
        this.change_view_mode(undefined, true);
    }

    load_task_list(task_list) {
        this.taskStore.load(task_list);
        // Alias for backward compatibility and convenience
        this.tasks = this.taskStore.getAll();
        this.dependency_map = this.taskStore.getDependencyMap();
    }

    refresh(tasks) {
        this.load_task_list(tasks);
        this.change_view_mode();
    }

    update_task(id, new_details) {
        const task = this.taskStore.update(id, new_details);
        if (task) {
            const bar = this.bars[task._index];
            bar.refresh();
        }
    }

    change_view_mode(mode = this.options.view_mode, maintain_pos = false) {
        if (typeof mode === 'string') {
            mode = this.options.view_modes.find((d) => d.name === mode);
        }
        let old_date, old_scroll_op;
        if (maintain_pos && this.viewport) {
            // Save the date at current scroll position, not the pixel position
            old_date = this.viewport.xToDate(this.$container.scrollLeft);
            old_scroll_op = this.options.scroll_to;
            this.options.scroll_to = null;
        }
        this.options.view_mode = mode.name;
        this.config.view_mode = mode;
        this.update_view_mode(mode);
        this.setup_grid_dates(maintain_pos, old_date);
        this.render();
        if (maintain_pos && old_date) {
            // Convert the saved date back to new pixel position
            const new_pos = this.viewport.dateToX(old_date);
            this.$container.scrollLeft = new_pos;
            this.options.scroll_to = old_scroll_op;
        }
        this.trigger_event('view_change', [mode]);
    }

    update_view_mode(mode) {
        let { value, unit } = parseDurationString(mode.step);
        this.config.step.interval = value;
        this.config.step.unit = unit;

        // Validate step duration
        if (value <= 0) {
            console.warn(`Invalid step duration: ${value} ${unit}. Using default step of 1 day.`);
            this.config.step.interval = 1;
            this.config.step.unit = 'day';
        }

        this.config.step.column_width =
            this.options.column_width || mode.column_width || 45;

        // Validate column width
        if (this.config.step.column_width <= 0) {
            console.warn(`Invalid column width: ${this.config.step.column_width}. Using default value of 45.`);
            this.config.step.column_width = 45;
        }

        this.$container.style.setProperty(
            '--gv-column-width',
            this.config.step.column_width + 'px',
        );
        this.config.header_height =
            this.options.lower_header_height +
            this.options.upper_header_height +
            10;
    }

    setup_grid_dates(refresh = false, target_date = null) {
        this.setup_grid_range(refresh, target_date);
        // Note: grid.dates is no longer pre-computed here
        // Grid class generates dates on-demand via getDates()
        this.setup_viewport();
    }

    setup_viewport() {
        const viewportOptions = {
            visible: {
                start: this.grid.start,
                end: this.grid.end,
            },
            columnWidth: this.config.step.column_width,
            stepInterval: this.config.step.interval,
            stepUnit: this.config.step.unit,
        };

        // For infinite_padding mode, bounds are undefined (infinite scroll)
        // For fixed padding mode, bounds equal visible (no scroll beyond)
        if (!this.options.infinite_padding) {
            viewportOptions.bounds = {
                min: this.grid.start,
                max: this.grid.end,
            };
        }

        if (this.viewport) {
            // Update existing viewport
            this.viewport.setScale(
                this.config.step.column_width,
                this.config.step.interval,
                this.config.step.unit
            );
            this.viewport.setVisible(this.grid.start, this.grid.end);
        } else {
            this.viewport = new Viewport(viewportOptions);
        }

        // Create or update Grid
        if (!this.gridRenderer) {
            this.gridRenderer = new Grid({
                viewport: this.viewport,
                gantt: this,
            });
        }
        this.gridRenderer.viewport = this.viewport;
        this.gridRenderer.setViewMode(this.config.view_mode);
    }

    setup_grid_range(refresh, target_date = null) {
        let gantt_start;
        if (!this.tasks.length) {
            gantt_start = Temporal.Now.instant();
        }

        for (let task of this.tasks) {
            if (!gantt_start || Temporal.Instant.compare(task.start, gantt_start) < 0) {
                gantt_start = task.start;
            }
        }

        gantt_start = floor(gantt_start, this.config.step.unit);

        if (!refresh) {
            if (!this.options.infinite_padding) {
                if (typeof this.config.view_mode.padding === 'string')
                    this.config.view_mode.padding = [
                        this.config.view_mode.padding,
                        this.config.view_mode.padding,
                    ];

                let [padding_start, padding_end] =
                    this.config.view_mode.padding.map(
                        parseDurationString,
                    );
                this.grid.start = add(
                    gantt_start,
                    -padding_start.value,
                    padding_start.unit,
                );
            } else {
                this.grid.start = add(
                    gantt_start,
                    -this.config.extend_by_units,
                    this.config.step.unit,
                );
            }
        }

        // Sets gantt_end
        this.extend_grid_to_fill_viewport(target_date);

        this.config.date_format =
            this.config.view_mode.date_format || this.options.date_format;
    }

    extend_grid_to_fill_viewport(target_date = null) {
        const container_width = this.$container?.clientWidth || 0;
        if (!container_width) return;

        // Calculate minimum columns needed to fill the viewport (plus a small buffer)
        const columns_in_viewport = Math.ceil(container_width / this.config.step.column_width) + 1;

        // Extend gantt_end if we don't have enough columns
        let grid_width = columns_in_viewport * this.config.step.interval;
        this.grid.end = add(this.grid.start, grid_width, this.config.step.unit);

        // Collect dates that must be included in the grid
        const must_include = [];
        if (target_date) {
            must_include.push(ensureInstant(target_date));
        }
        // Ensure today is in the grid if today_button is enabled
        if (this.options.today_button) {
            must_include.push(Temporal.Now.instant());
        }

        // Extend grid to include all required dates with buffer
        for (const date of must_include) {
            const buffer_date = add(date, columns_in_viewport * this.config.step.interval, this.config.step.unit);
            if (Temporal.Instant.compare(buffer_date, this.grid.end) > 0) {
                this.grid.end = buffer_date;
            }
            if (Temporal.Instant.compare(date, this.grid.start) < 0) {
                this.grid.start = floor(date, this.config.step.unit);
            }
        }
    }

    bind_events() {
        this.bind_grid_click();
        this.bind_holiday_labels();
        this.bind_bar_events();
    }

    render() {
        this.clear();
        this.setup_layers();
        // Use Grid for rendering
        this.gridRenderer.render(this.layers, this.$container);
        this.make_side_header();
        this.gridRenderer.renderDateLabels();
        this.gridRenderer.renderExtras();
        this.make_bars();
        this.make_arrows();
        this.map_arrows_on_bars();
        this.set_dimensions();
        this.set_scroll_position(this.options.scroll_to);
    }

    setup_layers() {
        this.layers = {};
        const layers = ['grid', 'arrow', 'progress', 'bar'];
        // make group layers
        for (let layer of layers) {
            this.layers[layer] = createSVG('g', {
                class: layer,
                append_to: this.$svg,
            });
        }
        this.$extras = this.create_el({
            classes: 'extras',
            append_to: this.$container,
        });
        this.$adjust = this.create_el({
            classes: 'adjust hide',
            append_to: this.$extras,
            type: 'button',
        });
        this.$adjust.innerHTML = '&larr;';
    }

    make_side_header() {
        this.$side_header = this.create_el({ classes: 'side-header' });
        this.$upper_header.prepend(this.$side_header);

        // Create view mode change select
        if (this.options.view_mode_select) {
            const $select = document.createElement('select');
            $select.classList.add('viewmode-select');

            const $el = document.createElement('option');
            $el.selected = true;
            $el.disabled = true;
            $el.textContent = 'Mode';
            $select.appendChild($el);

            for (const mode of this.options.view_modes) {
                const $option = document.createElement('option');
                $option.value = mode.name;
                $option.textContent = mode.name;
                if (mode.name === this.config.view_mode.name)
                    $option.selected = true;
                $select.appendChild($option);
            }

            $select.addEventListener(
                'change',
                function () {
                    this.change_view_mode($select.value, true);
                }.bind(this),
            );
            this.$side_header.appendChild($select);
        }

        // Create today button
        if (this.options.today_button) {
            let $today_button = document.createElement('button');
            $today_button.classList.add('today-button');
            $today_button.textContent = 'Today';
            $today_button.onclick = this.scroll_current.bind(this);
            this.$side_header.prepend($today_button);
            this.$today_button = $today_button;
        }
    }

    create_el({ left, top, width, height, id, classes, append_to, type }) {
        let $el = document.createElement(type || 'div');
        for (let cls of classes.split(' ')) $el.classList.add(cls);
        $el.style.top = top + 'px';
        $el.style.left = left + 'px';
        if (id) $el.id = id;
        if (width) $el.style.width = width + 'px';
        if (height) $el.style.height = height + 'px';
        if (append_to) append_to.appendChild($el);
        return $el;
    }

    make_bars() {
        this.barStore.render(this.layers.bar);
        // Alias for backward compatibility
        this.bars = this.barStore.getAll();
    }

    make_arrows() {
        this.arrows = [];
        for (let task of this.tasks) {
            let arrows = [];
            arrows = task.dependencies
                .map((task_id) => {
                    const dependency = this.get_task(task_id);
                    if (!dependency) return;
                    const arrow = new Arrow(
                        this,
                        this.bars[dependency._index], // from_task
                        this.bars[task._index], // to_task
                    );
                    this.layers.arrow.appendChild(arrow.element);
                    return arrow;
                })
                .filter(Boolean); // filter falsy values
            this.arrows = this.arrows.concat(arrows);
        }
    }

    map_arrows_on_bars() {
        this.barStore.mapArrows(this.arrows);
    }

    set_dimensions() {
        const { width: cur_width } = this.$svg.getBoundingClientRect();
        const actual_width = this.$svg.querySelector('.grid .grid-row')
            ? this.$svg.querySelector('.grid .grid-row').getAttribute('width')
            : 0;
        if (cur_width < actual_width) {
            this.$svg.setAttribute('width', actual_width);
        }
    }

    set_scroll_position(date) {
        if (this.options.infinite_padding && (!date || date === 'start')) {
            let [min_start, ..._] = this.get_start_end_positions();
            this.$container.scrollLeft = min_start;
            return;
        }
        if (!date || date === 'start') {
            date = this.grid.start;
        } else if (date === 'end') {
            date = this.grid.end;
        } else if (date === 'today') {
            return this.scroll_current();
        } else if (typeof date === 'string') {
            date = parseInstant(date);
        }

        const scroll_pos = this.viewport.dateToX(ensureInstant(date));

        this.$container.scrollTo({
            left: scroll_pos - this.config.step.column_width / 6,
            behavior: 'smooth',
        });

        // Calculate current scroll position's upper text using Duration
        if (this.$current) {
            this.$current.classList.remove('current-upper');
        }

        this.current_date = this.viewport.xToDate(this.$container.scrollLeft);

        let current_upper = this.config.view_mode.upper_text(
            this.current_date,
            null,
            this.options.language,
        );
        let $el = this.upperTexts.find(
            (el) => el.textContent === current_upper,
        );

        if ($el) {
            this.current_date = this.viewport.xToDate(this.$container.scrollLeft + $el.clientWidth);
            current_upper = this.config.view_mode.upper_text(
                this.current_date,
                null,
                this.options.language,
            );
            $el = this.upperTexts.find((el) => el.textContent === current_upper);
        }

        if ($el) {
            $el.classList.add('current-upper');
            this.$current = $el;
        }
    }

    scroll_current() {
        let res = this.get_closest_date();
        if (res) this.set_scroll_position(res[0]);
    }

    get_closest_date() {
        return this.gridRenderer.getClosestDate();
    }

    bind_grid_click() {
        $.on(
            this.$container,
            'click',
            '.grid-row, .grid-header, .ignored-bar, .holiday-highlight',
            () => {
                this.unselect_all();
                this.hide_popup();
            },
        );
    }

    bind_holiday_labels() {
        const $highlights =
            this.$container.querySelectorAll('.holiday-highlight');
        for (let h of $highlights) {
            const label = this.$container.querySelector(
                '.label_' + h.classList[1],
            );
            if (!label) continue;
            let timeout;
            h.onmouseenter = (e) => {
                timeout = setTimeout(() => {
                    label.classList.add('show');
                    label.style.left = (e.offsetX || e.layerX) + 'px';
                    label.style.top = (e.offsetY || e.layerY) + 'px';
                }, 300);
            };

            h.onmouseleave = (e) => {
                clearTimeout(timeout);
                label.classList.remove('show');
            };
        }
    }

    get_start_end_positions() {
        if (!this.bars.length) return [0, 0, 0];
        let { x, width } = this.bars[0].group.getBBox();
        let min_start = x;
        let max_start = x;
        let max_end = x + width;
        Array.prototype.forEach.call(this.bars, function ({ group }, i) {
            let { x, width } = group.getBBox();
            if (x < min_start) min_start = x;
            if (x > max_start) max_start = x;
            if (x + width > max_end) max_end = x + width;
        });
        return [min_start, max_start, max_end];
    }

    bind_bar_events() {
        let is_dragging = false;
        let x_on_start = 0;
        let x_on_scroll_start = 0;
        let is_resizing_left = false;
        let is_resizing_right = false;
        let parent_bar_id = null;
        let bars = []; // instanceof Bar
        this.bar_being_dragged = null;

        const action_in_progress = () =>
            is_dragging || is_resizing_left || is_resizing_right;

        this.$svg.onclick = (e) => {
            if (e.target.classList.contains('grid-row')) this.unselect_all();
        };

        let pos = 0;
        $.on(this.$svg, 'mousemove', '.bar-wrapper, .handle', (e) => {
            if (
                this.bar_being_dragged === false &&
                Math.abs((e.offsetX || e.layerX) - pos) > 10
            )
                this.bar_being_dragged = true;
        });

        $.on(this.$svg, 'mousedown', '.bar-wrapper, .handle', (e, element) => {
            const bar_wrapper = $.closest('.bar-wrapper', element);
            if (element.classList.contains('left')) {
                is_resizing_left = true;
                element.classList.add('visible');
            } else if (element.classList.contains('right')) {
                is_resizing_right = true;
                element.classList.add('visible');
            } else if (element.classList.contains('bar-wrapper')) {
                is_dragging = true;
            }

            if (this.popup) this.popup.hide();

            x_on_start = e.offsetX || e.layerX;

            parent_bar_id = bar_wrapper.getAttribute('data-id');
            let ids;
            if (this.options.move_dependencies) {
                ids = [
                    parent_bar_id,
                    ...this.get_all_dependent_tasks(parent_bar_id),
                ];
            } else {
                ids = [parent_bar_id];
            }
            bars = ids.map((id) => this.get_bar(id));

            this.bar_being_dragged = false;
            pos = x_on_start;

            bars.forEach((bar) => {
                const $bar = bar.$bar;
                $bar.ox = $bar.getX();
                $bar.oy = $bar.getY();
                $bar.owidth = $bar.getWidth();
                $bar.finaldx = 0;
            });
        });

        if (this.options.infinite_padding) {
            let extending = false;
            // Trigger extension when within 2 viewport widths of the edge
            const getTriggerDistance = () => this.$container.clientWidth * 2;
            // Extend by enough units to add 3 viewport widths of content
            const getExtendUnits = () => Math.ceil((this.$container.clientWidth * 3) / this.config.step.column_width);

            $.on(this.$container, 'mousewheel', (e) => {
                if (extending) return;

                const scrollLeft = e.currentTarget.scrollLeft;
                const scrollWidth = e.currentTarget.scrollWidth;
                const clientWidth = e.currentTarget.clientWidth;
                const triggerDistance = getTriggerDistance();

                // Extend into past when near the left edge
                if (scrollLeft <= triggerDistance) {
                    extending = true;
                    const extendUnits = getExtendUnits();
                    const old_scroll_left = scrollLeft;

                    this.grid.start = add(
                        this.grid.start,
                        -extendUnits,
                        this.config.step.unit,
                    );
                    this.viewport.extendBounds('past', extendUnits);
                    // Grid generates dates on-demand, no need to call setup_grid_date_values()
                    this.render();
                    e.currentTarget.scrollLeft =
                        old_scroll_left +
                        this.config.step.column_width * extendUnits;
                    setTimeout(() => (extending = false), 100);
                    return;
                }

                // Extend into future when near the right edge
                const remainingRight = scrollWidth - (scrollLeft + clientWidth);
                if (remainingRight <= triggerDistance) {
                    extending = true;
                    const extendUnits = getExtendUnits();
                    const old_scroll_left = scrollLeft;

                    this.grid.end = add(
                        this.grid.end,
                        extendUnits,
                        this.config.step.unit,
                    );
                    this.viewport.extendBounds('future', extendUnits);
                    // Grid generates dates on-demand, no need to call setup_grid_date_values()
                    this.render();
                    e.currentTarget.scrollLeft = old_scroll_left;
                    setTimeout(() => (extending = false), 100);
                }
            });
        }

        $.on(this.$container, 'scroll', (e) => {
            let localBars = [];
            const ids = this.bars.map(({ group }) =>
                group.getAttribute('data-id'),
            );
            let dx;
            if (x_on_scroll_start) {
                dx = e.currentTarget.scrollLeft - x_on_scroll_start;
            }

            this.current_date = this.viewport.xToDate(e.currentTarget.scrollLeft);

            let current_upper = this.config.view_mode.upper_text(
                this.current_date,
                null,
                this.options.language,
            );
            let $el = this.upperTexts.find(
                (el) => el.textContent === current_upper,
            );

            if ($el) {
                this.current_date = this.viewport.xToDate(e.currentTarget.scrollLeft + $el.clientWidth);
                current_upper = this.config.view_mode.upper_text(
                    this.current_date,
                    null,
                    this.options.language,
                );
                $el = this.upperTexts.find(
                    (el) => el.textContent === current_upper,
                );
            }

            if ($el && $el !== this.$current) {
                if (this.$current)
                    this.$current.classList.remove('current-upper');

                $el.classList.add('current-upper');
                this.$current = $el;
            }

            x_on_scroll_start = e.currentTarget.scrollLeft;
            let [min_start, max_start, max_end] =
                this.get_start_end_positions();

            if (x_on_scroll_start > max_end + 100) {
                this.$adjust.innerHTML = '&larr;';
                this.$adjust.classList.remove('hide');
                this.$adjust.onclick = () => {
                    this.$container.scrollTo({
                        left: max_start,
                        behavior: 'smooth',
                    });
                };
            } else if (
                x_on_scroll_start + e.currentTarget.offsetWidth <
                min_start - 100
            ) {
                this.$adjust.innerHTML = '&rarr;';
                this.$adjust.classList.remove('hide');
                this.$adjust.onclick = () => {
                    this.$container.scrollTo({
                        left: min_start,
                        behavior: 'smooth',
                    });
                };
            } else {
                this.$adjust.classList.add('hide');
            }

            if (dx) {
                localBars = ids.map((id) => this.get_bar(id));
                if (this.options.auto_move_label) {
                    localBars.forEach((bar) => {
                        bar.updateLabelPositionOnHorizontalScroll({
                            x: dx,
                            sx: e.currentTarget.scrollLeft,
                        });
                    });
                }
            }
        });

        $.on(this.$svg, 'mousemove', (e) => {
            if (!action_in_progress()) return;
            const dx = (e.offsetX || e.layerX) - x_on_start;

            bars.forEach((bar) => {
                const $bar = bar.$bar;
                $bar.finaldx = this.get_snap_position(dx);
                this.hide_popup();
                if (is_resizing_left) {
                    if (parent_bar_id === bar.task.uid) {
                        bar.updateBarPosition({
                            x: $bar.ox + $bar.finaldx,
                            width: $bar.owidth - $bar.finaldx,
                        });
                    } else {
                        bar.updateBarPosition({
                            x: $bar.ox + $bar.finaldx,
                        });
                    }
                } else if (is_resizing_right) {
                    if (parent_bar_id === bar.task.uid) {
                        bar.updateBarPosition({
                            width: $bar.owidth + $bar.finaldx,
                        });
                    }
                } else if (
                    is_dragging &&
                    !this.options.readonly &&
                    !this.options.readonly_dates
                ) {
                    bar.updateBarPosition({ x: $bar.ox + $bar.finaldx });
                }
            });
        });

        document.addEventListener('mouseup', () => {
            is_dragging = false;
            is_resizing_left = false;
            is_resizing_right = false;
            this.$container
                .querySelector('.visible')
                ?.classList?.remove?.('visible');
        });

        $.on(this.$svg, 'mouseup', (e) => {
            this.bar_being_dragged = null;
            bars.forEach((bar) => {
                const $bar = bar.$bar;
                if (!$bar.finaldx) return;

                // Compute new dates from visual position
                const { newStart, newEnd } = bar.computeStartEndFromPosition();

                // Update task data
                const changed =
                    Temporal.Instant.compare(bar.task.start, newStart) !== 0 ||
                    Temporal.Instant.compare(bar.task.end, newEnd) !== 0;

                if (changed) {
                    bar.task.start = newStart;
                    bar.task.end = newEnd;
                    this.trigger_event('date_change', [
                        bar.task,
                        newStart,
                        add(newEnd, -1, 'second'),
                    ]);
                }

                bar.setActionCompleted();
            });
        });

        this.bind_bar_progress();
    }

    bind_bar_progress() {
        let x_on_start = 0;
        let y_on_start = 0;
        let is_resizing = null;
        let bar = null;
        let $bar_progress = null;
        let $bar = null;

        $.on(this.$svg, 'mousedown', '.handle.progress', (e, handle) => {
            is_resizing = true;
            x_on_start = e.offsetX || e.layerX;

            const $bar_wrapper = $.closest('.bar-wrapper', handle);
            const id = $bar_wrapper.getAttribute('data-id');
            bar = this.get_bar(id);

            $bar_progress = bar.$bar_progress;
            $bar = bar.$bar;

            $bar_progress.finaldx = 0;
            $bar_progress.owidth = $bar_progress.getWidth();
            $bar_progress.min_dx = -$bar_progress.owidth;
            $bar_progress.max_dx = $bar.getWidth() - $bar_progress.getWidth();
        });

        $.on(this.$svg, 'mousemove', (e) => {
            if (!is_resizing) return;
            const now_x = e.offsetX || e.layerX;

            let dx = now_x - x_on_start;
            if (dx > $bar_progress.max_dx) {
                dx = $bar_progress.max_dx;
            }
            if (dx < $bar_progress.min_dx) {
                dx = $bar_progress.min_dx;
            }

            $bar_progress.setAttribute('width', $bar_progress.owidth + dx);
            $.attr(bar.$handle_progress, 'cx', $bar_progress.getEndX());

            $bar_progress.finaldx = dx;
        });

        $.on(this.$svg, 'mouseup', () => {
            is_resizing = false;
            if (!($bar_progress && $bar_progress.finaldx)) return;

            $bar_progress.finaldx = 0;

            // Compute new progress from visual position
            const newProgress = bar.computeProgressFromPosition();
            bar.task.progress = newProgress;
            this.trigger_event('progress_change', [bar.task, newProgress]);

            bar.setActionCompleted();
            bar = null;
            $bar_progress = null;
            $bar = null;
        });
    }

    get_all_dependent_tasks(task_id) {
        return this.taskStore.getAllDependentIds(task_id);
    }

    get_snap_position(dx) {
        const step_duration = parseDuration(this.config.view_mode.step);
        const default_snap =
            this.options.snap_at || this.config.view_mode.snap_at || '1d';

        // Calculate snap duration
        let snap_duration = step_duration;
        if (default_snap !== 'unit') {
            snap_duration = parseDuration(default_snap);
        }

        // Get durations in milliseconds for ratio calculation
        const relativeTo = Temporal.Now.plainDateISO();
        const step_ms = step_duration.total({ unit: 'millisecond', relativeTo });
        const snap_ms = snap_duration.total({ unit: 'millisecond', relativeTo });

        // Snap width in pixels
        const snap_pixels = (snap_ms / step_ms) * this.config.step.column_width;

        // Snap to nearest grid position
        return Math.round(dx / snap_pixels) * snap_pixels;
    }

    unselect_all() {
        if (this.popup) this.popup.parent.classList.add('hide');
        this.$container
            .querySelectorAll('.date-range-highlight')
            .forEach((k) => k.classList.add('hide'));
    }

    view_is(modes) {
        if (typeof modes === 'string') {
            return this.config.view_mode.name === modes;
        }

        if (Array.isArray(modes)) {
            return modes.some(view_is);
        }

        return this.config.view_mode.name === modes.name;
    }

    get_task(id) {
        return this.taskStore.get(id);
    }

    get_bar(id) {
        return this.barStore.get(id);
    }

    show_popup(opts) {
        if (this.options.popup === false) return;
        if (!this.popup) {
            this.popup = new Popup(
                this.$popup_wrapper,
                this.options.popup,
                this,
            );
        }
        this.popup.show(opts);
    }

    hide_popup() {
        this.popup && this.popup.hide();
    }

    trigger_event(event, args) {
        if (this.options['on_' + event]) {
            this.options['on_' + event].apply(this, args);
        }
    }

    /**
     * Gets the oldest starting date from the list of tasks
     *
     * @returns Temporal.Instant
     * @memberof Gantt
     */
    get_oldest_starting_date() {
        return this.taskStore.getOldestStart();
    }

    /**
     * Clear all elements from the parent svg element
     *
     * @memberof Gantt
     */
    clear() {
        this.$svg.innerHTML = '';
        this.$header?.remove?.();
        this.$side_header?.remove?.();
        this.$current_highlight?.remove?.();
        this.$extras?.remove?.();
        this.popup?.hide?.();
    }
}

Gantt.VIEW_MODE = {
    HOUR: DEFAULT_VIEW_MODES[0],
    QUARTER_DAY: DEFAULT_VIEW_MODES[1],
    HALF_DAY: DEFAULT_VIEW_MODES[2],
    DAY: DEFAULT_VIEW_MODES[3],
    WEEK: DEFAULT_VIEW_MODES[4],
    MONTH: DEFAULT_VIEW_MODES[5],
    YEAR: DEFAULT_VIEW_MODES[6],
};
