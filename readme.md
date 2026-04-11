# WhatsApp Google Sheets Scheduler Bot

A **Node.js automation server** that sends **scheduled WhatsApp messages** using **Google Sheets as a control panel**.

The bot reads message schedules from a Google Sheet and automatically sends WhatsApp messages at the specified date and time. After sending, it logs the timestamp back into the sheet.

This allows you to **manage scheduled WhatsApp messages without modifying code**, simply by editing a spreadsheet.

The bot uses:

- **whatsapp-web.js** to control WhatsApp Web
- **Google Sheets API** to store schedules
- **node-cron** to schedule message delivery
- **Service Account authentication** for secure Google API access
- **pm2** to keep the bot running 24/7 on a server

---

# Features

- Send **scheduled WhatsApp messages automatically**
- Five scheduling modes: **once, daily, weekly, monthly, scheduled (interval-based)**
- **Interval-based scheduling**: send every N days, weeks, or months from a start date
- **Add new schedules via WhatsApp** using the `!new-schedule` command — no spreadsheet access needed
- Manage everything from **Google Sheets** — no code changes needed
- **Automatic sync every 30 minutes**
- **Log messages sent back to the spreadsheet**
- **server_updated_at** cell updated on every sync
- Remote bot commands through WhatsApp (owner-only)
- Persistent WhatsApp login using **LocalAuth**
- **Human-like staggered delays** between messages to reduce spam flags
- **Archive finished rows** automatically to a "done" sheet to keep the active spreadsheet clean
- **Unit tested** with Jest — pure parsing logic covered by 89 test cases across 8 groups

---

# Project Structure

```
whatsapp-project/
├── src/
│   ├── services/
│   │   └── googleSheets.js   ← Google Sheets auth, row fetching, cell writing, addRowToSheet
│   ├── utils/
│   │   ├── parser.js         ← parseRowData(), isRowFinished(), parseNewScheduleInput() — pure, no deps
│   │   ├── formatter.js      ← formatMessage(), formatTimestamp(), getNewScheduleTemplate(), buildScheduleConfirmation() — pure
│   │   ├── logger.js         ← logMessageToFile(), getLastLogLines() — local file logger
│   │   ├── notifier.js       ← withRetry(), notifyOwner() — retry logic and owner alerts
│   │   └── messages.js       ← getHelpMessage(), getLogsMessage() — pure WhatsApp reply builders
│   └── scheduler.js          ← Core engine: sync, cron scheduling, send, archive, pending, save
├── tests/
│   ├── parser.test.js        ← Jest unit tests for parser.js (89 test cases across 8 groups)
│   ├── logger.test.js        ← Jest unit tests for logger.js (19 test cases across 2 groups)
│   └── notifier.test.js      ← Jest unit tests for notifier.js (13 test cases across 4 groups)
├── index.js                  ← Entry point — WhatsApp client, command routing, session state
├── ecosystem.config.js       ← pm2 process manager config (for server deploy)
├── creds.json                ← Google Service Account credentials (local only, gitignored)
├── .env                      ← Environment variables (gitignored)
├── .env.example              ← Template for required environment variables
└── package.json
```

---

# Prerequisites

### 1. Node.js

Download and install Node.js from https://nodejs.org

```bash
node -v
npm -v
```

### 2. Google Account

You need a Google account to create a Cloud Project, enable the Sheets API, and generate a Service Account.

### 3. WhatsApp Account

The bot connects to WhatsApp Web — you must scan a QR code with your phone the first time it runs.

---

# Installation

```bash
git clone https://github.com/YOUR_USERNAME/WhatsApp-Scheduler-Bot.git
cd WhatsApp-Scheduler-Bot
npm install
```

---

# Google Sheets API Setup

## Step 1 — Create a Google Cloud Project

Go to https://console.cloud.google.com/

1. Click **Select Project** → **New Project**
2. Give it a name and click **Create**

## Step 2 — Enable the Google Sheets API

1. Go to **APIs & Services → Library**
2. Search for **Google Sheets API**
3. Click **Enable**

## Step 3 — Create a Service Account

1. Go to **APIs & Services → Credentials**
2. Click **Create Credentials → Service Account**
3. Name it `whatsapp-bot`, click **Create and Continue**
4. Skip the permission step, click **Done**

## Step 4 — Generate Credentials JSON

1. Click the service account you created → **Keys**
2. Click **Add Key → Create New Key → JSON**
3. Download the file and rename it `creds.json`
4. Place it in your project root folder

## Step 5 — Share Your Google Sheet

Open your Google Sheet, click **Share**, and add the service account email from `creds.json`:

```
xxxxx@xxxxx.iam.gserviceaccount.com
```

Give it **Editor** permission.

---

# Google Sheet Structure

Your sheet must have the following columns:

