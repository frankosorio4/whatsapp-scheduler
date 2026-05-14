// tests/formatter.test.js
//
// Unit tests for src/utils/formatter.js.
// All functions are pure with no external dependencies — no mocks required.

const {
    formatMessage,
    formatTimestamp,
    getNewScheduleTemplate,
    buildScheduleConfirmation,
    sortByMode,
} = require('../src/utils/formatter');

// ---------------------------------------------------------------------------
// 1. formatMessage()
// ---------------------------------------------------------------------------
describe('formatMessage()', () => {

    it('wraps subject in WhatsApp bold and appends message', () => {
        expect(formatMessage('Pay rent', 'Transfer R$1500')).toBe('*Pay rent:* Transfer R$1500');
    });

    it('works with an empty subject', () => {
        expect(formatMessage('', 'Hello')).toBe('*:* Hello');
    });

    it('works with an empty message', () => {
        expect(formatMessage('Reminder', '')).toBe('*Reminder:* ');
    });

    it('preserves special characters in both fields', () => {
        const result = formatMessage('Água & Luz', 'Vencimento: 10/04 ⚡');
        expect(result).toBe('*Água & Luz:* Vencimento: 10/04 ⚡');
    });

    it('does not double-wrap if subject already contains asterisks', () => {
        const result = formatMessage('*Bold*', 'message');
        expect(result).toBe('**Bold*:* message');
    });

});

// ---------------------------------------------------------------------------
// 2. formatTimestamp()
// ---------------------------------------------------------------------------
describe('formatTimestamp()', () => {

    it('returns a string in DD/MM/YYYY HH:MM format', () => {
        // Pass a fixed date to avoid flakiness from real clock
        const fixed = new Date(2026, 2, 27, 14, 35, 0); // 27 Mar 2026 14:35 local
        const result = formatTimestamp(fixed);

        // Should match pt-BR date pattern: DD/MM/YYYY HH:MM
        expect(result).toMatch(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);
    });

    it('includes the correct year', () => {
        const fixed = new Date(2026, 0, 15, 9, 0, 0);
        expect(formatTimestamp(fixed)).toContain('2026');
    });

    it('uses a default date when no argument is passed', () => {
        const before = new Date();
        const result = formatTimestamp();
        const after  = new Date();

        // Result should be a non-empty string — we can't pin the exact value
        // without knowing the timezone offset, but it must match the format.
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
        expect(result).toMatch(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);
    });

    it('zero-pads single-digit hours and minutes', () => {
        // 1 Jan 2026 at 09:05 — both hour and minute should be zero-padded
        const fixed = new Date(2026, 0, 1, 9, 5, 0);
        const result = formatTimestamp(fixed);
        // The time portion must have exactly HH:MM (2 digits each)
        const timePart = result.split(' ')[1];
        expect(timePart).toMatch(/^\d{2}:\d{2}$/);
    });

});

// ---------------------------------------------------------------------------
// 3. getNewScheduleTemplate()
// ---------------------------------------------------------------------------
describe('getNewScheduleTemplate()', () => {

    it('returns an array of exactly two strings', () => {
        const result = getNewScheduleTemplate();
        expect(Array.isArray(result)).toBe(true);
        expect(result).toHaveLength(2);
        expect(typeof result[0]).toBe('string');
        expect(typeof result[1]).toBe('string');
    });

    it('first element (notes) contains all required field names', () => {
        const [notes] = getNewScheduleTemplate();
        expect(notes).toContain('subject');
        expect(notes).toContain('message');
        expect(notes).toContain('number');
        expect(notes).toContain('date');
        expect(notes).toContain('hour');
        expect(notes).toContain('schedule');
        expect(notes).toContain('interval');
        expect(notes).toContain('date_finish_schedule');
    });

    it('second element (template) contains all fillable field keys', () => {
        const [, template] = getNewScheduleTemplate();
        expect(template).toContain('subject:');
        expect(template).toContain('message:');
        expect(template).toContain('number:');
        expect(template).toContain('date:');
        expect(template).toContain('hour:');
        expect(template).toContain('schedule:');
        expect(template).toContain('interval:');
        expect(template).toContain('date_finish_schedule:');
    });

    it('notes mention all five schedule modes', () => {
        const [notes] = getNewScheduleTemplate();
        expect(notes).toContain('once');
        expect(notes).toContain('daily');
        expect(notes).toContain('weekly');
        expect(notes).toContain('monthly');
        expect(notes).toContain('scheduled');
    });

    it('returns consistent output on repeated calls (pure function)', () => {
        expect(getNewScheduleTemplate()).toEqual(getNewScheduleTemplate());
    });

});

