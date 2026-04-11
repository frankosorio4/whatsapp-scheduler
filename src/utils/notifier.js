// src/utils/notifier.js
//
// Two focused utilities:
//   - withRetry(fn, retries, delayMs): wraps any async fn with exponential backoff.
//   - notifyOwner(client, message): sends a WhatsApp DM to the owner number.

// --- WITH RETRY ---
// Retries an async function up to `retries` times with exponential backoff.
// On each failed attempt (except the last), waits delayMs * attemptNumber before retrying.
// If all attempts fail, the last error is re-thrown to the caller.
//
// Use for idempotent Sheets API calls (reads, cell writes, row appends).
// Do NOT use for client.sendMessage — WhatsApp is not idempotent.
//
// Example:
//   const { doc, sheet, rows } = await withRetry(() => getSheetAndRows());
async function withRetry(fn, retries = 3, delayMs = 2000) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            return await fn();
        } catch (err) {
            if (attempt === retries) throw err;
            const wait = delayMs * attempt;
            console.warn(`[RETRY] Attempt ${attempt}/${retries} failed: ${err.message}. Retrying in ${wait / 1000}s...`);
            await new Promise(resolve => setTimeout(resolve, wait));
        }
    }
}

// --- NOTIFY OWNER ---
// Sends a WhatsApp message to the owner number defined in OWNER_NUMBER env var.
// Fails silently if the send itself throws — owner notification must never crash the bot.
//
// Always prefix messages with an emoji + context tag so the owner immediately knows
// what system generated the alert (e.g. '⚠️ [SYNC ERROR] ...').
async function notifyOwner(client, message) {
    try {
        const ownerNumber = `${process.env.OWNER_NUMBER}@c.us`;
        await client.sendMessage(ownerNumber, message);
    } catch (err) {
        // Notification failure must never propagate — log to console only.
        console.error('[NOTIFIER ERROR] Could not send owner notification:', err.message);
    }
}

module.exports = { withRetry, notifyOwner };
