require('dotenv').config(); // Must be first - loads .env before any other module reads process.env

//console.log('[DEBUG] 1. dotenv loaded');

const { Client, LocalAuth } = require('whatsapp-web.js');
//console.log('[DEBUG] 2. whatsapp-web.js loaded');

const qrcode = require('qrcode-terminal');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
//console.log('[DEBUG] 3. core modules loaded');

const {
    syncSheetToScheduler,
    getPendingMessages,
    getPendingMessagesByDate,
    archiveFinished,
    saveNewSchedule,
} = require('./src/scheduler');
const { getNewScheduleTemplate, buildScheduleConfirmation } = require('./src/utils/formatter');
const { getHelpMessage, getLogsMessage } = require('./src/utils/messages');
const { parseNewScheduleInput } = require('./src/utils/parser');
//console.log('[DEBUG] 4. scheduler loaded');

// --- STARTUP VALIDATION ---
if (!process.env.OWNER_NUMBER) {
    console.error('[ERROR] Missing OWNER_NUMBER in .env file. Exiting.');
    process.exit(1);
}
//console.log('[DEBUG] 5. env vars OK');

// --- NEW SCHEDULE SESSION STATE ---
// Tracks owner conversations in progress for the !new-schedule flow.
// Key: sender number string. Value: { step, parsedData, timer }.
//   step: 'awaiting_fill' | 'awaiting_confirm'
//   parsedData: the validated sheetData object (only set when step === 'awaiting_confirm')
//   timer: setTimeout handle — clears the session after 10 minutes of inactivity
const SESSION_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const newScheduleSessions = new Map();

function clearSession(senderNumber) {
    const session = newScheduleSessions.get(senderNumber);
    if (session && session.timer) clearTimeout(session.timer);
    newScheduleSessions.delete(senderNumber);
}

function setSession(senderNumber, step, parsedData = null) {
    // Clear any existing timer before overwriting
    clearSession(senderNumber);
    const timer = setTimeout(() => {
        newScheduleSessions.delete(senderNumber);
        console.log(`[NEW-SCHEDULE] Session expired for ${senderNumber}`);
    }, SESSION_TIMEOUT_MS);
    newScheduleSessions.set(senderNumber, { step, parsedData, timer });
}

// --- WHATSAPP CLIENT ---
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        executablePath: process.env.CHROME_PATH || undefined,
        protocolTimeout: 180000,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-extensions',
            '--disable-software-rasterizer',
            '--no-first-run',
            '--disable-background-networking',
            '--disable-sync',
            '--mute-audio',
        ]
    }
});
//console.log('[DEBUG] 6. client created, calling initialize...');

// --- WHATSAPP EVENTS ---
client.on('qr', qr => {
    qrcode.generate(qr, { small: true });
    console.log('Scan the QR code above to login.');
});

client.on('ready', async () => {
    console.log('Bot is online!');
    const ownerNumber = `${process.env.OWNER_NUMBER}@c.us`;

    // Log the authenticated phone number for debugging
    const myInfo = client.info.me;
    console.log(`[DEBUG] Authenticated as: ${myInfo?.user || 'unknown'}`);

    try {
        await client.sendMessage(ownerNumber, 'Bot restarted and Google Sheets scheduler active.');
        console.log('Startup confirmation sent to your phone.');
    } catch (e) {
        console.log('Startup msg failed:', e.message);
    }

    await syncSheetToScheduler(client);

    cron.schedule('*/30 * * * *', async () => {
        await syncSheetToScheduler(client);
    });
});

// --- RECONNECTION HANDLING ---
// When the WhatsApp session drops or auth fails, exit cleanly so pm2 restarts
// the process with a fresh Chromium instance. The LocalAuth session on disk
// means no QR scan is needed on reconnect (unless WhatsApp invalidated the session).
client.on('disconnected', (reason) => {
    console.error('[DISCONNECTED] WhatsApp client disconnected:', reason);
    console.log('[DISCONNECTED] Exiting so pm2 can restart with a fresh session...');
    process.exit(1);
});

client.on('auth_failure', (msg) => {
    console.error('[AUTH FAILURE] WhatsApp authentication failed:', msg);
    process.exit(1);
});

