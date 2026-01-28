import { $, createSVG } from './svg_utils';
import { parseInstant, ensureInstant, add, floor, isRelativeOffset, applyRelativeOffset, Temporal } from './temporal_utils';
import Arrows from './arrows';
import Bars from './bars';
import Grid from './grid';
import Popup from './popup';
import Viewport from './viewport';

/**
 * Chart - Visual layer composition and scroll/rendering policy
 *
 * Owns:
 * - All visual components and rendering orchestration (SVG, layers, visual managers)
 * - renderedRange: { start, end } - the time range currently rendered in SVG
 * - bounds: { min?, max? } - scroll limits (undefined = infinite scrolling)
 * - Viewport: pure coordinate calculator
 *
 * The Chart decides what to render and manages scroll behavior.
 * The Viewport only handles coordinate conversion.
 */
export default class Chart {
    /**
     * @param {Gantt} gantt - Reference to the Gantt instance
     */
    constructor(gantt) {
        this.gantt = gantt;

        // DOM elements (set up in setupWrapper)
        this.$container = null;
        this.$svg = null;
        this.$popup_wrapper = null;
        this.$header = null;
        this.$upper_header = null;
        this.$lower_header = null;
        this.$side_header = null;
        this.$extras = null;
        this.$adjust = null;
        this.$current = null;
        this.$current_highlight = null;
        this.$current_ball_highlight = null;

        // SVG layers
        this.layers = {};

        // Visual managers (initialized in setup)
        this.viewport = null;
        this.grid = null;
        this.bars = null;
        this.arrows = null;
        this.popup = null;

        // Rendered range - what time range is currently rendered in SVG
        this.renderedRange = { start: null, end: null };

        // Bounds configuration - scroll limits
        this._boundsConfig = null;  // Raw config (may contain relative offsets)
        this.bounds = { min: undefined, max: undefined };  // Resolved absolute bounds

        // Upper text elements for scroll tracking
        this.upperTexts = [];
    }

    /**
     * Set up the DOM wrapper and SVG element
     * @param {string|HTMLElement|SVGElement} element - Wrapper element or selector
     */
    setupWrapper(element) {
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
            this.$svg = createSVG('svg', {
                append_to: wrapper_element,
                class: 'gantt',
            });
        } else {
            this.$svg = svg_element;
            this.$svg.classList.add('gantt');
        }

        // wrapper element
        this.$container = this.createElement({
            classes: 'gantt-container',
            appendTo: this.$svg.parentElement,
        });

