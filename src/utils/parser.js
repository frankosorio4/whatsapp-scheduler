// src/utils/parser.js
//
// Pure parsing and validation logic for a single Google Sheet row.
// No external dependencies - this file can be imported by Jest directly
// without any mocks or special configuration.

// --- PARSE AND VALIDATE A SINGLE ROW ---
// Receives the plain object returned by row.toObject() from google-spreadsheet.
// Returns a structured object if the row is valid, or null if required fields are missing.
function parseRowData(data) {
    const subject   = data.subject || '(no subject)';
    const message   = data.message;
    const rawNumber = data.number ? data.number.toString().replace(/\D/g, '') : '';
    const rawDate   = data.date ? String(data.date).trim() : '';
    const rawHour   = data.hour ? String(data.hour).trim() : '';

    // Guard: skip rows with missing required fields
    if (!rawDate || !rawHour || !rawNumber) return null;

    const dateParts = rawDate.split('/');
    const hourParts = rawHour.split(':');

    // Guard: date must have at least DD/MM and hour must be HH:MM
    if (dateParts.length < 2 || hourParts.length < 2) return null;

    const day    = parseInt(dateParts[0], 10);
    const month  = parseInt(dateParts[1], 10);
    const hour   = parseInt(hourParts[0], 10);
    const minute = parseInt(hourParts[1], 10);

    // Guard: all parsed values must be valid numbers
    if (isNaN(day) || isNaN(month) || isNaN(hour) || isNaN(minute)) return null;

    // --- DETERMINE SCHEDULING MODE ---
    // The Google Sheet enforces that only one checkbox can be TRUE at a time via data validation.
    // The if/else chain below is a code-level safety net in case that validation is bypassed.
    // Checkbox values from Google Sheets arrive as the string 'TRUE' or 'FALSE'.
    const isOnce       = data.once         === 'TRUE' || data.once         === true;
    const isDaily      = data.daily        === 'TRUE' || data.daily        === true;
    const isWeekly     = data.weekly       === 'TRUE' || data.weekly       === true;
    const isMonthly    = data.monthly      === 'TRUE' || data.monthly      === true;
    const isScheduled  = data.scheduled    === 'TRUE' || data.scheduled    === true;
    const isEndOfMonth = data.end_of_month === 'TRUE' || data.end_of_month === true;

    // --- END OF MONTH MODE ---
    // Fires a daily cron at the defined hour/minute.
    // shouldSendEndOfMonth() in scheduler.js gates the actual send to the last
    // calendar day of each month.
    // Stops after date_finish_schedule if set.
    if (isEndOfMonth) {
        let finishDate = null;
        const rawFinishEOM = data.date_finish_schedule ? String(data.date_finish_schedule).trim() : '';
        if (rawFinishEOM) {
            const fp = rawFinishEOM.split('/');
            if (fp.length >= 3) {
                const fd  = parseInt(fp[0], 10);
                const fm  = parseInt(fp[1], 10);
                const rfy = parseInt(fp[2], 10);
                const fy  = rfy < 100 ? 2000 + rfy : rfy;
                if (!isNaN(fd) && !isNaN(fm) && !isNaN(rfy)) {
                    finishDate = new Date(fy, fm - 1, fd);
                }
            }
        }
        const cronTime = `${minute} ${hour} * * *`;
        return { day, month, hour, minute, subject, message, rawNumber, cronTime, mode: 'end_of_month', finishDate };
    }

    // --- SCHEDULED MODE (interval-based) ---
    // Fires a daily cron at the defined hour/minute.
    // shouldSendToday() in scheduler.js checks elapsed intervals before actually sending.
    // date column must be DD/MM/YYYY so elapsed days can be calculated from the start date.
    if (isScheduled) {
        // Guard: year part must exist and be a valid number.
        // Accepts 2-digit years and expands them to 4-digit (e.g. 26 → 2026).
        const rawStartYear = dateParts.length >= 3 ? parseInt(dateParts[2], 10) : NaN;
        if (isNaN(rawStartYear)) return null;
        const startYear = rawStartYear < 100 ? 2000 + rawStartYear : rawStartYear;

        const intervalDays   = parseInt(data.interval_days,   10) || 0;
        const intervalWeeks  = parseInt(data.interval_weeks,  10) || 0;
        const intervalMonths = parseInt(data.interval_months, 10) || 0;

        // Guard: at least one interval must be set
        if (intervalDays === 0 && intervalWeeks === 0 && intervalMonths === 0) return null;

        // Parse finish date — optional. If filled, must be DD/MM/YYYY.
        let finishDate = null;
        const rawFinish = data.date_finish_schedule ? String(data.date_finish_schedule).trim() : '';
        if (rawFinish) {
            const finishParts = rawFinish.split('/');
            if (finishParts.length >= 3) {
                const finishDay    = parseInt(finishParts[0], 10);
                const finishMonth  = parseInt(finishParts[1], 10);
                const rawFinishYear = parseInt(finishParts[2], 10);
                const finishYear   = rawFinishYear < 100 ? 2000 + rawFinishYear : rawFinishYear;
                if (!isNaN(finishDay) && !isNaN(finishMonth) && !isNaN(rawFinishYear)) {
                    finishDate = new Date(finishYear, finishMonth - 1, finishDay);
                }
            }
        }

        // Cron fires daily at the defined hour/minute.
        // shouldSendToday() in scheduler.js decides on each fire whether to actually send.
        const cronTime = `${minute} ${hour} * * *`;
        const mode = 'scheduled';

        return {
            day, month, hour, minute, subject, message, rawNumber, cronTime, mode,
            startYear,
            intervalDays,
            intervalWeeks,
            intervalMonths,
            finishDate
        };
    }

    let cronTime;
    let mode;

    // --- OPTIONAL FINISH DATE (daily/weekly/monthly) ---
    // If date_finish_schedule is filled in, parse it as a Date object.
    // If empty or invalid, finishDate is null → row runs indefinitely.
    let finishDate = null;
    const rawFinishRecurring = data.date_finish_schedule ? String(data.date_finish_schedule).trim() : '';
    if (rawFinishRecurring) {
        const fp = rawFinishRecurring.split('/');
        if (fp.length >= 3) {
            const fd = parseInt(fp[0], 10);
            const fm = parseInt(fp[1], 10);
            const rawFY = parseInt(fp[2], 10);
            const fy = rawFY < 100 ? 2000 + rawFY : rawFY;
            if (!isNaN(fd) && !isNaN(fm) && !isNaN(rawFY)) {
                finishDate = new Date(fy, fm - 1, fd);
            }
        }
    }

    if (isOnce) {
        // Send once on the exact date and time
        cronTime = `${minute} ${hour} ${day} ${month} *`;
        mode = 'once';
    } else if (isDaily) {
        // Send every day at the defined hour, ignoring the date
        cronTime = `${minute} ${hour} * * *`;
        mode = 'daily';
    } else if (isWeekly) {
        // Send every week on the same weekday derived from the date column.
        // getDay() returns 0 (Sun) to 6 (Sat), which matches cron's weekday field.
        const year = new Date().getFullYear();
        const weekday = new Date(year, month - 1, day).getDay();
        cronTime = `${minute} ${hour} * * ${weekday}`;
        mode = 'weekly';
    } else if (isMonthly) {
        // Send every month on the same day number at the defined hour
        cronTime = `${minute} ${hour} ${day} * *`;
        mode = 'monthly';
    } else {
        // No checkbox selected - default to once as a fallback
        cronTime = `${minute} ${hour} ${day} ${month} *`;
        mode = 'once';
    }

    return { day, month, hour, minute, subject, message, rawNumber, cronTime, mode, finishDate };
}

