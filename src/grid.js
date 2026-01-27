import {
    ensureInstant,
    toPlainDateTime,
    toInstant,
    Temporal,
    parseDuration,
    add,
    format,
    getDaysInMonth,
    getDaysInYear,
} from './temporal_utils';
import { $, createSVG } from './svg_utils';

/**
 * Grid - Manages grid rendering for the Gantt chart
 *
 * Responsibilities:
 * - Grid background, rows, and tick lines
 * - Header rendering (upper and lower)
 * - Date label generation and positioning
 * - Holiday/weekend highlights
 * - Current date marker
 */
export default class Grid {
    /**
     * @param {Object} options
     * @param {Viewport} options.viewport - Viewport instance for positioning
     * @param {Gantt} options.gantt - Gantt instance for config and predicates
     */
    constructor(options) {
        this.viewport = options.viewport;
        this.gantt = options.gantt;

        // Step configuration (visual grid rhythm)
        this.step = {
            interval: 1,
            unit: 'day',
            columnWidth: 45,
        };

        // Header format functions
        this.headerFormat = {
            upper: () => '',
            lower: () => '',
        };

        // Cached dates for the current view (generated on-demand)
        this._cachedDates = null;
        this._cacheKey = null;
    }

    /**
     * Update step configuration from view mode
     * @param {Object} viewMode - View mode object from defaults
     */
    setViewMode(viewMode) {
        const duration = parseDuration(viewMode.step);

        // Extract interval and unit from the view mode step
        if (duration.years) {
            this.step.interval = duration.years;
            this.step.unit = 'year';
        } else if (duration.months) {
            this.step.interval = duration.months;
            this.step.unit = 'month';
        } else if (duration.weeks) {
            this.step.interval = duration.weeks * 7;
            this.step.unit = 'day';
        } else if (duration.days) {
            this.step.interval = duration.days;
            this.step.unit = 'day';
        } else if (duration.hours) {
            this.step.interval = duration.hours;
            this.step.unit = 'hour';
        } else if (duration.minutes) {
            this.step.interval = duration.minutes;
            this.step.unit = 'minute';
        } else {
            this.step.interval = 1;
            this.step.unit = 'day';
        }

        this.step.columnWidth = viewMode.column_width || this.gantt.options.column_width || 45;
        this.step.duration = duration;
        this.viewMode = viewMode;

        // Set up header format functions
        this._setupHeaderFormats(viewMode);

        // Invalidate cache
        this._cachedDates = null;
    }

    /**
     * Set up header format functions from view mode
     * @private
     */
    _setupHeaderFormats(viewMode) {
        const lang = this.gantt.options.language;

        let upper = viewMode.upper_text;
        let lower = viewMode.lower_text;

        if (!upper) {
            this.headerFormat.upper = () => '';
        } else if (typeof upper === 'string') {
            this.headerFormat.upper = (instant, lastInstant) =>
                format(instant, upper, lang);
        } else {
            this.headerFormat.upper = (instant, lastInstant) =>
                upper(instant, lastInstant, lang);
        }

        if (!lower) {
            this.headerFormat.lower = () => '';
        } else if (typeof lower === 'string') {
            this.headerFormat.lower = (instant, lastInstant) =>
                format(instant, lower, lang);
        } else {
            this.headerFormat.lower = (instant, lastInstant) =>
                lower(instant, lastInstant, lang);
        }
    }

    /**
     * Generate dates for the visible range
     * Uses caching to avoid regenerating on every render
     * @returns {Array<Temporal.Instant>}
     */
    getDates() {
        const start = this.gantt.grid.start;
        const end = this.gantt.grid.end;
        const cacheKey = `${start.epochMilliseconds}-${end.epochMilliseconds}-${this.viewMode?.step}`;

        if (this._cachedDates && this._cacheKey === cacheKey) {
            return this._cachedDates;
        }

        const dates = [start];
        let curPdt = toPlainDateTime(start);
        const endPdt = toPlainDateTime(end);
        const stepDuration = this.step.duration;

        while (Temporal.PlainDateTime.compare(curPdt, endPdt) < 0) {
            curPdt = curPdt.add(stepDuration);
            dates.push(toInstant(curPdt));
        }

        this._cachedDates = dates;
        this._cacheKey = cacheKey;
        return dates;
    }

    /**
     * Get date information for rendering
     * @returns {Array<Object>} Array of date info objects with x, text, etc.
     */
    getDatesToDraw() {
        const dates = this.getDates();
        let lastDateInfo = null;

        return dates.map((instant, i) => {
            const info = this._getDateInfo(instant, lastDateInfo);
            lastDateInfo = info;
            return info;
        });
    }

