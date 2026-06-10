// src/utils/formatter.js
//
// Pure formatting helpers for WhatsApp messages and log timestamps.
// No external dependencies.

// Wraps subject in WhatsApp bold (*asterisks*) and appends the message body.
// Example: formatMessage('Pay rent', 'Transfer R$1500') → '*Pay rent:* Transfer R$1500'
function formatMessage(subject, message) {
    return `*${subject}:* ${message}`;
}

// Returns a human-readable pt-BR timestamp for use in Google Sheet logs.
// Always uses America/Sao_Paulo timezone so the logged time matches Brazil local time
// regardless of the server's system timezone (DigitalOcean runs UTC).
// Example: '26/03/2026 14:35'
function formatTimestamp(date = new Date()) {
    const datePart = date.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const timePart = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
    return `${datePart} ${timePart}`;
}

// Returns two separate strings for the !new-schedule flow.
// [0] = notes/instructions, [1] = bare fillable template the owner sends back.
function getNewScheduleTemplate() {
    const notes = (
        `📝 *Notes:*\n` +
        `• *subject* is optional (defaults to "no subject")\n` +
        `• *message* is required\n` +
        `• *number* — digits only, include country code (e.g. 5511999999999)\n` +
        `• *date* format: DD/MM/YYYY (e.g. 15/04/2026)\n` +
        `• *hour* format: HH:MM 24h (e.g. 14:30)\n` +
        `• *schedule* options: once | daily | weekly | monthly | scheduled | end_of_month\n` +
        `• *interval* — only for scheduled mode: e.g. 3d, 2w, 1mo\n` +
        `• *date_finish_schedule* — optional (DD/MM/YYYY). Required only if you want a stop date.\n\n` +
        `*Fill* in the template below *and send* that message back. *Do not change* the field names.`
    );

    const template = (
        `subject: \n` +
        `message: \n` +
        `number: \n` +
        `date: \n` +
        `hour: \n` +
        `schedule: \n` +
        `interval: \n` +
        `date_finish_schedule: `
    );

    return [notes, template];
}

// Builds a human-readable confirmation summary for the owner to review before saving.
// Called after successful parseNewScheduleInput, before writing to the sheet.
function buildScheduleConfirmation(data) {
    const modeLabel =
        data.once         === 'TRUE' ? 'once' :
        data.daily        === 'TRUE' ? 'daily' :
        data.weekly       === 'TRUE' ? 'weekly' :
        data.monthly      === 'TRUE' ? 'monthly' :
        data.scheduled    === 'TRUE' ? 'scheduled' :
        data.end_of_month === 'TRUE' ? 'end_of_month' : '—';

    let intervalLabel = '—';
    if (data.scheduled === 'TRUE') {
        if (data.interval_days)        intervalLabel = `every ${data.interval_days} day(s)`;
        else if (data.interval_weeks)  intervalLabel = `every ${data.interval_weeks} week(s)`;
        else if (data.interval_months) intervalLabel = `every ${data.interval_months} month(s)`;
    }

    return (
        `📋 *Review new schedule:*\n\n` +
        `• *Subject:* ${data.subject}\n` +
        `• *Message:* ${data.message}\n` +
        `• *Number:* ${data.number}\n` +
        `• *Date:* ${data.date}\n` +
        `• *Hour:* ${data.hour}\n` +
        `• *Schedule:* ${modeLabel}\n` +
        `• *Interval:* ${intervalLabel}\n` +
        `• *Finish date:* ${data.date_finish_schedule || '—'}\n\n` +
        `Reply *!confirm* to save or *!cancel* to abort.`
    );
}

// --- SORT BY MODE ---
// Comparator for recurring rows in getPendingMessages().
// Orders: daily → weekly → monthly. Unknown modes sort last.
const MODE_ORDER = { daily: 0, weekly: 1, monthly: 2, end_of_month: 3 };

function sortByMode(a, b) {
    return (MODE_ORDER[a.mode] ?? 99) - (MODE_ORDER[b.mode] ?? 99);
}

// --- SORT BY DATE ---
// Comparator for !pending-date. Rows must have a `nextOccurrence` field (Date object)
// pre-computed by computeNextOccurrence() in scheduler.js.
// Sorts ascending: nearest send time first.
// Rows missing nextOccurrence sort last.
function sortByDate(a, b) {
    const ta = a.nextOccurrence ? a.nextOccurrence.getTime() : Infinity;
    const tb = b.nextOccurrence ? b.nextOccurrence.getTime() : Infinity;
    return ta - tb;
}

module.exports = { formatMessage, formatTimestamp, getNewScheduleTemplate, buildScheduleConfirmation, sortByMode, sortByDate };