// --- IS ROW FINISHED ---
// Pure function — no external deps. Returns true if a row should be archived.
// Called by archiveFinishedRows() in googleSheets.js.
//
// Rules:
//   once / fallback : finished if DD/MM in the given current year is strictly in the past.
//   daily/weekly/monthly/scheduled/end_of_month : finished if date_finish_schedule is set and strictly past.
//
// todayMidnight must be a Date at midnight local time (São Paulo), passed in by the caller
// so this function stays pure and testable without any Date.now() side effects.
function isRowFinished(data, todayMidnight) {
    const todayYear = todayMidnight.getFullYear();

    const isOnce       = data.once         === 'TRUE' || data.once         === true;
    const isDaily      = data.daily        === 'TRUE' || data.daily        === true;
    const isWeekly     = data.weekly       === 'TRUE' || data.weekly       === true;
    const isMonthly    = data.monthly      === 'TRUE' || data.monthly      === true;
    const isScheduled  = data.scheduled    === 'TRUE' || data.scheduled    === true;
    const isEndOfMonth = data.end_of_month === 'TRUE' || data.end_of_month === true;

    if (isOnce || (!isDaily && !isWeekly && !isMonthly && !isScheduled && !isEndOfMonth)) {
        // once / fallback: finished if already sent (log column is filled)
        if (data.log_last_sent_message && String(data.log_last_sent_message).trim()) return true;

        // otherwise: compare against the row's date.
        // Use the year from the date column when present (DD/MM/YYYY or DD/MM/YY).
        // Fall back to todayYear only for legacy DD/MM-only entries.
        const rawDate = data.date ? String(data.date).trim() : '';
        const parts = rawDate.split('/');
        if (parts.length < 2) return false;
        const d = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10);
        if (isNaN(d) || isNaN(m)) return false;
        const rawYear = parts.length >= 3 ? parseInt(parts[2], 10) : NaN;
        const resolvedYear = !isNaN(rawYear) ? (rawYear < 100 ? 2000 + rawYear : rawYear) : todayYear;
        const rowDate = new Date(resolvedYear, m - 1, d);
        return todayMidnight > rowDate;
    }

    // recurring / scheduled / end_of_month: finished only if date_finish_schedule is set and past.
    const rawFinish = data.date_finish_schedule ? String(data.date_finish_schedule).trim() : '';
    if (!rawFinish) return false;
    const fp = rawFinish.split('/');
    if (fp.length < 3) return false;
    const fd  = parseInt(fp[0], 10);
    const fm  = parseInt(fp[1], 10);
    const rfy = parseInt(fp[2], 10);
    if (isNaN(fd) || isNaN(fm) || isNaN(rfy)) return false;
    const fy = rfy < 100 ? 2000 + rfy : rfy;
    const finishDate = new Date(fy, fm - 1, fd);
    return todayMidnight > finishDate;
}

