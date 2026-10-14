'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { startServer, client, verifyEmail } = require('./helpers');
const config = require('../src/config');
const { createLogger, logger, redact } = require('../src/logger');
const { createErrorReporter } = require('../src/errors');

const APP_HOST = 'localhost:3999';
const TOKEN = 'metrics-test-token-123';

// Raw GET with a custom Host header (fetch() cannot override Host).
function get(base, path, { host = APP_HOST, headers = {} } = {}) {
  const { port } = new URL(base);
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port, path, headers: { Host: host, ...headers } }, (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (d) => (text += d));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
      })
      .on('error', reject);
  });
}

function captureLogger(level = 'debug') {
  const lines = [];
  const log = createLogger({ level, format: 'json', stream: { write: (s) => lines.push(JSON.parse(s)) } });
  return { log, lines };
}

const settle = () => new Promise((r) => setTimeout(r, 20));

test('logs are silent under the test runner by default', () => {
  assert.equal(config.logLevel, 'silent');
  assert.equal(logger.level, 'silent');
  assert.equal(logger.isLevelEnabled('error'), false);
});

test('redaction of sensitive keys and inline credentials', () => {
  const out = redact({
    email: 'a@b.vn',
    password: 'matkhau123',
    password_hash: 'x',
    nested: { apiKey: 'k1', checksumKey: 'k2', Authorization: 'Bearer abc', list: [{ token: 't' }] },
    m2signature: 'sig',
    cookie: 'htc_session=abc',
    secretKey: 's',
    smtp: 'smtps://user:pass@smtp.example.com:465',
    note: 'header Bearer abc.def',
  });
  assert.equal(out.email, 'a@b.vn');
  for (const v of [out.password, out.password_hash, out.nested.apiKey, out.nested.checksumKey, out.nested.Authorization, out.nested.list[0].token, out.m2signature, out.cookie, out.secretKey]) {
    assert.equal(v, '[REDACTED]');
  }
  assert.equal(out.smtp, 'smtps://[REDACTED]@smtp.example.com:465');
  assert.equal(out.note, 'header Bearer [REDACTED]');

  const { log, lines } = captureLogger();
  log.child({ component: 'x' }).warn('hello', { token: 'abc', err: new Error('boom') });
  assert.equal(lines.length, 1);
  assert.equal(lines[0].level, 'warn');
  assert.equal(lines[0].component, 'x');
  assert.equal(lines[0].token, '[REDACTED]');
  assert.equal(lines[0].err.message, 'boom');
  assert.match(lines[0].err.stack, /boom/);

  const quiet = captureLogger('warn');
  quiet.log.info('skip me');
  assert.equal(quiet.lines.length, 0);
});

test('request id and access log', async (t) => {
  const { log, lines } = captureLogger();
  const { server, base } = await startServer({ logger: log });
  t.after(() => server.close());

  await t.test('generated when missing or malformed, echoed when well-formed', async () => {
    const a = await fetch(`${base}/healthz`);
    assert.match(a.headers.get('x-request-id'), /^[0-9a-f-]{36}$/);
    const b = await fetch(`${base}/healthz`, { headers: { 'X-Request-Id': 'trace-abc-12345' } });
    assert.equal(b.headers.get('x-request-id'), 'trace-abc-12345');
    const c = await fetch(`${base}/healthz`, { headers: { 'X-Request-Id': 'bad id <script>' } });
    assert.match(c.headers.get('x-request-id'), /^[0-9a-f-]{36}$/);
  });

  await t.test('access log has no query string or path tokens', async () => {
    lines.length = 0;
    const secret = 'Zq3' + 'x'.repeat(40);
    const r = await fetch(`${base}/api/invitations/${secret}?token=supersecret&email=a@b.vn`, { headers: { 'X-Request-Id': 'req-invite-0001' } });
    await r.text();
    await settle();
    const entry = lines.find((l) => l.msg === 'request' && l.reqId === 'req-invite-0001');
    assert.ok(entry, 'access log written');
    assert.equal(entry.method, 'GET');
    assert.equal(entry.route, '/api/invitations/:token');
    assert.equal(entry.path, '/api/invitations/:redacted');
    assert.equal(typeof entry.durationMs, 'number');
    assert.equal(entry.status, r.status);
    const raw = JSON.stringify(lines);
    assert.ok(!raw.includes('supersecret'));
    assert.ok(!raw.includes(secret));
  });

  await t.test('user id is logged, health checks only at debug', async () => {
    lines.length = 0;
    const c = client(base);
    await c('POST', '/api/auth/signup', { name: 'Log', email: 'log@example.com', password: 'matkhau123' });
    await c('GET', '/api/auth/me', undefined, { headers: { 'X-Request-Id': 'req-me-000001' } });
    await fetch(`${base}/healthz`, { headers: { 'X-Request-Id': 'req-health-01' } });
    await settle();
    const me = lines.find((l) => l.reqId === 'req-me-000001' && l.msg === 'request');
    assert.equal(me.level, 'info');
    assert.ok(Number.isInteger(me.userId));
    assert.ok(!JSON.stringify(lines).includes('matkhau123'));
    assert.equal(lines.find((l) => l.reqId === 'req-health-01').level, 'debug');
  });
});