    /**
     * Get info for a single date
     * @private
     */
    _getDateInfo(instant, lastDateInfo) {
        const lastInstant = lastDateInfo ? lastDateInfo.instant : null;

        const x = lastDateInfo
            ? lastDateInfo.x + lastDateInfo.columnWidth
            : 0;

        const dateFormat = this.viewMode.date_format || this.gantt.options.date_format;

        return {
            instant,
            date: instant, // backward compatibility
            formattedDate: this._sanitize(
                format(instant, dateFormat, this.gantt.options.language)
            ),
            columnWidth: this.step.columnWidth,
            x,
            upperText: this.headerFormat.upper(instant, lastInstant),
            lowerText: this.headerFormat.lower(instant, lastInstant),
            upperY: 17,
            lowerY: this.gantt.options.upper_header_height + 5,
        };
    }

    /**
     * Render the entire grid
     * @param {Object} layers - SVG layer groups
     * @param {HTMLElement} $container - Container element
     */
    render(layers, $container) {
        this.layers = layers;
        this.$container = $container;

        this.renderBackground();
        this.renderRows();
        this.renderHeader();
    }

    /**
     * Render grid extras (highlights, ticks)
     * Called after bars are rendered
     */
    renderExtras() {
        this.renderHighlights();
        this.renderTicks();
    }

    /**
     * Render the grid background
     */
    renderBackground() {
        const dates = this.getDates();
        const gridWidth = dates.length * this.step.columnWidth;
        const gridHeight = this._calculateGridHeight();

        createSVG('rect', {
            x: 0,
            y: 0,
            width: gridWidth,
            height: gridHeight,
            class: 'grid-background',
            append_to: this.gantt.$svg,
        });

        $.attr(this.gantt.$svg, {
            height: gridHeight,
            width: '100%',
        });

        this.gridHeight = gridHeight;

        if (this.gantt.options.container_height === 'auto') {
            this.$container.style.height = gridHeight + 'px';
        }
    }

    /**
     * Calculate the grid height based on tasks
     * @private
     */
    _calculateGridHeight() {
        const opts = this.gantt.options;
        const headerHeight = opts.lower_header_height + opts.upper_header_height + 10;

        return Math.max(
            headerHeight +
            opts.padding +
            (opts.bar_height + opts.padding) * this.gantt.tasks.length - 10,
            opts.container_height !== 'auto' ? opts.container_height : 0
        );
    }

    /**
     * Render grid rows
     */
    renderRows() {
        const rowsLayer = createSVG('g', { append_to: this.layers.grid });
        const dates = this.getDates();
        const rowWidth = dates.length * this.step.columnWidth;
        const rowHeight = this.gantt.options.bar_height + this.gantt.options.padding;
        const headerHeight = this.gantt.options.lower_header_height +
                            this.gantt.options.upper_header_height + 10;

        for (let y = headerHeight; y < this.gridHeight; y += rowHeight) {
            createSVG('rect', {
                x: 0,
                y,
                width: rowWidth,
                height: rowHeight,
                class: 'grid-row',
                append_to: rowsLayer,
            });
        }
    }

    /**
     * Render grid header (upper and lower)
     */
    renderHeader() {
        const dates = this.getDates();
        const gantt = this.gantt;

        gantt.$header = this._createElement({
            width: dates.length * this.step.columnWidth,
            classes: 'grid-header',
            appendTo: this.$container,
        });

        gantt.$upper_header = this._createElement({
            classes: 'upper-header',
            appendTo: gantt.$header,
        });

        gantt.$lower_header = this._createElement({
            classes: 'lower-header',
            appendTo: gantt.$header,
        });
    }

    /**
     * Render date labels
     */
    renderDateLabels() {
        const gantt = this.gantt;

        this.getDatesToDraw().forEach((date) => {
            if (date.lowerText) {
                const $lowerText = this._createElement({
                    left: date.x,
                    top: date.lowerY,
                    classes: 'lower-text date_' + date.formattedDate,
                    appendTo: gantt.$lower_header,
                });
                $lowerText.innerText = date.lowerText;
            }

            if (date.upperText) {
                const $upperText = this._createElement({
                    left: date.x,
                    top: date.upperY,
                    classes: 'upper-text',
                    appendTo: gantt.$upper_header,
                });
                $upperText.innerText = date.upperText;
            }
        });

        gantt.upperTexts = Array.from(
            this.$container.querySelectorAll('.upper-text')
        );
    }

