// Always use polyfill for consistent behavior across browsers
// Native Temporal support is still experimental in some browsers
import { Temporal } from 'temporal-polyfill';

// Default timezone for converting Instant to PlainDateTime
const DEFAULT_TIMEZONE = 'UTC';

// Unit short forms for duration formatting
const UNIT_SHORT_FORMS = {
    year: 'y',
    month: 'mo',
    week: 'w',
    day: 'd',
    hour: 'h',
    minute: 'min',
    second: 's',
    millisecond: 'ms',
};

/**
 * Ensure input is a Temporal.Instant
 * @param {Temporal.Instant|Date|string|number} input
 * @returns {Temporal.Instant}
 */
export function ensureInstant(input) {
    if (input instanceof Temporal.Instant) {
        return input;
    }
    if (input instanceof Temporal.ZonedDateTime) {
        return input.toInstant();
    }
    if (input instanceof Temporal.PlainDateTime) {
        return input.toZonedDateTime(DEFAULT_TIMEZONE).toInstant();
    }
    if (input instanceof Date) {
        return Temporal.Instant.fromEpochMilliseconds(input.getTime());
    }
    if (typeof input === 'number') {
        return Temporal.Instant.fromEpochMilliseconds(input);
    }
    if (typeof input === 'string') {
        return parseInstant(input);
    }
    throw new Error(`Cannot convert ${typeof input} to Temporal.Instant`);
}

/**
 * Convert Instant to PlainDateTime in UTC for local operations
 * @param {Temporal.Instant} instant
 * @returns {Temporal.PlainDateTime}
 */
export function toPlainDateTime(instant) {
    return instant.toZonedDateTimeISO(DEFAULT_TIMEZONE).toPlainDateTime();
}

/**
 * Convert PlainDateTime back to Instant (assumes UTC)
 * @param {Temporal.PlainDateTime} pdt
 * @returns {Temporal.Instant}
 */
export function toInstant(pdt) {
    return pdt.toZonedDateTime(DEFAULT_TIMEZONE).toInstant();
}

/**
 * Parse custom duration format ("1d", "2h", "30min") into Temporal.Duration
 * @param {string} durationStr
 * @returns {Temporal.Duration}
 */
export function parseDuration(durationStr) {
    const regex = /^(\d+)(y|mo|m|w|d|h|min|s|ms)$/;
    const matches = durationStr.match(regex);

    if (!matches) {
        console.warn(`Invalid duration "${durationStr}", defaulting to 1 day`);
        return Temporal.Duration.from({ days: 1 });
    }

    const value = parseInt(matches[1], 10);
    const unit = matches[2];

    const unitMap = {
        'y': { years: value },
        'mo': { months: value },
        'm': { months: value },
        'w': { weeks: value },
        'd': { days: value },
        'h': { hours: value },
        'min': { minutes: value },
        's': { seconds: value },
        'ms': { milliseconds: value },
    };

    return Temporal.Duration.from(unitMap[unit] || { days: 1 });
}

/**
 * Parse a duration string and return the numeric value and unit name
 * @param {string} durationStr - Duration string like "1d", "2h", "30min"
 * @returns {{value: number, unit: string}}
 */
export function parseDurationString(durationStr) {
    const regex = /^(\d+)(y|mo|m|w|d|h|min|s|ms)$/;
    const matches = durationStr.match(regex);

    if (!matches) {
        console.warn(`Invalid duration "${durationStr}", defaulting to 1 day`);
        return { value: 1, unit: 'day' };
    }

    const value = parseInt(matches[1], 10);
    const unitAbbrev = matches[2];

    const unitMap = {
        'y': 'year',
        'mo': 'month',
        'm': 'month',
        'w': 'week',
        'd': 'day',
        'h': 'hour',
        'min': 'minute',
        's': 'second',
        'ms': 'millisecond',
    };

    return { value, unit: unitMap[unitAbbrev] || 'day' };
}

