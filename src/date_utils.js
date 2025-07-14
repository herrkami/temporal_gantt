const YEAR = 'year';
const MONTH = 'month';
const DAY = 'day';
const HOUR = 'hour';
const MINUTE = 'minute';
const SECOND = 'second';
const MILLISECOND = 'millisecond';

export default {
    parse_duration(duration) {
        const regex = /([0-9]+)(min|ms|y|m|d|h|s)/;
        const matches = duration.match(regex);
        if (matches !== null) {
            if (matches[2] === 'y') {
                return { duration: parseInt(matches[1]), scale: `year` };
            } else if (matches[2] === 'm') {
                return { duration: parseInt(matches[1]), scale: `month` };
            } else if (matches[2] === 'd') {
                return { duration: parseInt(matches[1]), scale: `day` };
            } else if (matches[2] === 'h') {
                return { duration: parseInt(matches[1]), scale: `hour` };
            } else if (matches[2] === 'min') {
                return { duration: parseInt(matches[1]), scale: `minute` };
            } else if (matches[2] === 's') {
                return { duration: parseInt(matches[1]), scale: `second` };
            } else if (matches[2] === 'ms') {
                return { duration: parseInt(matches[1]), scale: `millisecond` };
            }
        }
        console.warn(`invalid duration "${duration}", defaulting to 1 day`);
        return { duration: 1, scale: `day` };
    },
    parse(date, date_separator = '-', time_separator = /[.:]/) {
        if (date instanceof Date) {
            return date;
        }
        if (typeof date === 'string') {
            let date_parts, time_parts;
            const parts = date.split(' ');
            date_parts = parts[0]
                .split(date_separator)
                .map((val) => parseInt(val, 10));
            time_parts = parts[1] && parts[1].split(time_separator);

            // month is 0 indexed
            date_parts[1] = date_parts[1] ? date_parts[1] - 1 : 0;

            let vals = date_parts;

            if (time_parts && time_parts.length) {
                if (time_parts.length === 4) {
                    time_parts[3] = '0.' + time_parts[3];
                    time_parts[3] = parseFloat(time_parts[3]) * 1000;
                }
                vals = vals.concat(time_parts);
            }
            return new Date(...vals);
        }
    },

    to_string(date, with_time = false) {
        if (!(date instanceof Date)) {
            throw new TypeError('Invalid argument type');
        }
        const vals = this.get_date_values(date).map((val, i) => {
            if (i === 1) {
                // add 1 for month
                val = val + 1;
            }

            if (i === 6) {
                return padStart(val + '', 3, '0');
            }

            return padStart(val + '', 2, '0');
        });
        const date_string = `${vals[0]}-${vals[1]}-${vals[2]}`;
        const time_string = `${vals[3]}:${vals[4]}:${vals[5]}.${vals[6]}`;

        return date_string + (with_time ? ' ' + time_string : '');
    },

    format(date, date_format = 'YYYY-MM-DD HH:mm:ss.SSS', lang = 'en') {
        const dateTimeFormat = new Intl.DateTimeFormat(lang, {
            month: 'long',
        });
        const dateTimeFormatShort = new Intl.DateTimeFormat(lang, {
            month: 'short',
        });
        const month_name = dateTimeFormat.format(date);
        const month_name_capitalized =
            month_name.charAt(0).toUpperCase() + month_name.slice(1);

        const values = this.get_date_values(date).map((d) => padStart(d, 2, 0));
        const format_map = {
            YYYY: values[0],
            MM: padStart(+values[1] + 1, 2, 0),
            DD: values[2],
            HH: values[3],
            mm: values[4],
            ss: values[5],
            SSS: values[6],
            D: values[2],
            MMMM: month_name_capitalized,
            MMM: dateTimeFormatShort.format(date),
        };

        let str = date_format;
        const formatted_values = [];

        Object.keys(format_map)
            .sort((a, b) => b.length - a.length) // big string first
            .forEach((key) => {
                if (str.includes(key)) {
                    str = str.replaceAll(key, `$${formatted_values.length}`);
                    formatted_values.push(format_map[key]);
                }
            });

        formatted_values.forEach((value, i) => {
            str = str.replaceAll(`$${i}`, value);
        });

        return str;
    },

    diff(date_a, date_b, scale = 'day') {
        let milliseconds, seconds, hours, minutes, days, months, years;

        milliseconds =
            date_a -
            date_b +
            (date_b.getTimezoneOffset() - date_a.getTimezoneOffset()) * 60000;
        seconds = milliseconds / 1000;
        minutes = seconds / 60;
        hours = minutes / 60;
        days = hours / 24;
        // Calculate months across years
        let yearDiff = date_a.getFullYear() - date_b.getFullYear();
        let monthDiff = date_a.getMonth() - date_b.getMonth();
        // calculate extra
        monthDiff += (days % 30) / 30;

        /* If monthDiff is negative, date_b is in an earlier month than
        date_a and thus subtracted from the year difference in months */
        months = yearDiff * 12 + monthDiff;
        /* If date_a's (e.g. march 1st) day of the month is smaller than date_b (e.g. february 28th),
        adjust the month difference */
        if (date_a.getDate() < date_b.getDate()) {
            months--;
        }

        // Calculate years based on actual months
        years = months / 12;

        if (!scale.endsWith('s')) {
            scale += 's';
        }

        return (
            Math.round(
                {
                    milliseconds,
                    seconds,
                    minutes,
                    hours,
                    days,
                    months,
                    years,
                }[scale] * 100,
            ) / 100
        );
    },

    today() {
        const vals = this.get_date_values(new Date()).slice(0, 3);
        return new Date(...vals);
    },

    now() {
        return new Date();
    },

    add(date, qty, scale) {
        qty = parseInt(qty, 10);
        const vals = [
            date.getFullYear() + (scale === YEAR ? qty : 0),
            date.getMonth() + (scale === MONTH ? qty : 0),
            date.getDate() + (scale === DAY ? qty : 0),
            date.getHours() + (scale === HOUR ? qty : 0),
            date.getMinutes() + (scale === MINUTE ? qty : 0),
            date.getSeconds() + (scale === SECOND ? qty : 0),
            date.getMilliseconds() + (scale === MILLISECOND ? qty : 0),
        ];
        return new Date(...vals);
    },

    start_of(date, scale) {
        const scores = {
            [YEAR]: 6,
            [MONTH]: 5,
            [DAY]: 4,
            [HOUR]: 3,
            [MINUTE]: 2,
            [SECOND]: 1,
            [MILLISECOND]: 0,
        };

        function should_reset(_scale) {
            const max_score = scores[scale];
            return scores[_scale] <= max_score;
        }

        const vals = [
            date.getFullYear(),
            should_reset(YEAR) ? 0 : date.getMonth(),
            should_reset(MONTH) ? 1 : date.getDate(),
            should_reset(DAY) ? 0 : date.getHours(),
            should_reset(HOUR) ? 0 : date.getMinutes(),
            should_reset(MINUTE) ? 0 : date.getSeconds(),
            should_reset(SECOND) ? 0 : date.getMilliseconds(),
        ];

        return new Date(...vals);
    },

    clone(date) {
        return new Date(...this.get_date_values(date));
    },

    get_date_values(date) {
        return [
            date.getFullYear(),
            date.getMonth(),
            date.getDate(),
            date.getHours(),
            date.getMinutes(),
            date.getSeconds(),
            date.getMilliseconds(),
        ];
    },

    convert_scales(period, to_scale) {
        const TO_DAYS = {
            millisecond: 1 / 60 / 60 / 24 / 1000,
            second: 1 / 60 / 60 / 24,
            minute: 1 / 60 / 24,
            hour: 1 / 24,
            day: 1,
            month: 30,
            year: 365,
        };
        const { duration, scale } = this.parse_duration(period);
        let in_days = duration * TO_DAYS[scale];
        return in_days / TO_DAYS[to_scale];
    },

    get_days_in_month(date) {
        const no_of_days = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

        const month = date.getMonth();

        if (month !== 1) {
            return no_of_days[month];
        }

        // Feb
        const year = date.getFullYear();
        if ((year % 4 === 0 && year % 100 != 0) || year % 400 === 0) {
            return 29;
        }
        return 28;
    },

    get_days_in_year(date) {
        return date.getFullYear() % 4 ? 365 : 366;
    },

    /**
     * Formats a duration in milliseconds into a human-readable string
     * Shows only non-zero units in descending order: years, months, days, hours, minutes, seconds, milliseconds
     * @param {number} ms - Duration in milliseconds
     * @param {object} options - Formatting options
     * @returns {string} Formatted duration string
     */
    format_duration(ms, options = {}) {
        const {
            showMilliseconds = true,
            maxUnits = null, // Maximum number of units to show
            shortForm = false, // Use short form (1y 2d) vs long form (1 year 2 days)
        } = options;

        if (ms === 0) return shortForm ? '0ms' : '0 milliseconds';
        if (ms < 0) return '-' + this.format_duration(-ms, options);

        const units = [
            { name: 'year', short: 'y', ms: 365 * 24 * 60 * 60 * 1000 },
            { name: 'month', short: 'mo', ms: 30 * 24 * 60 * 60 * 1000 },
            { name: 'day', short: 'd', ms: 24 * 60 * 60 * 1000 },
            { name: 'hour', short: 'h', ms: 60 * 60 * 1000 },
            { name: 'minute', short: 'min', ms: 60 * 1000 },
            { name: 'second', short: 's', ms: 1000 },
        ];

        if (showMilliseconds) {
            units.push({ name: 'millisecond', short: 'ms', ms: 1 });
        }

        const parts = [];
        let remainingMs = ms;

        for (const unit of units) {
            const count = Math.floor(remainingMs / unit.ms);
            if (count > 0) {
                const label = shortForm
                    ? unit.short
                    : count === 1
                      ? unit.name
                      : unit.name + 's';
                const separator = shortForm ? '' : ' ';
                parts.push(`${count}${separator}${label}`);
                remainingMs -= count * unit.ms;
            }

            // Stop if we've reached the maximum number of units
            if (maxUnits && parts.length >= maxUnits) {
                break;
            }
        }

        // If no parts were added (very small duration) and we're not showing milliseconds
        if (parts.length === 0 && !showMilliseconds) {
            return shortForm ? '<1s' : 'less than 1 second';
        }

        return parts.join(shortForm ? ' ' : ', ');
    },

    /**
     * Formats a date and time with precise timestamp including milliseconds
     * @param {Date} date - Date to format
     * @param {string} lang - Language for formatting
     * @returns {string} Formatted date and time string
     */
    format_precise_datetime(date, lang = 'en') {
        const dateStr = this.format(date, 'MMM D, YYYY', lang);
        const timeStr = this.format(date, 'HH:mm:ss.SSS', lang);
        return `${dateStr} at ${timeStr}`;
    },

    /**
     * Formats a date and time intelligently, showing only non-zero time units
     * Similar to duration formatting but for absolute timestamps
     * @param {Date} date - Date to format
     * @param {object} options - Formatting options
     * @returns {string} Smart formatted date and time string
     */
    format_smart_datetime(date, options = {}) {
        const {
            lang = 'en',
            showMilliseconds = true,
            showSeconds = true,
            showDate = true,
            maxTimeUnits = null,
        } = options;

        const dateStr = this.format(date, 'MMM D, YYYY', lang);

        // Extract time components
        const hours = date.getHours();
        const minutes = date.getMinutes();
        const seconds = date.getSeconds();
        const milliseconds = date.getMilliseconds();

        // Build time parts array (only non-zero values)
        const timeParts = [];

        if (hours > 0) {
            timeParts.push(`${hours} ${hours === 1 ? 'hour' : 'hours'}`);
        }

        if (minutes > 0) {
            timeParts.push(
                `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`,
            );
        }

        if (showSeconds && seconds > 0) {
            timeParts.push(
                `${seconds} ${seconds === 1 ? 'second' : 'seconds'}`,
            );
        }

        if (showMilliseconds && milliseconds > 0) {
            timeParts.push(
                `${milliseconds} ${milliseconds === 1 ? 'millisecond' : 'milliseconds'}`,
            );
        }

        // Apply maxTimeUnits limit
        if (maxTimeUnits && timeParts.length > maxTimeUnits) {
            timeParts.splice(maxTimeUnits);
        }

        // Handle special cases - when all time components are zero
        if (timeParts.length === 0) {
            // For midnight (00:00:00.000), show "midnight" instead of "0 hours"
            if (
                hours === 0 &&
                minutes === 0 &&
                seconds === 0 &&
                milliseconds === 0
            ) {
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
    },

    /**
     * Formats just the time portion intelligently, showing only non-zero units
     * @param {Date} date - Date to format
     * @param {object} options - Formatting options
     * @returns {string} Smart formatted time string
     */
    format_smart_time(date, options = {}) {
        return this.format_smart_datetime(date, {
            ...options,
            showDate: false,
        });
    },

    /**
     * Calculates precise duration between two dates and returns formatted string
     * @param {Date} startDate - Start date
     * @param {Date} endDate - End date
     * @param {object} options - Formatting options
     * @returns {string} Formatted duration string
     */
    format_duration_between_dates(startDate, endDate, options = {}) {
        const durationMs = endDate.getTime() - startDate.getTime();
        return this.format_duration(durationMs, options);
    },
};

// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/padStart
function padStart(str, targetLength, padString) {
    str = str + '';
    targetLength = targetLength >> 0;
    padString = String(typeof padString !== 'undefined' ? padString : ' ');
    if (str.length > targetLength) {
        return String(str);
    } else {
        targetLength = targetLength - str.length;
        if (targetLength > padString.length) {
            padString += padString.repeat(targetLength / padString.length);
        }
        return padString.slice(0, targetLength) + String(str);
    }
}
