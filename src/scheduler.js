// src/scheduler.js
//
// Core scheduling engine.
// Reads rows from Google Sheets, builds cron jobs, and sends WhatsApp messages.
// Imports pure helpers from utils/ and sheet access from services/googleSheets.js.

const cron = require('node-cron');
const { getSheetAndRows, logSentMessage, updateServerTimestamp, archiveFinishedRows, addRowToSheet } = require('./services/googleSheets');
const { parseRowData } = require('./utils/parser');
const { formatMessage, formatTimestamp, sortByMode } = require('./utils/formatter');
const { logMessageToFile } = require('./utils/logger');
const { withRetry, notifyOwner } = require('./utils/notifier');

// Active cron tasks - cleared and rebuilt on every sync.
let scheduledTasks = [];

// --- SHOULD SEND TODAY (scheduled mode only) ---
// Returns true if today is a send day for an interval-based scheduled row.
// Called inside the daily cron that fires at the row's defined hour/minute.
//
// Rules:
//   - If today is past finishDate → skip
//   - If message was already sent today (log_last_sent_message contains today's date) → skip
//   - Elapsed days since start date must be divisible by the interval
function shouldSendToday(parsed, logLastSent) {
    const now = new Date();

    // Normalize today to midnight São Paulo time for clean day-level comparison.
    // toLocaleDateString gives "DD/MM/YYYY" in pt-BR — we parse it back into a Date at midnight.
    const todayStr = now.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const [todayDay, todayMonth, todayYear] = todayStr.split('/').map(Number);
    const todayMidnight = new Date(todayYear, todayMonth - 1, todayDay);

    // Check finish date
    if (parsed.finishDate && todayMidnight > parsed.finishDate) return false;

    // Check if already sent today — log format is "DD/MM/YYYY HH:MM"
    if (logLastSent) {
        const logDate = String(logLastSent).trim().split(' ')[0]; // "DD/MM/YYYY"
        if (logDate === todayStr) return false;
    }

    // Calculate start date at midnight
    const startMidnight = new Date(parsed.startYear, parsed.month - 1, parsed.day);

    // Elapsed full days since start
    const msPerDay = 24 * 60 * 60 * 1000;
    const elapsedDays = Math.round((todayMidnight - startMidnight) / msPerDay);

    // Before or on start date: only send if elapsed === 0 (first send)
    if (elapsedDays < 0) return false;

    if (parsed.intervalDays > 0) {
        return elapsedDays % parsed.intervalDays === 0;
    }

    if (parsed.intervalWeeks > 0) {
        return elapsedDays % (parsed.intervalWeeks * 7) === 0;
    }

    if (parsed.intervalMonths > 0) {
        // Compare calendar months elapsed (ignores exact day count, uses month boundaries)
        const monthsElapsed =
            (todayYear - parsed.startYear) * 12 + (todayMonth - parsed.month);
        // Only fire on the same day-of-month as the start date
        return monthsElapsed % parsed.intervalMonths === 0 && todayDay === parsed.day;
    }

    return false;
}

