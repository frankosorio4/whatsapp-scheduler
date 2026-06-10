// tests/parser.test.js
//
// Unit tests for src/utils/parser.js.
// No mocks required - parser.js has zero external dependencies.

const { parseRowData, isRowFinished, parseNewScheduleInput } = require('../src/utils/parser');

// ---------------------------------------------------------------------------
// Helper - returns a base valid row. Tests override only the fields they need.
// ---------------------------------------------------------------------------
function makeRow(overrides = {}) {
    return {
        subject: 'Pay rent',
        message: 'Remember to pay the rent!',
        number: '5511999999999',
        date: '05/06',
        hour: '09:30',
        once: 'TRUE',
        daily: 'FALSE',
        weekly: 'FALSE',
        monthly: 'FALSE',
        scheduled: 'FALSE',
        ...overrides,
    };
}

// Helper for scheduled-mode rows. date must be DD/MM/YYYY.
// date_finish_schedule defaults to a value since most tests need it;
// override with '' to test the no-finish-date case.
function makeScheduledRow(overrides = {}) {
    return {
        subject: 'Follow up',
        message: 'Don\'t forget to follow up!',
        number: '5511999999999',
        date: '01/04/2026',
        hour: '09:00',
        once: 'FALSE',
        daily: 'FALSE',
        weekly: 'FALSE',
        monthly: 'FALSE',
        scheduled: 'TRUE',
        interval_days: '2',
        interval_weeks: '',
        interval_months: '',
        date_finish_schedule: '20/04/2026',
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// 1. Happy path - required fields parse correctly
// ---------------------------------------------------------------------------
describe('parseRowData() - valid rows', () => {

    it('parses day, month, hour and minute from a valid row', () => {
        const result = parseRowData(makeRow());

        expect(result).not.toBeNull();
        expect(result.day).toBe(5);
        expect(result.month).toBe(6);
        expect(result.hour).toBe(9);
        expect(result.minute).toBe(30);
    });

    it('strips non-digit characters from the phone number', () => {
        const result = parseRowData(makeRow({ number: '+55 (11) 99999-9999' }));

        expect(result).not.toBeNull();
        expect(result.rawNumber).toBe('5511999999999');
    });

    it('uses "(no subject)" when subject is empty', () => {
        const result = parseRowData(makeRow({ subject: '' }));

        expect(result).not.toBeNull();
        expect(result.subject).toBe('(no subject)');
    });

    it('trims whitespace from date and hour', () => {
        const result = parseRowData(makeRow({ date: '  05/06  ', hour: '  09:30  ' }));

        expect(result).not.toBeNull();
        expect(result.day).toBe(5);
        expect(result.hour).toBe(9);
    });

});

// ---------------------------------------------------------------------------
// 2. Guard clauses - missing or malformed required fields return null
// ---------------------------------------------------------------------------
describe('parseRowData() - missing required fields return null', () => {

    it('returns null when date is empty', () => {
        expect(parseRowData(makeRow({ date: '' }))).toBeNull();
    });

    it('returns null when hour is empty', () => {
        expect(parseRowData(makeRow({ hour: '' }))).toBeNull();
    });

    it('returns null when number is empty', () => {
        expect(parseRowData(makeRow({ number: '' }))).toBeNull();
    });

    it('returns null when number contains only non-digit characters', () => {
        // After .replace(/\D/g, '') the string becomes '' - treated as missing
        expect(parseRowData(makeRow({ number: '---' }))).toBeNull();
    });

    it('returns null when date has no slash separator', () => {
        expect(parseRowData(makeRow({ date: '0506' }))).toBeNull();
    });

    it('returns null when hour has no colon separator', () => {
        expect(parseRowData(makeRow({ hour: '0930' }))).toBeNull();
    });

    it('returns null when date parts are not numbers', () => {
        expect(parseRowData(makeRow({ date: 'DD/MM' }))).toBeNull();
    });

    it('returns null when hour parts are not numbers', () => {
        expect(parseRowData(makeRow({ hour: 'HH:MM' }))).toBeNull();
    });

});

// ---------------------------------------------------------------------------
// 3. Scheduling modes - correct mode string and cron pattern
// ---------------------------------------------------------------------------
describe('parseRowData() - scheduling modes', () => {

    it('sets mode "once" and exact-date cron when once is TRUE', () => {
        const result = parseRowData(makeRow({ once: 'TRUE' }));

        expect(result.mode).toBe('once');
        expect(result.cronTime).toBe('30 9 5 6 *');
    });

    it('sets mode "daily" and wildcard-date cron when daily is TRUE', () => {
        const result = parseRowData(makeRow({ once: 'FALSE', daily: 'TRUE' }));

        expect(result.mode).toBe('daily');
        expect(result.cronTime).toBe('30 9 * * *');
    });

    it('sets mode "monthly" and wildcard-month cron when monthly is TRUE', () => {
        const result = parseRowData(makeRow({ once: 'FALSE', monthly: 'TRUE' }));

        expect(result.mode).toBe('monthly');
        expect(result.cronTime).toBe('30 9 5 * *');
    });

    it('sets mode "weekly" and derives weekday from date when weekly is TRUE', () => {
        // 05/06 in the current year - weekday is derived by getDay() (0=Sun … 6=Sat)
        const year = new Date().getFullYear();
        const expectedWeekday = new Date(year, 5, 5).getDay(); // month is 0-indexed

        const result = parseRowData(makeRow({ once: 'FALSE', weekly: 'TRUE' }));

        expect(result.mode).toBe('weekly');
        expect(result.cronTime).toBe(`30 9 * * ${expectedWeekday}`);
    });

    it('defaults to "once" mode when no checkbox is selected', () => {
        const result = parseRowData(makeRow({
            once: 'FALSE',
            daily: 'FALSE',
            weekly: 'FALSE',
            monthly: 'FALSE',
        }));

        expect(result.mode).toBe('once');
        expect(result.cronTime).toBe('30 9 5 6 *');
    });

    it('accepts boolean true (not just string "TRUE") for checkbox values', () => {
        // google-spreadsheet occasionally sends real booleans instead of strings
        const result = parseRowData(makeRow({ once: true }));

        expect(result.mode).toBe('once');
    });

});

// ---------------------------------------------------------------------------
// 4. Edge cases - boundary values
// ---------------------------------------------------------------------------
describe('parseRowData() - edge cases', () => {

    it('handles midnight correctly (00:00)', () => {
        const result = parseRowData(makeRow({ hour: '00:00' }));

        expect(result).not.toBeNull();
        expect(result.hour).toBe(0);
        expect(result.minute).toBe(0);
        expect(result.cronTime).toBe('0 0 5 6 *');
    });

    it('handles end of day correctly (23:59)', () => {
        const result = parseRowData(makeRow({ hour: '23:59' }));

        expect(result).not.toBeNull();
        expect(result.hour).toBe(23);
        expect(result.minute).toBe(59);
    });

    it('handles single-digit day and month (1/1)', () => {
        const result = parseRowData(makeRow({ date: '1/1' }));

        expect(result).not.toBeNull();
        expect(result.day).toBe(1);
        expect(result.month).toBe(1);
    });

});

// ---------------------------------------------------------------------------
// 5. Finish date for recurring rows (daily / weekly / monthly)
// ---------------------------------------------------------------------------
describe('parseRowData() - optional finishDate for recurring modes', () => {

    it('returns finishDate as null when date_finish_schedule is empty (runs indefinitely)', () => {
        const result = parseRowData(makeRow({ once: 'FALSE', daily: 'TRUE', date_finish_schedule: '' }));

        expect(result).not.toBeNull();
        expect(result.finishDate).toBeNull();
    });

    it('returns finishDate as null when date_finish_schedule is absent', () => {
        const result = parseRowData(makeRow({ once: 'FALSE', daily: 'TRUE' }));

        expect(result).not.toBeNull();
        expect(result.finishDate).toBeNull();
    });

    it('parses a valid date_finish_schedule into a Date object for a daily row', () => {
        const result = parseRowData(makeRow({
            once: 'FALSE',
            daily: 'TRUE',
            date_finish_schedule: '31/12/2026',
        }));

        expect(result).not.toBeNull();
        expect(result.finishDate).toBeInstanceOf(Date);
        expect(result.finishDate.getFullYear()).toBe(2026);
        expect(result.finishDate.getMonth()).toBe(11); // December = 11 (0-indexed)
        expect(result.finishDate.getDate()).toBe(31);
    });

    it('parses a valid date_finish_schedule for a weekly row', () => {
        const result = parseRowData(makeRow({
            once: 'FALSE',
            weekly: 'TRUE',
            date_finish_schedule: '15/06/2026',
        }));

        expect(result).not.toBeNull();
        expect(result.finishDate).toBeInstanceOf(Date);
        expect(result.finishDate.getMonth()).toBe(5); // June = 5 (0-indexed)
    });

    it('parses a valid date_finish_schedule for a monthly row', () => {
        const result = parseRowData(makeRow({
            once: 'FALSE',
            monthly: 'TRUE',
            date_finish_schedule: '05/03/2027',
        }));

        expect(result).not.toBeNull();
        expect(result.finishDate).toBeInstanceOf(Date);
        expect(result.finishDate.getFullYear()).toBe(2027);
    });

    it('returns finishDate as null when date_finish_schedule has no year part', () => {
        const result = parseRowData(makeRow({
            once: 'FALSE',
            daily: 'TRUE',
            date_finish_schedule: '31/12',
        }));

        expect(result).not.toBeNull();
        expect(result.finishDate).toBeNull();
    });

    it('expands a 2-digit finish year to 4-digit for a recurring row (e.g. 26 → 2026)', () => {
        const result = parseRowData(makeRow({
            once: 'FALSE',
            daily: 'TRUE',
            date_finish_schedule: '31/12/26',
        }));

        expect(result).not.toBeNull();
        expect(result.finishDate).toBeInstanceOf(Date);
        expect(result.finishDate.getFullYear()).toBe(2026);
    });

});

// ---------------------------------------------------------------------------
// 6. Scheduled mode — interval-based rows
// ---------------------------------------------------------------------------
describe('parseRowData() - scheduled mode', () => {

    it('sets mode "scheduled" and returns a daily cron at the defined hour', () => {
        const result = parseRowData(makeScheduledRow());

        expect(result).not.toBeNull();
        expect(result.mode).toBe('scheduled');
        expect(result.cronTime).toBe('0 9 * * *');
    });

    it('parses interval_days correctly', () => {
        const result = parseRowData(makeScheduledRow({ interval_days: '3' }));

        expect(result.intervalDays).toBe(3);
        expect(result.intervalWeeks).toBe(0);
        expect(result.intervalMonths).toBe(0);
    });

    it('parses interval_weeks correctly', () => {
        const result = parseRowData(makeScheduledRow({
            interval_days: '',
            interval_weeks: '2',
        }));

        expect(result.intervalWeeks).toBe(2);
        expect(result.intervalDays).toBe(0);
    });

    it('parses interval_months correctly', () => {
        const result = parseRowData(makeScheduledRow({
            interval_days: '',
            interval_months: '1',
        }));

        expect(result.intervalMonths).toBe(1);
        expect(result.intervalDays).toBe(0);
    });

    it('parses startYear from the date column', () => {
        const result = parseRowData(makeScheduledRow({ date: '01/04/2026' }));

        expect(result.startYear).toBe(2026);
        expect(result.day).toBe(1);
        expect(result.month).toBe(4);
    });

    it('parses finishDate as a Date object when date_finish_schedule is set', () => {
        const result = parseRowData(makeScheduledRow({ date_finish_schedule: '20/04/2026' }));

        expect(result).not.toBeNull();
        expect(result.finishDate).toBeInstanceOf(Date);
        expect(result.finishDate.getFullYear()).toBe(2026);
        expect(result.finishDate.getMonth()).toBe(3); // April = 3 (0-indexed)
        expect(result.finishDate.getDate()).toBe(20);
    });

    it('returns finishDate as null when date_finish_schedule is empty (runs indefinitely)', () => {
        // date_finish_schedule is now optional for scheduled mode
        const result = parseRowData(makeScheduledRow({ date_finish_schedule: '' }));

        expect(result).not.toBeNull();
        expect(result.mode).toBe('scheduled');
        expect(result.finishDate).toBeNull();
    });

    it('returns finishDate as null when date_finish_schedule has no year part', () => {
        // Malformed finish date is silently ignored — row is still valid
        const result = parseRowData(makeScheduledRow({ date_finish_schedule: '20/04' }));

        expect(result).not.toBeNull();
        expect(result.finishDate).toBeNull();
    });

    it('returns null when scheduled is TRUE but date has no year', () => {
        expect(parseRowData(makeScheduledRow({ date: '01/04' }))).toBeNull();
    });

    it('expands a 2-digit start year to 4-digit (e.g. 26 → 2026)', () => {
        const result = parseRowData(makeScheduledRow({ date: '01/04/26' }));

        expect(result).not.toBeNull();
        expect(result.startYear).toBe(2026);
    });

    it('expands a 2-digit finish year to 4-digit (e.g. 26 → 2026)', () => {
        const result = parseRowData(makeScheduledRow({ date_finish_schedule: '20/04/26' }));

        expect(result).not.toBeNull();
        expect(result.finishDate.getFullYear()).toBe(2026);
    });

    it('returns null when scheduled is TRUE but all intervals are empty', () => {
        const result = parseRowData(makeScheduledRow({
            interval_days: '',
            interval_weeks: '',
            interval_months: '',
        }));

        expect(result).toBeNull();
    });

    it('accepts boolean true for the scheduled checkbox', () => {
        const result = parseRowData(makeScheduledRow({ scheduled: true }));

        expect(result).not.toBeNull();
        expect(result.mode).toBe('scheduled');
    });

});

// ---------------------------------------------------------------------------
// 7. isRowFinished() — archive eligibility logic
// ---------------------------------------------------------------------------
describe('isRowFinished()', () => {

    // Fixed reference point: 1 April 2026 at midnight.
    const TODAY = new Date(2026, 3, 1); // month is 0-indexed

    // Helper: builds a plain data object (mimics row.toObject()).
    function makeData(overrides = {}) {
        return {
            subject: 'Test',
            number: '5511999999999',
            date: '05/06',
            hour: '09:00',
            once: 'TRUE',
            daily: 'FALSE',
            weekly: 'FALSE',
            monthly: 'FALSE',
            scheduled: 'FALSE',
            date_finish_schedule: '',
            ...overrides,
        };
    }

    // --- once mode ---

    it('returns true for a once row whose date is in the past (current year)', () => {
        // 15/03 is before 01/04/2026
        expect(isRowFinished(makeData({ date: '15/03' }), TODAY)).toBe(true);
    });

    it('returns false for a once row whose date is today', () => {
        // 01/04 — strictly in the past means today itself is NOT finished
        expect(isRowFinished(makeData({ date: '01/04' }), TODAY)).toBe(false);
    });

    it('returns false for a once row whose date is in the future', () => {
        expect(isRowFinished(makeData({ date: '10/06' }), TODAY)).toBe(false);
    });

    it('returns false for a once row with a malformed date', () => {
        expect(isRowFinished(makeData({ date: 'invalid' }), TODAY)).toBe(false);
    });

    it('returns false for a once row with an empty date', () => {
        expect(isRowFinished(makeData({ date: '' }), TODAY)).toBe(false);
    });

    // --- fallback (no checkbox selected) ---

    it('returns true for a fallback row (no checkbox) whose date is in the past', () => {
        const data = makeData({
            date: '10/01',
            once: 'FALSE',
            daily: 'FALSE',
            weekly: 'FALSE',
            monthly: 'FALSE',
            scheduled: 'FALSE',
        });
        expect(isRowFinished(data, TODAY)).toBe(true);
    });

    // --- recurring rows (daily / weekly / monthly) ---

    it('returns false for a daily row with no date_finish_schedule (runs forever)', () => {
        const data = makeData({ once: 'FALSE', daily: 'TRUE', date_finish_schedule: '' });
        expect(isRowFinished(data, TODAY)).toBe(false);
    });

    it('returns true for a daily row whose date_finish_schedule is in the past', () => {
        const data = makeData({
            once: 'FALSE', daily: 'TRUE',
            date_finish_schedule: '28/03/2026', // before 01/04/2026
        });
        expect(isRowFinished(data, TODAY)).toBe(true);
    });

    it('returns false for a daily row whose date_finish_schedule is today', () => {
        const data = makeData({
            once: 'FALSE', daily: 'TRUE',
            date_finish_schedule: '01/04/2026',
        });
        expect(isRowFinished(data, TODAY)).toBe(false);
    });

    it('returns false for a weekly row with no date_finish_schedule', () => {
        const data = makeData({ once: 'FALSE', weekly: 'TRUE', date_finish_schedule: '' });
        expect(isRowFinished(data, TODAY)).toBe(false);
    });

    it('returns true for a monthly row whose date_finish_schedule is in the past', () => {
        const data = makeData({
            once: 'FALSE', monthly: 'TRUE',
            date_finish_schedule: '01/01/2026',
        });
        expect(isRowFinished(data, TODAY)).toBe(true);
    });

    // --- scheduled mode ---

    it('returns false for a scheduled row with no date_finish_schedule (runs indefinitely)', () => {
        const data = makeData({
            once: 'FALSE', scheduled: 'TRUE',
            date: '01/04/2026',
            date_finish_schedule: '',
        });
        expect(isRowFinished(data, TODAY)).toBe(false);
    });

    it('returns true for a scheduled row whose date_finish_schedule is in the past', () => {
        const data = makeData({
            once: 'FALSE', scheduled: 'TRUE',
            date: '01/01/2026',
            date_finish_schedule: '31/03/2026',
        });
        expect(isRowFinished(data, TODAY)).toBe(true);
    });

    it('expands a 2-digit finish year correctly for a recurring row', () => {
        // 28/03/26 should be interpreted as 28/03/2026, which is before 01/04/2026
        const data = makeData({
            once: 'FALSE', daily: 'TRUE',
            date_finish_schedule: '28/03/26',
        });
        expect(isRowFinished(data, TODAY)).toBe(true);
    });

    it('returns false when date_finish_schedule has no year part', () => {
        const data = makeData({
            once: 'FALSE', daily: 'TRUE',
            date_finish_schedule: '28/03', // missing year
        });
        expect(isRowFinished(data, TODAY)).toBe(false);
    });

    it('accepts boolean true for checkbox values', () => {
        // once: true (real boolean, not string)
        expect(isRowFinished(makeData({ once: true, date: '15/03' }), TODAY)).toBe(true);
    });

    it('returns true for a once row with a past DD/MM/YYYY date (full year)', () => {
        // 15/03/2026 is before 01/04/2026
        expect(isRowFinished(makeData({ date: '15/03/2026' }), TODAY)).toBe(true);
    });

    it('returns true for a once row with a past DD/MM/YY date (2-digit year)', () => {
        // 15/03/26 expands to 15/03/2026, which is before 01/04/2026
        expect(isRowFinished(makeData({ date: '15/03/26' }), TODAY)).toBe(true);
    });

    it('returns false for a once row with a future DD/MM/YYYY date', () => {
        // 10/06/2026 is after 01/04/2026
        expect(isRowFinished(makeData({ date: '10/06/2026' }), TODAY)).toBe(false);
    });

    it('returns true for a once row from a past year — regression test', () => {
        // Before the fix, 15/03/25 was reconstructed as 15/03/2026 (future) and never archived.
        const pastToday = new Date(2025, 3, 1); // 01/04/2025
        expect(isRowFinished(makeData({ date: '15/03/25' }), pastToday)).toBe(true);
    });

});

// ---------------------------------------------------------------------------
// 8. parseNewScheduleInput() — WhatsApp template parser and validator
// ---------------------------------------------------------------------------
describe('parseNewScheduleInput()', () => {

    // Helper: builds a valid filled-in template string.
    // date defaults to DD/MM/YYYY as required by the validator.
    function makeTemplate(overrides = {}) {
        const defaults = {
            subject: 'Pay rent',
            message: 'Remember to transfer!',
            number: '5511999999999',
            date: '10/06/2026',
            hour: '09:00',
            schedule: 'once',
            interval: '',
            date_finish_schedule: '',
        };
        const fields = { ...defaults, ...overrides };
        return [
            `subject: ${fields.subject}`,
            `message: ${fields.message}`,
            `number: ${fields.number}`,
            `date: ${fields.date}`,
            `hour: ${fields.hour}`,
            `schedule: ${fields.schedule}`,
            `interval: ${fields.interval}`,
            `date_finish_schedule: ${fields.date_finish_schedule}`,
        ].join('\n');
    }

    // Helper: builds a valid scheduled-mode template string.
    // date_finish_schedule is optional for scheduled mode — omitted by default here.
    function makeScheduledTemplate(overrides = {}) {
        return makeTemplate({
            date: '01/04/2026',
            schedule: 'scheduled',
            interval: '3d',
            date_finish_schedule: '',
            ...overrides,
        });
    }

    // --- Happy path ---

    it('returns ok:true and correct sheetData for a valid once template', () => {
        const result = parseNewScheduleInput(makeTemplate());

        expect(result.ok).toBe(true);
        expect(result.data.subject).toBe('Pay rent');
        expect(result.data.message).toBe('Remember to transfer!');
        expect(result.data.number).toBe('5511999999999');
        expect(result.data.date).toBe('10/06/2026');
        expect(result.data.hour).toBe('09:00');
        expect(result.data.once).toBe('TRUE');
        expect(result.data.daily).toBe('FALSE');
    });

    it('defaults subject to "(no subject)" when left blank', () => {
        const result = parseNewScheduleInput(makeTemplate({ subject: '' }));

        expect(result.ok).toBe(true);
        expect(result.data.subject).toBe('(no subject)');
    });

    it('strips non-digit characters from number', () => {
        const result = parseNewScheduleInput(makeTemplate({ number: '+55 (11) 99999-9999' }));

        expect(result.ok).toBe(true);
        expect(result.data.number).toBe('5511999999999');
    });

    it('pads hour with leading zeros', () => {
        const result = parseNewScheduleInput(makeTemplate({ hour: '9:00' }));

        expect(result.ok).toBe(true);
        expect(result.data.hour).toBe('09:00');
    });

    it('preserves date exactly as typed', () => {
        const result = parseNewScheduleInput(makeTemplate({ date: '5/6/2026' }));

        expect(result.ok).toBe(true);
        expect(result.data.date).toBe('5/6/2026');
    });

    it('sets correct checkbox flags for daily mode', () => {
        const result = parseNewScheduleInput(makeTemplate({ schedule: 'daily' }));

        expect(result.ok).toBe(true);
        expect(result.data.daily).toBe('TRUE');
        expect(result.data.once).toBe('FALSE');
    });

    it('sets correct checkbox flags for weekly mode', () => {
        const result = parseNewScheduleInput(makeTemplate({ schedule: 'weekly' }));

        expect(result.ok).toBe(true);
        expect(result.data.weekly).toBe('TRUE');
    });

    it('sets correct checkbox flags for monthly mode', () => {
        const result = parseNewScheduleInput(makeTemplate({ schedule: 'monthly' }));

        expect(result.ok).toBe(true);
        expect(result.data.monthly).toBe('TRUE');
    });

    it('accepts schedule value in uppercase', () => {
        const result = parseNewScheduleInput(makeTemplate({ schedule: 'ONCE' }));

        expect(result.ok).toBe(true);
        expect(result.data.once).toBe('TRUE');
    });

    it('accepts a 2-digit year in date', () => {
        const result = parseNewScheduleInput(makeTemplate({ date: '10/06/26' }));

        expect(result.ok).toBe(true);
        expect(result.data.date).toBe('10/06/26');
    });

    // --- Scheduled mode ---

    it('parses a valid scheduled-mode template with interval in days', () => {
        const result = parseNewScheduleInput(makeScheduledTemplate({ interval: '3d' }));

        expect(result.ok).toBe(true);
        expect(result.data.scheduled).toBe('TRUE');
        expect(result.data.interval_days).toBe('3');
        expect(result.data.interval_weeks).toBe('');
        expect(result.data.interval_months).toBe('');
        expect(result.data.date).toBe('01/04/2026');
    });

    it('parses interval in weeks', () => {
        const result = parseNewScheduleInput(makeScheduledTemplate({ interval: '2w' }));

        expect(result.ok).toBe(true);
        expect(result.data.interval_weeks).toBe('2');
        expect(result.data.interval_days).toBe('');
    });

    it('parses interval in months', () => {
        const result = parseNewScheduleInput(makeScheduledTemplate({ interval: '1mo' }));

        expect(result.ok).toBe(true);
        expect(result.data.interval_months).toBe('1');
    });

    it('accepts scheduled mode without date_finish_schedule', () => {
        // date_finish_schedule is optional for scheduled mode
        const result = parseNewScheduleInput(makeScheduledTemplate({ date_finish_schedule: '' }));

        expect(result.ok).toBe(true);
        expect(result.data.date_finish_schedule).toBe('');
    });

    it('accepts scheduled mode with a valid date_finish_schedule', () => {
        const result = parseNewScheduleInput(makeScheduledTemplate({ date_finish_schedule: '30/06/2026' }));

        expect(result.ok).toBe(true);
        expect(result.data.date_finish_schedule).toBe('30/06/2026');
    });

    // --- Required field errors ---

    it('returns ok:false when message is empty', () => {
        const result = parseNewScheduleInput(makeTemplate({ message: '' }));

        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/message/i);
    });

    it('returns ok:false when number is missing', () => {
        const result = parseNewScheduleInput(makeTemplate({ number: '' }));

        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/number/i);
    });

    it('returns ok:false when number has fewer than 10 digits', () => {
        const result = parseNewScheduleInput(makeTemplate({ number: '123456' }));

        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/number/i);
    });

    it('returns ok:false when hour is missing', () => {
        const result = parseNewScheduleInput(makeTemplate({ hour: '' }));

        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/hour/i);
    });

    it('returns ok:false when hour has no colon', () => {
        const result = parseNewScheduleInput(makeTemplate({ hour: '0900' }));

        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/hour/i);
    });

    it('returns ok:false when hour value is out of range', () => {
        const result = parseNewScheduleInput(makeTemplate({ hour: '25:00' }));

        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/hour/i);
    });

    it('returns ok:false when minute value is out of range', () => {
        const result = parseNewScheduleInput(makeTemplate({ hour: '09:60' }));

        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/minute/i);
    });

    it('returns ok:false when schedule is missing', () => {
        const result = parseNewScheduleInput(makeTemplate({ schedule: '' }));

        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/schedule/i);
    });

    it('returns ok:false when schedule is not a valid mode', () => {
        const result = parseNewScheduleInput(makeTemplate({ schedule: 'sometimes' }));

        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/schedule/i);
    });

    it('returns ok:false when date is missing', () => {
        const result = parseNewScheduleInput(makeTemplate({ date: '' }));

        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/date/i);
    });

    it('returns ok:false when date has no slash', () => {
        const result = parseNewScheduleInput(makeTemplate({ date: '10062026' }));

        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/date/i);
    });

    it('returns ok:false when date has no year (DD/MM only)', () => {
        const result = parseNewScheduleInput(makeTemplate({ date: '10/06' }));

        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/date/i);
    });

    it('returns ok:false when date month is out of range', () => {
        const result = parseNewScheduleInput(makeTemplate({ date: '10/13/2026' }));

        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/month/i);
    });

    it('returns ok:false when date day is out of range for the month (e.g. 31/04)', () => {
        // April has 30 days
        const result = parseNewScheduleInput(makeTemplate({ date: '31/04/2026' }));

        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/day/i);
    });

    it('returns ok:false when date day is impossible for February (e.g. 30/02)', () => {
        const result = parseNewScheduleInput(makeTemplate({ date: '30/02/2026' }));

        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/day/i);
    });

    it('accepts 29/02 on a leap year', () => {
        const result = parseNewScheduleInput(makeTemplate({ date: '29/02/2028' }));

        expect(result.ok).toBe(true);
    });

    it('returns ok:false for 29/02 on a non-leap year', () => {
        const result = parseNewScheduleInput(makeTemplate({ date: '29/02/2026' }));

        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/day/i);
    });

    // --- Scheduled mode errors ---

    it('returns ok:false for scheduled mode when interval is missing', () => {
        const result = parseNewScheduleInput(makeScheduledTemplate({ interval: '' }));

        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/interval/i);
    });

    it('returns ok:false when interval format is not recognised', () => {
        const result = parseNewScheduleInput(makeScheduledTemplate({ interval: '3days' }));

        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/interval/i);
    });

    // --- date_finish_schedule validation ---

    it('returns ok:false when date_finish_schedule is provided but has no year', () => {
        const result = parseNewScheduleInput(makeTemplate({
            schedule: 'daily',
            date_finish_schedule: '31/12',
        }));

        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/date_finish_schedule/i);
    });

    it('returns ok:false when date_finish_schedule day is invalid for the month', () => {
        const result = parseNewScheduleInput(makeTemplate({
            schedule: 'daily',
            date_finish_schedule: '31/11/2026', // November has 30 days
        }));

        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/date_finish_schedule/i);
    });

    it('accepts a valid date_finish_schedule for a daily row', () => {
        const result = parseNewScheduleInput(makeTemplate({
            schedule: 'daily',
            date_finish_schedule: '31/12/2026',
        }));

        expect(result.ok).toBe(true);
        expect(result.data.date_finish_schedule).toBe('31/12/2026');
    });

});