```
# | subject | message | number | date | hour | once | daily | weekly | monthly | scheduled | interval_days | interval_weeks | interval_months | date_finish_schedule | log_last_sent_message | server_updated_at
```

Example rows:

| # | subject | message | number | date | hour | once | daily | weekly | monthly | scheduled | interval_days | interval_weeks | interval_months | date_finish_schedule | log_last_sent_message | server_updated_at |
|---|---------|---------|--------|------|------|------|-------|--------|---------|-----------|--------------|--------------|----------------|---------------------|----------------------|-------------------|
| 1 | Reminder | Hello! | 5511999999999 | 20/06/2026 | 14:30 | ☑ | ☐ | ☐ | ☐ | ☐ | | | | | | |
| 2 | Follow up | Check in! | 5511999999999 | 01/04/2026 | 09:00 | ☐ | ☐ | ☐ | ☐ | ☑ | 2 | | | | | |

### Column descriptions

**number** — WhatsApp number with country code, digits only. Example: `5511999999999`

**date** — Format `DD/MM/YYYY` for all modes. Example: `20/06/2026`

**hour** — Format `HH:MM` 24h. Example: `14:30`

**once / daily / weekly / monthly / scheduled** — Checkboxes. Only one can be selected per row (enforced by sheet data validation via Apps Script):
- **once** — sends at the exact date and time, never again
- **daily** — sends every day at the defined hour. Stops after `date_finish_schedule` if set, otherwise runs indefinitely.
- **weekly** — sends every week on the same weekday derived from the date column. Stops after `date_finish_schedule` if set, otherwise runs indefinitely.
- **monthly** — sends every month on the same day number. Stops after `date_finish_schedule` if set, otherwise runs indefinitely.
- **scheduled** — sends every N days, weeks, or months from the start date. Stops after `date_finish_schedule` if set, otherwise runs indefinitely.

**interval_days** — (scheduled mode only) Send every N days. Example: `2` = every 2 days.

**interval_weeks** — (scheduled mode only) Send every N weeks. Example: `3` = every 3 weeks.

**interval_months** — (scheduled mode only) Send every N calendar months on the same day of month. Example: `1` = every month.

> Only one interval column should be filled per row. Apps Script enforces mutual exclusivity.

**date_finish_schedule** — Last day the message can be sent. Format `DD/MM/YYYY`. Example: `20/04/2026`. Optional for all modes — if set, the bot stops scheduling the row after this date (inclusive). If left empty, the row runs indefinitely.

**log_last_sent_message** — automatically filled by the bot when a message is sent.

**server_updated_at** — updated every time the server syncs with the sheet (top row only).

---

# Archive / "done" Sheet

The bot automatically moves finished rows from the main sheet to a second tab titled **"done"** in the same spreadsheet.

**A row is considered finished when:**
- `once` mode (or fallback): its `DD/MM` date in the current year is strictly in the past.
- `daily` / `weekly` / `monthly` / `scheduled`: its `date_finish_schedule` is set and strictly in the past.

**Behaviour:**
- The "done" sheet is **created automatically** on first run — no manual setup needed.
- Headers are copied from the main sheet.
- **Deduplication**: if a row already exists in "done" (matched by `subject + number + date + hour`), it is skipped — re-running archive never creates duplicates.
- Rows are deleted from the main sheet after being copied.
- Archiving runs **silently on every `!sync`** (including the automatic 30-minute sync).
- The `!archive` command triggers archiving on demand and re-syncs the schedule afterwards.

> Recurring rows with **no** `date_finish_schedule` run forever and are never archived.

---

# Configuration

Create a `.env` file in the project root (use `.env.example` as a template):

```
SPREADSHEET_ID=your_spreadsheet_id_here
OWNER_NUMBER=5511999999999
CHROME_PATH=
```

Find your `SPREADSHEET_ID` in the Google Sheet URL:
```
https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit
```

`OWNER_NUMBER` is the WhatsApp number that receives startup confirmations and is the only number allowed to send bot commands.

`CHROME_PATH` — leave empty locally (Puppeteer uses its bundled browser). On the server set it to `/usr/bin/chromium-browser`.

---

# Running Locally

### Development (auto-restarts on file changes)

```bash
npm run dev
```

### Production

```bash
npm start
```

A QR code will appear in the terminal. Scan it with:
```
WhatsApp → Linked Devices → Link Device
```

### Running Unit Tests

```bash
npm test
```

Jest will run all tests in the `tests/` folder and report pass/fail per test case.

---

# How the Scheduler Works

