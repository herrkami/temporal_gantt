import { toPlainDateTime, ensureInstant, add, format, formatDatetime, formatDuration } from './temporal_utils';

function getDecade(instant) {
    const pdt = toPlainDateTime(ensureInstant(instant));
    const year = pdt.year;
    return year - (year % 10) + '';
}

function formatWeek(instant, lastInstant, lang) {
    const pdt = toPlainDateTime(ensureInstant(instant));
    let endOfWeek = add(instant, 6, 'day');
    const endPdt = toPlainDateTime(endOfWeek);
    let endFormat = endPdt.month !== pdt.month ? 'D MMM' : 'D';
    let beginFormat = !lastInstant || toPlainDateTime(ensureInstant(lastInstant)).month !== pdt.month ? 'D MMM' : 'D';
    return `${format(instant, beginFormat, lang)} - ${format(endOfWeek, endFormat, lang)}`;
}

const DEFAULT_VIEW_MODES = [
    {
        name: 'Hour',
        padding: '1h',
        step: '1h',
        date_format: 'YYYY-MM-DD HH:',
        lower_text: 'HH',
        upper_text: (instant, lastInstant, lang) => {
            const pdt = toPlainDateTime(ensureInstant(instant));
            const lastPdt = lastInstant ? toPlainDateTime(ensureInstant(lastInstant)) : null;
            return !lastPdt || pdt.day !== lastPdt.day
                ? format(instant, 'D MMMM', lang)
                : '';
        },
        upper_text_frequency: 24,
    },
    {
        name: 'Quarter Day',
        padding: '6h',
        step: '6h',
        date_format: 'YYYY-MM-DD HH:',
        lower_text: 'HH',
        upper_text: (instant, lastInstant, lang) => {
            const pdt = toPlainDateTime(ensureInstant(instant));
            const lastPdt = lastInstant ? toPlainDateTime(ensureInstant(lastInstant)) : null;
            return !lastPdt || pdt.day !== lastPdt.day
                ? format(instant, 'D MMM', lang)
                : '';
        },
        upper_text_frequency: 4,
    },
    {
        name: 'Half Day',
        padding: '12h',
        step: '12h',
        date_format: 'YYYY-MM-DD HH:',
        lower_text: 'HH',
        upper_text: (instant, lastInstant, lang) => {
            const pdt = toPlainDateTime(ensureInstant(instant));
            const lastPdt = lastInstant ? toPlainDateTime(ensureInstant(lastInstant)) : null;
            return !lastPdt || pdt.day !== lastPdt.day
                ? !lastPdt || pdt.month !== lastPdt.month
                    ? format(instant, 'D MMM', lang)
                    : format(instant, 'D', lang)
                : '';
        },
        upper_text_frequency: 2,
    },
    {
        name: 'Day',
        padding: '1d',
        date_format: 'YYYY-MM-DD',
        step: '1d',
        lower_text: (instant, lastInstant, lang) => {
            const pdt = toPlainDateTime(ensureInstant(instant));
            const lastPdt = lastInstant ? toPlainDateTime(ensureInstant(lastInstant)) : null;
            return !lastPdt || pdt.day !== lastPdt.day
                ? format(instant, 'D', lang)
                : '';
        },
        upper_text: (instant, lastInstant, lang) => {
            const pdt = toPlainDateTime(ensureInstant(instant));
            const lastPdt = lastInstant ? toPlainDateTime(ensureInstant(lastInstant)) : null;
            return !lastPdt || pdt.month !== lastPdt.month
                ? format(instant, 'MMMM', lang)
                : '';
        },
        thick_line: (instant) => {
            const pdt = toPlainDateTime(ensureInstant(instant));
            return pdt.dayOfWeek === 1; // Monday
        },
    },
    {
        name: 'Week',
        padding: '1w',
        step: '7d',
        date_format: 'YYYY-MM-DD',
        column_width: 140,
        lower_text: formatWeek,
        upper_text: (instant, lastInstant, lang) => {
            const pdt = toPlainDateTime(ensureInstant(instant));
            const lastPdt = lastInstant ? toPlainDateTime(ensureInstant(lastInstant)) : null;
            return !lastPdt || pdt.month !== lastPdt.month
                ? format(instant, 'MMMM', lang)
                : '';
        },
        thick_line: (instant) => {
            const pdt = toPlainDateTime(ensureInstant(instant));
            return pdt.day >= 1 && pdt.day <= 7;
        },
        upper_text_frequency: 4,
    },
    {
        name: 'Month',
        padding: '1m',
        step: '1m',
        column_width: 120,
        date_format: 'YYYY-MM',
        lower_text: 'MMMM',
        upper_text: (instant, lastInstant, lang) => {
            const pdt = toPlainDateTime(ensureInstant(instant));
            const lastPdt = lastInstant ? toPlainDateTime(ensureInstant(lastInstant)) : null;
            return !lastPdt || pdt.year !== lastPdt.year
                ? format(instant, 'YYYY', lang)
                : '';
        },
        thick_line: (instant) => {
            const pdt = toPlainDateTime(ensureInstant(instant));
            return pdt.month % 3 === 0;
        },
        snap_at: '7d',
    },
    {
        name: 'Year',
        padding: '1y',
        step: '1y',
        column_width: 120,
        date_format: 'YYYY',
        upper_text: (instant, lastInstant, lang) =>
            !lastInstant || getDecade(instant) !== getDecade(lastInstant) ? getDecade(instant) : '',
        lower_text: 'YYYY',
        snap_at: '30d',
    },
];