    /**
     * Render tick lines
     */
    renderTicks() {
        if (this.gantt.options.lines === 'none') return;

        const dates = this.getDates();
        const headerHeight = this.gantt.options.lower_header_height +
                            this.gantt.options.upper_header_height + 10;
        const tickHeight = this.gridHeight - headerHeight;
        const rowWidth = dates.length * this.step.columnWidth;
        const rowHeight = this.gantt.options.bar_height + this.gantt.options.padding;

        const $linesLayer = createSVG('g', {
            class: 'lines_layer',
            append_to: this.layers.grid,
        });

        // Horizontal lines
        if (this.gantt.options.lines !== 'vertical') {
            for (let y = headerHeight; y < this.gridHeight; y += rowHeight) {
                createSVG('line', {
                    x1: 0,
                    y1: y + rowHeight,
                    x2: rowWidth,
                    y2: y + rowHeight,
                    class: 'row-line',
                    append_to: $linesLayer,
                });
            }
        }

        if (this.gantt.options.lines === 'horizontal') return;

        // Vertical tick lines
        let tickX = 0;
        for (const instant of dates) {
            let tickClass = 'tick';
            if (this.viewMode.thick_line && this.viewMode.thick_line(instant)) {
                tickClass += ' thick';
            }

            createSVG('path', {
                d: `M ${tickX} ${headerHeight} v ${tickHeight}`,
                class: tickClass,
                append_to: this.layers.grid,
            });

            // Handle variable-width columns for month/year views
            if (this._isMonthView()) {
                tickX += (getDaysInMonth(instant) * this.step.columnWidth) / 30;
            } else if (this._isYearView()) {
                tickX += (getDaysInYear(instant) * this.step.columnWidth) / 365;
            } else {
                tickX += this.step.columnWidth;
            }
        }
    }

    /**
     * Render highlights (holidays, weekends, current date)
     */
    renderHighlights() {
        this._renderHolidays();
        this._renderIgnoredRegions();
        this._renderCurrentDateMarker();
    }

    /**
     * Render holiday highlights
     * @private
     */
    _renderHolidays() {
        const gantt = this.gantt;
        if (!gantt.options.holidays) return;

        const labels = new Map();
        const oneDay = Temporal.Duration.from({ days: 1 });
        const headerHeight = gantt.options.lower_header_height +
                            gantt.options.upper_header_height + 10;

        for (const color in gantt.options.holidays) {
            let checkHighlight = gantt.options.holidays[color];

            if (checkHighlight === 'weekend') {
                checkHighlight = gantt.options.is_weekend ||
                    ((instant) => {
                        const pdt = toPlainDateTime(ensureInstant(instant));
                        return pdt.dayOfWeek === 6 || pdt.dayOfWeek === 7;
                    });
            }

            let extraFunc;

            if (typeof checkHighlight === 'object') {
                // Single named holiday object {date, name}
                if (checkHighlight.name && checkHighlight.date) {
                    const dateInstant = ensureInstant(checkHighlight.date + ' ');
                    labels.set(dateInstant.toString(), checkHighlight.name);
                    checkHighlight = (instant) =>
                        Temporal.Instant.compare(dateInstant, ensureInstant(instant)) === 0;
                } else if (Array.isArray(checkHighlight)) {
                    // Array of dates/objects
                    const f = checkHighlight.find((k) => typeof k === 'function');
                    if (f) extraFunc = f;

                    const holidayInstants = gantt.options.holidays[color]
                        .filter((k) => typeof k !== 'function')
                        .map((k) => {
                            if (k.name) {
                                const dateInstant = ensureInstant(k.date + ' ');
                                labels.set(dateInstant.toString(), k.name);
                                return dateInstant;
                            }
                            return ensureInstant(k + ' ');
                        });

                    checkHighlight = (instant) =>
                        holidayInstants.some((hi) =>
                            Temporal.Instant.compare(hi, ensureInstant(instant)) === 0);
                }
            }

            if (typeof checkHighlight !== 'function') continue;

            // Iterate through days
            let currentPdt = toPlainDateTime(gantt.grid.start);
            const endPdt = toPlainDateTime(gantt.grid.end);

            while (Temporal.PlainDateTime.compare(currentPdt, endPdt) <= 0) {
                const d = toInstant(currentPdt);

                if (this._isIgnored(d)) {
                    currentPdt = currentPdt.add(oneDay);
                    continue;
                }

                if (checkHighlight(d) || (extraFunc && extraFunc(d))) {
                    const x = this.viewport.dateToX(d);
                    const nextDay = add(d, 1, 'day');
                    const nextX = this.viewport.dateToX(nextDay);
                    const width = nextX - x;
                    const height = this.gridHeight - headerHeight;
                    const dFormatted = format(d, 'YYYY-MM-DD', gantt.options.language)
                        .replace(' ', '_');

                    const labelText = labels.get(d.toString());
                    if (labelText) {
                        const label = this._createElement({
                            classes: 'holiday-label label_' + dFormatted,
                            appendTo: gantt.$extras,
                        });
                        label.textContent = labelText;
                    }

                    createSVG('rect', {
                        x: Math.round(x),
                        y: headerHeight,
                        width,
                        height,
                        class: 'holiday-highlight ' + dFormatted,
                        style: `fill: ${color};`,
                        append_to: this.layers.grid,
                    });
                }

                currentPdt = currentPdt.add(oneDay);
            }
        }
    }