```
Bot starts (or every 30 min at */30)
        │
        ▼
syncSheetToScheduler() ──► reads all rows from Google Sheet
        │
        ├── for each "once/daily/weekly/monthly" row:
        │       creates a cron job with the exact cron pattern for that mode
        │
        └── for each "scheduled" row:
                creates a daily cron job at the row's defined hour/minute
                (e.g. cron: "0 9 * * *" for 09:00)
                        │
                        ▼
                When 09:00 hits → shouldSendToday() runs
                        ├── Is today past the finish date?      → SKIP
                        ├── Was it already sent today (log)?    → SKIP
                        ├── elapsed days % interval_days === 0? → SEND
                        └── otherwise                           → SKIP silently
```

**Key points:**

- The **30-minute sync** only rebuilds cron jobs — it never sends messages directly.
- The actual send always happens at the precise **hour/minute** defined in the sheet.
- Every sync **stops all existing cron jobs** and rebuilds from scratch, then **silently archives finished rows**. Use `!sync` to force an immediate rebuild and archive. Use `!archive` to archive and re-sync on demand.
- All cron jobs use the `America/Sao_Paulo` timezone so the hours in the sheet always match Brazil local time regardless of the server's system timezone (DigitalOcean runs UTC).
- Messages are sent with a **human-like staggered delay** when multiple rows share the same send time (5s base + up to 10s random variance per slot position).
- After sending, the timestamp is written back to `log_last_sent_message` in the sheet.
- `server_updated_at` (top cell of its column) is updated on every sync.

---

# WhatsApp Commands

Commands can only be sent by the owner number defined in `.env`, except `!ping` which is open to everyone.

| Command | Description |
|---------|-------------|
| `!ping` | Health check — replies `pong`. Open to everyone. |
| `!sync` | Reloads the schedule from Google Sheets immediately. Also archives finished rows silently. |
| `!pending` | Shows pending `once` messages not yet sent, all active recurring messages, and all active `scheduled` interval rows. |
| `!archive` | Moves all finished rows to the "done" sheet and re-syncs the schedule. |
| `!logs N` | Shows the last N messages sent by the bot (e.g. `!logs 10`). Defaults to 10 if N is omitted. |
| `!new-schedule` | Starts a guided 3-step flow to add a new scheduled message via WhatsApp. |
| `!confirm` | Confirms and saves a pending new schedule after reviewing the summary. |
| `!cancel` | Cancels an in-progress `!new-schedule` session. |
| `!reset-bot` | Logs out and deletes the WhatsApp session. QR scan required on next start. |
| `!help` | Lists all available commands. Owner sees all commands; others see public commands only. |

---

# !new-schedule Flow

The `!new-schedule` command lets the owner add a new scheduled message directly from WhatsApp — no spreadsheet access needed.

**3-step flow:**

1. Send `!new-schedule` → bot replies with instructions and a blank template.
2. Fill in the template and send it back → bot validates all fields and replies with a summary.
3. Send `!confirm` to save and sync, or `!cancel` to abort.

**Field rules:**
- `subject` — optional (defaults to `no subject`)
- `message` — required
- `number` — required, digits only, include country code (e.g. `5511999999999`)
- `date` — required, format `DD/MM/YYYY` (e.g. `15/04/2026`). Day is validated against the month (e.g. `31/04` is rejected). Leap years are handled correctly.
- `hour` — required, format `HH:MM` 24h (e.g. `14:30`)
- `schedule` — required, one of: `once | daily | weekly | monthly | scheduled`
- `interval` — required only for `scheduled` mode (e.g. `3d`, `2w`, `1mo`)
- `date_finish_schedule` — optional, format `DD/MM/YYYY`. If provided, the bot stops sending after this date.

Sessions expire automatically after **10 minutes** of inactivity. If validation fails, the bot replies with a specific error and keeps the session alive so you can fix and resend.

---

### `!logs` reply format

```
📋 Last 3 sent message(s):

[03/04/2026 14:30] | Rent Reminder | 5511999999999 | 03/04 | 14:30 | Hey, just a reminder that rent is due...
[03/04/2026 15:00] | Weekly Check  | 5511888888888 | 03/04 | 15:00 | Don't forget your weekly review...
[03/04/2026 16:00] | Follow up     | 5511777777777 | 03/04 | 16:00 | Checking in on the project status...
```

---

### `!pending` reply format

```
📅 Once (1 pending):
• *Recordatorio* — 26/3 at 10:00

🔁 Recurring (2 active):
• *[monthly] Pagos:* Pagar tarjeta — 3/3 at 8:00
• *[daily] Agua:* Tomar agua — at 8:00

📆 Scheduled (1 active):
• *Follow up* - every 2 days, starts 01/04 at 09:00, ends no end date
```

---

# Deploying to DigitalOcean

## Requirements

- A DigitalOcean account
- Your repo pushed to GitHub
- Your local `creds.json` content ready to paste

---

## Step 1 — Create a Droplet

