import date_utils from './date_utils';

function getDecade(d) {
    const year = d.getFullYear();
    return year - (year % 10) + '';
}

function formatWeek(d, ld, lang) {
    let endOfWeek = date_utils.add(d, 6, 'day');
    let endFormat = endOfWeek.getMonth() !== d.getMonth() ? 'D MMM' : 'D';
    let beginFormat = !ld || d.getMonth() !== ld.getMonth() ? 'D MMM' : 'D';
    return `${date_utils.format(d, beginFormat, lang)} - ${date_utils.format(endOfWeek, endFormat, lang)}`;
}

const DEFAULT_VIEW_MODES = [
    {
        name: 'Hour',
        padding: '7d',
        step: '1h',
        step_ms: date_utils.units.hour.in_ms,
        date_format: 'YYYY-MM-DD HH:',
        lower_text: 'HH',
        upper_text: (d, ld, lang) =>
            !ld || d.getDate() !== ld.getDate()
                ? date_utils.format(d, 'D MMMM', lang)
                : '',
        upper_text_frequency: 24,
    },
    {
        name: 'Quarter Day',
        padding: '7d',
        step: '6h',
        step_ms: 6 * date_utils.units.hour.in_ms,
        date_format: 'YYYY-MM-DD HH:',
        lower_text: 'HH',
        upper_text: (d, ld, lang) =>
            !ld || d.getDate() !== ld.getDate()
                ? date_utils.format(d, 'D MMM', lang)
                : '',
        upper_text_frequency: 4,
    },
    {
        name: 'Half Day',
        padding: '14d',
        step: '12h',
        step_ms: 12 * date_utils.units.hour.in_ms,
        date_format: 'YYYY-MM-DD HH:',
        lower_text: 'HH',
        upper_text: (d, ld, lang) =>
            !ld || d.getDate() !== ld.getDate()
                ? d.getMonth() !== d.getMonth()
                    ? date_utils.format(d, 'D MMM', lang)
                    : date_utils.format(d, 'D', lang)
                : '',
        upper_text_frequency: 2,
    },
    {
        name: 'Day',
        padding: '7d',
        date_format: 'YYYY-MM-DD',
        step: '1d',
        step_ms: date_utils.units.day.in_ms,
        lower_text: (d, ld, lang) =>
            !ld || d.getDate() !== ld.getDate()
                ? date_utils.format(d, 'D', lang)
                : '',
        upper_text: (d, ld, lang) =>
            !ld || d.getMonth() !== ld.getMonth()
                ? date_utils.format(d, 'MMMM', lang)
                : '',
        thick_line: (d) => d.getDay() === 1,
    },
    {
        name: 'Week',
        padding: '1m',
        step: '7d',
        step_ms: date_utils.units.week.in_ms,
        date_format: 'YYYY-MM-DD',
        column_width: 140,
        lower_text: formatWeek,
        upper_text: (d, ld, lang) =>
            !ld || d.getMonth() !== ld.getMonth()
                ? date_utils.format(d, 'MMMM', lang)
                : '',
        thick_line: (d) => d.getDate() >= 1 && d.getDate() <= 7,
        upper_text_frequency: 4,
    },
    {
        name: 'Month',
        padding: '2m',
        step: '1m',
        step_ms: date_utils.units.month.in_ms,
        column_width: 120,
        date_format: 'YYYY-MM',
        lower_text: 'MMMM',
        upper_text: (d, ld, lang) =>
            !ld || d.getFullYear() !== ld.getFullYear()
                ? date_utils.format(d, 'YYYY', lang)
                : '',
        thick_line: (d) => d.getMonth() % 3 === 0,
        snap_at: '7d',
    },
    {
        name: 'Year',
        padding: '2y',
        step: '1y',
        step_ms: date_utils.units.year.in_ms,
        column_width: 120,
        date_format: 'YYYY',
        upper_text: (d, ld, lang) =>
            !ld || getDecade(d) !== getDecade(ld) ? getDecade(d) : '',
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

        const start_time = date_utils.format_datetime(ctx.task._start, {
            lang: ctx.chart.options.language,
            showMilliseconds: false,
            maxTimeUnits: 3,
        });
        const end_time = date_utils.format_datetime(ctx.task._end, {
            lang: ctx.chart.options.language,
            showMilliseconds: false,
            maxTimeUnits: 3,
        });

        const precise_duration = date_utils.format_duration(
            ctx.task._end.getTime() - ctx.task._start.getTime(),
            { showMilliseconds: false, maxUnits: 4 },
        );

        // Calculate working duration (excluding ignored periods)
        const working_duration = date_utils.format_duration(
            ctx.task.actual_duration * date_utils.units.day.in_ms,
            { showMilliseconds: false, maxUnits: 4 },
        );

        const ignored_duration = ctx.task.ignored_duration
            ? date_utils.format_duration(
                  ctx.task.ignored_duration * date_utils.units.day.in_ms,
                  { showMilliseconds: false, maxUnits: 3 },
              )
            : null;

        let details = `<strong>Start:</strong> ${start_time}<br/>`;
        details += `<strong>End:</strong> ${end_time}<br/>`;
        details += `<strong>Total Duration:</strong> ${precise_duration}<br/>`;
        details += `<strong>Working Duration:</strong> ${working_duration}`;

        if (ignored_duration) {
            details += `<br/><strong>Excluded Time:</strong> ${ignored_duration}`;
        }

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
};

export { DEFAULT_OPTIONS, DEFAULT_VIEW_MODES };