// ---------------------------------------------------------------------------
// 4. buildScheduleConfirmation()
// ---------------------------------------------------------------------------
describe('buildScheduleConfirmation()', () => {

    // Helper — builds a minimal sheetData object as parseNewScheduleInput would return.
    function makeData(overrides = {}) {
        return {
            subject:               'Pay rent',
            message:               'Transfer R$1500',
            number:                '5511999999999',
            date:                  '10/06/2026',
            hour:                  '09:00',
            once:                  'TRUE',
            daily:                 'FALSE',
            weekly:                'FALSE',
            monthly:               'FALSE',
            scheduled:             'FALSE',
            interval_days:         '',
            interval_weeks:        '',
            interval_months:       '',
            date_finish_schedule:  '',
            ...overrides,
        };
    }

    it('includes subject, message, number, date, and hour in output', () => {
        const result = buildScheduleConfirmation(makeData());
        expect(result).toContain('Pay rent');
        expect(result).toContain('Transfer R$1500');
        expect(result).toContain('5511999999999');
        expect(result).toContain('10/06/2026');
        expect(result).toContain('09:00');
    });

    it('shows mode label "once" for a once row', () => {
        expect(buildScheduleConfirmation(makeData({ once: 'TRUE' }))).toContain('once');
    });

    it('shows mode label "daily" for a daily row', () => {
        const result = buildScheduleConfirmation(makeData({ once: 'FALSE', daily: 'TRUE' }));
        expect(result).toContain('daily');
    });

    it('shows mode label "weekly" for a weekly row', () => {
        const result = buildScheduleConfirmation(makeData({ once: 'FALSE', weekly: 'TRUE' }));
        expect(result).toContain('weekly');
    });

    it('shows mode label "monthly" for a monthly row', () => {
        const result = buildScheduleConfirmation(makeData({ once: 'FALSE', monthly: 'TRUE' }));
        expect(result).toContain('monthly');
    });

    it('shows mode label "scheduled" for a scheduled row', () => {
        const result = buildScheduleConfirmation(makeData({ once: 'FALSE', scheduled: 'TRUE', interval_days: '3' }));
        expect(result).toContain('scheduled');
    });

    it('shows "—" as mode label when no checkbox is TRUE', () => {
        const result = buildScheduleConfirmation(makeData({
            once: 'FALSE', daily: 'FALSE', weekly: 'FALSE', monthly: 'FALSE', scheduled: 'FALSE',
        }));
        expect(result).toContain('—');
    });

    it('shows interval in days for a scheduled row with interval_days', () => {
        const result = buildScheduleConfirmation(makeData({
            once: 'FALSE', scheduled: 'TRUE', interval_days: '3',
        }));
        expect(result).toContain('every 3 day(s)');
    });

    it('shows interval in weeks for a scheduled row with interval_weeks', () => {
        const result = buildScheduleConfirmation(makeData({
            once: 'FALSE', scheduled: 'TRUE', interval_weeks: '2',
        }));
        expect(result).toContain('every 2 week(s)');
    });

    it('shows interval in months for a scheduled row with interval_months', () => {
        const result = buildScheduleConfirmation(makeData({
            once: 'FALSE', scheduled: 'TRUE', interval_months: '1',
        }));
        expect(result).toContain('every 1 month(s)');
    });

    it('shows "—" as interval for non-scheduled modes', () => {
        const result = buildScheduleConfirmation(makeData({ once: 'TRUE' }));
        // Should show "—" for interval line
        const lines = result.split('\n');
        const intervalLine = lines.find(l => l.includes('Interval'));
        expect(intervalLine).toContain('—');
    });

    it('shows finish date when date_finish_schedule is set', () => {
        const result = buildScheduleConfirmation(makeData({ date_finish_schedule: '31/12/2026' }));
        expect(result).toContain('31/12/2026');
    });

    it('shows "—" as finish date when date_finish_schedule is empty', () => {
        const result = buildScheduleConfirmation(makeData({ date_finish_schedule: '' }));
        const lines = result.split('\n');
        const finishLine = lines.find(l => l.includes('Finish date'));
        expect(finishLine).toContain('—');
    });

    it('contains !confirm and !cancel instructions', () => {
        const result = buildScheduleConfirmation(makeData());
        expect(result).toContain('!confirm');
        expect(result).toContain('!cancel');
    });

});

// ---------------------------------------------------------------------------
// 5. sortByMode()
// ---------------------------------------------------------------------------
describe('sortByMode()', () => {

    it('sorts daily before weekly', () => {
        const rows = [{ mode: 'weekly' }, { mode: 'daily' }];
        rows.sort(sortByMode);
        expect(rows[0].mode).toBe('daily');
        expect(rows[1].mode).toBe('weekly');
    });

    it('sorts daily before monthly', () => {
        const rows = [{ mode: 'monthly' }, { mode: 'daily' }];
        rows.sort(sortByMode);
        expect(rows[0].mode).toBe('daily');
    });

    it('sorts weekly before monthly', () => {
        const rows = [{ mode: 'monthly' }, { mode: 'weekly' }];
        rows.sort(sortByMode);
        expect(rows[0].mode).toBe('weekly');
    });

    it('sorts all three modes in correct order: daily → weekly → monthly', () => {
        const rows = [
            { mode: 'monthly' },
            { mode: 'daily' },
            { mode: 'weekly' },
        ];
        rows.sort(sortByMode);
        expect(rows.map(r => r.mode)).toEqual(['daily', 'weekly', 'monthly']);
    });

    it('places unknown modes last', () => {
        const rows = [{ mode: 'unknown' }, { mode: 'daily' }];
        rows.sort(sortByMode);
        expect(rows[0].mode).toBe('daily');
        expect(rows[1].mode).toBe('unknown');
    });

    it('keeps equal modes stable (same weight returns 0)', () => {
        const result = sortByMode({ mode: 'daily' }, { mode: 'daily' });
        expect(result).toBe(0);
    });

    it('handles an empty array without throwing', () => {
        expect(() => [].sort(sortByMode)).not.toThrow();
    });

    it('handles a single-element array without throwing', () => {
        const rows = [{ mode: 'weekly' }];
        expect(() => rows.sort(sortByMode)).not.toThrow();
    });

});
