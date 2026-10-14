'use strict';

const config = require('./config');
const { openDb } = require('./db');
const { createApp } = require('./app');
const { createMailer } = require('./mailer');
const { startJobs } = require('./jobs');
const { logger } = require('./logger');
const { createErrorReporter } = require('./errors');

// Crash reporting: log + alert (ERROR_WEBHOOK_URL). Uncaught exceptions exit after the alert.
config.errorReporter = createErrorReporter({ url: config.errorWebhookUrl, log: logger });
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { err: reason });
  config.errorReporter.report(reason, { kind: 'unhandledRejection' });
});
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception, exiting', { err });
  const exit = () => process.exit(1);
  setTimeout(exit, 5000);
  config.errorReporter.report(err, { kind: 'uncaughtException' }).finally(exit);
});

const db = openDb(config.dbFile);

config.mailer = createMailer(config);
startJobs({ db, mailer: config.mailer, config });

const server = createApp({ db, config }).listen(config.port, () => {
  logger.info(`HiTechCloud LandingPage đang chạy tại ${config.appUrl} (port ${config.port})`, { port: config.port });
});

// Graceful shutdown: stop accepting connections, finish in-flight requests, close the DB.
function shutdown(signal) {
  logger.info(`Nhận ${signal}, đang dừng…`, { signal });
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
