'use strict';

const config = require('./config');
const { openDb } = require('./db');
const { createApp } = require('./app');

const db = openDb(config.dbFile);

// Periodically purge expired sessions.
setInterval(() => {
  db.prepare("DELETE FROM sessions WHERE expires_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now')").run();
}, 3600_000).unref();

const server = createApp({ db, config }).listen(config.port, () => {
  console.log(`HiTechCloud LandingPage đang chạy tại ${config.appUrl} (port ${config.port})`);
});

// Graceful shutdown: stop accepting connections, finish in-flight requests, close the DB.
function shutdown(signal) {
  console.log(`Nhận ${signal}, đang dừng…`);
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
