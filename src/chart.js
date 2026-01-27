import { createSVG } from './svg_utils';
import { parseInstant, ensureInstant } from './temporal_utils';
import Arrows from './arrows';
import Bars from './bars';
import Grid from './grid';
import Popup from './popup';
import Viewport from './viewport';

/**
 * Chart - Visual layer composition
 *
 * Owns all visual components and rendering orchestration.
 * Contains the SVG element, layers, and visual managers.
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

        // Visual managers (initialized after wrapper setup)
        this.viewport = null;
        this.grid = null;
        this.bars = null;
        this.arrows = null;
        this.popup = null;

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

    /**
     * Initialize visual managers (Bars, Arrows)
     * Called after options and tasks are set up
     */
    initializeManagers() {
        this.bars = new Bars(this.gantt);
        this.arrows = new Arrows(this.gantt);
    }

    /**
     * Set up viewport with current view mode configuration
     * @param {Object} options - Viewport options
     * @param {Object} options.visible - Visible time range {start, end}
     * @param {number} options.columnWidth - Column width in pixels
     * @param {number} options.stepInterval - Step interval value
     * @param {string} options.stepUnit - Step unit (day, hour, etc.)
     * @param {Object} [options.bounds] - Optional bounds {min, max}
     */
    setupViewport(options) {
        if (this.viewport) {
            // Update existing viewport
            this.viewport.setScale(
                options.columnWidth,
                options.stepInterval,
                options.stepUnit
            );
            this.viewport.setVisible(options.visible.start, options.visible.end);
        } else {
            this.viewport = new Viewport(options);
        }

        // Create or update Grid
        if (!this.grid) {
            this.grid = new Grid({
                viewport: this.viewport,
                gantt: this.gantt,
            });
        }
        this.grid.viewport = this.viewport;
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
     * Render the side header with view mode select and today button
     */
    renderSideHeader() {
        const gantt = this.gantt;

        this.$side_header = this.createElement({ classes: 'side-header' });
        this.$upper_header = this.$container.querySelector('.upper-header');
        this.$lower_header = this.$container.querySelector('.lower-header');
        this.$header = this.$container.querySelector('.grid-header');

        if (this.$upper_header) {
            this.$upper_header.prepend(this.$side_header);
        }

        // Create view mode change select
        if (gantt.options.view_mode_select) {
            const $select = document.createElement('select');
            $select.classList.add('viewmode-select');

            const $el = document.createElement('option');
            $el.selected = true;
            $el.disabled = true;
            $el.textContent = 'Mode';
            $select.appendChild($el);

            for (const mode of gantt.options.view_modes) {
                const $option = document.createElement('option');
                $option.value = mode.name;
                $option.textContent = mode.name;
                if (mode.name === gantt.config.view_mode.name)
                    $option.selected = true;
                $select.appendChild($option);
            }

            $select.addEventListener(
                'change',
                function () {
                    gantt.change_view_mode($select.value, true);
                }
            );
            this.$side_header.appendChild($select);
        }

        // Create today button
        if (gantt.options.today_button) {
            const $today_button = document.createElement('button');
            $today_button.classList.add('today-button');
            $today_button.textContent = 'Today';
            $today_button.onclick = () => this.scrollToCurrent();
            this.$side_header.prepend($today_button);
            this.$today_button = $today_button;
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

        if (gantt.options.infinite_padding && (!date || date === 'start')) {
            const [min_start] = this.getStartEndPositions();
            this.$container.scrollLeft = min_start;
            return;
        }

        if (!date || date === 'start') {
            date = gantt.grid.start;
        } else if (date === 'end') {
            date = gantt.grid.end;
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
     * Extend bounds for infinite scroll
     * @param {string} direction - 'past' or 'future'
     * @param {number} units - Number of units to extend
     */
    extendBounds(direction, units) {
        this.viewport.extendBounds(direction, units);
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
