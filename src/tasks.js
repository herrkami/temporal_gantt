import {
    ensureInstant,
    parseInstant,
    parseDurationString,
    add,
    diff,
    toPlainDateTime,
    Temporal,
} from './temporal_utils';

/**
 * Task - Represents a single task in the Gantt chart
 *
 * Separates original constraints (user-defined) from derived values (computed).
 */
export class Task {
    /**
     * @param {Object} data - Parsed task data
     */
    constructor(data) {
        // Core identity
        this.uid = data.uid;
        this.name = data.name;
        this._index = data._index;

        // Temporal values
        this.start = data.start;
        this.end = data.end;
        this.duration = data.duration;

        // Progress (0-100)
        this.progress = data.progress ?? 0;

        // Dependencies (array of task UIDs)
        this.dependencies = data.dependencies ?? [];

        // Visual properties
        this.custom_class = data.custom_class;
        this.color = data.color;
        this.color_progress = data.color_progress;
        this.thumbnail = data.thumbnail;
        this.invalid = data.invalid;

        // Original constraints as provided by user (for export)
        this._original = data._original ?? {};

        // Derived values computed during rendering
        this._derived = data._derived ?? {};
    }

    /**
     * Update task properties
     * @param {Object} changes - Properties to update
     */
    update(changes) {
        for (const [key, value] of Object.entries(changes)) {
            if (key === 'uid' || key === '_index') continue;

            if (key === 'start' || key === 'end') {
                this[key] = ensureInstant(value);
            } else {
                this[key] = value;
            }
        }
    }

    /**
     * Export task to minimal constraint format
     */
    toSpec() {
        const spec = {
            id: this.uid,
            name: this.name,
            progress: this.progress,
        };

        if (this._original.start) spec.start = this._original.start;
        else spec.start = this.start.toString();

        if (this._original.end) spec.end = this._original.end;
        else if (this._original.duration) spec.duration = this._original.duration;
        else spec.end = this.end.toString();

        if (this.dependencies.length > 0) {
            spec.dependencies = this.dependencies.join(', ');
        }

        if (this.custom_class) spec.custom_class = this.custom_class;
        if (this.color) spec.color = this.color;
        if (this.color_progress) spec.color_progress = this.color_progress;
        if (this.thumbnail) spec.thumbnail = this.thumbnail;

        return spec;
    }
}

/**
 * Tasks - Collection manager for Task objects
 *
 * Manages task storage, indexing, and dependency relationships.
 * Pure data layer - no visual or scheduling logic.
 */
export default class Tasks {
    constructor() {
        this._tasks = [];
        this._byId = new Map();
        // Map<taskId, Set<dependentTaskId>> - tasks that depend on the key
        this._dependents = new Map();
    }

    /**
     * Load tasks from raw input array
     * @param {Array} rawTasks - Array of raw task objects
     * @returns {Tasks} this instance for chaining
     */
    load(rawTasks) {
        this.clear();

        rawTasks.forEach((rawTask, index) => {
            const task = this._parseTask(rawTask, index);
            if (task) {
                this._addInternal(task);
            }
        });

        this._buildDependencyGraph();
        return this;
    }

    _parseTask(rawTask, index) {
        const data = {
            _original: {
                start: rawTask.start,
                end: rawTask.end,
                duration: rawTask.duration,
            },
            _derived: {},
        };

        data.name = rawTask.name;
        data.progress = rawTask.progress ?? 0;

        // Generate or normalize ID
        if (!rawTask.id) {
            data.uid = this._generateUid(rawTask);
        } else if (typeof rawTask.id === 'string') {
            data.uid = rawTask.id.replaceAll(' ', '_');
        } else {
            data.uid = `${rawTask.id}`;
        }

        // Copy optional visual properties
        if (rawTask.custom_class) data.custom_class = rawTask.custom_class;
        if (rawTask.color) data.color = rawTask.color;
        if (rawTask.color_progress) data.color_progress = rawTask.color_progress;
        if (rawTask.thumbnail) data.thumbnail = rawTask.thumbnail;
        if (rawTask.invalid !== undefined) data.invalid = rawTask.invalid;

        // Parse dependencies
        let deps = [];
        if (typeof rawTask.dependencies === 'string') {
            deps = rawTask.dependencies
                .split(',')
                .map((d) => d.trim().replaceAll(' ', '_'))
                .filter((d) => d);
        } else if (Array.isArray(rawTask.dependencies)) {
            deps = rawTask.dependencies
                .map((d) => (typeof d === 'string' ? d.trim().replaceAll(' ', '_') : `${d}`))
                .filter((d) => d);
        }
        data.dependencies = deps;

        // Validate and parse start
        if (!rawTask.start) {
            console.error(`task "${rawTask.name}" (ID: "${rawTask.id}") doesn't have a start date`);
            return null;
        }
        data.start = parseInstant(rawTask.start);

        // Parse duration if defined
        if (rawTask.duration !== undefined) {
            rawTask.duration.split(' ').forEach((ds) => {
                const { value, unit } = parseDurationString(ds);
                data.end = add(data.start, value, unit);
                data.duration = diff(data.end, data.start);
            });
        }

        // Parse end if defined
        if (rawTask.end !== undefined) {
            const descEnd = parseInstant(rawTask.end);
            if (data.end !== undefined) {
                if (Temporal.Instant.compare(data.end, descEnd) !== 0) {
                    console.error(
                        `end date of task "${rawTask.name}" (ID: "${rawTask.id}") contradicts its start and duration`,
                    );
                    return null;
                } else {
                    console.warn(
                        `end of task "${rawTask.name}" (ID: "${rawTask.id}") is redundantly defined by duration`,
                    );
                }
            } else {
                data.end = descEnd;
            }
        }

        // Validate end exists
        if (!data.end) {
            console.error(`task "${rawTask.name}" (ID: "${rawTask.id}") has neither end date nor duration`);
            return null;
        }

        // Validate start/end order
        if (Temporal.Instant.compare(data.end, data.start) < 0) {
            console.error(`start of task can't be after end of task: in task "${rawTask.name}" (ID: "${rawTask.id}")`);
            return null;
        }

        // Validate duration limit
        if (diff(data.end, data.start, 'year') > 10) {
            console.error(`the duration of task "${rawTask.name}" (ID: "${rawTask.id}") is too long (above ten years)`);
            return null;
        }

        data._index = index;

        // If end has no time component, assume full day
        const taskEndPdt = toPlainDateTime(data.end);
        if (taskEndPdt.hour === 0 && taskEndPdt.minute === 0 &&
            taskEndPdt.second === 0 && taskEndPdt.millisecond === 0) {
            data.end = add(data.end, 24, 'hour');
        }

        return new Task(data);
    }