// --- SYNC SHEET TO SCHEDULER ---
// Stops all existing cron jobs, re-reads the sheet, and creates new jobs.
// Called on startup and every 30 minutes by index.js.
// On failure: notifies the owner and re-throws so the caller knows the sync failed.
async function syncSheetToScheduler(client) {
    try {
        scheduledTasks.forEach(task => task.stop());
        scheduledTasks = [];

        const { doc, sheet, rows } = await withRetry(() => getSheetAndRows());

        console.log(`[${new Date().toLocaleTimeString()}] Syncing Google Sheets...`);

        // Update server_updated_at in Q2 on every sync (non-critical — no retry).
        const syncTimestamp = formatTimestamp();
        await updateServerTimestamp(sheet, syncTimestamp);
        console.log(`[SYNC] server_updated_at set to ${syncTimestamp}`);

        // Group parsed rows by cronTime to calculate stagger index within each time slot.
        // Rows that share the same cronTime are sent sequentially with a delay between them.
        // Rows alone in their time slot are sent with no stagger (slotIndex = 0).
        const cronGroups = {};
        const parsedRows = [];

        // Normalize today to midnight São Paulo for expiry comparisons.
        const nowStr = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
        const [nowDay, nowMonth, nowYear] = nowStr.split('/').map(Number);
        const todayMidnight = new Date(nowYear, nowMonth - 1, nowDay);

        rows.forEach((row, index) => {
            const data = row.toObject();
            const parsed = parseRowData(data);

            // Guard: skip rows that can't be parsed
            if (!parsed) return;

            const { day, month, hour, minute } = parsed;
            if (isNaN(day) || isNaN(month) || isNaN(hour) || isNaN(minute)) return;

            // Guard: skip expired recurring rows (daily/weekly/monthly with a past finishDate).
            // finishDate is inclusive — row is still active on the finish date itself.
            // 'scheduled' mode expiry is handled separately inside shouldSendToday().
            if (
                parsed.finishDate &&
                parsed.mode !== 'scheduled' &&
                parsed.mode !== 'once' &&
                todayMidnight > parsed.finishDate
            ) {
                console.log(`[EXPIRED] Row ${index + 2} [${parsed.mode}] "${parsed.subject}": finish date ${parsed.finishDate.toLocaleDateString('pt-BR')} passed. Skipping.`);
                return;
            }

            cronGroups[parsed.cronTime] = (cronGroups[parsed.cronTime] || 0) + 1;
            parsedRows.push({ row, parsed, data, sheetIndex: index });
        });

        const cronGroupCounters = {};

        parsedRows.forEach(({ row, parsed, data, sheetIndex }) => {
            const { day, month, hour, minute, subject, message, rawNumber, cronTime } = parsed;

            const slotIndex = cronGroupCounters[cronTime] || 0;
            cronGroupCounters[cronTime] = slotIndex + 1;

            const targetNumber = `${rawNumber}@c.us`;
            const task = sendScheduledMessage(client, row, parsed, data, slotIndex, subject, message, targetNumber, cronTime);

            scheduledTasks.push(task);

            if (parsed.mode === 'scheduled') {
                const interval = parsed.intervalDays   > 0 ? `every ${parsed.intervalDays}d`
                               : parsed.intervalWeeks  > 0 ? `every ${parsed.intervalWeeks}w`
                               : `every ${parsed.intervalMonths}mo`;
                const finish = parsed.finishDate ? parsed.finishDate.toLocaleDateString('pt-BR') : 'no end date';
                console.log(`Scheduled Row ${sheetIndex + 2} [scheduled/${interval}] "${subject}": starts ${day}/${month}/${parsed.startYear} at ${hour}:${minute.toString().padStart(2, '0')} until ${finish} (slot ${slotIndex + 1}/${cronGroups[cronTime]})`);
            } else {
                console.log(`Scheduled Row ${sheetIndex + 2} [${parsed.mode}] "${subject}": ${day}/${month} at ${hour}:${minute.toString().padStart(2, '0')} (slot ${slotIndex + 1}/${cronGroups[cronTime]})`);
            }
        });

        console.log(`Total active schedules: ${scheduledTasks.length}`);

        // Silently archive finished rows on every sync.
        // Runs after scheduling so the cron jobs are already stopped before rows are deleted.
        await archiveFinishedRows(doc, sheet, rows);

    } catch (e) {
        console.error('[SYNC ERROR]', e.message);
        await notifyOwner(
            client,
            `⚠️ *[SYNC ERROR]* Failed to sync Google Sheets.\nReason: ${e.message}\n\nSchedules may be inactive. Check the server logs.`
        );
    }
}