const DEFAULT_OPTIONS = {
    arrow_curve: 5,
    auto_move_label: false,
    bar_corner_radius: 3,
    bar_height: 30,
    container_height: 'auto',
    column_width: null,
    date_format: 'YYYY-MM-DD HH:mm',
    upper_header_height: 45,
    lower_header_height: 30,
    snap_at: null,
    infinite_padding: true,
    holidays: { 'var(--g-weekend-highlight-color)': 'weekend' },
    ignore: [],
    language: 'en',
    lines: 'both',
    move_dependencies: true,
    padding: 18,
    popup: (ctx) => {
        ctx.set_title(ctx.task.name);
        if (ctx.task.description) ctx.set_subtitle(ctx.task.description);
        else ctx.set_subtitle('');

        const start_time = formatDatetime(ctx.task.start, {
            lang: ctx.chart.options.language,
            showMilliseconds: false,
            maxTimeUnits: 3,
        });
        const end_time = formatDatetime(ctx.task.end, {
            lang: ctx.chart.options.language,
            showMilliseconds: false,
            maxTimeUnits: 3,
        });

        // Calculate precise duration using Temporal Duration
        const taskEnd = toPlainDateTime(ctx.task.end);
        const taskStart = toPlainDateTime(ctx.task.start);
        const precise_duration = formatDuration(
            taskEnd.since(taskStart),
            { showMilliseconds: false, maxUnits: 4 },
        );

        let details = `<strong>Start:</strong> ${start_time}<br/>`;
        details += `<strong>End:</strong> ${end_time}<br/>`;
        details += `<strong>Duration:</strong> ${precise_duration}`;

        details += `<br/><strong>Progress:</strong> ${Math.floor(ctx.task.progress * 100) / 100}%`;

        ctx.set_details(details);
    },
    popup_on: 'click',
    readonly_progress: false,
    readonly_dates: false,
    readonly: false,
    scroll_to: 'today',
    show_expected_progress: false,
    today_button: true,
    view_mode: 'Day',
    view_mode_select: false,
    view_modes: DEFAULT_VIEW_MODES,
    is_weekend: (instant) => {
        const pdt = toPlainDateTime(ensureInstant(instant));
        return pdt.dayOfWeek === 6 || pdt.dayOfWeek === 7;
    },
};

export { DEFAULT_OPTIONS, DEFAULT_VIEW_MODES };
