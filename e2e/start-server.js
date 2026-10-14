'use strict';

// Starts the real app (src/server.js) for the Playwright suite with an isolated,
// throw-away database and uploads directory. Everything the server prints is
// also appended to E2E_LOG_FILE so specs can read emails (verification links,
// password resets) that the mailer logs to stdout when SMTP_URL is empty.
// The temp directory is removed when the process exits.

const fs = require('node:fs');
const path = require('node:path');

const dir = process.env.E2E_TMP_DIR;
const port = process.env.E2E_PORT;
if (!dir || !port) {
  console.error('E2E_TMP_DIR and E2E_PORT must be set (see e2e/playwright.config.js)');
  process.exit(1);
}
fs.mkdirSync(dir, { recursive: true });

Object.assign(process.env, {
  PORT: port,
  APP_URL: `http://localhost:${port}`,
  DB_FILE: path.join(dir, 'e2e.db'),
  UPLOADS_DIR: path.join(dir, 'uploads'),
  SUPERADMIN_EMAILS: process.env.SUPERADMIN_EMAILS || 'root@e2e.test',
  SMTP_URL: '',
});
// Never talk to real gateways, buckets or mail servers from the e2e run.
for (const key of Object.keys(process.env)) {
  if (/^(PAYOS_|PAY2S_|S3_)/.test(key)) delete process.env[key];
}

const logFile = process.env.E2E_LOG_FILE || path.join(dir, 'server.log');
fs.writeFileSync(logFile, '');
for (const stream of [process.stdout, process.stderr]) {
  const write = stream.write.bind(stream);
  stream.write = (chunk, ...args) => {
    try {
      fs.appendFileSync(logFile, chunk);
    } catch {
      // The log is best-effort; never break the server because of it.
    }
    return write(chunk, ...args);
  };
}

process.on('exit', () => {
  if (process.env.E2E_KEEP_TMP) return;
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

require('../src/server');
