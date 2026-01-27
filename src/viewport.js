import { Temporal, ensureInstant, add, diff } from './temporal_utils';

/**
 * Viewport - The coordinate authority for time↔pixel conversion
 */
export default class Viewport {
    constructor(options = {}) {
        this.bounds = {
            min: options.bounds?.min ? ensureInstant(options.bounds.min) : undefined,
            max: options.bounds?.max ? ensureInstant(options.bounds.max) : undefined,
        };

        if (!options.visible?.start || !options.visible?.end) {
            throw new Error('Viewport requires visible.start and visible.end');
        }
        this.visible = {
            start: ensureInstant(options.visible.start),
            end: ensureInstant(options.visible.end),
        };

        this.columnWidth = options.columnWidth || 45;
        this.stepInterval = options.stepInterval || 1;
        this.stepUnit = options.stepUnit || 'day';

        this._updateScale();
    }

    _updateScale() {
        const baseInstant = Temporal.Instant.fromEpochMilliseconds(0);
        const endInstant = add(baseInstant, this.stepInterval, this.stepUnit);
        const msPerInterval = endInstant.epochMilliseconds - baseInstant.epochMilliseconds;
        this.msPerPixel = msPerInterval / this.columnWidth;
    }

    dateToX(instant) {
        const inst = ensureInstant(instant);
        const msOffset = inst.epochMilliseconds - this.visible.start.epochMilliseconds;
        return msOffset / this.msPerPixel;
    }

    xToDate(x) {
        const msOffset = x * this.msPerPixel;
        return Temporal.Instant.fromEpochMilliseconds(
            Math.round(this.visible.start.epochMilliseconds + msOffset)
        );
    }

    setVisible(start, end) {
        let newStart = ensureInstant(start);
        let newEnd = ensureInstant(end);

        if (this.bounds.min && Temporal.Instant.compare(newStart, this.bounds.min) < 0) {
            const msShift = this.bounds.min.epochMilliseconds - newStart.epochMilliseconds;
            newStart = this.bounds.min;
            newEnd = Temporal.Instant.fromEpochMilliseconds(Math.round(newEnd.epochMilliseconds + msShift));
        }

        if (this.bounds.max && Temporal.Instant.compare(newEnd, this.bounds.max) > 0) {
            const msShift = newEnd.epochMilliseconds - this.bounds.max.epochMilliseconds;
            newEnd = this.bounds.max;
            newStart = Temporal.Instant.fromEpochMilliseconds(Math.round(newStart.epochMilliseconds - msShift));

            if (this.bounds.min && Temporal.Instant.compare(newStart, this.bounds.min) < 0) {
                newStart = this.bounds.min;
            }
        }

        const changed =
            Temporal.Instant.compare(newStart, this.visible.start) !== 0 ||
            Temporal.Instant.compare(newEnd, this.visible.end) !== 0;

        this.visible.start = newStart;
        this.visible.end = newEnd;

        return changed;
    }

    pan(deltaPixels) {
        const deltaMs = deltaPixels * this.msPerPixel;
        const newStart = Temporal.Instant.fromEpochMilliseconds(
            Math.round(this.visible.start.epochMilliseconds + deltaMs)
        );
        const newEnd = Temporal.Instant.fromEpochMilliseconds(
            Math.round(this.visible.end.epochMilliseconds + deltaMs)
        );
        return this.setVisible(newStart, newEnd);
    }

    setScale(columnWidth, stepInterval, stepUnit) {
        this.columnWidth = columnWidth;
        if (stepInterval !== undefined) this.stepInterval = stepInterval;
        if (stepUnit !== undefined) this.stepUnit = stepUnit;
        this._updateScale();
    }

    extendBounds(direction, amount) {
        if (direction === 'past') {
            if (this.bounds.min !== undefined) {
                this.bounds.min = add(this.bounds.min, -amount, this.stepUnit);
            }
            this.visible.start = add(this.visible.start, -amount, this.stepUnit);
        } else if (direction === 'future') {
            if (this.bounds.max !== undefined) {
                this.bounds.max = add(this.bounds.max, amount, this.stepUnit);
            }
            this.visible.end = add(this.visible.end, amount, this.stepUnit);
        }
    }

    getVisibleWidth() {
        const msSpan = this.visible.end.epochMilliseconds - this.visible.start.epochMilliseconds;
        return msSpan / this.msPerPixel;
    }

    getVisibleSpan() {
        return diff(this.visible.end, this.visible.start, this.stepUnit);
    }

    isVisible(instant) {
        const inst = ensureInstant(instant);
        return Temporal.Instant.compare(inst, this.visible.start) >= 0 &&
               Temporal.Instant.compare(inst, this.visible.end) <= 0;
    }

    canScroll(direction) {
        if (direction === 'past') {
            return this.bounds.min === undefined ||
                   Temporal.Instant.compare(this.visible.start, this.bounds.min) > 0;
        } else {
            return this.bounds.max === undefined ||
                   Temporal.Instant.compare(this.visible.end, this.bounds.max) < 0;
        }
    }
}