// --- ARCHIVE FINISHED MESSAGES ---
// Called by the !archive command. Reads the sheet, archives finished rows,
// then re-syncs so cron jobs reflect the cleaned-up sheet.
async function archiveFinished(client) {
    try {
        const { doc, sheet, rows } = await withRetry(() => getSheetAndRows());
        const count = await archiveFinishedRows(doc, sheet, rows);

        // Re-sync so cron jobs no longer include deleted rows.
        await syncSheetToScheduler(client);

        if (count === 0) return '✅ No finished rows to archive. Schedule is up to date.';
        return `✅ Archived ${count} finished row(s) to the "done" sheet and re-synced the schedule.`;
    } catch (e) {
        console.error('[ARCHIVE ERROR]', e.message);
        await notifyOwner(
            client,
            `⚠️ *[ARCHIVE ERROR]* Failed to archive finished rows.\nReason: ${e.message}\n\nFinished rows were not removed. Check the server logs.`
        );
        return '❌ Archive failed. Check the server logs.';
    }
}

// --- PENDING MESSAGES ---
// Returns a formatted WhatsApp reply listing unsent once-rows and all active recurring rows.
// Recurring rows are sorted by mode: daily → weekly → monthly.
async function getPendingMessages() {
    try {
        const { rows } = await withRetry(() => getSheetAndRows());

        console.log(`[${new Date().toLocaleTimeString()}] Fetching pending messages...`);

        const pendingOnce = [];
        const pendingRecurring = [];
        const pendingScheduled = [];

        rows.forEach((row) => {
            const data = row.toObject();
            const parsed = parseRowData(data);

            if (!parsed) return;

            const { day, month, hour, minute, subject, message, mode } = parsed;
            const time = `${hour}:${minute.toString().padStart(2, '0')}`;

            if (mode === 'once') {
                if (!data.log_last_sent_message) {
                    pendingOnce.push(`• *${subject}:* ${message} - ${day}/${month} at ${time}`);
                }
            } else if (mode === 'scheduled') {
                const interval = parsed.intervalDays   > 0 ? `every ${parsed.intervalDays} days`
                               : parsed.intervalWeeks  > 0 ? `every ${parsed.intervalWeeks} weeks`
                               : `every ${parsed.intervalMonths} months`;
                const finish = parsed.finishDate ? parsed.finishDate.toLocaleDateString('pt-BR') : 'no end date';
                pendingScheduled.push(`• *${subject}:* ${message} - ${interval}, starts ${day}/${month} at ${time}, ends ${finish}`);
            } else {
                // Store as object so we can sort by mode before formatting.
                pendingRecurring.push({ mode, subject, message, day, month, time });
            }
        });

        const sections = [];

        if (pendingOnce.length > 0) {
            sections.push(`*📅 Once (${pendingOnce.length} pending):*\n${pendingOnce.join('\n')}`);
        }

        if (pendingRecurring.length > 0) {
            const sortedRecurring = pendingRecurring
                .sort(sortByMode)
                .map(r => `• *[${r.mode}] ${r.subject}:* ${r.message} - ${r.day}/${r.month} at ${r.time}`);
            sections.push(`*🔁 Recurring (${sortedRecurring.length} active):*\n${sortedRecurring.join('\n')}`);
        }

        if (pendingScheduled.length > 0) {
            sections.push(`*📆 Scheduled (${pendingScheduled.length} active):*\n${pendingScheduled.join('\n')}`);
        }

        if (sections.length === 0) {
            return '✅ No pending or active messages.';
        }

        return sections.join('\n\n');

    } catch (e) {
        console.error('Get Pending Messages Error:', e.message);
        return '❌ Could not fetch pending messages. Check the server logs.';
    }
}

