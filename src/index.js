import {
    ensureInstant,
    toPlainDateTime,
    toInstant,
    Temporal,
    startOf,
    parseInstant,
    parseDuration,
    parseDurationString,
    add,
    diff,
    format,
    getDaysInMonth,
    getDaysInYear,
    convertToUnit,
} from './temporal_utils';
import { $, createSVG } from './svg_utils';

import Arrow from './arrow';
import Bar from './bar';
import Popup from './popup';

import { DEFAULT_OPTIONS, DEFAULT_VIEW_MODES } from './defaults';

import './styles/gantt.css';

export default class Gantt {
    constructor(wrapper, tasks, options) {
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
            extend_by_units: 10,
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
        // TODO This function should only read the task description. Deriving
        // missing start/end/duration should happen in a separate scheduler.
        this.tasks = task_list.map((task_raw, i) => {
            let task = {};

            // Copy name
            task.name = task_raw.name;
            // Copy progress
            task.progress = task_raw.progress;

            // Copy or assign unique ID
            if (!task_raw.id) {
                task.uid = generate_uid(task_raw);
            } else if (typeof task_raw.id === 'string') {
                task.uid = task_raw.id.replaceAll(' ', '_');
            } else {
                // TODO looks a bit unsafe
                task.uid = `${task_raw.id}`;
            }

            // Dependencies
            let deps = [];
            if (typeof task_raw.dependencies === 'string') {
                deps = task_raw.dependencies
                    .split(',')
                    .map((d) => d.trim().replaceAll(' ', '_'))
                    .filter((d) => d);
            }
            task.dependencies = deps;

            // Start must be defined
            if (!task_raw.start) {
                console.error(
                    `task "${task_raw.name}" (ID: "${task_raw.id}") doesn't have a start date`,
                );
                return false;
            } else {
                task.start = parseInstant(task_raw.start);
            }

            // Parse duration if defined
            if (task_raw.duration !== undefined) {
                // E.g. '4h 30min'
                task_raw.duration.split(' ').forEach((ds) => {
                    let { value, unit } =
                        parseDurationString(ds);
                    task.end = add(task.start, value, unit);
                    task.duration = diff(task.end, task.start);
                });
            }

            // Parse end if defined
            if (task_raw.end !== undefined) {
                const desc_end = parseInstant(task_raw.end);
                if (task.end !== undefined) {
                    // End has already been derived from duration
                    if (Temporal.Instant.compare(task.end, desc_end) != 0) {
                        // Redundantly consistent
                        console.warn(
                            `end of task "${task_raw.name}" (ID: "${task_raw.id}") is redundantly defined by duration`,
                        );
                    } else {
                        // Duration and end inconsistent
                        console.error(
                            `end date of task "${task_raw.name}" (ID: "${task_raw.id}") contradicts its start and duration`,
                        );
                        return false;
                    }
                } else {
                    task.end = desc_end;
                }
            }

            // Neither duration nor end were defined
            if (!task.end) {
                console.error(`task "${task_raw.name}" (ID: "${task_raw.id}") has neither end date nor duration`);
                return false;
            }

            // Check if end is before start
            if (Temporal.Instant.compare(task.end, task.start) < 0) {
                console.error(
                    `start of task can't be after end of task: in task "${task_raw.name}" (ID: "${task_raw.id}")`,
                );
                return false;
            }

            // Invalidate task if duration too large
            if (diff(task.end, task.start, 'year') > 10) {
                console.error(
                    `the duration of task "${task_raw.name}" (ID: "${task_raw.id}") is too long (above ten years)`,
                );
                return false;
            }

            // Cache index
            task._index = i;

            // TODO: This check should be performed on the task description earlier
            // If hours is not set, assume the last day is a full day
            // e.g: 2018-09-09 becomes 2018-09-09 23:59:59
            const task_end_pdt = toPlainDateTime(task.end);
            if (task_end_pdt.hour === 0 && task_end_pdt.minute === 0 &&
                task_end_pdt.second === 0 && task_end_pdt.millisecond === 0) {
                task.end = add(task.end, 24, 'hour');
            }
            return task;
        })
            // Keep only non-false tasks
            .filter((t) => t);
        this.setup_dependencies();
    }

