'use strict';

const config = require('./config');
const { openDb } = require('./db');
const { createApp } = require('./app');

const db = openDb(config.dbFile);

// Periodically purge expired sessions.
setInterval(() => {
  db.prepare("DELETE FROM sessions WHERE expires_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now')").run();
}, 3600_000).unref();

createApp({ db, config }).listen(config.port, () => {
  console.log(`HiTechCloud LandingPage đang chạy tại ${config.appUrl} (port ${config.port})`);
});
