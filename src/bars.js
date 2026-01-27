import Bar from './bar';

/**
 * Bars - Collection manager for Bar objects
 *
 * Manages bar rendering, lookup, and arrow associations.
 * Visual layer - no scheduling logic.
 */
export default class Bars {
    /**
     * @param {Gantt} gantt - Reference to the Gantt instance
     */
    constructor(gantt) {
        this.gantt = gantt;
        this._bars = [];
        this._byTaskId = new Map();
    }

    /**
     * Create bars for all tasks and append to the bar layer
     * @param {SVGElement} layer - The SVG layer to append bars to
     */
    render(layer) {
        this.clear();

        for (const task of this.gantt.tasks) {
            const bar = new Bar(this.gantt, task);
            layer.appendChild(bar.group);
            this._bars.push(bar);
            this._byTaskId.set(task.uid, bar);
        }
    }

    /**
     * Associate arrows with their connected bars
     * @param {Arrow[]} arrows - Array of Arrow instances
     */
    mapArrows(arrows) {
        for (const bar of this._bars) {
            bar.arrows = arrows.filter((arrow) => {
                return (
                    arrow.from_task.task.uid === bar.task.uid ||
                    arrow.to_task.task.uid === bar.task.uid
                );
            });
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
}