    setup_dependencies() {
        this.dependency_map = {};
        for (let t of this.tasks) {
            for (let d of t.dependencies) {
                this.dependency_map[d] = this.dependency_map[d] || [];
                this.dependency_map[d].push(t.uid);
            }
        }
    }

    refresh(tasks) {
        this.load_task_list(tasks);
        this.change_view_mode();
    }

    update_task(id, new_details) {
        let task = this.tasks.find((t) => t.uid === id);
        let bar = this.bars[task._index];
        Object.assign(task, new_details);
        bar.refresh();
    }

    change_view_mode(mode = this.options.view_mode, maintain_pos = false) {
        if (typeof mode === 'string') {
            mode = this.options.view_modes.find((d) => d.name === mode);
        }
        let old_pos, old_scroll_op;
        if (maintain_pos) {
            old_pos = this.$container.scrollLeft;
            old_scroll_op = this.options.scroll_to;
            this.options.scroll_to = null;
        }
        this.options.view_mode = mode.name;
        this.config.view_mode = mode;
        this.update_view_scale(mode);
        this.setup_dates(maintain_pos);
        this.render();
        if (maintain_pos) {
            this.$container.scrollLeft = old_pos;
            this.options.scroll_to = old_scroll_op;
        }
        this.trigger_event('view_change', [mode]);
    }

    update_view_scale(mode) {
        let { value, unit } = parseDurationString(mode.step);
        this.config.step = value;
        this.config.unit = unit;

        // Validate step duration
        if (value <= 0) {
            console.warn(`Invalid step duration: ${value} ${unit}. Using default step of 1 day.`);
            this.config.step = 1;
            this.config.unit = 'day';
        }

        this.config.column_width =
            this.options.column_width || mode.column_width || 45;

        // Validate column width
        if (this.config.column_width <= 0) {
            console.warn(`Invalid column width: ${this.config.column_width}. Using default value of 45.`);
            this.config.column_width = 45;
        }

        this.$container.style.setProperty(
            '--gv-column-width',
            this.config.column_width + 'px',
        );
        this.config.header_height =
            this.options.lower_header_height +
            this.options.upper_header_height +
            10;
    }

    setup_dates(refresh = false) {
        this.setup_gantt_dates(refresh);
        this.setup_date_values();
    }

