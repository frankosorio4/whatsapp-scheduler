// src/utils/dateUtils.js
//
// Pure date computation helpers. No external dependencies.
// Used by scheduler.js but kept separate so tests can import them
// without pulling in the Google Sheets / whatsapp-web.js dependency chain.

// --- COMPUTE NEXT OCCURRENCE ---
// Returns a Date representing the next time this row will fire, from the perspective
// of `now`. Used by getPendingMessagesByDate() to sort rows by proximity.
//
// Rules per mode:
//   once      → the exact date+time from the sheet (may be in the past for already-sent rows)
//   daily     → today at hour:minute if not yet passed, otherwise tomorrow
//   weekly    → next future occurrence of the same weekday at hour:minute
//   monthly   → next future occurrence of the same day-of-month at hour:minute
//   scheduled → next valid send day based on interval, from start date
//
// `now` is injected so the function stays pure and easily testable.
function computeNextOccurrence(parsed, now) {
    const { day, month, hour, minute, mode } = parsed;

    // Build a candidate Date at hour:minute on a given year/month/day.
    const candidate = (y, mo, d) => new Date(y, mo - 1, d, hour, minute, 0, 0);

    const y  = now.getFullYear();
    const mo = now.getMonth() + 1; // 1-based
    const d  = now.getDate();

    if (mode === 'once') {
        // once rows use the year stored in the sheet date if available,
        // otherwise fall back to current year.
        const rowYear = parsed.startYear || y;
        return candidate(rowYear, month, day);
    }

    if (mode === 'daily') {
        // Try today first; if that time has passed, use tomorrow.
        const todayFire = candidate(y, mo, d);
        if (todayFire > now) return todayFire;
        const tomorrow = new Date(y, mo - 1, d + 1);
        return candidate(tomorrow.getFullYear(), tomorrow.getMonth() + 1, tomorrow.getDate());
    }

    if (mode === 'weekly') {
        // Find the next date whose weekday matches the row's weekday.
        // The row's weekday is derived from day/month (same as parseRowData).
        const rowWeekday = new Date(y, month - 1, day).getDay(); // 0=Sun..6=Sat
        for (let offset = 0; offset <= 7; offset++) {
            const attempt = new Date(y, mo - 1, d + offset);
            if (attempt.getDay() === rowWeekday) {
                const fire = candidate(attempt.getFullYear(), attempt.getMonth() + 1, attempt.getDate());
                if (fire > now) return fire;
            }
        }
        // Fallback: 7 days from today
        const fallback = new Date(y, mo - 1, d + 7);
        return candidate(fallback.getFullYear(), fallback.getMonth() + 1, fallback.getDate());
    }

    if (mode === 'monthly') {
        // Try this month's day; if passed, try next month's.
        const thisMonthFire = candidate(y, mo, day);
        if (thisMonthFire > now) return thisMonthFire;
        // Advance one month (let Date handle month overflow automatically).
        const nextMonth = new Date(y, mo, 1); // 1st of next month
        return candidate(nextMonth.getFullYear(), nextMonth.getMonth() + 1, day);
    }

    if (mode === 'end_of_month') {
        // Next occurrence: the last day of this month if not yet passed, otherwise last day of next month.
        const lastDayThisMonth = new Date(y, mo, 0).getDate(); // last day of current month
        const thisMonthFire = candidate(y, mo, lastDayThisMonth);
        if (thisMonthFire > now) {
            if (parsed.finishDate && thisMonthFire > parsed.finishDate) return null;
            return thisMonthFire;
        }
        // Advance to last day of next month
        const nextMonthLastDay = new Date(y, mo + 1, 0).getDate();
        const nextMonthFire = candidate(y, mo + 1, nextMonthLastDay);
        if (parsed.finishDate && nextMonthFire > parsed.finishDate) return null;
        return nextMonthFire;
    }

    if (mode === 'scheduled') {
        // Walk forward from start date in interval steps until we find
        // the first future send day at the row's hour:minute.
        const { startYear, intervalDays, intervalWeeks, intervalMonths } = parsed;
        const startMidnight = new Date(startYear, month - 1, day, 0, 0, 0, 0);
        const msPerDay = 24 * 60 * 60 * 1000;

        // Determine the interval step in days (approx for months) to bound iteration.
        const stepDays = intervalDays  > 0 ? intervalDays
                       : intervalWeeks > 0 ? intervalWeeks * 7
                       : 31; // monthly: use 31 as max step

        // Max iterations: scan up to 2 years ahead.
        const maxIter = Math.ceil(730 / stepDays) + 1;

        for (let i = 0; i <= maxIter; i++) {
            let sendDate;

            if (intervalDays > 0) {
                const ms = startMidnight.getTime() + i * intervalDays * msPerDay;
                sendDate = new Date(ms);
            } else if (intervalWeeks > 0) {
                const ms = startMidnight.getTime() + i * intervalWeeks * 7 * msPerDay;
                sendDate = new Date(ms);
            } else {
                // Monthly: advance i months from start
                sendDate = new Date(startYear, month - 1 + i * intervalMonths, day);
            }

            const fire = candidate(
                sendDate.getFullYear(),
                sendDate.getMonth() + 1,
                sendDate.getDate()
            );

            if (fire > now) {
                // Also respect finishDate
                if (parsed.finishDate && fire > parsed.finishDate) return null;
                return fire;
            }
        }
        return null; // no future occurrence found within 2 years
    }

    return null;
}

module.exports = { computeNextOccurrence };