/**
 * Parse input into Temporal.Instant
 * Handles: Instant, Date, string ("YYYY-MM-DD" or "YYYY-MM-DD HH:mm:ss.SSS")
 * @param {Temporal.Instant|Date|string} input
 * @param {string} dateSeparator
 * @param {RegExp} timeSeparator
 * @returns {Temporal.Instant}
 */
export function parseInstant(input, dateSeparator = '-', timeSeparator = /[.:]/) {
    if (input instanceof Temporal.Instant) {
        return input;
    }
    if (input instanceof Temporal.ZonedDateTime) {
        return input.toInstant();
    }
    if (input instanceof Temporal.PlainDateTime) {
        return input.toZonedDateTime(DEFAULT_TIMEZONE).toInstant();
    }
    if (input instanceof Date) {
        return Temporal.Instant.fromEpochMilliseconds(input.getTime());
    }

    if (typeof input === 'string') {
        // Try ISO format first
        const normalized = input.trim().replace(' ', 'T');
        if (normalized.includes('T') || normalized.includes('Z')) {
            try {
                // If it looks like an instant (has Z or timezone offset)
                if (normalized.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(normalized)) {
                    return Temporal.Instant.from(normalized);
                }
                // Otherwise parse as PlainDateTime and convert
                const pdt = Temporal.PlainDateTime.from(normalized);
                return pdt.toZonedDateTime(DEFAULT_TIMEZONE).toInstant();
            } catch {
                // Fall through to manual parsing
            }
        }

        // Manual parsing for custom formats
        const parts = input.trim().split(' ');
        const dateParts = parts[0].split(dateSeparator).map(Number);
        const timeParts = parts[1] && parts[1].trim() ? parts[1].split(timeSeparator).map(Number) : [];

        const year = dateParts[0];
        const month = dateParts[1] || 1;
        const day = dateParts[2] || 1;
        const hour = timeParts[0] || 0;
        const minute = timeParts[1] || 0;
        const second = timeParts[2] || 0;
        const millisecond = timeParts[3] || 0;

        const pdt = Temporal.PlainDateTime.from({
            year, month, day, hour, minute, second, millisecond
        });
        return pdt.toZonedDateTime(DEFAULT_TIMEZONE).toInstant();
    }

    throw new Error(`Cannot parse instant from ${typeof input}`);
}

/**
 * Calculate difference between two instants using Temporal.Duration
 * @param {Temporal.Instant|Date|string} instantA
 * @param {Temporal.Instant|Date|string} instantB
 * @param {string} scale - 'millisecond'|'second'|'minute'|'hour'|'day'|'month'|'year'
 * @returns {number}
 */
export function diff(instantA, instantB, scale = 'day') {
    const a = ensureInstant(instantA);
    const b = ensureInstant(instantB);

    // Normalize scale (remove trailing 's' if present)
    let unit = scale.endsWith('s') ? scale.slice(0, -1) : scale;

    // Convert to PlainDateTime for calendar-aware duration calculation
    const pdtA = toPlainDateTime(a);
    const pdtB = toPlainDateTime(b);

    // Get duration between the two instants
    const duration = pdtA.since(pdtB, {
        largestUnit: unit + 's',
    });

    // Return total in the requested unit
    const total = duration.total({
        unit,
        relativeTo: pdtB,
    });

    return Math.round(total * 100) / 100;
}

/**
 * Add duration to an instant
 * @param {Temporal.Instant|Date|string} instant
 * @param {number} qty
 * @param {string} scale
 * @returns {Temporal.Instant}
 */
export function add(instant, qty, scale) {
    const inst = ensureInstant(instant);
    const pdt = toPlainDateTime(inst);

    // Build duration object with pluralized key
    const pluralScale = scale.endsWith('s') ? scale : scale + 's';
    const duration = Temporal.Duration.from({ [pluralScale]: parseInt(qty, 10) });

    const newPdt = pdt.add(duration);
    return toInstant(newPdt);
}

/**
 * Get the start of a time unit
 * @param {Temporal.Instant|Date|string} instant
 * @param {string} scale
 * @returns {Temporal.Instant}
 */
