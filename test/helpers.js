'use strict';

const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { openDb } = require('../src/db');
const { createApp } = require('../src/app');
const { createMailer } = require('../src/mailer');

const APP_URL = 'http://localhost:3999';

function testConfig(overrides = {}) {
  return {
    appUrl: APP_URL,
    publishRootDomain: 'sites.test',
    superAdmins: ['root@hitechcloud.vn'],
    sessionDays: 1,
    secureCookies: false,
    mailFrom: 'test@hitechcloud.vn',
    quietMail: true,
    uploadsDir: fs.mkdtempSync(path.join(os.tmpdir(), 'htc-uploads-')),
    ...overrides,
  };
}

async function startServer(overrides = {}) {
  const db = openDb(':memory:');
  const config = testConfig(overrides);
  config.mailer = createMailer(config);
  const server = createApp({ db, config }).listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { db, server, base, config, outbox: config.mailer.outbox };
}

// Minimal cookie-aware JSON client.
function client(base) {
  let cookie = '';
  return async function call(method, path, body, { headers = {}, raw = false } = {}) {
    const res = await fetch(base + path, {
      method,
      redirect: 'manual',
      headers: {
        Origin: APP_URL,
        ...(body !== undefined && !raw ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    const type = res.headers.get('content-type') || '';
    const data = type.includes('json') ? await res.json() : await res.text();
    return { status: res.status, data, headers: res.headers };
  };
}

// fetch() does not allow overriding Host, so use node:http for host routing.
function getWithHost(base, path, host) {
  const { port } = new URL(base);
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port, path, headers: { Host: host } }, (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (d) => (text += d));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
      })
      .on('error', reject);
  });
}

module.exports = { APP_URL, testConfig, startServer, client, getWithHost };
