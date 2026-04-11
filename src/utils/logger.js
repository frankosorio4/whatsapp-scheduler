// src/utils/logger.js
//
// Local file logger for sent messages.
// Appends one line per sent message to logs/messages.log.
// Creates the logs/ directory automatically if it does not exist.
//
// logMessageToFile({ subject, message, number, date, hour })

const fs   = require('fs');
const path = require('path');

const LOG_DIR  = path.join(__dirname, '../../logs');
const LOG_FILE = path.join(LOG_DIR, 'messages.log');

// Truncate long messages so the log stays readable.
const MAX_MSG_LENGTH = 60;

function logMessageToFile({ subject, message, number, date, hour }) {
    try {
        if (!fs.existsSync(LOG_DIR)) {
            fs.mkdirSync(LOG_DIR, { recursive: true });
        }

        const now       = new Date();
        const timestamp = now.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
                        + ' '
                        + now.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });

        const shortMsg  = String(message).length > MAX_MSG_LENGTH
            ? String(message).substring(0, MAX_MSG_LENGTH) + '...'
            : String(message);

        const line = `[${timestamp}] | ${subject} | ${number} | ${date} | ${hour} | ${shortMsg}\n`;

        fs.appendFileSync(LOG_FILE, line, 'utf8');
    } catch (err) {
        // Logger errors must never crash the bot — log to console only.
        console.error('[LOGGER ERROR]', err.message);
    }
}

// Returns the last N lines of the log file as an array of strings.
// Returns an empty array if the file does not exist yet.
function getLastLogLines(n) {
    try {
        if (!fs.existsSync(LOG_FILE)) return [];
        const content = fs.readFileSync(LOG_FILE, 'utf8');
        const lines   = content.split('\n').filter(l => l.trim() !== '');
        return lines.slice(-n);
    } catch (err) {
        console.error('[LOGGER ERROR]', err.message);
        return [];
    }
}

module.exports = { logMessageToFile, getLastLogLines };