test('/metrics is disabled without METRICS_TOKEN', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());
  const r = await get(base, '/metrics', { headers: { Authorization: `Bearer ${TOKEN}` } });
  assert.equal(r.status, 404);
  assert.ok(!r.text.includes('http_requests_total'));
});

test('/metrics with token', async (t) => {
  const { server, base, db } = await startServer({ metricsToken: TOKEN, publishRootDomain: 'sites.test' });
  t.after(() => server.close());

  const c = client(base);
  await c('POST', '/api/auth/signup', { name: 'Chủ', email: 'metrics@example.com', password: 'matkhau123' });
  verifyEmail(db, 'metrics@example.com');
  const wsId = (await c('GET', '/api/auth/me')).data.workspaces[0].id;
  const site = (await c('POST', `/api/workspaces/${wsId}/sites`, { name: 'Shop', subdomain: 'shop' })).data;
  const page = (await c('GET', `/api/sites/${site.id}/pages`)).data[0];
  await c('POST', `/api/pages/${page.id}/publish`, {});
  db.prepare("UPDATE workspaces SET plan = 'pro' WHERE id = ?").run(wsId);
  db.prepare('INSERT INTO leads (site_id, page_slug, data_json) VALUES (?, ?, ?)').run(site.id, 'index', '{}');

  await t.test('401 without or with a wrong token', async () => {
    const none = await get(base, '/metrics');
    assert.equal(none.status, 401);
    assert.match(none.headers['www-authenticate'], /Bearer/);
    const wrong = await get(base, '/metrics', { headers: { Authorization: 'Bearer nope' } });
    assert.equal(wrong.status, 401);
  });

  await t.test('200 with token: route patterns, runtime and business metrics', async () => {
    const r = await get(base, '/metrics', { headers: { Authorization: `Bearer ${TOKEN}` } });
    assert.equal(r.status, 200);
    assert.match(r.headers['content-type'], /^text\/plain/);
    const text = r.text;
    for (const name of [
      'http_requests_total',
      'http_request_duration_seconds_bucket',
      'http_request_duration_seconds_count',
      'process_uptime_seconds',
      'process_resident_memory_bytes',
      'nodejs_heap_used_bytes',
      'nodejs_eventloop_lag_seconds',
      'hitechcloud_users',
      'hitechcloud_workspaces',
      'hitechcloud_workspaces_paid',
      'hitechcloud_sites',
      'hitechcloud_pages_published',
      'hitechcloud_leads_today',
    ]) {
      assert.ok(text.includes(`# TYPE ${name.replace(/_(bucket|count)$/, '')} `), `missing ${name}`);
    }
    assert.match(text, /http_requests_total\{method="GET",route="\/api\/sites\/:\w+\/pages",status_class="2xx"\} 1/);
    assert.match(text, /http_requests_total\{method="POST",route="\/api\/pages\/:\w+\/publish",status_class="2xx"\} 1/);
    assert.ok(!new RegExp(`route="[^"]*/${site.id}[/"]`).test(text), 'raw ids must not be labels');
    assert.match(text, /hitechcloud_users 1\n/);
    assert.match(text, /hitechcloud_workspaces_paid\{plan="pro"\} 1\n/);
    assert.match(text, /hitechcloud_pages_published 1\n/);
    assert.match(text, /hitechcloud_leads_today 1\n/);
  });

  await t.test('never served on customer hosts', async () => {
    const r = await get(base, '/metrics', { host: 'shop.sites.test', headers: { Authorization: `Bearer ${TOKEN}` } });
    assert.notEqual(r.status, 200);
    assert.ok(!r.text.includes('http_requests_total'));
  });
});

