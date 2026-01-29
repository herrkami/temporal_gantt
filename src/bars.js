import { $ } from './svg_utils';
import Bar from './bar';

/**
 * Bars - Collection manager for Bar objects
 *
 * Manages bar rendering, lookup, and drag/resize interactions.
 * Visual layer - delegates snapping and task updates to Gantt.
 */
export default class Bars {
    /**
     * @param {Gantt} gantt - Reference to the Gantt instance
     */
    constructor(gantt) {
        this.gantt = gantt;
        this._bars = [];
        this._byTaskId = new Map();

        // Drag/resize state
        this._dragState = null;
        this.dragging = null; // null = not dragging, false = drag started, true = actually dragging
    }

    /**
     * Create bars for all tasks and append to the bar layer
     * @param {SVGElement} layer - The SVG layer to append bars to
     */
    render(layer) {
        this.clear();

        for (const task of this.gantt.tasks.getAll()) {
            const bar = new Bar(this.gantt, task);
            layer.appendChild(bar.group);
            this._bars.push(bar);
            this._byTaskId.set(task.uid, bar);
        }
    }

    /**
     * Get bar by task ID
     * @param {string} id - Task UID
     * @returns {Bar|undefined}
     */
    get(id) {
        return this._byTaskId.get(id);
    }

    /**
     * Get bar by task index
     * @param {number} index - Task index
     * @returns {Bar|undefined}
     */
    getByIndex(index) {
        return this._bars[index];
    }

    /**
     * Get all bars
     * @returns {Bar[]}
     */
    getAll() {
        return this._bars;
    }

    /**
     * Find bar matching predicate
     * @param {Function} predicate
     * @returns {Bar|undefined}
     */
    find(predicate) {
        return this._bars.find(predicate);
    }

    /**
     * Clear all bars
     */
    clear() {
        this._bars = [];
        this._byTaskId.clear();
    }

    get length() {
        return this._bars.length;
    }

    /**
     * Iterate over all bars
     * @param {Function} callback
     */
    forEach(callback) {
        this._bars.forEach(callback);
    }

    /**
     * Map over all bars
     * @param {Function} callback
     * @returns {Array}
     */
    map(callback) {
        return this._bars.map(callback);
    }

    // =========================================================================
    // DRAG/RESIZE EVENT HANDLING
    // =========================================================================

    /**
     * Bind drag and resize events to the SVG element
     * @param {SVGElement} svg - The SVG element to bind events to
     */
    bindDragEvents(svg) {
        $.on(svg, 'mousedown', '.bar-wrapper, .handle', (e, element) => {
            this._startDrag(e, element);
        });

        $.on(svg, 'mousemove', (e) => {
            this._onDragMove(e);
        });

        $.on(svg, 'mouseup', () => {
            this._endDrag();
        });

        // Also end drag if mouse leaves the document
        document.addEventListener('mouseup', () => {
            if (this._dragState) {
                this._endDrag();
            }
        });
    }

    /**
     * Start a drag or resize operation
     * @private
     */
    _startDrag(e, element) {
        const gantt = this.gantt;
        const barWrapper = $.closest('.bar-wrapper', element);
        if (!barWrapper) return;

        const parentBarId = barWrapper.getAttribute('data-id');
        const parentBar = this.get(parentBarId);
        if (!parentBar) return;

        // Determine drag type
        let dragType = 'move';
        if (element.classList.contains('left')) {
            dragType = 'resize-left';
            element.classList.add('visible');
        } else if (element.classList.contains('right')) {
            dragType = 'resize-right';
            element.classList.add('visible');
        } else if (element.classList.contains('progress')) {
            // Progress is handled separately
            return;
        }

        // Hide popup during drag
        gantt.hidePopup();

        // Collect affected bars (parent + dependents if move_dependencies)
        let barIds = [parentBarId];
        if (gantt.options.move_dependencies) {
            barIds = [parentBarId, ...gantt.getAllDependentTasks(parentBarId)];
        }
        const bars = barIds.map((id) => this.get(id)).filter(Boolean);

        // Store initial positions
        for (const bar of bars) {
            const $bar = bar.$bar;
            $bar.ox = $bar.getX();
            $bar.oy = $bar.getY();
            $bar.owidth = $bar.getWidth();
            $bar.finaldx = 0;
        }

        this._dragState = {
            type: dragType,
            startX: e.offsetX || e.layerX,
            parentBarId,
            bars,
            dragging: false, // Becomes true after threshold movement
        };

        this.dragging = false;
    }

