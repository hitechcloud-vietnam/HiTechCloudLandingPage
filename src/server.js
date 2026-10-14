'use strict';

const config = require('./config');
const { openDb } = require('./db');
const { createApp } = require('./app');
const { createMailer } = require('./mailer');
const { startJobs } = require('./jobs');

const db = openDb(config.dbFile);

config.mailer = createMailer(config);
startJobs({ db, mailer: config.mailer, config });

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
