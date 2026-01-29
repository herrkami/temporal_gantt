import {
    ensureInstant,
    toPlainDateTime,
    parseDurationString,
} from './temporal_utils';

import Chart from './chart';
import Scheduler from './scheduler';
import Tasks from './tasks';

import { DEFAULT_OPTIONS, DEFAULT_VIEW_MODES } from './defaults';

import './styles/gantt.css';

/**
 * Gantt - Main orchestrator class
 *
 * Coordinates between:
 * - Tasks: data layer (task storage and manipulation)
 * - Chart: visual layer (SVG rendering and DOM management)
 * - Scheduler: computation layer (snapping, task mutation, dependency resolution)
 */
export default class Gantt {
    constructor(wrapper, tasks, options) {
        this.config = {};
        this.tasks = new Tasks();
        this.scheduler = new Scheduler(this);

        this.setupOptions(options);
        this.setupChart(wrapper);
        this.loadTaskList(tasks);
        this.changeViewMode();
        this.bindEvents();
    }

    setupChart(wrapper) {
        this.chart = new Chart(this);
        this.chart.setupWrapper(wrapper);

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

    setupOptions(options) {
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

    updateOptions(options) {
        this.setupOptions({ ...this.original_options, ...options });
        this.changeViewMode(undefined, true);
    }

    /**
     * Update an existing task
     * @param {string} id - Task ID
     * @param {Object} newDetails - Properties to update
     */
    updateTask(id, newDetails) {
        const task = this.tasks.update(id, newDetails);
        if (task) {
            const bar = this.chart.getBar(task.uid);
            bar?.refresh();
        }
    }

    /**
     * Add a new task
     * @param {Object} taskData - Raw task data
     * @returns {Task|null} The created task or null if invalid
     */
    addTask(taskData) {
        const task = this.tasks.add(taskData);
        if (task) {
            this.render();
        }
        return task;
    }

    /**
     * Remove a task by ID
     * @param {string} id - Task ID
     * @returns {boolean} True if task was removed
     */
    removeTask(id) {
        const removed = this.tasks.remove(id);
        if (removed) {
            this.render();
        }
        return removed;
    }

    /**
    * Load a new task list
    * @param {Array} taskList - List of task specifications
    */
    loadTaskList(taskList) {
        this.tasks.load(taskList);
    }

    /**
     * Load a new task list and rebuild the chart
     * @param {Array} taskList - List of task specifications
     */
    setTasks(taskList) {
        this.loadTaskList(taskList);
        this.changeViewMode();
    }

    /**
     * Get all tasks in export format (minimal constraints)
     * @returns {Array} Array of task specifications
     */
    getTasks() {
        return this.tasks.export();
    }

    changeViewMode(mode = this.options.view_mode, maintainScrollPosition = false) {
        if (typeof mode === 'string') {
            mode = this.options.view_modes.find((d) => d.name === mode);
        }

        // Save scroll position before changing
        let savedDate, savedScrollTo;
        if (maintainScrollPosition && this.chart.viewport) {
            savedDate = this.chart.viewport.xToDate(this.chart.$container.scrollLeft);
            savedScrollTo = this.options.scroll_to;
            this.options.scroll_to = null;
        }

        this.options.view_mode = mode.name;
        this.config.view_mode = mode;
        this.updateViewMode(mode);
        this.configureChart();
        this.render();

        // Restore scroll position
        if (maintainScrollPosition && savedDate) {
            this.chart.$container.scrollLeft = this.chart.viewport.dateToX(savedDate);
            this.options.scroll_to = savedScrollTo;
        }

        this.triggerEvent('view_change', [mode]);
    }

    updateViewMode(mode) {
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

        this.config.header_height =
            this.options.lower_header_height +
            this.options.upper_header_height +
            10;
    }

    configureChart() {
        this.chart.setup({
            taskExtent: this.tasks.getExtent(),
            columnWidth: this.config.step.column_width,
            stepInterval: this.config.step.interval,
            stepUnit: this.config.step.unit,
            bounds: this.options.bounds,
            viewMode: this.config.view_mode,
        });

        this.config.date_format =
            this.config.view_mode.date_format || this.options.date_format;
    }

    bindEvents() {
        const chart = this.chart;

        // Grid click to unselect
        chart.bindGridClick();

        // Holiday label hover
        chart.grid.bindHolidayLabels();

        // Bar drag/resize
        chart.bars.bindDragEvents(chart.$svg);
        chart.bars.bindProgressEvents(chart.$svg);

        // Scroll behavior
        if (chart.isInfinite()) {
            chart.bindInfiniteScroll((skipScrollReset) => this.render(skipScrollReset));
        }
        chart.bindScrollEvents();
    }

    render(skipScrollReset = false) {
        this.chart.render();
        this.renderControls();

        if (!skipScrollReset) {
            this.setScrollPosition(this.options.scroll_to);
        }
    }

    /**
     * Render global controls (view mode select, today button)
     * These are Gantt-level controls, not part of the chart visualization
     */
    renderControls() {
        const $sideHeader = this.chart.$side_header;
        if (!$sideHeader) return;

        // Clear existing controls
        $sideHeader.innerHTML = '';

        // View mode select
        if (this.options.view_mode_select) {
            const $select = document.createElement('select');
            $select.classList.add('viewmode-select');

            const $placeholder = document.createElement('option');
            $placeholder.selected = true;
            $placeholder.disabled = true;
            $placeholder.textContent = 'Mode';
            $select.appendChild($placeholder);

            for (const mode of this.options.view_modes) {
                const $option = document.createElement('option');
                $option.value = mode.name;
                $option.textContent = mode.name;
                if (mode.name === this.config.view_mode.name) {
                    $option.selected = true;
                }
                $select.appendChild($option);
            }

            $select.addEventListener('change', () => {
                this.changeViewMode($select.value, true);
            });
            $sideHeader.appendChild($select);
        }

        // Today button
        if (this.options.today_button) {
            const $todayButton = document.createElement('button');
            $todayButton.classList.add('today-button');
            $todayButton.textContent = 'Today';
            $todayButton.onclick = () => this.scrollToNow();
            $sideHeader.prepend($todayButton);
        }
    }

    setScrollPosition(date) {
        this.chart.setScrollPosition(date);
    }

    scrollToNow() {
        this.chart.scrollToNow();
    }

    getClosestGridDate() {
        return this.chart.getClosestGridDate();
    }

    // =========================================================================
    // PUBLIC API
    // =========================================================================

    unselectAll() {
        this.chart.unselectAll();
    }

    viewIs(modes) {
        if (typeof modes === 'string') {
            return this.config.view_mode.name === modes;
        }

        if (Array.isArray(modes)) {
            return modes.some((m) => this.viewIs(m));
        }

        return this.config.view_mode.name === modes.name;
    }

    getTask(id) {
        return this.tasks.get(id);
    }

    getBar(id) {
        return this.chart.getBar(id);
    }

    showPopup(opts) {
        this.chart.showPopup(opts);
    }

    hidePopup() {
        this.chart.hidePopup();
    }

    /**
     * Subscribe to an event
     * @param {string} event - Event name (click, date_change, progress_change, view_change, etc.)
     * @param {Function} callback - Event handler
     */
    on(event, callback) {
        this.options['on_' + event] = callback;
    }

    /**
     * Unsubscribe from an event
     * @param {string} event - Event name
     */
    off(event) {
        delete this.options['on_' + event];
    }

    triggerEvent(event, args) {
        if (this.options['on_' + event]) {
            this.options['on_' + event].apply(this, args);
        }
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