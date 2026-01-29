import { Temporal, parseDuration, add } from './temporal_utils';

/**
 * Scheduler - Temporal computation layer
 *
 * Handles scheduling logic:
 * - Snap calculations for drag/resize operations
 * - Task date/progress mutations with event triggering
 * - Dependency-aware affected-task resolution
 *
 * Purely temporal - no visual/DOM awareness.
 */
export default class Scheduler {
    /**
     * @param {Gantt} gantt - Reference to the Gantt instance
     */
    constructor(gantt) {
        this.gantt = gantt;
    }

    // =========================================================================
    // SNAP LOGIC
    // =========================================================================

    /**
     * Calculate snapped pixel delta from raw pixel delta.
     *
     * Quantizes raw drag movement to the nearest snap boundary based on
     * the current view mode's step duration and snap setting.
     *
     * @param {number} dx - Raw pixel delta from drag start
     * @returns {number} Snapped pixel delta
     */
    getSnapPosition(dx) {
        const gantt = this.gantt;
        const step_duration = parseDuration(gantt.config.view_mode.step);
        const default_snap =
            gantt.options.snap_at || gantt.config.view_mode.snap_at || '1d';

        let snap_duration = step_duration;
        if (default_snap !== 'unit') {
            snap_duration = parseDuration(default_snap);
        }

        const relativeTo = Temporal.Now.plainDateISO();
        const step_ms = step_duration.total({
            unit: 'millisecond',
            relativeTo,
        });
        const snap_ms = snap_duration.total({
            unit: 'millisecond',
            relativeTo,
        });

        const snap_pixels =
            (snap_ms / step_ms) * gantt.config.step.column_width;

        return Math.round(dx / snap_pixels) * snap_pixels;
    }

    // =========================================================================
    // TASK MUTATION
    // =========================================================================

    /**
     * Commit a date change to a task after drag/resize.
     *
     * Only fires the 'date_change' event if dates actually changed.
     * The end date passed to the event has 1 second subtracted
     * (inclusive-end convention).
     *
     * @param {Task} task - The task to update
     * @param {Temporal.Instant} newStart - New start instant
     * @param {Temporal.Instant} newEnd - New end instant
     */
    commitDateChange(task, newStart, newEnd) {
        const changed =
            Temporal.Instant.compare(task.start, newStart) !== 0 ||
            Temporal.Instant.compare(task.end, newEnd) !== 0;

        if (changed) {
            task.start = newStart;
            task.end = newEnd;
            this.gantt.triggerEvent('date_change', [
                task,
                newStart,
                add(newEnd, -1, 'second'),
            ]);
        }
    }

    /**
     * Commit a progress change to a task after progress-handle drag.
     *
     * @param {Task} task - The task to update
     * @param {number} newProgress - New progress percentage (0-100)
     */
    commitProgressChange(task, newProgress) {
        task.progress = newProgress;
        this.gantt.triggerEvent('progress_change', [task, newProgress]);
    }

    // =========================================================================
    // DEPENDENCY RESOLUTION
    // =========================================================================

    /**
     * Get all task IDs affected by modifying the given task.
     *
     * Encapsulates the move_dependencies policy: when enabled, returns the
     * task itself plus all transitively dependent tasks. Otherwise returns
     * only the given task.
     *
     * @param {string} taskId - The task being modified
     * @returns {string[]} Affected task IDs (always includes taskId)
     */
    getAffectedTaskIds(taskId) {
        const ids = [taskId];
        if (this.gantt.options.move_dependencies) {
            ids.push(...this.gantt.tasks.getAllDependentIds(taskId));
        }
        return ids;
    }
}