    /**
     * Handle mouse move during drag
     * @private
     */
    _onDragMove(e) {
        if (!this._dragState) return;

        const gantt = this.gantt;
        const { type, startX, parentBarId, bars } = this._dragState;
        const currentX = e.offsetX || e.layerX;
        const rawDx = currentX - startX;

        // Detect if actually dragging (threshold for click vs drag)
        if (!this._dragState.dragging && Math.abs(rawDx) > 10) {
            this._dragState.dragging = true;
            this.dragging = true;
        }

        if (!this._dragState.dragging) return;

        // Get snapped delta (Scheduler territory - delegated to Gantt)
        const dx = gantt.getSnapPosition(rawDx);
        gantt.hidePopup();

        // Update each affected bar's visual position
        for (const bar of bars) {
            const $bar = bar.$bar;
            $bar.finaldx = dx;

            if (type === 'resize-left') {
                if (bar.task.uid === parentBarId) {
                    bar.updateBarPosition({
                        x: $bar.ox + dx,
                        width: $bar.owidth - dx,
                    });
                } else {
                    bar.updateBarPosition({ x: $bar.ox + dx });
                }
            } else if (type === 'resize-right') {
                if (bar.task.uid === parentBarId) {
                    bar.updateBarPosition({ width: $bar.owidth + dx });
                }
            } else if (type === 'move') {
                if (!gantt.options.readonly && !gantt.options.readonly_dates) {
                    bar.updateBarPosition({ x: $bar.ox + dx });
                }
            }
        }
    }

    /**
     * End drag operation and commit changes
     * @private
     */
    _endDrag() {
        if (!this._dragState) return;

        const gantt = this.gantt;
        const { bars } = this._dragState;

        // Clear visible handle state
        gantt.chart.$container
            .querySelector('.visible')
            ?.classList?.remove?.('visible');

        // Commit changes for each bar
        for (const bar of bars) {
            const $bar = bar.$bar;
            if (!$bar.finaldx) continue;

            // Compute new dates from visual position (Scheduler territory)
            const { newStart, newEnd } = bar.computeStartEndFromPosition();

            // Delegate task update to Gantt
            gantt.commitBarDateChange(bar, newStart, newEnd);

            bar.setActionCompleted();
        }

        this.dragging = null;
        this._dragState = null;
    }

    /**
     * Bind progress drag events to the SVG element
     * @param {SVGElement} svg - The SVG element to bind events to
     */
    bindProgressEvents(svg) {
        const gantt = this.gantt;
        let progressState = null;

        $.on(svg, 'mousedown', '.handle.progress', (e, handle) => {
            const barWrapper = $.closest('.bar-wrapper', handle);
            const id = barWrapper.getAttribute('data-id');
            const bar = this.get(id);
            if (!bar) return;

            const $bar_progress = bar.$bar_progress;
            const $bar = bar.$bar;

            progressState = {
                bar,
                $bar_progress,
                startX: e.offsetX || e.layerX,
                owidth: $bar_progress.getWidth(),
                minDx: -$bar_progress.getWidth(),
                maxDx: $bar.getWidth() - $bar_progress.getWidth(),
                finaldx: 0,
            };
        });

        $.on(svg, 'mousemove', (e) => {
            if (!progressState) return;

            const { $bar_progress, startX, owidth, minDx, maxDx, bar } = progressState;
            const currentX = e.offsetX || e.layerX;
            let dx = currentX - startX;

            // Clamp to valid range
            dx = Math.max(minDx, Math.min(maxDx, dx));

            $bar_progress.setAttribute('width', owidth + dx);
            $.attr(bar.$handle_progress, 'cx', $bar_progress.getEndX());

            progressState.finaldx = dx;
        });

        $.on(svg, 'mouseup', () => {
            if (!progressState || !progressState.finaldx) {
                progressState = null;
                return;
            }

            const { bar } = progressState;

            // Compute new progress from visual position
            const newProgress = bar.computeProgressFromPosition();

            // Delegate task update to Gantt
            gantt.commitBarProgressChange(bar, newProgress);

            bar.setActionCompleted();
            progressState = null;
        });
    }
}
