// Test script for duration formatting
import date_utils from '../src/date_utils.js';

console.log('=== Testing Duration Formatting ===\n');

// Test cases with various durations
const testCases = [
    { ms: 500, description: '500 milliseconds' },
    { ms: 1500, description: '1.5 seconds' },
    { ms: 90000, description: '1.5 minutes' },
    { ms: 5400000, description: '1.5 hours' },
    { ms: 90000000, description: '25 hours' },
    { ms: 1800000, description: '30 minutes' },
    { ms: 86400000 + 1800000, description: '1 day 30 minutes' },
    {
        ms: 86400000 + 3600000 + 1800000,
        description: '1 day 1 hour 30 minutes',
    },
    { ms: 365 * 24 * 60 * 60 * 1000 + 60000, description: '1 year 1 minute' },
    {
        ms:
            2 * 365 * 24 * 60 * 60 * 1000 +
            30 * 24 * 60 * 60 * 1000 +
            86400000 +
            3600000,
        description: '2 years 1 month 1 day 1 hour',
    },
    {
        ms: 30 * 24 * 60 * 60 * 1000 + 7 * 24 * 60 * 60 * 1000,
        description: '1 month 1 week (should show as 1 month 7 days)',
    },
];

testCases.forEach(({ ms, description }) => {
    console.log(`${description}:`);
    console.log(`  Full format: ${date_utils.format_duration(ms)}`);
    console.log(
        `  Short format: ${date_utils.format_duration(ms, { shortForm: true })}`,
    );
    console.log(
        `  Max 2 units: ${date_utils.format_duration(ms, { maxUnits: 2 })}`,
    );
    console.log(
        `  No milliseconds: ${date_utils.format_duration(ms, { showMilliseconds: false })}`,
    );
    console.log('');
});

// Test precise datetime formatting
console.log('=== Testing Precise DateTime Formatting ===\n');

const testDate = new Date('2024-07-10T14:30:25.123Z');
console.log(
    `Precise format: ${date_utils.format_precise_datetime(testDate, 'en')}`,
);

console.log('\n=== Testing Smart DateTime Formatting ===\n');

// Test various datetime scenarios (using local time constructor)
const datetimeTestCases = [
    {
        date: new Date(2024, 6, 10, 0, 0, 0, 0),
        description: 'Midnight (all zeros)',
    },
    { date: new Date(2024, 6, 10, 9, 0, 0, 0), description: '9 AM exactly' },
    {
        date: new Date(2024, 6, 10, 14, 30, 0, 0),
        description: '2:30 PM (no seconds)',
    },
    {
        date: new Date(2024, 6, 10, 14, 30, 25, 0),
        description: '2:30:25 PM (no milliseconds)',
    },
    {
        date: new Date(2024, 6, 10, 14, 30, 25, 123),
        description: '2:30:25.123 PM (all units)',
    },
    {
        date: new Date(2024, 6, 10, 0, 30, 25, 500),
        description: '30 minutes 25 seconds (no hours)',
    },
    {
        date: new Date(2024, 6, 10, 0, 0, 15, 750),
        description: 'Only seconds and milliseconds',
    },
    {
        date: new Date(2024, 6, 10, 12, 0, 0, 250),
        description: 'Noon with milliseconds',
    },
];

datetimeTestCases.forEach(({ date, description }) => {
    console.log(`${description}:`);
    console.log(`  Smart format: ${date_utils.format_smart_datetime(date)}`);
    console.log(
        `  No milliseconds: ${date_utils.format_smart_datetime(date, { showMilliseconds: false })}`,
    );
    console.log(
        `  Max 2 units: ${date_utils.format_smart_datetime(date, { maxTimeUnits: 2 })}`,
    );
    console.log(
        `  Time only: ${date_utils.format_smart_time(date, { showMilliseconds: false })}`,
    );
    console.log('');
});

// Test duration between dates
console.log('\n=== Testing Duration Between Dates ===\n');

const startDate = new Date(2024, 6, 10, 9, 0, 0, 0); // 9 AM local time
const endDate = new Date(2024, 6, 11, 15, 30, 25, 123); // 3:30:25.123 PM next day local time

console.log(
    `Start (precise): ${date_utils.format_precise_datetime(startDate, 'en')}`,
);
console.log(
    `Start (smart): ${date_utils.format_smart_datetime(startDate, { showMilliseconds: false })}`,
);
console.log(
    `End (precise): ${date_utils.format_precise_datetime(endDate, 'en')}`,
);
console.log(
    `End (smart): ${date_utils.format_smart_datetime(endDate, { showMilliseconds: false })}`,
);
console.log(
    `Duration: ${date_utils.format_duration_between_dates(startDate, endDate)}`,
);

console.log('\n=== Test Complete ===');