1. Go to https://digitalocean.com and sign up
2. Create a new **Project**
3. Click **Create → Droplet**:
   - **Image:** Ubuntu 22.04 LTS
   - **Size:** Basic → Regular → **$6/month** (1 vCPU, 1GB RAM)
   - **Region:** closest to you
   - **Authentication:** SSH Key (paste your `~/.ssh/id_rsa.pub`) or Password
4. Click **Create Droplet**

---

## Step 2 — Access the server

Either SSH from your terminal:
```bash
ssh root@YOUR_DROPLET_IP
```

Or use the **Access → Launch Droplet Console** button in the DigitalOcean dashboard.

---

## Step 3 — Install dependencies

```bash
apt update && apt upgrade -y
apt install -y git chromium-browser
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
npm install -g pm2
```

Verify:
```bash
node -v          # v20.x.x
chromium-browser --version
pm2 -v
```

---

## Step 4 — Add swap memory (required for 512MB droplets)

If your Droplet has 512MB RAM, Chromium won't have enough memory to start. Add a 1GB swap file:

```bash
fallocate -l 1G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

Verify:
```bash
free -m   # Swap should show 1023
```

---

## Step 5 — Clone the repo

```bash
git clone -b deploy-digital-ocean https://github.com/YOUR_USERNAME/WhatsApp-Scheduler-Bot.git
cd WhatsApp-Scheduler-Bot
npm install
```

> If your repo is private, use a Personal Access Token:
> ```bash
> git clone -b deploy-digital-ocean https://YOUR_TOKEN@github.com/YOUR_USERNAME/WhatsApp-Scheduler-Bot.git
> ```

---

## Step 6 — Create the `.env` file on the server

```bash
nano .env
```

Add the following — paste the entire content of your local `creds.json` as a single line for `GOOGLE_CREDS_JSON`:

```
SPREADSHEET_ID=your_spreadsheet_id
OWNER_NUMBER=your_whatsapp_number
GOOGLE_CREDS_JSON={"type":"service_account","project_id":"..."}
CHROME_PATH=/usr/bin/chromium-browser
```

Save with `Ctrl+O` → Enter → exit with `Ctrl+X`.

---

## Step 7 — Run once to scan the QR code

```bash
node index.js
```

A QR code will appear in the terminal. Scan it with your phone:
```
WhatsApp → Linked Devices → Link Device
```

Once you see `Bot is online!` press `Ctrl+C` — the session is saved in `.wwebjs_auth`.

---

## Step 8 — Hand over to pm2

```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

Copy and run the command that `pm2 startup` outputs. This makes the bot survive server reboots.

---

## Step 9 — Verify

```bash
pm2 logs whatsapp-bot
```

You should see:
```
Bot is online!
Startup confirmation sent to your phone.
[HH:MM:SS] Syncing Google Sheets...
Total active schedules: X
```

You can now close the console — the bot runs 24/7 on the server.

---

## Daily management commands

```bash
pm2 status                    # check if bot is running
pm2 logs whatsapp-bot         # see live logs
pm2 restart whatsapp-bot      # restart the bot
pm2 stop whatsapp-bot         # stop the bot
```

---

## Downloading the message log file

The bot writes a local log of every sent message to `logs/messages.log` on the server. To download it to your computer:

```bash
scp root@YOUR_DROPLET_IP:~/WhatsApp-Scheduler-Bot/logs/messages.log ./messages.log
```

This saves the file as `messages.log` in your current local directory. You can then open it in any text editor or spreadsheet app.

To download it into a specific folder:

```bash
scp root@YOUR_DROPLET_IP:~/WhatsApp-Scheduler-Bot/logs/messages.log ~/Downloads/messages.log
```

> The `logs/` folder and `messages.log` file are created automatically the first time a message is sent. The file is excluded from git (listed in `.gitignore`) and lives only on the server.

---

## Updating the bot from GitHub

```bash
ssh root@YOUR_DROPLET_IP
cd WhatsApp-Scheduler-Bot
git pull
pm2 restart whatsapp-bot
pm2 logs whatsapp-bot         # verify Bot is online!
```

> **Note — if you changed `.env`:** pm2 does not detect `.env` changes automatically. After editing `.env` on the server you must restart manually:
> ```bash
> nano .env
> pm2 restart whatsapp-bot
> ```

---

# Notes

- WhatsApp may temporarily block accounts that send large volumes of automated messages. The bot includes staggered delays to reduce this risk.
- Use responsibly and avoid spam.
- Phone numbers must include country codes and contain digits only.
- `creds.json` and `.env` contain sensitive credentials — never commit them to a public repository.

---

# Technologies Used

- Node.js
- whatsapp-web.js
- Puppeteer (via whatsapp-web.js)
- Google Sheets API
- node-cron
- google-auth-library
- dotenv
- pm2
- Jest (testing)
- nodemon (dev)

---

# License

This project is intended for **educational and automation purposes**.
Use responsibly and respect WhatsApp's terms of service.