    /**
     * Render ignored regions (weekends when excluded from work time)
     * @private
     */
    _renderIgnoredRegions() {
        const gantt = this.gantt;
        gantt.config.ignored_positions = [];

        const headerHeight = gantt.options.lower_header_height +
                            gantt.options.upper_header_height + 10;
        const height = (gantt.options.bar_height + gantt.options.padding) *
                       gantt.tasks.length;

        // Add hatch pattern for ignored regions
        this.layers.grid.innerHTML += `<pattern id="diagonalHatch" patternUnits="userSpaceOnUse" width="4" height="4">
          <path d="M-1,1 l2,-2
                   M0,4 l4,-4
                   M3,5 l2,-2"
                style="stroke:grey; stroke-width:0.3" />
        </pattern>`;

        const oneDay = Temporal.Duration.from({ days: 1 });
        let currentPdt = toPlainDateTime(gantt.grid.start);
        const endPdt = toPlainDateTime(gantt.grid.end);

        while (Temporal.PlainDateTime.compare(currentPdt, endPdt) <= 0) {
            const d = toInstant(currentPdt);

            if (!this._isIgnored(d)) {
                currentPdt = currentPdt.add(oneDay);
                continue;
            }

            const x = this.viewport.dateToX(d);
            gantt.config.ignored_positions.push(x);

            // Calculate width based on one day's span in current view
            const nextDay = add(d, 1, 'day');
            const nextX = this.viewport.dateToX(nextDay);
            const width = nextX - x;

            createSVG('rect', {
                x,
                y: headerHeight,
                width,
                height,
                class: 'ignored-bar',
                style: 'fill: url(#diagonalHatch);',
                append_to: gantt.$svg,
            });

            currentPdt = currentPdt.add(oneDay);
        }
    }

    /**
     * Render current date marker
     * @private
     */
    _renderCurrentDateMarker() {
        const gantt = this.gantt;
        const headerHeight = gantt.options.lower_header_height +
                            gantt.options.upper_header_height + 10;

        const res = this.getClosestDate();
        if (!res) return;

        const [_, el] = res;
        el.classList.add('current-date-highlight');

        const now = Temporal.Now.instant();
        const left = this.viewport.dateToX(now);

        gantt.$current_highlight = this._createElement({
            top: headerHeight,
            left,
            height: this.gridHeight - headerHeight,
            classes: 'current-highlight',
            appendTo: this.$container,
        });

        gantt.$current_ball_highlight = this._createElement({
            top: headerHeight - 6,
            left: left - 2.5,
            width: 6,
            height: 6,
            classes: 'current-ball-highlight',
            appendTo: gantt.$header,
        });
    }

    /**
     * Get the closest date element to now
     * @returns {[Temporal.Instant, Element] | null}
     */
    getClosestDate() {
        const gantt = this.gantt;
        const now = Temporal.Now.instant();

        if (Temporal.Instant.compare(now, gantt.grid.start) < 0 ||
            Temporal.Instant.compare(now, gantt.grid.end) > 0) {
            return null;
        }

        const dateFormat = this.viewMode.date_format || gantt.options.date_format;
        let current = now;
        let el = this.$container.querySelector(
            '.date_' + this._sanitize(format(current, dateFormat, gantt.options.language))
        );

        // Safety check to prevent infinite loop
        let c = 0;
        while (!el && c < this.step.interval) {
            current = add(current, -1, this.step.unit);
            el = this.$container.querySelector(
                '.date_' + this._sanitize(format(current, dateFormat, gantt.options.language))
            );
            c++;
        }

        const formattedDate = format(current, dateFormat, gantt.options.language);
        return [ensureInstant(formattedDate + ' '), el];
    }

    /**
     * Check if a date is in the ignored list
     * @private
     */
    _isIgnored(instant) {
        const gantt = this.gantt;
        return gantt.config.ignored_dates.some(
            (k) => Temporal.Instant.compare(ensureInstant(k), instant) === 0
        ) || (gantt.config.ignored_function && gantt.config.ignored_function(instant));
    }

    /**
     * Check if current view is month view
     * @private
     */
    _isMonthView() {
        return this.viewMode?.name === 'Month';
    }

    /**
     * Check if current view is year view
     * @private
     */
    _isYearView() {
        return this.viewMode?.name === 'Year';
    }

    /**
     * Sanitize string for use in CSS class names
     * @private
     */
    _sanitize(s) {
        return s.replaceAll(' ', '_').replaceAll(':', '_').replaceAll('.', '_');
    }

    /**
     * Create an HTML element with positioning
     * @private
     */
    _createElement({ left, top, width, height, id, classes, appendTo, type }) {
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