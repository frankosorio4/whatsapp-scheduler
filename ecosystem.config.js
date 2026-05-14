module.exports = {
    apps: [{
        name: 'whatsapp-bot',
        script: 'index.js',
        cwd: '/root/WhatsApp-Scheduler-Bot',

        // Wait 10s before restarting after a crash — gives Chromium time to fully
        // release memory before the new process tries to launch a fresh instance.
        restart_delay: 10000,

        // Only count a crash against max_restarts if the process dies within 30s
        // of starting. A bot that ran for hours and then crashed doesn't consume
        // the counter, preventing pm2 from giving up after legitimate reconnects.
        min_uptime: '30s',

        // Stop trying after 20 consecutive rapid crashes (boot-loops).
        max_restarts: 20,

        // Give Chromium 15s to fully exit before pm2 starts the new process.
        // Without this, a zombie Chromium instance can cause the new process to
        // freeze on startup on a low-memory server.
        kill_timeout: 15000,

        // Environment — pm2 will use the .env file via dotenv inside the app.
        // Do not put secrets here; keep them in .env on the server.
        env: {
            NODE_ENV: 'production'
        }
    }]
};