// ---------------------------------------------------------------------------
// 9. end_of_month mode - parseRowData
// ---------------------------------------------------------------------------
describe('parseRowData() - end_of_month mode', () => {

    function makeEOMRow(overrides = {}) {
        return {
            subject: 'Month-end report',
            message: 'Please submit the report!',
            number: '5511999999999',
            date: '01/01/2026',
            hour: '08:00',
            once: 'FALSE',
            daily: 'FALSE',
            weekly: 'FALSE',
            monthly: 'FALSE',
            scheduled: 'FALSE',
            end_of_month: 'TRUE',
            date_finish_schedule: '',
            ...overrides,
        };
    }

    it('sets mode "end_of_month" and returns a daily cron at the defined hour', () => {
        const result = parseRowData(makeEOMRow());

        expect(result).not.toBeNull();
        expect(result.mode).toBe('end_of_month');
        expect(result.cronTime).toBe('0 8 * * *');
    });

    it('returns finishDate as null when date_finish_schedule is empty', () => {
        const result = parseRowData(makeEOMRow({ date_finish_schedule: '' }));

        expect(result).not.toBeNull();
        expect(result.finishDate).toBeNull();
    });

    it('parses finishDate correctly when date_finish_schedule is set', () => {
        const result = parseRowData(makeEOMRow({ date_finish_schedule: '31/12/2026' }));

        expect(result).not.toBeNull();
        expect(result.finishDate).toBeInstanceOf(Date);
        expect(result.finishDate.getFullYear()).toBe(2026);
        expect(result.finishDate.getMonth()).toBe(11);
        expect(result.finishDate.getDate()).toBe(31);
    });

    it('expands a 2-digit finish year for end_of_month rows', () => {
        const result = parseRowData(makeEOMRow({ date_finish_schedule: '31/12/26' }));

        expect(result).not.toBeNull();
        expect(result.finishDate.getFullYear()).toBe(2026);
    });

    it('accepts boolean true for the end_of_month checkbox', () => {
        const result = parseRowData(makeEOMRow({ end_of_month: true }));

        expect(result).not.toBeNull();
        expect(result.mode).toBe('end_of_month');
    });

});