    setup_gantt_dates(refresh) {
        let gantt_start, gantt_end;
        if (!this.tasks.length) {
            gantt_start = Temporal.Now.instant();
            gantt_end = Temporal.Now.instant();
        }

        for (let task of this.tasks) {
            if (!gantt_start || Temporal.Instant.compare(task.start, gantt_start) < 0) {
                gantt_start = task.start;
            }
            if (!gantt_end || Temporal.Instant.compare(task.end, gantt_end) > 0) {
                gantt_end = task.end;
            }
        }

        gantt_start = startOf(gantt_start, this.config.unit);
        gantt_end = startOf(gantt_end, this.config.unit);

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
                this.gantt_start = add(
                    gantt_start,
                    -padding_start.value,
                    padding_start.unit,
                );
                this.gantt_end = add(
                    gantt_end,
                    padding_end.value,
                    padding_end.unit,
                );
            } else {
                this.gantt_start = add(
                    gantt_start,
                    -this.config.extend_by_units * 3,
                    this.config.unit,
                );
                this.gantt_end = add(
                    gantt_end,
                    this.config.extend_by_units * 3,
                    this.config.unit,
                );
            }
        }
        this.config.date_format =
            this.config.view_mode.date_format || this.options.date_format;
        // Normalize gantt_start to midnight
        this.gantt_start = startOf(this.gantt_start, 'day');
    }

    setup_date_values() {
        let cur_pdt = toPlainDateTime(this.gantt_start);
        this.dates = [this.gantt_start];

        // Use Duration for date iteration
        const step_duration = parseDuration(this.config.view_mode.step);
        const gantt_end_pdt = toPlainDateTime(this.gantt_end);

        while (Temporal.PlainDateTime.compare(cur_pdt, gantt_end_pdt) < 0) {
            cur_pdt = cur_pdt.add(step_duration);
            this.dates.push(toInstant(cur_pdt));
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
        this.make_grid();
        this.make_dates();
        this.make_grid_extras();
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

    make_grid() {
        this.make_grid_background();
        this.make_grid_rows();
        this.make_grid_header();
        this.make_side_header();
    }

    make_grid_extras() {
        this.make_grid_highlights();
        this.make_grid_ticks();
    }

    make_grid_background() {
        const grid_width = this.dates.length * this.config.column_width;
        const grid_height = Math.max(
            this.config.header_height +
            this.options.padding +
            (this.options.bar_height + this.options.padding) *
            this.tasks.length -
            10,
            this.options.container_height !== 'auto'
                ? this.options.container_height
                : 0,
        );

        createSVG('rect', {
            x: 0,
            y: 0,
            width: grid_width,
            height: grid_height,
            class: 'grid-background',
            append_to: this.$svg,
        });

        $.attr(this.$svg, {
            height: grid_height,
            width: '100%',
        });
        this.grid_height = grid_height;
        if (this.options.container_height === 'auto')
            this.$container.style.height = grid_height + 'px';
    }

    make_grid_rows() {
        const rows_layer = createSVG('g', { append_to: this.layers.grid });

        const row_width = this.dates.length * this.config.column_width;
        const row_height = this.options.bar_height + this.options.padding;

        let y = this.config.header_height;
        for (
            let y = this.config.header_height;
            y < this.grid_height;
            y += row_height
        ) {
            createSVG('rect', {
                x: 0,
                y,
                width: row_width,
                height: row_height,
                class: 'grid-row',
                append_to: rows_layer,
            });
        }
    }

    make_grid_header() {
        this.$header = this.create_el({
            width: this.dates.length * this.config.column_width,
            classes: 'grid-header',
            append_to: this.$container,
        });

        this.$upper_header = this.create_el({
            classes: 'upper-header',
            append_to: this.$header,
        });
        this.$lower_header = this.create_el({
            classes: 'lower-header',
            append_to: this.$header,
        });
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

    make_grid_ticks() {
        if (this.options.lines === 'none') return;
        let tick_x = 0;
        let tick_y = this.config.header_height;
        let tick_height = this.grid_height - this.config.header_height;

        let $lines_layer = createSVG('g', {
            class: 'lines_layer',
            append_to: this.layers.grid,
        });

        let row_y = this.config.header_height;

        const row_width = this.dates.length * this.config.column_width;
        const row_height = this.options.bar_height + this.options.padding;
        if (this.options.lines !== 'vertical') {
            for (
                let y = this.config.header_height;
                y < this.grid_height;
                y += row_height
            ) {
                createSVG('line', {
                    x1: 0,
                    y1: row_y + row_height,
                    x2: row_width,
                    y2: row_y + row_height,
                    class: 'row-line',
                    append_to: $lines_layer,
                });
                row_y += row_height;
            }
        }
        if (this.options.lines === 'horizontal') return;

        for (let instant of this.dates) {
            let tick_class = 'tick';
            if (
                this.config.view_mode.thick_line &&
                this.config.view_mode.thick_line(instant)
            ) {
                tick_class += ' thick';
            }

            createSVG('path', {
                d: `M ${tick_x} ${tick_y} v ${tick_height}`,
                class: tick_class,
                append_to: this.layers.grid,
            });

            if (this.view_is('month')) {
                tick_x +=
                    (getDaysInMonth(instant) *
                        this.config.column_width) /
                    30;
            } else if (this.view_is('year')) {
                tick_x +=
                    (getDaysInYear(instant) *
                        this.config.column_width) /
                    365;
            } else {
                tick_x += this.config.column_width;
            }
        }
    }

    highlight_holidays() {
        let labels = new Map();
        if (!this.options.holidays) return;

        const oneDay = Temporal.Duration.from({ days: 1 });

        for (let color in this.options.holidays) {
            let check_highlight = this.options.holidays[color];
            if (check_highlight === 'weekend')
                check_highlight = this.options.is_weekend || DEFAULT_OPTIONS.is_weekend;
            let extra_func;

            if (typeof check_highlight === 'object') {
                // Check if it's a single named holiday object {date, name}
                if (check_highlight.name && check_highlight.date) {
                    let dateInstant = ensureInstant(check_highlight.date + ' ');
                    labels.set(dateInstant.toString(), check_highlight.name);
                    check_highlight = (instant) =>
                        Temporal.Instant.compare(dateInstant, ensureInstant(instant)) === 0;
                } else if (Array.isArray(check_highlight)) {
                    // It's an array of dates/objects
                    let f = check_highlight.find((k) => typeof k === 'function');
                    if (f) {
                        extra_func = f;
                    }
                    const holidayInstants = this.options.holidays[color]
                        .filter((k) => typeof k !== 'function')
                        .map((k) => {
                            if (k.name) {
                                let dateInstant = ensureInstant(k.date + ' ');
                                labels.set(dateInstant.toString(), k.name);
                                return dateInstant;
                            }
                            return ensureInstant(k + ' ');
                        });
                    check_highlight = (instant) =>
                        holidayInstants.some((hi) => Temporal.Instant.compare(hi, ensureInstant(instant)) === 0);
                }
            }

            // Skip if check_highlight is not a valid function
            if (typeof check_highlight !== 'function') {
                continue;
            }

            // Iterate through days using Duration
            let currentPdt = toPlainDateTime(this.gantt_start);
            const endPdt = toPlainDateTime(this.gantt_end);

            while (Temporal.PlainDateTime.compare(currentPdt, endPdt) <= 0) {
                const d = toInstant(currentPdt);

                if (
                    this.config.ignored_dates.some(
                        (k) => Temporal.Instant.compare(ensureInstant(k), d) === 0,
                    ) ||
                    (this.config.ignored_function &&
                        this.config.ignored_function(d))
                ) {
                    currentPdt = currentPdt.add(oneDay);
                    continue;
                }

                if (check_highlight(d) || (extra_func && extra_func(d))) {
                    const x =
                        (diff(
                            d,
                            this.gantt_start,
                            this.config.unit,
                        ) /
                            this.config.step) *
                        this.config.column_width;
                    const height = this.grid_height - this.config.header_height;
                    const d_formatted = format(d, 'YYYY-MM-DD', this.options.language)
                        .replace(' ', '_');

                    const labelText = labels.get(d.toString());
                    if (labelText) {
                        let label = this.create_el({
                            classes: 'holiday-label ' + 'label_' + d_formatted,
                            append_to: this.$extras,
                        });
                        label.textContent = labelText;
                    }
                    createSVG('rect', {
                        x: Math.round(x),
                        y: this.config.header_height,
                        width:
                            this.config.column_width /
                            convertToUnit(
                                this.config.view_mode.step,
                                'day',
                            ),
                        height,
                        class: 'holiday-highlight ' + d_formatted,
                        style: `fill: ${color};`,
                        append_to: this.layers.grid,
                    });
                }
                currentPdt = currentPdt.add(oneDay);
            }
        }
    }

    /**
     * Compute the horizontal x-axis distance and associated date for the current date and view.
     *
     * @returns Object containing the x-axis distance and date of the current date, or null if the current date is out of the gantt range.
     */
    highlight_current() {
        const res = this.get_closest_date();
        if (!res) return;

        const [_, el] = res;
        el.classList.add('current-date-highlight');

        const now = Temporal.Now.instant();
        const diff_in_units = diff(now, this.gantt_start, this.config.unit);
        const left = (diff_in_units / this.config.step) * this.config.column_width;

        this.$current_highlight = this.create_el({
            top: this.config.header_height,
            left,
            height: this.grid_height - this.config.header_height,
            classes: 'current-highlight',
            append_to: this.$container,
        });
        this.$current_ball_highlight = this.create_el({
            top: this.config.header_height - 6,
            left: left - 2.5,
            width: 6,
            height: 6,
            classes: 'current-ball-highlight',
            append_to: this.$header,
        });
    }

    make_grid_highlights() {
        this.highlight_holidays();
        this.config.ignored_positions = [];

        const height =
            (this.options.bar_height + this.options.padding) *
            this.tasks.length;
        this.layers.grid.innerHTML += `<pattern id="diagonalHatch" patternUnits="userSpaceOnUse" width="4" height="4">
          <path d="M-1,1 l2,-2
                   M0,4 l4,-4
                   M3,5 l2,-2"
                style="stroke:grey; stroke-width:0.3" />
        </pattern>`;

        const oneDay = Temporal.Duration.from({ days: 1 });
        let currentPdt = toPlainDateTime(this.gantt_start);
        const endPdt = toPlainDateTime(this.gantt_end);

        while (Temporal.PlainDateTime.compare(currentPdt, endPdt) <= 0) {
            const d = toInstant(currentPdt);

            if (
                // TODO
                // Arbitrary ignored_dates requires different check
                !this.config.ignored_dates.some(
                    (k) => Temporal.Instant.compare(ensureInstant(k), d) === 0,
                ) &&
                (!this.config.ignored_function ||
                    !this.config.ignored_function(d))
            ) {
                currentPdt = currentPdt.add(oneDay);
                continue;
            }

            let positionOffset =
                convertToUnit(
                    diff(d, this.gantt_start) + 'd',
                    this.config.unit,
                ) / this.config.step;

            this.config.ignored_positions.push(positionOffset * this.config.column_width);
            createSVG('rect', {
                x: positionOffset * this.config.column_width,
                y: this.config.header_height,
                width: this.config.column_width,
                height: height,
                class: 'ignored-bar',
                style: 'fill: url(#diagonalHatch);',
                append_to: this.$svg,
            });

            currentPdt = currentPdt.add(oneDay);
        }

        const highlightDimensions = this.highlight_current(
            this.config.view_mode,
        );

        if (!highlightDimensions) return;
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

    make_dates() {
        this.get_dates_to_draw().forEach((date, i) => {
            if (date.lower_text) {
                let $lower_text = this.create_el({
                    left: date.x,
                    top: date.lower_y,
                    classes: 'lower-text date_' + sanitize(date.formatted_date),
                    append_to: this.$lower_header,
                });
                $lower_text.innerText = date.lower_text;
            }

            if (date.upper_text) {
                let $upper_text = this.create_el({
                    left: date.x,
                    top: date.upper_y,
                    classes: 'upper-text',
                    append_to: this.$upper_header,
                });
                $upper_text.innerText = date.upper_text;
            }
        });
        this.upperTexts = Array.from(
            this.$container.querySelectorAll('.upper-text'),
        );
    }

    get_dates_to_draw() {
        let last_date_info = null;
        const dates = this.dates.map((instant, i) => {
            const d = this.get_date_info(instant, last_date_info, i);
            last_date_info = d;
            return d;
        });
        return dates;
    }

    get_date_info(instant, last_date_info) {
        let last_instant = last_date_info ? last_date_info.instant : null;

        let column_width = this.config.column_width;

        const x = last_date_info
            ? last_date_info.x + last_date_info.column_width
            : 0;

        let upper_text = this.config.view_mode.upper_text;
        let lower_text = this.config.view_mode.lower_text;

        if (!upper_text) {
            this.config.view_mode.upper_text = () => '';
        } else if (typeof upper_text === 'string') {
            this.config.view_mode.upper_text = (instant) =>
                format(instant, upper_text, this.options.language);
        }

        if (!lower_text) {
            this.config.view_mode.lower_text = () => '';
        } else if (typeof lower_text === 'string') {
            this.config.view_mode.lower_text = (instant) =>
                format(instant, lower_text, this.options.language);
        }

        return {
            instant,
            date: instant, // backward compatibility
            formatted_date: sanitize(
                format(
                    instant,
                    this.config.date_format,
                    this.options.language,
                ),
            ),
            column_width: this.config.column_width,
            x,
            upper_text: this.config.view_mode.upper_text(
                instant,
                last_instant,
                this.options.language,
            ),
            lower_text: this.config.view_mode.lower_text(
                instant,
                last_instant,
                this.options.language,
            ),
            upper_y: 17,
            lower_y: this.options.upper_header_height + 5,
        };
    }

    make_bars() {
        this.bars = this.tasks.map((task) => {
            const bar = new Bar(this, task);
            this.layers.bar.appendChild(bar.group);
            return bar;
        });
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
        for (let bar of this.bars) {
            bar.arrows = this.arrows.filter((arrow) => {
                return (
                    arrow.from_task.task.uid === bar.task.uid ||
                    arrow.to_task.task.uid === bar.task.uid
                );
            });
        }
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
            date = this.gantt_start;
        } else if (date === 'end') {
            date = this.gantt_end;
        } else if (date === 'today') {
            return this.scroll_current();
        } else if (typeof date === 'string') {
            date = parseInstant(date);
        }

        // Calculate scroll position using Duration
        const diff_in_units = diff(ensureInstant(date), this.gantt_start, this.config.unit);
        const scroll_pos = (diff_in_units / this.config.step) * this.config.column_width;

        this.$container.scrollTo({
            left: scroll_pos - this.config.column_width / 6,
            behavior: 'smooth',
        });

        // Calculate current scroll position's upper text using Duration
        if (this.$current) {
            this.$current.classList.remove('current-upper');
        }

        const scroll_units =
            (this.$container.scrollLeft / this.config.column_width) *
            this.config.step;
        this.current_date = add(this.gantt_start, scroll_units, this.config.unit);

        let current_upper = this.config.view_mode.upper_text(
            this.current_date,
            null,
            this.options.language,
        );
        let $el = this.upperTexts.find(
            (el) => el.textContent === current_upper,
        );

        if ($el) {
            // Recalculate using Duration
            const adjusted_scroll_units =
                ((this.$container.scrollLeft + $el.clientWidth) /
                    this.config.column_width) *
                this.config.step;
            this.current_date = add(this.gantt_start, adjusted_scroll_units, this.config.unit);
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
        const now = Temporal.Now.instant();

        if (Temporal.Instant.compare(now, this.gantt_start) < 0 ||
            Temporal.Instant.compare(now, this.gantt_end) > 0) return null;

        let current = Temporal.Now.instant();
        let el = this.$container.querySelector(
            '.date_' +
            sanitize(
                format(
                    current,
                    this.config.date_format,
                    this.options.language,
                ),
            ),
        );

        // safety check to prevent infinite loop
        let c = 0;
        while (!el && c < this.config.step) {
            current = add(current, -1, this.config.unit);
            el = this.$container.querySelector(
                '.date_' +
                sanitize(
                    format(
                        current,
                        this.config.date_format,
                        this.options.language,
                    ),
                ),
            );
            c++;
        }

        // Parse the formatted date string back to an instant
        const formattedDate = format(
            current,
            this.config.date_format,
            this.options.language,
        );
        return [
            ensureInstant(formattedDate + ' '),
            el,
        ];
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
            let extended = false;
            $.on(this.$container, 'mousewheel', (e) => {
                let trigger = this.$container.scrollWidth / 2;
                if (!extended && e.currentTarget.scrollLeft <= trigger) {
                    let old_scroll_left = e.currentTarget.scrollLeft;
                    extended = true;

                    this.gantt_start = add(
                        this.gantt_start,
                        -this.config.extend_by_units,
                        this.config.unit,
                    );
                    this.setup_date_values();
                    this.render();
                    e.currentTarget.scrollLeft =
                        old_scroll_left +
                        this.config.column_width * this.config.extend_by_units;
                    setTimeout(() => (extended = false), 300);
                }

                if (
                    !extended &&
                    e.currentTarget.scrollWidth -
                    (e.currentTarget.scrollLeft +
                        e.currentTarget.clientWidth) <=
                    trigger
                ) {
                    let old_scroll_left = e.currentTarget.scrollLeft;
                    extended = true;
                    this.gantt_end = add(
                        this.gantt_end,
                        this.config.extend_by_units,
                        this.config.unit,
                    );
                    this.setup_date_values();
                    this.render();
                    e.currentTarget.scrollLeft = old_scroll_left;
                    setTimeout(() => (extended = false), 300);
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

            // Calculate current scroll position's upper text using Duration
            const scroll_units =
                (e.currentTarget.scrollLeft / this.config.column_width) *
                this.config.step;
            this.current_date = add(this.gantt_start, scroll_units, this.config.unit);

            let current_upper = this.config.view_mode.upper_text(
                this.current_date,
                null,
                this.options.language,
            );
            let $el = this.upperTexts.find(
                (el) => el.textContent === current_upper,
            );

            if ($el) {
                // Recalculate for smoother experience using Duration
                const adjusted_scroll_units =
                    ((e.currentTarget.scrollLeft + $el.clientWidth) /
                        this.config.column_width) *
                    this.config.step;
                this.current_date = add(this.gantt_start, adjusted_scroll_units, this.config.unit);
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
                        bar.update_label_position_on_horizontal_scroll({
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
                $bar.finaldx = this.get_snap_position(dx, $bar.ox);
                this.hide_popup();
                if (is_resizing_left) {
                    if (parent_bar_id === bar.task.uid) {
                        bar.update_bar_position({
                            x: $bar.ox + $bar.finaldx,
                            width: $bar.owidth - $bar.finaldx,
                        });
                    } else {
                        bar.update_bar_position({
                            x: $bar.ox + $bar.finaldx,
                        });
                    }
                } else if (is_resizing_right) {
                    if (parent_bar_id === bar.task.uid) {
                        bar.update_bar_position({
                            width: $bar.owidth + $bar.finaldx,
                        });
                    }
                } else if (
                    is_dragging &&
                    !this.options.readonly &&
                    !this.options.readonly_dates
                ) {
                    bar.update_bar_position({ x: $bar.ox + $bar.finaldx });
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
                bar.date_changed();
                bar.compute_progress();
                bar.set_action_completed();
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

        const range_positions = this.config.ignored_positions.map((d) => [
            d,
            d + this.config.column_width,
        ]);

        $.on(this.$svg, 'mousemove', (e) => {
            if (!is_resizing) return;
            let now_x = e.offsetX || e.layerX;

            let moving_right = now_x > x_on_start;
            if (moving_right) {
                let k = range_positions.find(
                    ([begin, end]) => now_x >= begin && now_x < end,
                );
                while (k) {
                    now_x = k[1];
                    k = range_positions.find(
                        ([begin, end]) => now_x >= begin && now_x < end,
                    );
                }
            } else {
                let k = range_positions.find(
                    ([begin, end]) => now_x > begin && now_x <= end,
                );
                while (k) {
                    now_x = k[0];
                    k = range_positions.find(
                        ([begin, end]) => now_x > begin && now_x <= end,
                    );
                }
            }

            let dx = now_x - x_on_start;
            console.log($bar_progress);
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
            bar.progress_changed();
            bar.set_action_completed();
            bar = null;
            $bar_progress = null;
            $bar = null;
        });
    }

    get_all_dependent_tasks(task_id) {
        let out = [];
        let to_process = [task_id];
        while (to_process.length) {
            const deps = to_process.reduce((acc, curr) => {
                acc = acc.concat(this.dependency_map[curr]);
                return acc;
            }, []);

            out = out.concat(deps);
            to_process = deps.filter((d) => !to_process.includes(d));
        }

        return out.filter(Boolean);
    }

    get_snap_position(dx, ox) {
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
        const snap_pixels = (snap_ms / step_ms) * this.config.column_width;

        // Snap to nearest grid position
        const snapped_dx = Math.round(dx / snap_pixels) * snap_pixels;
        let final_pos = ox + snapped_dx;

        const drn = snapped_dx > 0 ? 1 : -1;
        let ignored_regions = this.get_ignored_region(final_pos, drn);
        while (ignored_regions.length) {
            final_pos += this.config.column_width * drn;
            ignored_regions = this.get_ignored_region(final_pos, drn);
            if (!ignored_regions.length)
                final_pos -= this.config.column_width * drn;
        }
        return final_pos - ox;
    }

    get_ignored_region(pos, drn = 1) {
        if (drn === 1) {
            return this.config.ignored_positions.filter((val) => {
                return pos > val && pos <= val + this.config.column_width;
            });
        } else {
            return this.config.ignored_positions.filter(
                (val) => pos >= val && pos < val + this.config.column_width,
            );
        }
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
        return this.tasks.find((task) => {
            return task.uid === id;
        });
    }

    get_bar(id) {
        return this.bars.find((bar) => {
            return bar.task.uid === id;
        });
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
        if (!this.tasks.length) return Temporal.Now.instant();
        return this.tasks
            .map((task) => task.start)
            .reduce((prev, cur) => {
                return Temporal.Instant.compare(cur, prev) <= 0 ? cur : prev;
            });
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

function generate_uid(task) {
    // TODO
    // Could be better
    return task.name + '_' + Math.random().toString(36).slice(2, 12);
}

function sanitize(s) {
    return s.replaceAll(' ', '_').replaceAll(':', '_').replaceAll('.', '_');
}