export function floor(instant, scale) {
    const pdt = toPlainDateTime(ensureInstant(instant));

    let truncated;
    switch (scale) {
        case 'year':
            truncated = pdt.with({ month: 1, day: 1, hour: 0, minute: 0, second: 0, millisecond: 0 });
            break;
        case 'month':
            truncated = pdt.with({ day: 1, hour: 0, minute: 0, second: 0, millisecond: 0 });
            break;
        case 'week':
            // Get to start of week (assuming Monday is first day)
            const dayOfWeek = pdt.dayOfWeek; // 1 = Monday, 7 = Sunday
            const daysToSubtract = dayOfWeek - 1;
            truncated = pdt.subtract({ days: daysToSubtract }).with({ hour: 0, minute: 0, second: 0, millisecond: 0 });
            break;
        case 'day':
            truncated = pdt.with({ hour: 0, minute: 0, second: 0, millisecond: 0 });
            break;
        case 'hour':
            truncated = pdt.with({ minute: 0, second: 0, millisecond: 0 });
            break;
        case 'minute':
            truncated = pdt.with({ second: 0, millisecond: 0 });
            break;
        case 'second':
            truncated = pdt.with({ millisecond: 0 });
            break;
        default:
            truncated = pdt;
    }

    return toInstant(truncated);
}

/**
 * Get today at midnight (UTC)
 * @returns {Temporal.Instant}
 */
export function today() {
    return floor(Temporal.Now.instant(), 'day');
}

/**
 * Get current instant
 * @returns {Temporal.Instant}
 */
export function now() {
    return Temporal.Now.instant();
}

/**
 * Format an instant using a format string
 * @param {Temporal.Instant|Date|string} instant
 * @param {string} formatStr - Format string like 'YYYY-MM-DD HH:mm:ss.SSS'
 * @param {string} lang - Language code for month names
 * @returns {string}
 */
export function format(instant, formatStr = 'YYYY-MM-DD HH:mm:ss.SSS', lang = 'en') {
    const inst = ensureInstant(instant);
    const pdt = toPlainDateTime(inst);

    // Get localized month names directly from PlainDateTime
    const monthName = pdt.toLocaleString(lang, { month: 'long' });
    const monthNameCapitalized = monthName.charAt(0).toUpperCase() + monthName.slice(1);

    const formatMap = {
        'YYYY': String(pdt.year),
        'MM': String(pdt.month).padStart(2, '0'),
        'DD': String(pdt.day).padStart(2, '0'),
        'D': String(pdt.day),
        'HH': String(pdt.hour).padStart(2, '0'),
        'mm': String(pdt.minute).padStart(2, '0'),
        'ss': String(pdt.second).padStart(2, '0'),
        'SSS': String(pdt.millisecond).padStart(3, '0'),
        'MMMM': monthNameCapitalized,
        'MMM': pdt.toLocaleString(lang, { month: 'short' }),
    };

    let result = formatStr;
    const formattedValues = [];

    // Replace longer tokens first to avoid partial matches
    Object.keys(formatMap)
        .sort((a, b) => b.length - a.length)
        .forEach((key) => {
            if (result.includes(key)) {
                result = result.replaceAll(key, `$${formattedValues.length}`);
                formattedValues.push(formatMap[key]);
            }
        });

    formattedValues.forEach((value, i) => {
        result = result.replaceAll(`$${i}`, value);
    });

    return result;
}

/**
 * Get number of days in the month of the given instant
 * @param {Temporal.Instant|Date|string} instant
 * @returns {number}
 */
export function getDaysInMonth(instant) {
    const pdt = toPlainDateTime(ensureInstant(instant));
    return pdt.daysInMonth;
}

/**
 * Get number of days in the year of the given instant
 * @param {Temporal.Instant|Date|string} instant
 * @returns {number}
 */
export function getDaysInYear(instant) {
    const pdt = toPlainDateTime(ensureInstant(instant));
    return pdt.daysInYear;
}