// ---------------------------------------------------------------------------
// 10. isRowFinished() - end_of_month mode
// ---------------------------------------------------------------------------
describe('isRowFinished() - end_of_month mode', () => {

    const TODAY = new Date(2026, 3, 1); // 01/04/2026

    function makeEOMData(overrides = {}) {
        return {
            subject: 'EOM test',
            number: '5511999999999',
            date: '01/01/2026',
            hour: '08:00',
            once: 'FALSE',
            daily: 'FALSE',
            weekly: 'FALSE',
            monthly: 'FALSE',
            scheduled: 'FALSE',
            end_of_month: 'TRUE',
            date_finish_schedule: '',
        };
    }

    it('returns false when date_finish_schedule is empty (runs indefinitely)', () => {
        expect(isRowFinished(makeEOMData(), TODAY)).toBe(false);
    });

    it('returns true when date_finish_schedule is in the past', () => {
        expect(isRowFinished({ ...makeEOMData(), date_finish_schedule: '28/03/2026' }, TODAY)).toBe(true);
    });

    it('returns false when date_finish_schedule is today', () => {
        expect(isRowFinished({ ...makeEOMData(), date_finish_schedule: '01/04/2026' }, TODAY)).toBe(false);
    });

    it('returns false when date_finish_schedule is in the future', () => {
        expect(isRowFinished({ ...makeEOMData(), date_finish_schedule: '31/12/2026' }, TODAY)).toBe(false);
    });

});