// --- SEND SCHEDULED MESSAGE ---
// Not async - cron.schedule() is synchronous and returns the task directly.
// Making this async would wrap the return in a Promise, breaking task.stop().
//
// For 'scheduled' mode rows, shouldSendToday() is evaluated inside the cron callback
// before sending. If it returns false the cron fires but exits silently — no message sent.
//
// Error handling:
//   - client.sendMessage failure: no retry (not idempotent). Notifies owner.
//   - logSentMessage failure: retried up to 3 times (idempotent write). Notifies owner if all fail.
function sendScheduledMessage(client, row, parsed, data, index, subject, message, targetNumber, cronTime) {
    const task = cron.schedule(cronTime, async () => {
        // --- SCHEDULED MODE GATE ---
        // For interval-based rows, check whether today is actually a send day
        // before applying any delay or sending anything.
        if (parsed.mode === 'scheduled') {
            // Re-read log from the row object to get the latest value at fire time.
            // row.toObject() reflects the data loaded at last sync; good enough for same-day check.
            const logLastSent = row.toObject().log_last_sent_message || '';
            if (!shouldSendToday(parsed, logLastSent)) {
                console.log(`[SKIP] "${subject}" — not a send day (scheduled mode).`);
                return;
            }
        }

        // Staggered human-like delay: only applied when multiple rows share the same time slot.
        // slotIndex 0 = first (or only) message in this minute → no stagger, sends immediately.
        // slotIndex 1+ = subsequent messages → 5s base + 1–10s random variance per position.
        const baseDelay = index * 5000;
        const randomVariance = index > 0 ? Math.floor(Math.random() * 10000) + 1000 : 0;
        const totalWait = baseDelay + randomVariance;

        console.log(`[QUEUED] "${subject}" will send in ${Math.round(totalWait / 1000)}s...`);
        await new Promise(resolve => setTimeout(resolve, totalWait));

        // --- SEND (no retry — WhatsApp is not idempotent) ---
        try {
            const formattedMessage = formatMessage(subject, message);
            await client.sendMessage(targetNumber, formattedMessage);
            console.log(`[SENT] "${subject}" to ${targetNumber}`);
        } catch (sendErr) {
            console.error(`[SEND ERROR] "${subject}":`, sendErr.message);
            await notifyOwner(
                client,
                `⚠️ *[SEND ERROR]* Failed to send scheduled message.\n*Subject:* ${subject}\n*To:* ${targetNumber}\nReason: ${sendErr.message}`
            );
            return; // Don't attempt to log a message that was never sent.
        }

        // --- LOG TO FILE (best-effort, no retry needed — local write) ---
        const dateStr = `${parsed.day.toString().padStart(2, '0')}/${parsed.month.toString().padStart(2, '0')}`;
        const hourStr = `${parsed.hour.toString().padStart(2, '0')}:${parsed.minute.toString().padStart(2, '0')}`;
        logMessageToFile({ subject, message, number: parsed.rawNumber, date: dateStr, hour: hourStr });

        // --- LOG TO SHEET (retry — idempotent cell write) ---
        try {
            const timestamp = formatTimestamp();
            await withRetry(() => logSentMessage(row, timestamp));
            console.log(`[LOGGED] "${subject}" updated in Google Sheets.`);
        } catch (logErr) {
            console.error(`[LOG ERROR] "${subject}" sent but sheet log failed:`, logErr.message);
            await notifyOwner(
                client,
                `⚠️ *[LOG ERROR]* Message sent but Google Sheets log failed.\n*Subject:* ${subject}\n*To:* ${targetNumber}\nReason: ${logErr.message}\n\nMessage was delivered — update the sheet log manually.`
            );
        }
    }, { timezone: "America/Sao_Paulo" });

    return task;
}

// --- NEW SCHEDULE: SAVE ---
// Appends the validated row to the sheet and triggers a re-sync.
// Called after the owner confirms with !confirm.
async function saveNewSchedule(client, sheetData) {
    try {
        await withRetry(() => addRowToSheet(sheetData));
        console.log(`[NEW-SCHEDULE] Row added: "${sheetData.subject}"`);
        await syncSheetToScheduler(client);
        return `✅ New schedule *"${sheetData.subject}"* added and synced.`;
    } catch (e) {
        console.error('[NEW-SCHEDULE ERROR]', e.message);
        await notifyOwner(
            client,
            `⚠️ *[NEW-SCHEDULE ERROR]* Failed to save new schedule to Google Sheets.\n*Subject:* ${sheetData.subject}\nReason: ${e.message}`
        );
        return '❌ Failed to save to Google Sheets. Check the server logs.';
    }
}

module.exports = {
    syncSheetToScheduler,
    getPendingMessages,
    archiveFinished,
    saveNewSchedule,
};
