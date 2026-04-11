module.exports = {
    apps: [{
        name: 'whatsapp-bot',
        script: 'index.js',

        // Restart the bot automatically if it crashes
        restart_delay: 5000,   // Wait 5 seconds before restarting after a crash
        max_restarts: 10,      // Stop trying after 10 consecutive crashes

        // Give Chromium enough time to fully exit before pm2 starts the new process.
        // Without this, a manual 'pm2 restart' on a low-memory server can leave a
        // zombie Chromium instance that causes the new process to freeze on startup.
        kill_timeout: 10000,   // Wait up to 10 seconds for the process to die cleanly

        // Environment — pm2 will use the .env file via dotenv inside the app.
        // Do not put secrets here; keep them in .env on the server.
        env: {
            NODE_ENV: 'production'
        }
    }]
};
