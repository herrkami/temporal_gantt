import Arrow from './arrow';

/**
 * Arrows - Collection manager for Arrow objects
 *
 * Manages arrow rendering and lookup.
 * Visual layer - no scheduling logic.
 */
export default class Arrows {
    /**
     * @param {Gantt} gantt - Reference to the Gantt instance
     */
    constructor(gantt) {
        this.gantt = gantt;
        this._arrows = [];
        this._byFromId = new Map();
        this._byToId = new Map();
    }

    /**
     * Create arrows for all task dependencies and append to the arrow layer
     * @param {SVGElement} layer - The SVG layer to append arrows to
     */
    render(layer) {
        this.clear();

        for (const task of this.gantt.tasks) {
            for (const depId of task.dependencies) {
                const dependency = this.gantt.taskStore.get(depId);
                if (!dependency) continue;

                const fromBar = this.gantt.barStore.get(depId);
                const toBar = this.gantt.barStore.get(task.uid);
                if (!fromBar || !toBar) continue;

                const arrow = new Arrow(this.gantt, fromBar, toBar);
                layer.appendChild(arrow.element);

                this._arrows.push(arrow);
                this._addToIndex(this._byFromId, depId, arrow);
                this._addToIndex(this._byToId, task.uid, arrow);
            }
        }

        // Map arrows to bars so bars can update them on move
        this._mapArrowsToBars();
    }

    _addToIndex(map, key, arrow) {
        if (!map.has(key)) {
            map.set(key, []);
        }
        map.get(key).push(arrow);
    }

    _mapArrowsToBars() {
        for (const bar of this.gantt.barStore.getAll()) {
            bar.arrows = this._arrows.filter((arrow) => {
                return (
                    arrow.from_task.task.uid === bar.task.uid ||
                    arrow.to_task.task.uid === bar.task.uid
                );
            });
        }
    }

    /**
     * Get arrows originating from a task
     * @param {string} taskId - Task UID
     * @returns {Arrow[]}
     */
    getFrom(taskId) {
        return this._byFromId.get(taskId) || [];
    }

    /**
     * Get arrows pointing to a task
     * @param {string} taskId - Task UID
     * @returns {Arrow[]}
     */
    getTo(taskId) {
        return this._byToId.get(taskId) || [];
    }

    /**
     * Get all arrows connected to a task (from or to)
     * @param {string} taskId - Task UID
     * @returns {Arrow[]}
     */
    getConnected(taskId) {
        const from = this.getFrom(taskId);
        const to = this.getTo(taskId);
        return [...from, ...to];
    }

    /**
     * Get all arrows
     * @returns {Arrow[]}
     */
    getAll() {
        return this._arrows;
    }

    /**
     * Clear all arrows
     */
    clear() {
        this._arrows = [];
        this._byFromId.clear();
        this._byToId.clear();
    }

    get length() {
        return this._arrows.length;
    }

    /**
     * Update all arrows (recalculate paths)
     */
    updateAll() {
        for (const arrow of this._arrows) {
            arrow.update();
        }
    }

    /**
     * Iterate over all arrows
     * @param {Function} callback
     */
    forEach(callback) {
        this._arrows.forEach(callback);
    }
}