// --- COMMAND ROUTING ---
client.on('message', async (msg) => {
    // Log full message object for debugging
    console.log(`[MSG] from=${msg.from} author=${msg.author} body=${msg.body}`);

    // Resolve sender phone number.
    // When using WhatsApp Web or linked devices, msg.from may be a @lid (device ID)
    // like "173980568793106@lid" instead of the real phone number "554888572036@c.us".
    // In that case, getContactById() resolves the device ID to the actual phone number.
    let senderNumber = msg.from.replace('@c.us', '').replace('@lid', '');
    if (msg.from.endsWith('@lid')) {
        try {
            const contact = await client.getContactById(msg.from);
            if (contact?.number) senderNumber = contact.number;
        } catch (e) {
            console.log(`[MSG] Could not resolve @lid to phone number: ${e.message}`);
        }
    }

    const authorNumber = msg.author ? msg.author.replace('@c.us', '').replace('@lid', '') : '';
    const isOwner = senderNumber === process.env.OWNER_NUMBER || authorNumber === process.env.OWNER_NUMBER;
    console.log(`[MSG] sender=${senderNumber} author=${authorNumber} owner=${process.env.OWNER_NUMBER} isOwner=${isOwner}`);

    if (msg.body.toLowerCase() === '!ping') {
        await msg.reply('pong');

    } else if (msg.body === '!sync') {
        if (!isOwner) return;
        await syncSheetToScheduler(client);
        await msg.reply('Schedule synchronized with Google Sheets!');

    } else if (msg.body === '!pending') {
        if (!isOwner) return;
        // Ensure the in-memory schedule is up-to-date before listing pending messages
        await syncSheetToScheduler(client);
        const reply = await getPendingMessages();
        await msg.reply(reply);

    } else if (msg.body === '!pending-date') {
        if (!isOwner) return;
        await syncSheetToScheduler(client);
        const reply = await getPendingMessagesByDate();
        await msg.reply(reply);

    } else if (msg.body === '!archive') {
        if (!isOwner) return;
        const reply = await archiveFinished(client);
        await msg.reply(reply);

    } else if (msg.body.startsWith('!logs')) {
        if (!isOwner) return;
        const parts = msg.body.trim().split(/\s+/);
        const n = Math.max(1, Math.min(parseInt(parts[1], 10) || 10, 100)); // clamp between 1 and 100
        const reply = getLogsMessage(n);
        await msg.reply(reply);

    } else if (msg.body === '!help') {
        const reply = getHelpMessage(isOwner);
        await msg.reply(reply);

    } else if (msg.body === '!reset-bot') {
        if (!isOwner) return;
        try {
            await msg.reply('Resetting session and shutting down...');
            await client.logout();
            const authDir = path.join(__dirname, '.wwebjs_auth');
            if (fs.existsSync(authDir)) {
                fs.rmSync(authDir, { recursive: true, force: true });
            }
            process.exit(0);
        } catch (error) {
            console.error('Reset error:', error.message);
        }

    // --- !new-schedule: step 1 — send notes then bare template as separate messages ---
    // [0] = notes + prompt, [1] = fillable template the owner sends back
    } else if (msg.body === '!new-schedule') {
        if (!isOwner) return;
        setSession(senderNumber, 'awaiting_fill');
        const [notes, template] = getNewScheduleTemplate();
        await client.sendMessage(msg.from, notes);
        await client.sendMessage(msg.from, template);

    // --- !cancel: abort any active new-schedule session ---
    } else if (msg.body === '!cancel') {
        if (!isOwner) return;
        if (newScheduleSessions.has(senderNumber)) {
            clearSession(senderNumber);
            await msg.reply('❌ New schedule cancelled.');
        }

    // --- !confirm: step 3 — save to sheet ---
    } else if (msg.body === '!confirm') {
        if (!isOwner) return;
        const session = newScheduleSessions.get(senderNumber);
        if (!session || session.step !== 'awaiting_confirm') {
            await msg.reply('ℹ️ Nothing to confirm. Use *!new-schedule* to start.');
            return;
        }
        clearSession(senderNumber);
        const reply = await saveNewSchedule(client, session.parsedData);
        await msg.reply(reply);

    // --- new-schedule: step 2 — parse filled template ---
    } else if (isOwner && newScheduleSessions.has(senderNumber)) {
        const session = newScheduleSessions.get(senderNumber);

        if (session.step === 'awaiting_fill') {
            const result = parseNewScheduleInput(msg.body);

            if (!result.ok) {
                // Validation failed — keep session alive, let owner fix and resend
                await msg.reply(
                    `${result.error}\n\nFix the field and send the full template again, or *!cancel* to abort.`
                );
                return;
            }

            // Parsed OK — move to confirmation step
            setSession(senderNumber, 'awaiting_confirm', result.data);
            await msg.reply(buildScheduleConfirmation(result.data));
        }
    }
});

// Catch initialization failures (e.g. Chromium protocolTimeout during inject).
// Without this, a failed initialize() leaves the process running as a zombie —
// the client object exists but the page is dead, causing detached Frame errors.
client.initialize().catch((err) => {
    console.error('[INIT ERROR] client.initialize() failed:', err.message);
    console.log('[INIT ERROR] Exiting so pm2 can restart...');
    process.exit(1);
});
