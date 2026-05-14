// tests/scheduler.pending-date.test.js
//
// Unit tests for computeNextOccurrence() and sortByDate() used by !pending-date.
// computeNextOccurrence is exported from src/scheduler.js.
// sortByDate is exported from src/utils/formatter.js.
//
// No real WhatsApp client or Google Sheets calls — scheduler internals are tested
// by importing computeNextOccurrence directly with controlled `now` values.

const { computeNextOccurrence } = require('../src/utils/dateUtils');
const { sortByDate } = require('../src/utils/formatter');

// ---------------------------------------------------------------------------
// Helper — builds a minimal parsed object as parseRowData() would return.
// Defaults to a daily row at 09:00 on the 15th of any month.
// ---------------------------------------------------------------------------
function makeParsed(overrides = {}) {
    return {
        day:            15,
        month:          6,
        hour:           9,
        minute:         0,
        subject:        'Test',
        message:        'Hello',
        rawNumber:      '5511999999999',
        mode:           'daily',
        finishDate:     null,
        // scheduled-mode fields (ignored by other modes)
        startYear:      2026,
        intervalDays:   0,
        intervalWeeks:  0,
        intervalMonths: 0,
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// 1. computeNextOccurrence() — once mode
// ---------------------------------------------------------------------------
describe('computeNextOccurrence() — once', () => {

    it('returns the exact date+time for a future once row', () => {
        const parsed = makeParsed({ mode: 'once', day: 20, month: 6, hour: 14, minute: 30, startYear: 2026 });
        const now    = new Date(2026, 5, 10, 8, 0); // 10 Jun 2026 08:00
        const result = computeNextOccurrence(parsed, now);
        expect(result).toEqual(new Date(2026, 5, 20, 14, 30, 0, 0));
    });

    it('uses startYear from parsed when available', () => {
        const parsed = makeParsed({ mode: 'once', day: 1, month: 1, hour: 10, minute: 0, startYear: 2027 });
        const now    = new Date(2026, 0, 1, 8, 0);
        const result = computeNextOccurrence(parsed, now);
        expect(result.getFullYear()).toBe(2027);
    });

    it('falls back to current year when startYear is absent', () => {
        const parsed = makeParsed({ mode: 'once', day: 5, month: 3, hour: 10, minute: 0, startYear: undefined });
        const now    = new Date(2026, 0, 1, 8, 0);
        const result = computeNextOccurrence(parsed, now);
        expect(result.getFullYear()).toBe(2026);
    });

    it('returns a past date for an already-past once row (caller decides whether to include)', () => {
        const parsed = makeParsed({ mode: 'once', day: 1, month: 1, hour: 9, minute: 0, startYear: 2026 });
        const now    = new Date(2026, 5, 10, 8, 0); // well after Jan 1
        const result = computeNextOccurrence(parsed, now);
        expect(result.getTime()).toBeLessThan(now.getTime());
    });

});

// ---------------------------------------------------------------------------
// 2. computeNextOccurrence() — daily mode
// ---------------------------------------------------------------------------
describe('computeNextOccurrence() — daily', () => {

    it('returns today when the fire time has not yet passed', () => {
        const parsed = makeParsed({ mode: 'daily', hour: 14, minute: 0 });
        const now    = new Date(2026, 5, 10, 8, 0); // 10 Jun 08:00 — fire is at 14:00
        const result = computeNextOccurrence(parsed, now);
        expect(result).toEqual(new Date(2026, 5, 10, 14, 0, 0, 0));
    });

    it('returns tomorrow when the fire time has already passed today', () => {
        const parsed = makeParsed({ mode: 'daily', hour: 9, minute: 0 });
        const now    = new Date(2026, 5, 10, 10, 0); // 10 Jun 10:00 — fire was at 09:00
        const result = computeNextOccurrence(parsed, now);
        expect(result).toEqual(new Date(2026, 5, 11, 9, 0, 0, 0));
    });

    it('handles month roll-over correctly', () => {
        const parsed = makeParsed({ mode: 'daily', hour: 9, minute: 0 });
        const now    = new Date(2026, 5, 30, 10, 0); // 30 Jun 10:00 — fire was at 09:00
        const result = computeNextOccurrence(parsed, now);
        // Tomorrow = 1 Jul 2026
        expect(result).toEqual(new Date(2026, 6, 1, 9, 0, 0, 0));
    });

    it('handles year roll-over correctly', () => {
        const parsed = makeParsed({ mode: 'daily', hour: 9, minute: 0 });
        const now    = new Date(2026, 11, 31, 10, 0); // 31 Dec 10:00
        const result = computeNextOccurrence(parsed, now);
        expect(result).toEqual(new Date(2027, 0, 1, 9, 0, 0, 0));
    });

    it('returns today when fire time is exactly now + 1 minute', () => {
        const parsed = makeParsed({ mode: 'daily', hour: 9, minute: 1 });
        const now    = new Date(2026, 5, 10, 9, 0); // 09:00 — fire at 09:01
        const result = computeNextOccurrence(parsed, now);
        expect(result).toEqual(new Date(2026, 5, 10, 9, 1, 0, 0));
    });

});

// ---------------------------------------------------------------------------
// 3. computeNextOccurrence() — weekly mode
// ---------------------------------------------------------------------------
describe('computeNextOccurrence() — weekly', () => {

    it('returns the next future occurrence of the correct weekday', () => {
        // Row date 15/06/2026 is a Monday (weekday 1).
        const parsed = makeParsed({ mode: 'weekly', day: 15, month: 6, hour: 10, minute: 0 });
        const now    = new Date(2026, 5, 10, 8, 0); // Wednesday 10 Jun — next Monday is 15 Jun
        const result = computeNextOccurrence(parsed, now);
        expect(result.getDay()).toBe(1); // Monday
        expect(result.getTime()).toBeGreaterThan(now.getTime());
    });

    it('skips to next week when this week\'s occurrence has passed', () => {
        const parsed = makeParsed({ mode: 'weekly', day: 15, month: 6, hour: 9, minute: 0 });
        // 15 Jun 2026 is Monday. now = Mon 15 Jun 10:00 (fire was at 09:00)
        const now = new Date(2026, 5, 15, 10, 0);
        const result = computeNextOccurrence(parsed, now);
        expect(result.getDay()).toBe(1);
        expect(result.getTime()).toBeGreaterThan(now.getTime());
        // Must be at least 6 days later
        const diffDays = (result.getTime() - now.getTime()) / (24 * 60 * 60 * 1000);
        expect(diffDays).toBeGreaterThanOrEqual(6);
    });

    it('returns a date strictly after now', () => {
        const parsed = makeParsed({ mode: 'weekly', day: 15, month: 6, hour: 10, minute: 0 });
        const now    = new Date(2026, 5, 14, 11, 0);
        const result = computeNextOccurrence(parsed, now);
        expect(result.getTime()).toBeGreaterThan(now.getTime());
    });

});

// ---------------------------------------------------------------------------
// 4. computeNextOccurrence() — monthly mode
// ---------------------------------------------------------------------------
describe('computeNextOccurrence() — monthly', () => {

    it('returns this month when the day has not yet passed', () => {
        const parsed = makeParsed({ mode: 'monthly', day: 20, month: 6, hour: 9, minute: 0 });
        const now    = new Date(2026, 5, 10, 8, 0); // 10 Jun — day 20 not yet passed
        const result = computeNextOccurrence(parsed, now);
        expect(result).toEqual(new Date(2026, 5, 20, 9, 0, 0, 0));
    });

    it('returns next month when this month\'s day has passed', () => {
        const parsed = makeParsed({ mode: 'monthly', day: 5, month: 6, hour: 9, minute: 0 });
        const now    = new Date(2026, 5, 10, 8, 0); // 10 Jun — day 5 already passed
        const result = computeNextOccurrence(parsed, now);
        expect(result.getMonth()).toBe(6); // July (0-indexed)
        expect(result.getDate()).toBe(5);
    });

    it('handles month roll-over to next year (December → January)', () => {
        const parsed = makeParsed({ mode: 'monthly', day: 5, month: 12, hour: 9, minute: 0 });
        const now    = new Date(2026, 11, 10, 8, 0); // 10 Dec — day 5 passed
        const result = computeNextOccurrence(parsed, now);
        expect(result.getFullYear()).toBe(2027);
        expect(result.getMonth()).toBe(0); // January
        expect(result.getDate()).toBe(5);
    });

    it('returns this month when fire time has not yet passed today (same day)', () => {
        const parsed = makeParsed({ mode: 'monthly', day: 10, month: 6, hour: 14, minute: 0 });
        const now    = new Date(2026, 5, 10, 8, 0); // same day but fire at 14:00
        const result = computeNextOccurrence(parsed, now);
        expect(result).toEqual(new Date(2026, 5, 10, 14, 0, 0, 0));
    });

});

// ---------------------------------------------------------------------------
// 5. computeNextOccurrence() — scheduled mode (interval-based)
// ---------------------------------------------------------------------------
describe('computeNextOccurrence() — scheduled', () => {

    it('returns the next send date for interval_days', () => {
        // Start: 1 Jun 2026, every 3 days → sends on 1,4,7,10,13,16...
        const parsed = makeParsed({
            mode: 'scheduled', day: 1, month: 6, startYear: 2026,
            hour: 9, minute: 0,
            intervalDays: 3, intervalWeeks: 0, intervalMonths: 0,
        });
        const now = new Date(2026, 5, 10, 10, 0); // 10 Jun 10:00 — next is 13 Jun 09:00
        const result = computeNextOccurrence(parsed, now);
        expect(result).toEqual(new Date(2026, 5, 13, 9, 0, 0, 0));
    });

    it('returns the next send date for interval_weeks', () => {
        // Start: 1 Jun 2026, every 2 weeks → 1 Jun, 15 Jun, 29 Jun...
        const parsed = makeParsed({
            mode: 'scheduled', day: 1, month: 6, startYear: 2026,
            hour: 9, minute: 0,
            intervalDays: 0, intervalWeeks: 2, intervalMonths: 0,
        });
        const now = new Date(2026, 5, 10, 10, 0); // between Jun 1 and Jun 15
        const result = computeNextOccurrence(parsed, now);
        expect(result).toEqual(new Date(2026, 5, 15, 9, 0, 0, 0));
    });

    it('returns the next send date for interval_months', () => {
        // Start: 1 Apr 2026, every 1 month → 1 Apr, 1 May, 1 Jun, 1 Jul...
        const parsed = makeParsed({
            mode: 'scheduled', day: 1, month: 4, startYear: 2026,
            hour: 9, minute: 0,
            intervalDays: 0, intervalWeeks: 0, intervalMonths: 1,
        });
        const now = new Date(2026, 5, 10, 10, 0); // 10 Jun → next is 1 Jul
        const result = computeNextOccurrence(parsed, now);
        expect(result).toEqual(new Date(2026, 6, 1, 9, 0, 0, 0));
    });

    it('returns null when finishDate has passed before next occurrence', () => {
        const parsed = makeParsed({
            mode: 'scheduled', day: 1, month: 6, startYear: 2026,
            hour: 9, minute: 0,
            intervalDays: 3, intervalWeeks: 0, intervalMonths: 0,
            finishDate: new Date(2026, 5, 11), // finishes 11 Jun — next fire is 13 Jun
        });
        const now = new Date(2026, 5, 10, 10, 0);
        const result = computeNextOccurrence(parsed, now);
        expect(result).toBeNull();
    });

    it('returns a date strictly after now', () => {
        const parsed = makeParsed({
            mode: 'scheduled', day: 1, month: 1, startYear: 2026,
            hour: 9, minute: 0,
            intervalDays: 7, intervalWeeks: 0, intervalMonths: 0,
        });
        const now = new Date(2026, 5, 10, 10, 0);
        const result = computeNextOccurrence(parsed, now);
        expect(result).not.toBeNull();
        expect(result.getTime()).toBeGreaterThan(now.getTime());
    });

});

// ---------------------------------------------------------------------------
// 6. sortByDate()
// ---------------------------------------------------------------------------
describe('sortByDate()', () => {

    it('sorts earlier nextOccurrence first', () => {
        const rows = [
            { nextOccurrence: new Date(2026, 5, 20, 9, 0) },
            { nextOccurrence: new Date(2026, 5, 10, 9, 0) },
        ];
        rows.sort(sortByDate);
        expect(rows[0].nextOccurrence.getDate()).toBe(10);
        expect(rows[1].nextOccurrence.getDate()).toBe(20);
    });

    it('sorts a longer list ascending', () => {
        const rows = [
            { nextOccurrence: new Date(2026, 6, 1, 9, 0) },
            { nextOccurrence: new Date(2026, 5, 10, 9, 0) },
            { nextOccurrence: new Date(2026, 5, 15, 14, 0) },
        ];
        rows.sort(sortByDate);
        const dates = rows.map(r => r.nextOccurrence.getTime());
        expect(dates[0]).toBeLessThan(dates[1]);
        expect(dates[1]).toBeLessThan(dates[2]);
    });

    it('places rows with null nextOccurrence last', () => {
        const rows = [
            { nextOccurrence: null },
            { nextOccurrence: new Date(2026, 5, 10, 9, 0) },
        ];
        rows.sort(sortByDate);
        expect(rows[0].nextOccurrence).not.toBeNull();
        expect(rows[1].nextOccurrence).toBeNull();
    });

    it('places rows with undefined nextOccurrence last', () => {
        const rows = [
            { nextOccurrence: undefined },
            { nextOccurrence: new Date(2026, 5, 10, 9, 0) },
        ];
        rows.sort(sortByDate);
        expect(rows[0].nextOccurrence).toBeDefined();
        expect(rows[1].nextOccurrence).toBeUndefined();
    });

    it('keeps equal nextOccurrence values stable (returns 0)', () => {
        const t = new Date(2026, 5, 10, 9, 0);
        const result = sortByDate({ nextOccurrence: t }, { nextOccurrence: new Date(t) });
        expect(result).toBe(0);
    });

    it('handles an empty array without throwing', () => {
        expect(() => [].sort(sortByDate)).not.toThrow();
    });

    it('handles a single-element array without throwing', () => {
        const rows = [{ nextOccurrence: new Date(2026, 5, 10) }];
        expect(() => rows.sort(sortByDate)).not.toThrow();
    });

    it('sorts rows with same date but different times correctly', () => {
        const rows = [
            { nextOccurrence: new Date(2026, 5, 10, 15, 0) },
            { nextOccurrence: new Date(2026, 5, 10, 9, 0) },
        ];
        rows.sort(sortByDate);
        expect(rows[0].nextOccurrence.getHours()).toBe(9);
        expect(rows[1].nextOccurrence.getHours()).toBe(15);
    });

});