// ---------------------------------------------------------------------------
// 11. parseNewScheduleInput() - end_of_month mode
// ---------------------------------------------------------------------------
describe('parseNewScheduleInput() - end_of_month mode', () => {

    function makeEOMTemplate(overrides = {}) {
        const defaults = {
            subject: 'Monthly report',
            message: 'Please submit!',
            number: '5511999999999',
            date: '01/01/2026',
            hour: '08:00',
            schedule: 'end_of_month',
            interval: '',
            date_finish_schedule: '',
        };
        const fields = { ...defaults, ...overrides };
        return [
            `subject: ${fields.subject}`,
            `message: ${fields.message}`,
            `number: ${fields.number}`,
            `date: ${fields.date}`,
            `hour: ${fields.hour}`,
            `schedule: ${fields.schedule}`,
            `interval: ${fields.interval}`,
            `date_finish_schedule: ${fields.date_finish_schedule}`,
        ].join('\n');
    }

    it('returns ok:true and sets end_of_month to TRUE', () => {
        const result = parseNewScheduleInput(makeEOMTemplate());

        expect(result.ok).toBe(true);
        expect(result.data.end_of_month).toBe('TRUE');
        expect(result.data.once).toBe('FALSE');
        expect(result.data.daily).toBe('FALSE');
        expect(result.data.monthly).toBe('FALSE');
        expect(result.data.scheduled).toBe('FALSE');
    });

    it('does not require interval for end_of_month mode', () => {
        const result = parseNewScheduleInput(makeEOMTemplate({ interval: '' }));

        expect(result.ok).toBe(true);
    });

    it('accepts an optional date_finish_schedule', () => {
        const result = parseNewScheduleInput(makeEOMTemplate({ date_finish_schedule: '31/12/2026' }));

        expect(result.ok).toBe(true);
        expect(result.data.date_finish_schedule).toBe('31/12/2026');
    });

    it('accepts end_of_month in uppercase', () => {
        const result = parseNewScheduleInput(makeEOMTemplate({ schedule: 'END_OF_MONTH' }));

        expect(result.ok).toBe(true);
        expect(result.data.end_of_month).toBe('TRUE');
    });

    it('returns ok:false when schedule is an invalid variant like "end_of_month_invalid"', () => {
        const result = parseNewScheduleInput(makeEOMTemplate({ schedule: 'end_of_month_invalid' }));

        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/schedule/i);
    });

});