// --- DAYS IN MONTH ---
// Returns the number of days in a given month/year.
// Used by parseNewScheduleInput to reject impossible dates like 31/02.
// Pure helper — no side effects.
function daysInMonth(month, year) {
    return new Date(year, month, 0).getDate();
}

// --- PARSE NEW SCHEDULE INPUT ---
// Parses and validates the filled-in template sent by the owner via WhatsApp.
// Returns { ok: true, data: {...} } on success, or { ok: false, error: string } on failure.
//
// Expected text format (each field on its own line):
//   subject: ...
//   message: ...
//   number: ...
//   date: ...                   DD/MM/YYYY required for all modes
//   hour: ...
//   schedule: ...
//   interval: ...               (required for scheduled mode only, e.g. 3d / 2w / 1mo)
//   date_finish_schedule: ...   (optional for all modes)
//
// Pure function — no require() calls, no side effects.
function parseNewScheduleInput(text) {
    // --- EXTRACT FIELDS ---
    // Parse "key: value" pairs from text. Keys are case-insensitive; values are trimmed.
    const fields = {};
    const lines = text.split('\n');
    for (const line of lines) {
        const colonIdx = line.indexOf(':');
        if (colonIdx === -1) continue;
        const key   = line.slice(0, colonIdx).trim().toLowerCase().replace(/\s+/g, '_');
        const value = line.slice(colonIdx + 1).trim();
        fields[key] = value;
    }

    // --- REQUIRED: message ---
    const message = fields['message'] || '';
    if (!message) return { ok: false, error: '❌ *message* is required.' };

    // --- OPTIONAL: subject ---
    const subject = fields['subject'] || '(no subject)';

    // --- REQUIRED: number ---
    const rawNumber = (fields['number'] || '').replace(/\D/g, '');
    if (!rawNumber) return { ok: false, error: '❌ *number* is required.' };
    if (rawNumber.length < 10) return { ok: false, error: '❌ *number* must have at least 10 digits (include country code).' };

    // --- REQUIRED: hour ---
    const rawHour = fields['hour'] || '';
    if (!rawHour) return { ok: false, error: '❌ *hour* is required.' };
    const hourParts = rawHour.split(':');
    if (hourParts.length < 2) return { ok: false, error: '❌ *hour* must be in HH:MM format (e.g. 14:30).' };
    const hour   = parseInt(hourParts[0], 10);
    const minute = parseInt(hourParts[1], 10);
    if (isNaN(hour) || isNaN(minute)) return { ok: false, error: '❌ *hour* must be in HH:MM format (e.g. 14:30).' };
    if (hour < 0 || hour > 23)        return { ok: false, error: '❌ *hour* value must be between 0 and 23.' };
    if (minute < 0 || minute > 59)    return { ok: false, error: '❌ *minute* value must be between 0 and 59.' };

    // --- REQUIRED: schedule mode ---
    const scheduleRaw = (fields['schedule'] || '').toLowerCase().trim();
    const validModes  = ['once', 'daily', 'weekly', 'monthly', 'scheduled', 'end_of_month'];
    if (!scheduleRaw) return { ok: false, error: '❌ *schedule* is required. Options: once | daily | weekly | monthly | scheduled | end_of_month' };
    if (!validModes.includes(scheduleRaw)) return { ok: false, error: '❌ *schedule* must be one of: once | daily | weekly | monthly | scheduled | end_of_month' };

    // --- REQUIRED: date — DD/MM/YYYY for all modes ---
    const rawDate = fields['date'] || '';
    if (!rawDate) return { ok: false, error: '❌ *date* is required.' };
    const dateParts = rawDate.split('/');
    if (dateParts.length < 3) return { ok: false, error: '❌ *date* must be in DD/MM/YYYY format (e.g. 15/04/2026).' };
    const day      = parseInt(dateParts[0], 10);
    const month    = parseInt(dateParts[1], 10);
    const rawYear  = parseInt(dateParts[2], 10);
    if (isNaN(day) || isNaN(month) || isNaN(rawYear)) return { ok: false, error: '❌ *date* must be in DD/MM/YYYY format (e.g. 15/04/2026).' };
    if (month < 1 || month > 12) return { ok: false, error: '❌ *date* month must be between 1 and 12.' };
    const year = rawYear < 100 ? 2000 + rawYear : rawYear;
    if (day < 1 || day > daysInMonth(month, year)) return { ok: false, error: `❌ *date* day ${day} is not valid for month ${month}.` };

    // --- OPTIONAL: date_finish_schedule ---
    const rawFinish = fields['date_finish_schedule'] || '';
    if (rawFinish) {
        const fp = rawFinish.split('/');
        if (fp.length < 3) return { ok: false, error: '❌ *date_finish_schedule* must be in DD/MM/YYYY format.' };
        const fd   = parseInt(fp[0], 10);
        const fm   = parseInt(fp[1], 10);
        const rfY  = parseInt(fp[2], 10);
        if (isNaN(fd) || isNaN(fm) || isNaN(rfY)) return { ok: false, error: '❌ *date_finish_schedule* must be in DD/MM/YYYY format.' };
        if (fm < 1 || fm > 12) return { ok: false, error: '❌ *date_finish_schedule* month must be between 1 and 12.' };
        const fYear = rfY < 100 ? 2000 + rfY : rfY;
        if (fd < 1 || fd > daysInMonth(fm, fYear)) return { ok: false, error: `❌ *date_finish_schedule* day ${fd} is not valid for month ${fm}.` };
    }

    // --- SCHEDULED MODE EXTRA VALIDATION ---
    let intervalDays   = 0;
    let intervalWeeks  = 0;
    let intervalMonths = 0;

    if (scheduleRaw === 'scheduled') {
        // interval is required for scheduled mode — parse "3d", "2w", "1mo"
        const intervalRaw = (fields['interval'] || '').toLowerCase().trim();
        if (!intervalRaw) return { ok: false, error: '❌ *interval* is required for *scheduled* mode (e.g. 3d, 2w, 1mo).' };

        const daysMatch   = intervalRaw.match(/^(\d+)d$/);
        const weeksMatch  = intervalRaw.match(/^(\d+)w$/);
        const monthsMatch = intervalRaw.match(/^(\d+)mo$/);

        if (daysMatch) {
            intervalDays = parseInt(daysMatch[1], 10);
        } else if (weeksMatch) {
            intervalWeeks = parseInt(weeksMatch[1], 10);
        } else if (monthsMatch) {
            intervalMonths = parseInt(monthsMatch[1], 10);
        } else {
            return { ok: false, error: '❌ *interval* format not recognised. Use: 3d (days), 2w (weeks), 1mo (months).' };
        }

        if (intervalDays === 0 && intervalWeeks === 0 && intervalMonths === 0) {
            return { ok: false, error: '❌ *interval* value must be greater than 0.' };
        }
    }

    // --- BUILD SHEET ROW DATA ---
    // date saved exactly as the user typed it (year preserved).
    const sheetData = {
        subject,
        message,
        number:        rawNumber,
        date:          rawDate,
        hour:          `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`,
        once:          scheduleRaw === 'once'          ? 'TRUE' : 'FALSE',
        daily:         scheduleRaw === 'daily'         ? 'TRUE' : 'FALSE',
        weekly:        scheduleRaw === 'weekly'        ? 'TRUE' : 'FALSE',
        monthly:       scheduleRaw === 'monthly'       ? 'TRUE' : 'FALSE',
        scheduled:     scheduleRaw === 'scheduled'     ? 'TRUE' : 'FALSE',
        end_of_month:  scheduleRaw === 'end_of_month'  ? 'TRUE' : 'FALSE',
        interval_days:         intervalDays   > 0 ? String(intervalDays)   : '',
        interval_weeks:        intervalWeeks  > 0 ? String(intervalWeeks)  : '',
        interval_months:       intervalMonths > 0 ? String(intervalMonths) : '',
        date_finish_schedule:  rawFinish || '',
        log_last_sent_message: '',
        server_updated_at:     '',
    };

    return { ok: true, data: sheetData };
}

module.exports = { parseRowData, isRowFinished, parseNewScheduleInput };
