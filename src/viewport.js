import { Temporal, ensureInstant, add } from './temporal_utils';

/**
 * Viewport - Pure coordinate calculator for time↔pixel conversion
 *
 * The Viewport is stateless with respect to what's "visible" or "rendered".
 * It only knows:
 *   - origin: the instant that maps to x=0
 *   - msPerPixel: the scale factor
 *
 * All rendering policy (what range to render, scroll bounds, etc.) belongs
 * to Chart, not Viewport.
 */
export default class Viewport {
    /**
     * @param {Object} options
     * @param {Temporal.Instant|string} options.origin - The instant at x=0
     * @param {number} [options.columnWidth=45] - Pixels per step
     * @param {number} [options.stepInterval=1] - Number of units per step
     * @param {string} [options.stepUnit='day'] - Unit type (day, hour, etc.)
     */
    constructor(options = {}) {
        if (!options.origin) {
            throw new Error('Viewport requires an origin');
        }
        this.origin = ensureInstant(options.origin);

        this.columnWidth = options.columnWidth || 45;
        this.stepInterval = options.stepInterval || 1;
        this.stepUnit = options.stepUnit || 'day';

        this._updateScale();
    }

    /**
     * Recalculate msPerPixel based on current scale settings
     * @private
     */
    _updateScale() {
        const baseInstant = Temporal.Instant.fromEpochMilliseconds(0);
        const endInstant = add(baseInstant, this.stepInterval, this.stepUnit);
        const msPerInterval = endInstant.epochMilliseconds - baseInstant.epochMilliseconds;
        this.msPerPixel = msPerInterval / this.columnWidth;
    }

    /**
     * Convert a date/instant to x coordinate
     * @param {Temporal.Instant|string} instant
     * @returns {number} x coordinate in pixels
     */
    dateToX(instant) {
        const inst = ensureInstant(instant);
        const msOffset = inst.epochMilliseconds - this.origin.epochMilliseconds;
        return msOffset / this.msPerPixel;
    }

    /**
     * Convert x coordinate to date/instant
     * @param {number} x - x coordinate in pixels
     * @returns {Temporal.Instant}
     */
    xToDate(x) {
        const msOffset = x * this.msPerPixel;
        return Temporal.Instant.fromEpochMilliseconds(
            Math.round(this.origin.epochMilliseconds + msOffset)
        );
    }

    /**
     * Convert a Duration to pixel width
     * @param {Temporal.Duration} duration
     * @returns {number} pixels
     */
    durationToPixels(duration) {
        const relativeTo = Temporal.Now.plainDateISO();
        const ms = duration.total({ unit: 'milliseconds', relativeTo });
        return ms / this.msPerPixel;
    }

    /**
     * Convert pixel width to Duration
     * @param {number} pixels
     * @returns {Temporal.Duration}
     */
    pixelsToDuration(pixels) {
        const ms = Math.round(pixels * this.msPerPixel);
        return Temporal.Duration.from({ milliseconds: ms });
    }

    /**
     * Set the origin (instant at x=0)
     * @param {Temporal.Instant|string} instant
     */
    setOrigin(instant) {
        this.origin = ensureInstant(instant);
    }

    /**
     * Shift the origin by a pixel delta
     * @param {number} deltaPixels - Positive = shift origin into the future
     * @returns {Temporal.Instant} The new origin
     */
    shiftOrigin(deltaPixels) {
        const deltaMs = deltaPixels * this.msPerPixel;
        this.origin = Temporal.Instant.fromEpochMilliseconds(
            Math.round(this.origin.epochMilliseconds + deltaMs)
        );
        return this.origin;
    }

    /**
     * Update scale parameters
     * @param {number} columnWidth - Pixels per step
     * @param {number} [stepInterval] - Number of units per step
     * @param {string} [stepUnit] - Unit type (day, hour, etc.)
     */
    setScale(columnWidth, stepInterval, stepUnit) {
        this.columnWidth = columnWidth;
        if (stepInterval !== undefined) this.stepInterval = stepInterval;
        if (stepUnit !== undefined) this.stepUnit = stepUnit;
        this._updateScale();
    }

    /**
     * Calculate the pixel width for a given time range
     * @param {Temporal.Instant|string} start
     * @param {Temporal.Instant|string} end
     * @returns {number} width in pixels
     */
    rangeToPixels(start, end) {
        const startInst = ensureInstant(start);
        const endInst = ensureInstant(end);
        const msSpan = endInst.epochMilliseconds - startInst.epochMilliseconds;
        return msSpan / this.msPerPixel;
    }

    /**
     * Check if an instant falls within a pixel range (useful for visibility checks)
     * @param {Temporal.Instant|string} instant
     * @param {number} startX - Start x coordinate
     * @param {number} endX - End x coordinate
     * @returns {boolean}
     */
    isInRange(instant, startX, endX) {
        const x = this.dateToX(instant);
        return x >= startX && x <= endX;
    }
}