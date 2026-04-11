// src/services/googleSheets.js
//
// Handles all Google Sheets interaction:
//   - Credentials loading (env var or local creds.json)
//   - JWT auth initialisation
//   - Sheet loading and row fetching
//   - Writing the log_last_sent_message column (K)
//   - Writing the server_updated_at cell (Q2)
//   - Archiving finished rows to the "done" sheet
//   - Appending a new row from the !new-schedule command

const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const { isRowFinished } = require('../utils/parser');

// --- CREDENTIALS ---
// On the server (DigitalOcean), creds.json is gitignored.
// Its contents are stored in GOOGLE_CREDS_JSON as a single-line JSON string.
// Locally, it falls back to reading creds.json from the project root.
let creds;
if (process.env.GOOGLE_CREDS_JSON) {
    try {
        creds = JSON.parse(process.env.GOOGLE_CREDS_JSON);
    } catch (e) {
        console.error('[ERROR] GOOGLE_CREDS_JSON is set but is not valid JSON. Exiting.');
        process.exit(1);
    }
} else {
    try {
        creds = require('../../creds.json');
    } catch (e) {
        console.error('[ERROR] creds.json not found and GOOGLE_CREDS_JSON is not set. Exiting.');
        process.exit(1);
    }
}

// --- STARTUP VALIDATION ---
if (!process.env.SPREADSHEET_ID) {
    console.error('[ERROR] Missing SPREADSHEET_ID in .env file. Exiting.');
    process.exit(1);
}

// --- GOOGLE AUTH ---
const serviceAccountAuth = new JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

// Loads the spreadsheet doc (without fetching rows) — used internally by functions
// that need access to the full doc object (e.g. to find or create sheets by title).
async function getDoc() {
    const doc = new GoogleSpreadsheet(process.env.SPREADSHEET_ID, serviceAccountAuth);
    await doc.loadInfo();
    return doc;
}

// Loads the spreadsheet and returns the doc, first sheet, and its rows.
async function getSheetAndRows() {
    const doc = await getDoc();
    const sheet = doc.sheetsByIndex[0];
    const rows = await sheet.getRows();
    return { doc, sheet, rows };
}

// Writes the timestamp back to a row's log_last_sent_message column (K).
// Always call await row.save() after row.set().
async function logSentMessage(row, timestamp) {
    row.set('log_last_sent_message', timestamp);
    await row.save();
}

// Writes the current sync timestamp to cell L2 only (never per-row).
async function updateServerTimestamp(sheet, timestamp) {
    await sheet.loadCells('Q2');
    const cell = sheet.getCellByA1('Q2');
    cell.value = timestamp;
    await sheet.saveUpdatedCells();
}

// --- ADD ROW TO SHEET ---
// Appends a new row to the first (main) sheet.
// sheetData must match the column layout exactly (built by parseNewScheduleInput).
// Returns the newly added row object.
async function addRowToSheet(sheetData) {
    const { sheet } = await getSheetAndRows();
    const newRow = await sheet.addRow(sheetData);
    return newRow;
}

// --- ARCHIVE FINISHED ROWS ---
// Moves finished rows from the main sheet to a "done" sheet.
// Creates the "done" sheet automatically if it doesn't exist yet.
// Deduplicates by composite key (subject|number|date|hour) so re-running
// the archive never creates duplicate entries in the "done" sheet.
// Returns the count of rows actually archived.
//
// Accepts the already-loaded `doc`, `sheet`, and `rows` from getSheetAndRows() so it
// does NOT need to call getDoc() again — avoids a second auth round-trip and
// ensures sheet.headerValues is already populated (requires getRows() first).
async function archiveFinishedRows(doc, sheet, rows) {

    // --- FIND OR CREATE "done" SHEET ---
    let doneSheet = Object.values(doc.sheetsById).find(s => s.title === 'done');
    if (!doneSheet) {
        doneSheet = await doc.addSheet({ title: 'done' });
        console.log('[ARCHIVE] Created new "done" sheet.');
    }

    // --- ENSURE HEADERS MATCH THE MAIN SHEET ---
    // sheet.headerValues is populated because getSheetAndRows() called sheet.getRows() first.
    const mainHeaders = sheet.headerValues;
    const doneRows = await doneSheet.getRows();
    if (!doneSheet.headerValues || doneSheet.headerValues.length === 0) {
        await doneSheet.setHeaderRow(mainHeaders);
        console.log('[ARCHIVE] Header row written to "done" sheet.');
    }

    // --- BUILD DUPLICATE-CHECK SET ---
    // Key: "subject|number|date|hour" — unique enough to prevent double-archiving.
    const existingKeys = new Set(
        doneRows.map(r => {
            const o = r.toObject();
            return `${o.subject}|${o.number}|${o.date}|${o.hour}`;
        })
    );

    // --- IDENTIFY FINISHED ROWS ---
    // Compute today's midnight in São Paulo for clean day-level comparisons.
    const nowStr = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const [todayDay, todayMonth, todayYear] = nowStr.split('/').map(Number);
    const todayMidnight = new Date(todayYear, todayMonth - 1, todayDay); // passed into isRowFinished()

    const toArchive = [];

    for (const row of rows) {
        const data = row.toObject();
        if (isRowFinished(data, todayMidnight)) toArchive.push(row);
    }

    if (toArchive.length === 0) {
        console.log('[ARCHIVE] No finished rows to archive.');
        return 0;
    }

    // --- APPEND NEW ROWS TO "done" SHEET (skip duplicates) ---
    let archived = 0;
    for (const row of toArchive) {
        const data = row.toObject();
        const key = `${data.subject}|${data.number}|${data.date}|${data.hour}`;

        if (existingKeys.has(key)) {
            console.log(`[ARCHIVE] Skipping duplicate: "${data.subject}"`);
            continue;
        }

        await doneSheet.addRow(data);
        existingKeys.add(key); // prevent duplicates within the same run
        console.log(`[ARCHIVE] Moved "${data.subject}" to "done" sheet.`);
        archived++;
    }

    // --- DELETE ARCHIVED ROWS FROM MAIN SHEET ---
    // Delete in reverse order so row indices don't shift during deletion.
    for (const row of [...toArchive].reverse()) {
        await row.delete();
    }

    console.log(`[ARCHIVE] Done. ${archived} row(s) archived, ${toArchive.length - archived} duplicate(s) skipped.`);
    return archived;
}

module.exports = { getSheetAndRows, logSentMessage, updateServerTimestamp, archiveFinishedRows, addRowToSheet };