/**
 * Format a Temporal.Duration into a human-readable string
 * @param {Temporal.Duration} duration - Duration to format
 * @param {object} options - Formatting options
 * @returns {string}
 */
export function formatDuration(duration, options = {}) {
    const {
        showMilliseconds = true,
        maxUnits = null,
        shortForm = false,
    } = options;

    // Handle zero duration
    const sign = Temporal.Duration.compare(duration, Temporal.Duration.from({ seconds: 0 }));
    if (sign === 0) return shortForm ? '0ms' : '0 milliseconds';
    if (sign < 0) return '-' + formatDuration(duration.negated(), options);

    // Balance the duration
    const balanced = duration.round({
        largestUnit: 'year',
        smallestUnit: showMilliseconds ? 'millisecond' : 'second',
        relativeTo: Temporal.Now.plainDateISO(),
    });

    const parts = [];
    const unitOrder = ['years', 'months', 'weeks', 'days', 'hours', 'minutes', 'seconds'];
    if (showMilliseconds) unitOrder.push('milliseconds');

    for (const unit of unitOrder) {
        const value = balanced[unit];
        if (value > 0) {
            const singular = unit.slice(0, -1);
            const label = shortForm
                ? UNIT_SHORT_FORMS[singular]
                : (value === 1 ? singular : unit);
            const separator = shortForm ? '' : ' ';
            parts.push(`${value}${separator}${label}`);
        }

        if (maxUnits && parts.length >= maxUnits) break;
    }

    if (parts.length === 0 && !showMilliseconds) {
        return shortForm ? '<1s' : 'less than 1 second';
    }

    return parts.join(shortForm ? ' ' : ', ');
}

/**
 * Format an instant, showing only non-zero time units
 * @param {Temporal.Instant|Date|string} instant
 * @param {object} options
 * @returns {string}
 */
export function formatDatetime(instant, options = {}) {
    const {
        lang = 'en',
        showMilliseconds = true,
        showSeconds = true,
        showDate = true,
        maxTimeUnits = null,
    } = options;

    const pdt = toPlainDateTime(ensureInstant(instant));
    const dateStr = format(instant, 'MMM D, YYYY', lang);

    const hours = pdt.hour;
    const minutes = pdt.minute;
    const seconds = pdt.second;
    const milliseconds = pdt.millisecond;

    const timeParts = [];

    if (hours > 0) {
        timeParts.push(`${hours} ${hours === 1 ? 'hour' : 'hours'}`);
    }

    if (minutes > 0) {
        timeParts.push(`${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`);
    }

    if (showSeconds && seconds > 0) {
        timeParts.push(`${seconds} ${seconds === 1 ? 'second' : 'seconds'}`);
    }

    if (showMilliseconds && milliseconds > 0) {
        timeParts.push(`${milliseconds} ${milliseconds === 1 ? 'millisecond' : 'milliseconds'}`);
    }

    if (maxTimeUnits && timeParts.length > maxTimeUnits) {
        timeParts.splice(maxTimeUnits);
    }

    // Handle special cases - when all time components are zero
    if (timeParts.length === 0) {
        if (hours === 0 && minutes === 0 && seconds === 0 && milliseconds === 0) {
            timeParts.push('midnight');
        } else if (showMilliseconds) {
            timeParts.push('0 milliseconds');
        } else if (showSeconds) {
            timeParts.push('0 seconds');
        } else {
            timeParts.push('0 minutes');
        }
    }

    const timeStr = timeParts.join(', ');

    if (showDate) {
        return `${dateStr} at ${timeStr}`;
    } else {
        return timeStr;
    }
}

/**
 * Convert a duration period to a different unit
 * @param {string} period - Duration string like "1d", "2h"
 * @param {string} unit - Target unit
 * @returns {number}
 */
export function convertToUnit(period, unit) {
    const duration = parseDuration(period);

    // Use duration.total() for conversion
    return duration.total({
        unit,
        relativeTo: Temporal.Now.plainDateISO(),
    });
}

// Export Temporal for direct access if needed
export { Temporal };