    _generateUid(task) {
        return task.name + '_' + Math.random().toString(36).slice(2, 12);
    }

    _addInternal(task) {
        this._tasks.push(task);
        this._byId.set(task.uid, task);
    }

    _buildDependencyGraph() {
        this._dependents.clear();

        for (const task of this._tasks) {
            if (!this._dependents.has(task.uid)) {
                this._dependents.set(task.uid, new Set());
            }

            for (const depId of task.dependencies) {
                if (!this._dependents.has(depId)) {
                    this._dependents.set(depId, new Set());
                }
                this._dependents.get(depId).add(task.uid);
            }
        }
    }

    // CRUD Operations

    get(id) {
        return this._byId.get(id);
    }

    getAll() {
        return this._tasks;
    }

    getDependents(id) {
        const dependentIds = this._dependents.get(id);
        if (!dependentIds) return [];
        return Array.from(dependentIds)
            .map((depId) => this.get(depId))
            .filter(Boolean);
    }

    getDependentIds(id) {
        const dependentIds = this._dependents.get(id);
        return dependentIds ? Array.from(dependentIds) : [];
    }

    getAllDependentIds(id) {
        const result = [];
        const toProcess = [id];
        const processed = new Set();

        while (toProcess.length) {
            const currentId = toProcess.shift();
            if (processed.has(currentId)) continue;
            processed.add(currentId);

            const deps = this.getDependentIds(currentId);
            for (const depId of deps) {
                if (!processed.has(depId)) {
                    result.push(depId);
                    toProcess.push(depId);
                }
            }
        }

        return result;
    }

    getDependencies(id) {
        const task = this.get(id);
        if (!task) return [];
        return task.dependencies.map((depId) => this.get(depId)).filter(Boolean);
    }

    add(rawTask) {
        const index = this._tasks.length;
        const task = this._parseTask(rawTask, index);
        if (!task) return null;

        this._addInternal(task);
        this._buildDependencyGraph();
        return task;
    }

    remove(id) {
        const index = this._tasks.findIndex((t) => t.uid === id);
        if (index === -1) return false;

        this._tasks.splice(index, 1);
        this._byId.delete(id);

        // Reindex
        this._tasks.forEach((task, i) => {
            task._index = i;
        });

        this._buildDependencyGraph();
        return true;
    }

    update(id, changes) {
        const task = this.get(id);
        if (!task) return null;

        task.update(changes);

        if ('dependencies' in changes) {
            this._buildDependencyGraph();
        }

        return task;
    }

    clear() {
        this._tasks = [];
        this._byId.clear();
        this._dependents.clear();
    }

    // Properties

    get length() {
        return this._tasks.length;
    }

    isEmpty() {
        return this._tasks.length === 0;
    }

    // Iteration

    forEach(callback) {
        this._tasks.forEach(callback);
    }

    map(callback) {
        return this._tasks.map(callback);
    }

    filter(predicate) {
        return this._tasks.filter(predicate);
    }

    find(predicate) {
        return this._tasks.find(predicate);
    }

    // Query methods

    getOldestStart() {
        if (this.isEmpty()) return Temporal.Now.instant();
        return this._tasks.reduce((oldest, task) => {
            return Temporal.Instant.compare(task.start, oldest) < 0 ? task.start : oldest;
        }, this._tasks[0].start);
    }

    getLatestEnd() {
        if (this.isEmpty()) return Temporal.Now.instant();
        return this._tasks.reduce((latest, task) => {
            return Temporal.Instant.compare(task.end, latest) > 0 ? task.end : latest;
        }, this._tasks[0].end);
    }

    // Compatibility

    getDependencyMap() {
        const map = {};
        for (const [id, dependents] of this._dependents) {
            if (dependents.size > 0) {
                map[id] = Array.from(dependents);
            }
        }
        return map;
    }

    // Export

    export() {
        return this._tasks.map((task) => task.toSpec());
    }
}