        this.$container.appendChild(this.$svg);
        this.$popup_wrapper = this.createElement({
            classes: 'popup-wrapper',
            appendTo: this.$container,
        });
    }

    // =========================================================================
    // CHART SETUP
    // =========================================================================

    /**
     * Set up all chart components
     * @param {Object} options
     * @param {Object} options.taskExtent - Task time extent {earliestStart, latestEnd}
     * @param {number} options.columnWidth - Column width in pixels
     * @param {number} options.stepInterval - Step interval value
     * @param {string} options.stepUnit - Step unit (day, hour, etc.)
     * @param {Object} [options.bounds] - Bounds config {min, max} or null for infinite
     * @param {Object} options.viewMode - View mode configuration
     */
    setup(options) {
        // Store step config for range computations
        this._stepConfig = {
            interval: options.stepInterval,
            unit: options.stepUnit,
            columnWidth: options.columnWidth,
        };

        // Set column width CSS variable (visual concern)
        this.$container.style.setProperty(
            '--gv-column-width',
            options.columnWidth + 'px',
        );

        // Configure bounds
        this.configureBounds(options.bounds);

        // Resolve relative bounds from task extent
        if (this.hasRelativeBounds() && options.taskExtent) {
            this.updateBoundsFromTaskExtent(
                options.taskExtent.earliestStart,
                options.taskExtent.latestEnd
            );
        }

        // Compute rendered range (Chart owns this computation)
        this.computeRenderedRange(options.taskExtent);

        // Set up viewport (pure coordinate calculator)
        this.setupViewport({
            origin: this.renderedRange.start,
            columnWidth: options.columnWidth,
            stepInterval: options.stepInterval,
            stepUnit: options.stepUnit,
        });

        // Set up grid
        this.setupGrid(options.viewMode);

        // Initialize bars and arrows managers
        if (!this.bars) {
            this.bars = new Bars(this.gantt);
        }
        if (!this.arrows) {
            this.arrows = new Arrows(this.gantt);
        }
    }

    /**
     * Compute the rendered range based on task extent and container size
     * @param {Object} taskExtent - {earliestStart, latestEnd}
     */
    computeRenderedRange(taskExtent) {
        const { interval, unit, columnWidth } = this._stepConfig;
        const extendByUnits = this.gantt.config.extend_by_units || 2;

        // Start a bit before the earliest task
        const ganttStart = floor(taskExtent.earliestStart, unit);
        this.renderedRange.start = add(ganttStart, -extendByUnits, unit);

        // Compute end to fill container
        const containerWidth = this.$container?.clientWidth || 0;
        const columnsNeeded = containerWidth > 0
            ? Math.ceil(containerWidth / columnWidth) + 1
            : 30;
        const rangeWidth = columnsNeeded * interval;
        this.renderedRange.end = add(this.renderedRange.start, rangeWidth, unit);

        // Ensure today is in range if today_button is enabled
        if (this.gantt.options.today_button) {
            const today = Temporal.Now.instant();
            const bufferDate = add(today, columnsNeeded * interval, unit);
            if (Temporal.Instant.compare(bufferDate, this.renderedRange.end) > 0) {
                this.renderedRange.end = bufferDate;
            }
            if (Temporal.Instant.compare(today, this.renderedRange.start) < 0) {
                this.renderedRange.start = floor(today, unit);
            }
        }
    }

    /**
     * Set up viewport with scale parameters
     * @param {Object} options
     * @param {Temporal.Instant|string} options.origin - The instant at x=0
     * @param {number} options.columnWidth - Pixels per step
     * @param {number} options.stepInterval - Number of units per step
     * @param {string} options.stepUnit - Unit type (day, hour, etc.)
     */
    setupViewport(options) {
        if (this.viewport) {
            // Update existing viewport
            this.viewport.setScale(
                options.columnWidth,
                options.stepInterval,
                options.stepUnit
            );
            this.viewport.setOrigin(options.origin);
        } else {
            this.viewport = new Viewport(options);
        }
    }

    /**
     * Set up grid component
     * @param {Object} viewMode - View mode configuration
     */
    setupGrid(viewMode) {
        if (!this.grid) {
            this.grid = new Grid({
                chart: this,
                gantt: this.gantt,
            });
        }
        if (viewMode) {
            this.grid.setViewMode(viewMode);
        }
    }

    /**
     * Set the view mode for the grid
     * @param {Object} viewMode - View mode configuration
     */
    setViewMode(viewMode) {
        if (this.grid) {
            this.grid.setViewMode(viewMode);
        }
    }

    // =========================================================================
    // BOUNDS MANAGEMENT
    // =========================================================================

    /**
     * Configure bounds from options
     * @param {Object|null} boundsConfig - Bounds configuration or null for infinite
     */
    configureBounds(boundsConfig) {
        this._boundsConfig = boundsConfig || null;
        this.bounds = { min: undefined, max: undefined };
        this._initializeBounds();
    }

    /**
     * Initialize bounds from config, resolving absolute bounds immediately
     * @private
     */
    _initializeBounds() {
        if (!this._boundsConfig) {
            // null/undefined = infinite scrolling
            this.bounds = { min: undefined, max: undefined };
            return;
        }

        // Resolve absolute bounds now; relative bounds will be resolved later
        if (this._boundsConfig.min !== undefined) {
            if (!this._isRelativeBound(this._boundsConfig.min)) {
                this.bounds.min = ensureInstant(this._boundsConfig.min);
            }
        }
        if (this._boundsConfig.max !== undefined) {
            if (!this._isRelativeBound(this._boundsConfig.max)) {
                this.bounds.max = ensureInstant(this._boundsConfig.max);
            }
        }
    }

    /**
     * Check if a bound value is relative
     * @private
     */
    _isRelativeBound(value) {
        return typeof value === 'string' && isRelativeOffset(value);
    }

    /**
     * Check if bounds have any relative components
     * @returns {boolean}
     */
    hasRelativeBounds() {
        if (!this._boundsConfig) return false;
        return this._isRelativeBound(this._boundsConfig.min) ||
            this._isRelativeBound(this._boundsConfig.max);
    }

    /**
     * Update absolute bounds from task extent (resolves relative bounds)
     * @param {Temporal.Instant} earliestStart - Earliest task start
     * @param {Temporal.Instant} latestEnd - Latest task end
     */
    updateBoundsFromTaskExtent(earliestStart, latestEnd) {
        if (!this._boundsConfig) return;

        if (this._isRelativeBound(this._boundsConfig.min)) {
            this.bounds.min = applyRelativeOffset(this._boundsConfig.min, earliestStart);
        }
        if (this._isRelativeBound(this._boundsConfig.max)) {
            this.bounds.max = applyRelativeOffset(this._boundsConfig.max, latestEnd);
        }
    }

    /**
     * Check if bounds are infinite (allow unlimited scrolling)
     * @returns {boolean}
     */
    isInfinite() {
        return this._boundsConfig === null || this._boundsConfig === undefined;
    }

    /**
     * Check if scrolling is allowed in a direction
     * @param {string} direction - 'past' or 'future'
     * @returns {boolean}
     */
    canScroll(direction) {
        if (direction === 'past') {
            return this.bounds.min === undefined ||
                Temporal.Instant.compare(this.renderedRange.start, this.bounds.min) > 0;
        } else {
            return this.bounds.max === undefined ||
                Temporal.Instant.compare(this.renderedRange.end, this.bounds.max) < 0;
        }
    }

    // =========================================================================
    // RENDERED RANGE MANAGEMENT
    // =========================================================================

    /**
     * Set the rendered range
     * @param {Temporal.Instant|string} start
     * @param {Temporal.Instant|string} end
     */
    setRenderedRange(start, end) {
        this.renderedRange.start = ensureInstant(start);
        this.renderedRange.end = ensureInstant(end);
    }

    /**
     * Extend the rendered range in a direction
     * @param {string} direction - 'past' or 'future'
     * @param {number} amount - Number of step units to extend
     * @param {string} unit - Time unit (day, hour, etc.)
     */
    extendRenderedRange(direction, amount, unit) {
        if (direction === 'past') {
            // Extend into the past
            if (this.bounds.min !== undefined) {
                this.bounds.min = add(this.bounds.min, -amount, unit);
            }
            this.renderedRange.start = add(this.renderedRange.start, -amount, unit);
            // Update viewport origin to match new start
            if (this.viewport) {
                this.viewport.setOrigin(this.renderedRange.start);
            }
        } else if (direction === 'future') {
            // Extend into the future
            if (this.bounds.max !== undefined) {
                this.bounds.max = add(this.bounds.max, amount, unit);
            }
            this.renderedRange.end = add(this.renderedRange.end, amount, unit);
        }
    }

    /**
     * Get the pixel width of the rendered range
     * @returns {number}
     */
    getRenderedWidth() {
        if (!this.viewport || !this.renderedRange.start || !this.renderedRange.end) {
            return 0;
        }
        return this.viewport.rangeToPixels(this.renderedRange.start, this.renderedRange.end);
    }

    // =========================================================================
    // SVG LAYERS
    // =========================================================================

    /**
     * Set up SVG layers for rendering
     */
    setupLayers() {
        this.layers = {};
        const layerNames = ['grid', 'arrow', 'progress', 'bar'];

        for (const layer of layerNames) {
            this.layers[layer] = createSVG('g', {
                class: layer,
                append_to: this.$svg,
            });
        }

        this.$extras = this.createElement({
            classes: 'extras',
            appendTo: this.$container,
        });

        this.$adjust = this.createElement({
            classes: 'adjust hide',
            appendTo: this.$extras,
            type: 'button',
        });
        this.$adjust.innerHTML = '&larr;';
    }

    /**
     * Clear all rendered content
     */
    clear() {
        this.$svg.innerHTML = '';
        this.$header?.remove?.();
        this.$side_header?.remove?.();
        this.$current_highlight?.remove?.();
        this.$current_ball_highlight?.remove?.();
        this.$extras?.remove?.();
        this.popup?.hide?.();
    }

    /**
     * Render all visual components
     */
    render() {
        this.clear();
        this.setupLayers();

        // Render grid
        this.grid.render(this.layers, this.$container);
        this.renderSideHeader();
        this.grid.renderDateLabels();
        this.grid.renderExtras();

        // Store references to upper texts for scroll tracking
        this.upperTexts = Array.from(
            this.$container.querySelectorAll('.upper-text')
        );

        // Render bars
        this.bars.render(this.layers.bar);

        // Render arrows
        this.arrows.render(this.layers.arrow);

        // Update dimensions
        this.setDimensions();
    }

    /**
     * Render the side header container
     * The actual controls (view mode select, today button) are rendered by Gantt
     */
    renderSideHeader() {
        this.$side_header = this.createElement({ classes: 'side-header' });
        this.$upper_header = this.$container.querySelector('.upper-header');
        this.$lower_header = this.$container.querySelector('.lower-header');
        this.$header = this.$container.querySelector('.grid-header');

        if (this.$upper_header) {
            this.$upper_header.prepend(this.$side_header);
        }
    }

    /**
     * Set SVG dimensions based on content
     */
    setDimensions() {
        const { width: cur_width } = this.$svg.getBoundingClientRect();
        const gridRow = this.$svg.querySelector('.grid .grid-row');
        const actual_width = gridRow ? gridRow.getAttribute('width') : 0;

        if (cur_width < actual_width) {
            this.$svg.setAttribute('width', actual_width);
        }
    }

    /**
     * Set scroll position to a specific date
     * @param {string|Temporal.Instant} date - Date to scroll to
     */
    setScrollPosition(date) {
        const gantt = this.gantt;

        if (this.isInfinite() && (!date || date === 'start')) {
            const [min_start] = this.getStartEndPositions();
            this.$container.scrollLeft = min_start;
            return;
        }

        if (!date || date === 'start') {
            date = this.renderedRange.start;
        } else if (date === 'end') {
            date = this.renderedRange.end;
        } else if (date === 'today') {
            return this.scrollToCurrent();
        } else if (typeof date === 'string') {
            date = parseInstant(date);
        }

        const scroll_pos = this.viewport.dateToX(ensureInstant(date));

        this.$container.scrollTo({
            left: scroll_pos - gantt.config.step.column_width / 6,
            behavior: 'smooth',
        });

        this.updateCurrentUpperText();
    }

    /**
     * Update the current upper text highlight based on scroll position
     */
    updateCurrentUpperText() {
        const gantt = this.gantt;

        if (this.$current) {
            this.$current.classList.remove('current-upper');
        }

        const current_date = this.viewport.xToDate(this.$container.scrollLeft);

        let current_upper = gantt.config.view_mode.upper_text(
            current_date,
            null,
            gantt.options.language,
        );

        let $el = this.upperTexts.find(
            (el) => el.textContent === current_upper,
        );

        if ($el) {
            const next_date = this.viewport.xToDate(
                this.$container.scrollLeft + $el.clientWidth
            );
            current_upper = gantt.config.view_mode.upper_text(
                next_date,
                null,
                gantt.options.language,
            );
            $el = this.upperTexts.find((el) => el.textContent === current_upper);
        }

        if ($el) {
            $el.classList.add('current-upper');
            this.$current = $el;
        }
    }

    /**
     * Scroll to the current date (today)
     */
    scrollToCurrent() {
        const res = this.getClosestDate();
        if (res) {
            this.setScrollPosition(res[0]);
        }
    }

    /**
     * Get the closest date element to now
     * @returns {[Temporal.Instant, Element] | null}
     */
    getClosestDate() {
        return this.grid.getClosestDate();
    }

    /**
     * Get start, max start, and max end positions of all bars
     * @returns {[number, number, number]}
     */
    getStartEndPositions() {
        const bars = this.bars.getAll();
        if (!bars.length) return [0, 0, 0];

        let { x, width } = bars[0].group.getBBox();
        let min_start = x;
        let max_start = x;
        let max_end = x + width;

        for (const bar of bars) {
            const bbox = bar.group.getBBox();
            if (bbox.x < min_start) min_start = bbox.x;
            if (bbox.x > max_start) max_start = bbox.x;
            if (bbox.x + bbox.width > max_end) max_end = bbox.x + bbox.width;
        }

        return [min_start, max_start, max_end];
    }

    /**
     * Show popup for a task
     * @param {Object} opts - Popup options
     */
    showPopup(opts) {
        const gantt = this.gantt;
        if (gantt.options.popup === false) return;

        if (!this.popup) {
            this.popup = new Popup(
                this.$popup_wrapper,
                gantt.options.popup,
                gantt,
            );
        }
        this.popup.show(opts);
    }

    /**
     * Hide the popup
     */
    hidePopup() {
        this.popup?.hide();
    }

    /**
     * Unselect all elements
     */
    unselectAll() {
        if (this.popup) {
            this.popup.parent.classList.add('hide');
        }
        this.$container
            .querySelectorAll('.date-range-highlight')
            .forEach((k) => k.classList.add('hide'));
    }

    /**
     * Bind click events to grid elements (unselect on click)
     */
    bindGridClick() {
        $.on(
            this.$container,
            'click',
            '.grid-row, .grid-header, .ignored-bar, .holiday-highlight',
            () => {
                this.unselectAll();
                this.hidePopup();
            },
        );
    }

    /**
     * Bind infinite scroll behavior
     * Extends the rendered range when scrolling near edges
     * @param {Function} renderCallback - Called after extending range
     */
    bindInfiniteScroll(renderCallback) {
        const gantt = this.gantt;
        let extending = false;

        const getTriggerDistance = () => this.$container.clientWidth * 2;
        const getExtendUnits = () =>
            Math.ceil((this.$container.clientWidth * 3) / gantt.config.step.column_width);

        $.on(this.$container, 'mousewheel', (e) => {
            if (extending) return;

            const scrollLeft = e.currentTarget.scrollLeft;
            const scrollWidth = e.currentTarget.scrollWidth;
            const clientWidth = e.currentTarget.clientWidth;
            const triggerDistance = getTriggerDistance();

            if (scrollLeft <= triggerDistance) {
                extending = true;
                const extendUnits = getExtendUnits();
                const dateAtScroll = this.viewport.xToDate(scrollLeft);

                this.extendRenderedRange('past', extendUnits, gantt.config.step.unit);
                renderCallback(true);
                e.currentTarget.scrollLeft = this.viewport.dateToX(dateAtScroll);
                setTimeout(() => (extending = false), 100);
                return;
            }

            const remainingRight = scrollWidth - (scrollLeft + clientWidth);
            if (remainingRight <= triggerDistance) {
                extending = true;
                const extendUnits = getExtendUnits();
                const dateAtScroll = this.viewport.xToDate(scrollLeft);

                this.extendRenderedRange('future', extendUnits, gantt.config.step.unit);
                renderCallback(true);
                e.currentTarget.scrollLeft = this.viewport.dateToX(dateAtScroll);
                setTimeout(() => (extending = false), 100);
            }
        });
    }

    /**
     * Bind scroll event handling (header tracking, adjust button, label movement)
     */
    bindScrollEvents() {
        const gantt = this.gantt;
        let lastScrollLeft = 0;

        $.on(this.$container, 'scroll', (e) => {
            const scrollLeft = e.currentTarget.scrollLeft;
            const dx = scrollLeft - lastScrollLeft;

            // Update current upper text highlight
            const currentDate = this.viewport.xToDate(scrollLeft);
            let currentUpper = gantt.config.view_mode.upper_text(
                currentDate,
                null,
                gantt.options.language,
            );
            let $el = this.upperTexts.find((el) => el.textContent === currentUpper);

            if ($el) {
                const nextDate = this.viewport.xToDate(scrollLeft + $el.clientWidth);
                currentUpper = gantt.config.view_mode.upper_text(
                    nextDate,
                    null,
                    gantt.options.language,
                );
                $el = this.upperTexts.find((el) => el.textContent === currentUpper);
            }

            if ($el && $el !== this.$current) {
                if (this.$current) {
                    this.$current.classList.remove('current-upper');
                }
                $el.classList.add('current-upper');
                this.$current = $el;
            }

            lastScrollLeft = scrollLeft;

            // Update adjust button visibility
            const [minStart, maxStart, maxEnd] = this.getStartEndPositions();

            if (scrollLeft > maxEnd + 100) {
                this.$adjust.innerHTML = '&larr;';
                this.$adjust.classList.remove('hide');
                this.$adjust.onclick = () => {
                    this.$container.scrollTo({ left: maxStart, behavior: 'smooth' });
                };
            } else if (scrollLeft + e.currentTarget.offsetWidth < minStart - 100) {
                this.$adjust.innerHTML = '&rarr;';
                this.$adjust.classList.remove('hide');
                this.$adjust.onclick = () => {
                    this.$container.scrollTo({ left: minStart, behavior: 'smooth' });
                };
            } else {
                this.$adjust.classList.add('hide');
            }

            // Auto-move labels on scroll
            if (dx && gantt.options.auto_move_label) {
                for (const bar of this.bars.getAll()) {
                    bar.updateLabelPositionOnHorizontalScroll({
                        x: dx,
                        sx: scrollLeft,
                    });
                }
            }
        });
    }

    /**
     * Get bar by task ID
     * @param {string} id - Task UID
     * @returns {Bar|undefined}
     */
    getBar(id) {
        return this.bars.get(id);
    }

    /**
     * Get all bars
     * @returns {Bar[]}
     */
    getAllBars() {
        return this.bars.getAll();
    }

    /**
     * Get all arrows
     * @returns {Arrow[]}
     */
    getAllArrows() {
        return this.arrows.getAll();
    }

    /**
     * Create an HTML element with positioning
     * @param {Object} options - Element options
     * @returns {HTMLElement}
     */
    createElement({ left, top, width, height, id, classes, appendTo, type }) {
        const $el = document.createElement(type || 'div');
        for (const cls of classes.split(' ')) {
            $el.classList.add(cls);
        }
        $el.style.top = top + 'px';
        $el.style.left = left + 'px';
        if (id) $el.id = id;
        if (width) $el.style.width = width + 'px';
        if (height) $el.style.height = height + 'px';
        if (appendTo) appendTo.appendChild($el);
        return $el;
    }
}