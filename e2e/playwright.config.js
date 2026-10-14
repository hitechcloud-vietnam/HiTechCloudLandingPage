'use strict';

// Browser end-to-end tests. Run with `npm run e2e`.
// The app is started by e2e/start-server.js on a free port with a temporary
// SQLite database and uploads directory (removed when the run ends).

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { defineConfig, devices } = require('@playwright/test');

const ROOT = path.join(__dirname, '..');

// This file is evaluated by the runner and again by every worker; workers
// inherit the runner's environment, so the port and temp dir are chosen once.
if (!process.env.E2E_PORT) {
  process.env.E2E_PORT = execFileSync(
    process.execPath,
    ['-e', "const s=require('net').createServer().listen(0,'127.0.0.1',()=>{process.stdout.write(String(s.address().port));s.close()})"],
    { encoding: 'utf8' }
  ).trim();
}
if (!process.env.E2E_TMP_DIR) process.env.E2E_TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'htc-e2e-'));
if (!process.env.E2E_LOG_FILE) process.env.E2E_LOG_FILE = path.join(__dirname, 'server.log');

const baseURL = `http://localhost:${process.env.E2E_PORT}`;
const CI = !!process.env.CI;

module.exports = defineConfig({
  testDir: __dirname,
  testMatch: '*.spec.js',
  outputDir: path.join(ROOT, 'test-results'),
  timeout: 60_000,
  expect: { timeout: 10_000 },
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  workers: CI ? 2 : undefined,
  reporter: [[CI ? 'github' : 'list'], ['html', { outputFolder: path.join(ROOT, 'playwright-report'), open: 'never' }]],
  use: {
    baseURL,
    locale: 'vi-VN',
    timezoneId: 'Asia/Ho_Chi_Minh',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop-chrome', use: { ...devices['Desktop Chrome'] } },
    // Core flows on a phone-sized viewport (tests tagged @mobile).
    { name: 'mobile-chrome', use: { ...devices['Pixel 5'] }, grep: /@mobile/ },
  ],
  webServer: {
    command: 'node --disable-warning=ExperimentalWarning e2e/start-server.js',
    cwd: ROOT,
    url: `${baseURL}/healthz`,
    reuseExistingServer: false,
    timeout: 30_000,
    stdout: 'ignore',
    stderr: 'pipe',
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
    env: {
      E2E_PORT: process.env.E2E_PORT,
      E2E_TMP_DIR: process.env.E2E_TMP_DIR,
      E2E_LOG_FILE: process.env.E2E_LOG_FILE,
      SUPERADMIN_EMAILS: 'root@e2e.test',
    },
  },
});
