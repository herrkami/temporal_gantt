import {
    ensureInstant,
    toPlainDateTime,
    Temporal,
    floor,
    parseDuration,
    parseDurationString,
    add,
} from './temporal_utils';
import { $ } from './svg_utils';

import Chart from './chart';
import Tasks from './tasks';

import { DEFAULT_OPTIONS, DEFAULT_VIEW_MODES } from './defaults';

import './styles/gantt.css';

export default class Gantt {
    constructor(wrapper, tasks, options) {
        this.config = {};
        this.grid = {};
        this.taskStore = new Tasks();

        this.setup_options(options);
        this.setup_chart(wrapper);
        this.load_task_list(tasks);
        this.change_view_mode();
        this.bind_events();
    }

    setup_chart(wrapper) {
        this.chart = new Chart(this);
        this.chart.setupWrapper(wrapper);
        this.chart.initializeManagers();

        // Apply CSS variables to container
        const CSS_VARIABLES = {
            'grid-height': 'container_height',
            'bar-height': 'bar_height',
            'lower-header-height': 'lower_header_height',
            'upper-header-height': 'upper_header_height',
        };
        for (let name in CSS_VARIABLES) {
            let setting = this.options[CSS_VARIABLES[name]];
            if (setting !== 'auto')
                this.chart.$container.style.setProperty(
                    '--gv-' + name,
                    setting + 'px',
                );
        }
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
                            return pdt.dayOfWeek === 6 || pdt.dayOfWeek === 7;
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
            const bar = this.chart.getBar(task.uid);
            bar?.refresh();
        }
    }

    change_view_mode(mode = this.options.view_mode, maintain_pos = false) {
        if (typeof mode === 'string') {
            mode = this.options.view_modes.find((d) => d.name === mode);
        }
        let old_date, old_scroll_op;
        if (maintain_pos && this.chart.viewport) {
            // Save the date at current scroll position
            old_date = this.chart.viewport.xToDate(this.chart.$container.scrollLeft);
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
            const new_pos = this.chart.viewport.dateToX(old_date);
            this.chart.$container.scrollLeft = new_pos;
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

        this.chart.$container.style.setProperty(
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

        this.chart.setupViewport(viewportOptions);
        this.chart.setViewMode(this.config.view_mode);

        // Alias for backward compatibility
        this.viewport = this.chart.viewport;
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
        const container_width = this.chart.$container?.clientWidth || 0;
        if (!container_width) return;

        const columns_in_viewport = Math.ceil(container_width / this.config.step.column_width) + 1;

        let grid_width = columns_in_viewport * this.config.step.interval;
        this.grid.end = add(this.grid.start, grid_width, this.config.step.unit);

        const must_include = [];
        if (target_date) {
            must_include.push(ensureInstant(target_date));
        }
        if (this.options.today_button) {
            must_include.push(Temporal.Now.instant());
        }

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

    render(skipScrollReset = false) {
        this.chart.render();

        // Aliases for backward compatibility
        this.bars = this.chart.getAllBars();
        this.arrows = this.chart.getAllArrows();
        this.upperTexts = this.chart.upperTexts;
        this.$upper_header = this.chart.$upper_header;

        // Set scroll position (skip during infinite scroll extension)
        if (!skipScrollReset) {
            this.set_scroll_position(this.options.scroll_to);
        }
    }

    set_scroll_position(date) {
        this.chart.setScrollPosition(date);
    }

    scroll_current() {
        this.chart.scrollToCurrent();
    }

    get_closest_date() {
        return this.chart.getClosestDate();
    }

    bind_grid_click() {
        $.on(
            this.chart.$container,
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
            this.chart.$container.querySelectorAll('.holiday-highlight');
        for (let h of $highlights) {
            const label = this.chart.$container.querySelector(
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

    bind_bar_events() {
        const chart = this.chart;
        let is_dragging = false;
        let x_on_start = 0;
        let x_on_scroll_start = 0;
        let is_resizing_left = false;
        let is_resizing_right = false;
        let parent_bar_id = null;
        let bars = [];
        this.bar_being_dragged = null;

        const action_in_progress = () =>
            is_dragging || is_resizing_left || is_resizing_right;

        chart.$svg.onclick = (e) => {
            if (e.target.classList.contains('grid-row')) this.unselect_all();
        };

        let pos = 0;
        $.on(chart.$svg, 'mousemove', '.bar-wrapper, .handle', (e) => {
            if (
                this.bar_being_dragged === false &&
                Math.abs((e.offsetX || e.layerX) - pos) > 10
            )
                this.bar_being_dragged = true;
        });

        $.on(chart.$svg, 'mousedown', '.bar-wrapper, .handle', (e, element) => {
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

            if (chart.popup) chart.popup.hide();

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
            const getTriggerDistance = () => chart.$container.clientWidth * 2;
            const getExtendUnits = () => Math.ceil((chart.$container.clientWidth * 3) / this.config.step.column_width);

            $.on(chart.$container, 'mousewheel', (e) => {
                if (extending) return;

                const scrollLeft = e.currentTarget.scrollLeft;
                const scrollWidth = e.currentTarget.scrollWidth;
                const clientWidth = e.currentTarget.clientWidth;
                const triggerDistance = getTriggerDistance();

                if (scrollLeft <= triggerDistance) {
                    extending = true;
                    const extendUnits = getExtendUnits();
                    const dateAtScroll = chart.viewport.xToDate(scrollLeft);

                    this.grid.start = add(
                        this.grid.start,
                        -extendUnits,
                        this.config.step.unit,
                    );
                    chart.extendBounds('past', extendUnits);
                    this.render(true);
                    e.currentTarget.scrollLeft = chart.viewport.dateToX(dateAtScroll);
                    setTimeout(() => (extending = false), 100);
                    return;
                }

                const remainingRight = scrollWidth - (scrollLeft + clientWidth);
                if (remainingRight <= triggerDistance) {
                    extending = true;
                    const extendUnits = getExtendUnits();
                    const dateAtScroll = chart.viewport.xToDate(scrollLeft);

                    this.grid.end = add(
                        this.grid.end,
                        extendUnits,
                        this.config.step.unit,
                    );
                    chart.extendBounds('future', extendUnits);
                    this.render(true);
                    e.currentTarget.scrollLeft = chart.viewport.dateToX(dateAtScroll);
                    setTimeout(() => (extending = false), 100);
                }
            });
        }

        $.on(chart.$container, 'scroll', (e) => {
            let localBars = [];
            const ids = this.bars.map(({ group }) =>
                group.getAttribute('data-id'),
            );
            let dx;
            if (x_on_scroll_start) {
                dx = e.currentTarget.scrollLeft - x_on_scroll_start;
            }

            const current_date = chart.viewport.xToDate(e.currentTarget.scrollLeft);

            let current_upper = this.config.view_mode.upper_text(
                current_date,
                null,
                this.options.language,
            );
            let $el = chart.upperTexts.find(
                (el) => el.textContent === current_upper,
            );

            if ($el) {
                const next_date = chart.viewport.xToDate(e.currentTarget.scrollLeft + $el.clientWidth);
                current_upper = this.config.view_mode.upper_text(
                    next_date,
                    null,
                    this.options.language,
                );
                $el = chart.upperTexts.find(
                    (el) => el.textContent === current_upper,
                );
            }

            if ($el && $el !== chart.$current) {
                if (chart.$current)
                    chart.$current.classList.remove('current-upper');

                $el.classList.add('current-upper');
                chart.$current = $el;
            }

            x_on_scroll_start = e.currentTarget.scrollLeft;
            let [min_start, max_start, max_end] =
                chart.getStartEndPositions();

            if (x_on_scroll_start > max_end + 100) {
                chart.$adjust.innerHTML = '&larr;';
                chart.$adjust.classList.remove('hide');
                chart.$adjust.onclick = () => {
                    chart.$container.scrollTo({
                        left: max_start,
                        behavior: 'smooth',
                    });
                };
            } else if (
                x_on_scroll_start + e.currentTarget.offsetWidth <
                min_start - 100
            ) {
                chart.$adjust.innerHTML = '&rarr;';
                chart.$adjust.classList.remove('hide');
                chart.$adjust.onclick = () => {
                    chart.$container.scrollTo({
                        left: min_start,
                        behavior: 'smooth',
                    });
                };
            } else {
                chart.$adjust.classList.add('hide');
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

        $.on(chart.$svg, 'mousemove', (e) => {
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
            chart.$container
                .querySelector('.visible')
                ?.classList?.remove?.('visible');
        });

        $.on(chart.$svg, 'mouseup', () => {
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
        const chart = this.chart;
        let x_on_start = 0;
        let is_resizing = null;
        let bar = null;
        let $bar_progress = null;
        let $bar = null;

        $.on(chart.$svg, 'mousedown', '.handle.progress', (e, handle) => {
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

        $.on(chart.$svg, 'mousemove', (e) => {
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

        $.on(chart.$svg, 'mouseup', () => {
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

    // Scheduler-territory methods (kept in Gantt for future extraction)

    get_all_dependent_tasks(task_id) {
        return this.taskStore.getAllDependentIds(task_id);
    }

    get_snap_position(dx) {
        const step_duration = parseDuration(this.config.view_mode.step);
        const default_snap =
            this.options.snap_at || this.config.view_mode.snap_at || '1d';

        let snap_duration = step_duration;
        if (default_snap !== 'unit') {
            snap_duration = parseDuration(default_snap);
        }

        const relativeTo = Temporal.Now.plainDateISO();
        const step_ms = step_duration.total({ unit: 'millisecond', relativeTo });
        const snap_ms = snap_duration.total({ unit: 'millisecond', relativeTo });

        const snap_pixels = (snap_ms / step_ms) * this.config.step.column_width;

        return Math.round(dx / snap_pixels) * snap_pixels;
    }

    // Public API methods

    unselect_all() {
        this.chart.unselectAll();
    }

    view_is(modes) {
        if (typeof modes === 'string') {
            return this.config.view_mode.name === modes;
        }

        if (Array.isArray(modes)) {
            return modes.some((m) => this.view_is(m));
        }

        return this.config.view_mode.name === modes.name;
    }

    get_task(id) {
        return this.taskStore.get(id);
    }

    get_bar(id) {
        return this.chart.getBar(id);
    }

    show_popup(opts) {
        this.chart.showPopup(opts);
    }

    hide_popup() {
        this.chart.hidePopup();
    }

    trigger_event(event, args) {
        if (this.options['on_' + event]) {
            this.options['on_' + event].apply(this, args);
        }
    }

    get_oldest_starting_date() {
        return this.taskStore.getOldestStart();
    }

    // Backward compatibility aliases
    get $svg() {
        return this.chart.$svg;
    }

    get $container() {
        return this.chart.$container;
    }

    get gridRenderer() {
        return this.chart.grid;
    }

    get barStore() {
        return this.chart.bars;
    }

    get arrowStore() {
        return this.chart.arrows;
    }

    get popup() {
        return this.chart.popup;
    }

    get layers() {
        return this.chart.layers;
    }

    create_el(opts) {
        return this.chart.createElement({
            ...opts,
            appendTo: opts.append_to,
        });
    }

    clear() {
        this.chart.clear();
    }

    get_start_end_positions() {
        return this.chart.getStartEndPositions();
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