test('/readyz and 5xx error reporting', async (t) => {
  const sent = [];
  const errorReporter = createErrorReporter({ url: 'https://hooks.example.test/x', transport: async (body) => (sent.push(JSON.parse(body)), 200) });
  const { log, lines } = captureLogger('error');
  const { server, base, db } = await startServer({ errorReporter, logger: log });
  t.after(() => server.close());

  assert.deepEqual(await (await fetch(`${base}/readyz`)).json(), { ok: true });

  const c = client(base);
  await c('POST', '/api/auth/signup', { name: 'Err', email: 'err@example.com', password: 'matkhau123' });
  db.close(); // every DB access now throws

  const ready = await fetch(`${base}/readyz`);
  assert.equal(ready.status, 503);

  const r = await c('GET', '/api/auth/me', undefined, { headers: { 'X-Request-Id': 'req-crash-0001' } });
  assert.equal(r.status, 500);
  assert.deepEqual(r.data, { error: 'Lỗi máy chủ', requestId: 'req-crash-0001' });
  await c('GET', '/api/auth/me');
  await settle();

  const logged = lines.find((l) => l.msg === 'Request failed');
  assert.equal(logged.reqId, 'req-crash-0001');
  assert.ok(logged.err.stack);
  assert.equal(sent.length, 1, 'same error throttled to one alert');
  assert.equal(sent[0].kind, 'http_5xx');
  assert.equal(sent[0].requestId, 'req-crash-0001');
  assert.equal(sent[0].text, sent[0].content);
});

test('error webhook throttling per fingerprint', async () => {
  let now = 1_000_000;
  const sent = [];
  const reporter = createErrorReporter({
    url: 'https://hooks.example.test/x',
    now: () => now,
    log: createLogger({ level: 'silent' }),
    transport: async (body) => {
      sent.push(JSON.parse(body));
      return 204;
    },
  });
  const boom = (id = 123) => new Error(`Order ${id} failed`);
  assert.equal(await reporter.report(boom(), { kind: 'test' }), true);
  assert.equal(await reporter.report(boom(), { kind: 'test' }), false); // same fingerprint
  assert.equal(await reporter.report(boom(456), {}), false); // ids normalised, same throw site
  assert.equal(await reporter.report(new TypeError('other'), {}), true); // different fingerprint
  now += 61_000;
  assert.equal(await reporter.report(boom(), {}), true);
  assert.equal(sent.length, 3);
  assert.match(sent[2].text, /2 repeats suppressed/);

  // A failing transport never throws.
  const broken = createErrorReporter({ url: 'https://x.test', log: createLogger({ level: 'silent' }), transport: async () => {
    throw new Error('network down');
  } });
  assert.equal(await broken.report(new Error('x')), false);

  // Disabled without a URL, and with a non-https URL.
  assert.equal(await createErrorReporter({ url: '' }).report(new Error('x')), false);
  assert.equal(createErrorReporter({ url: 'http://insecure.test', log: createLogger({ level: 'silent' }) }).enabled, false);
});
