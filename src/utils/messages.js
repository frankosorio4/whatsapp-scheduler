// src/utils/messages.js
//
// Pure presentation helpers for WhatsApp command replies.
// No scheduling logic or external dependencies except logger for log retrieval.

const { getLastLogLines } = require('./logger');

// --- HELP MESSAGE ---
// Returns a formatted list of available commands.
// Owner sees all commands; non-owners see only public ones.
function getHelpMessage(isOwner) {
    if (isOwner) {
        return (
            `🤖 *Available Commands*\n\n` +
            `*!ping* — Health check. Replies pong.\n` +
            `*!sync* — Re-reads Google Sheets and rebuilds all scheduled messages.\n` +
            `*!pending* — Lists unsent and active scheduled messages.\n` +
            `*!archive* — Moves finished rows to the "done" sheet and re-syncs.\n` +
            `*!logs N* — Shows the last N messages sent by the bot (e.g. !logs 10).\n` +
            `*!new-schedule* — Start a guided flow to add a new scheduled message.\n` +
            `*!confirm* — Confirm and save a pending new schedule.\n` +
            `*!cancel* — Cancel an in-progress !new-schedule session.\n` +
            `*!reset-bot* — Logs out WhatsApp, deletes session, and shuts down.\n` +
            `*!help* — Shows this help message.`
        );
    } else {
        return (
            `🤖 *Available Commands*\n\n` +
            `*!ping* — Health check. Replies pong.\n` +
            `*!help* — Shows this help message.`
        );
    }
}

// --- LOGS MESSAGE ---
// Returns the last N sent messages from logs/messages.log as a formatted WhatsApp reply.
// Called by the !logs N command in index.js.
function getLogsMessage(n) {
    const count = parseInt(n, 10);
    if (isNaN(count) || count <= 0) {
        return '❌ Invalid number. Usage: *!logs 10*';
    }

    const lines = getLastLogLines(count);

    if (lines.length === 0) {
        return '📋 No messages logged yet.';
    }

    const header = `📋 *Last ${lines.length} sent message(s):*\n\n`;
    return header + lines.join('\n');
}

module.exports = { getHelpMessage, getLogsMessage };
