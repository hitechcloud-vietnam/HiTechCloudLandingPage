'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { openDb } = require('../src/db');
const { startServer, client, verifyEmail } = require('./helpers');

const tokenFrom = (mail) => mail.text.match(/token=([\w-]+)/)[1];
const signup = (c, email, extra = {}) => c('POST', '/api/auth/signup', { name: 'Người dùng', email, password: 'matkhau123', ...extra });

test('email verification: single-use token, expiry, resend limit, soft enforcement', async (t) => {
  const { server, base, db, outbox } = await startServer();
  t.after(() => server.close());

  const c = client(base);
  assert.equal((await signup(c, 'owner@example.com')).status, 201);
  const mail = outbox.at(-1);
  assert.equal(mail.to, 'owner@example.com');
  assert.match(mail.text, /\/api\/auth\/verify\?token=/);
  const firstToken = tokenFrom(mail);
  const me = (await c('GET', '/api/auth/me')).data;
  assert.equal(me.user.emailVerified, false);
  const wsId = me.workspaces[0].id;
  const site = (await c('POST', `/api/workspaces/${wsId}/sites`, { name: 'Shop', subdomain: 'shop', template: 'blank' })).data;
  const page = (await c('GET', `/api/sites/${site.id}/pages`)).data[0];

  await t.test('publish and checkout are blocked until verified', async () => {
    // The rest of the app stays usable.
    assert.equal((await c('PUT', `/api/pages/${page.id}/project`, { project: {}, html: '<h1>Chào</h1>', css: '' })).status, 200);
    const pub = await c('POST', `/api/pages/${page.id}/publish`, {});
    assert.equal(pub.status, 403);
    assert.match(pub.data.error, /xác minh email/);
    const pay = await c('POST', `/api/workspaces/${wsId}/checkout`, { plan: 'pro', months: 1, provider: 'payos' });
    assert.equal(pay.status, 403);
    assert.match(pay.data.error, /xác minh email/);
  });

  let latestToken;
  await t.test('resend issues a new token, revokes the old one and is rate limited', async () => {
    const anon = client(base);
    assert.equal((await anon('POST', '/api/auth/resend-verification', {})).status, 401);
    for (let i = 0; i < 3; i++) {
      assert.equal((await c('POST', '/api/auth/resend-verification', {})).status, 200);
    }
    latestToken = tokenFrom(outbox.at(-1));
    assert.notEqual(latestToken, firstToken);
    assert.equal((await c('POST', '/api/auth/resend-verification', {})).status, 429);

    const old = await anon('GET', `/api/auth/verify?token=${firstToken}`);
    assert.equal(old.status, 302);
    assert.equal(old.headers.get('location'), '/app/?verified=0');
    assert.equal((await c('GET', '/api/auth/me')).data.user.emailVerified, false);
  });

  await t.test('verification link is a plain GET and single-use', async () => {
    const anon = client(base);
    const res = await anon('GET', `/api/auth/verify?token=${latestToken}`);
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/app/?verified=1');
    assert.equal((await c('GET', '/api/auth/me')).data.user.emailVerified, true);
    assert.equal((await anon('GET', `/api/auth/verify?token=${latestToken}`)).headers.get('location'), '/app/?verified=0');
    assert.equal((await anon('GET', '/api/auth/verify')).headers.get('location'), '/app/?verified=0');
  });

  await t.test('verified users can publish and reach the payment step', async () => {
    assert.equal((await c('POST', `/api/pages/${page.id}/publish`, {})).status, 200);
    // No gateway configured in this server: the request gets past the email check.
    assert.equal((await c('POST', `/api/workspaces/${wsId}/checkout`, { plan: 'pro', months: 1, provider: 'payos' })).status, 400);
    assert.equal((await c('POST', '/api/auth/resend-verification', {})).status, 400);
  });

  await t.test('expired tokens are rejected', async () => {
    const u = client(base);
    await signup(u, 'late@example.com');
    const token = tokenFrom(outbox.at(-1));
    db.prepare("UPDATE email_verifications SET expires_at = '2000-01-01T00:00:00.000Z'").run();
    assert.equal((await u('GET', `/api/auth/verify?token=${token}`)).headers.get('location'), '/app/?verified=0');
    assert.equal((await u('GET', '/api/auth/me')).data.user.emailVerified, false);
  });
});

test('accepting an invitation verifies the email', async (t) => {
  const { server, base, db, outbox } = await startServer();
  t.after(() => server.close());

  const owner = client(base);
  await signup(owner, 'owner@example.com');
  verifyEmail(db, 'owner@example.com');
  const wsId = (await owner('GET', '/api/auth/me')).data.workspaces[0].id;
  db.prepare("UPDATE workspaces SET plan = 'pro' WHERE id = ?").run(wsId);

  await t.test('signup with an invitation token', async () => {
    await owner('POST', `/api/workspaces/${wsId}/members`, { email: 'new@example.com' });
    const token = tokenFrom(outbox.at(-1));
    const before = outbox.length;
    const invitee = client(base);
    assert.equal((await signup(invitee, 'new@example.com', { inviteToken: token })).status, 201);
    assert.equal((await invitee('GET', '/api/auth/me')).data.user.emailVerified, true);
    // Only the welcome email: no verification email needed.
    assert.deepEqual(outbox.slice(before).map((m) => m.subject), ['Chào mừng bạn đến với HiTechCloud LandingPage']);
  });

  await t.test('logged-in user accepting an invitation', async () => {
    await owner('POST', `/api/workspaces/${wsId}/members`, { email: 'later@example.com' });
    const token = tokenFrom(outbox.at(-1));
    const u = client(base);
    await signup(u, 'later@example.com');
    assert.equal((await u('GET', '/api/auth/me')).data.user.emailVerified, false);
    assert.equal((await u('POST', '/api/invitations/accept', { token })).status, 200);
    assert.equal((await u('GET', '/api/auth/me')).data.user.emailVerified, true);
  });
});

test('existing users are treated as verified after the migration', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'htc-migrate-'));
  const file = path.join(dir, 'old.db');
  const legacy = new DatabaseSync(file);
  legacy.exec(`CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
    password_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  legacy.prepare("INSERT INTO users (email, name, password_hash, created_at) VALUES ('old@example.com', 'Cũ', 'x', '2025-01-02 03:04:05')").run();
  legacy.close();

  const db = openDb(file);
  const row = db.prepare('SELECT email_verified_at FROM users WHERE email = ?').get('old@example.com');
  assert.equal(row.email_verified_at, '2025-01-02 03:04:05');
  db.prepare("INSERT INTO users (email, name, password_hash) VALUES ('new@example.com', 'Mới', 'x')").run();
  assert.equal(db.prepare('SELECT email_verified_at FROM users WHERE email = ?').get('new@example.com').email_verified_at, null);
  db.close();
  // Re-opening must not re-run the backfill.
  const again = openDb(file);
  assert.equal(again.prepare('SELECT email_verified_at FROM users WHERE email = ?').get('new@example.com').email_verified_at, null);
  again.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('personal data export', async (t) => {
  const { server, base, db } = await startServer();
  t.after(() => server.close());

  const owner = client(base);
  await signup(owner, 'owner@example.com');
  verifyEmail(db, 'owner@example.com');
  const wsId = (await owner('GET', '/api/auth/me')).data.workspaces[0].id;
  db.prepare("UPDATE workspaces SET plan = 'pro' WHERE id = ?").run(wsId);
  const site = (await owner('POST', `/api/workspaces/${wsId}/sites`, { name: 'Shop', subdomain: 'shop', template: 'blank' })).data;
  const page = (await owner('GET', `/api/sites/${site.id}/pages`)).data[0];
  await owner('PUT', `/api/pages/${page.id}/project`, { project: {}, html: '<h1>Trang của tôi</h1>', css: '' });
  await owner('POST', `/api/pages/${page.id}/publish`, {});
  db.prepare("INSERT INTO leads (site_id, page_slug, data_json, ip) VALUES (?, 'index', ?, '203.0.113.5')").run(site.id, JSON.stringify({ phone: '0909123456' }));
  db.prepare("INSERT INTO orders (workspace_id, user_id, plan, months, amount, provider, order_code, provider_ref, checkout_url) VALUES (?, 1, 'pro', 1, 199000, 'payos', 'ORD1', 'secret-ref', 'https://pay.test/x')").run(wsId);
  db.prepare('UPDATE sites SET domain_token = ?, settings_json = ? WHERE id = ?').run(
    'domain-token-secret',
    JSON.stringify({ telegramBotToken: '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefgh' }),
    site.id
  );

  // A second user who is only an editor in the owner's workspace.
  const editor = client(base);
  await signup(editor, 'editor@example.com');
  await owner('POST', `/api/workspaces/${wsId}/members`, { email: 'editor@example.com' });

  await t.test('owner export contains their content and no secrets', async () => {
    const res = await owner('GET', '/api/auth/export');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-disposition'), /^attachment; filename="hitechcloud-du-lieu-ca-nhan-.*\.json"$/);
    const data = res.data;
    assert.equal(data.user.email, 'owner@example.com');
    assert.deepEqual(data.memberships.map((m) => [m.workspaceId, m.role]), [[wsId, 'owner']]);
    const ws = data.ownedWorkspaces[0];
    assert.equal(ws.id, wsId);
    assert.equal(ws.sites[0].subdomain, 'shop');
    assert.equal(ws.sites[0].pages[0].draft_html, '<h1>Trang của tôi</h1>');
    assert.equal(ws.sites[0].pages[0].published_html, '<h1>Trang của tôi</h1>');
    assert.deepEqual(ws.sites[0].leads[0].data, { phone: '0909123456' });
    assert.equal(ws.orders[0].order_code, 'ORD1');

    const text = JSON.stringify(data);
    for (const secret of ['password_hash', 'scrypt$', 'token_hash', 'domain-token-secret', 'ABCDEFGHIJKLMNOP', 'secret-ref', 'settings_json', 'editor@example.com']) {
      assert.ok(!text.includes(secret), `export leaks ${secret}`);
    }
  });

  await t.test('editors do not get the workspace content', async () => {
    const data = (await editor('GET', '/api/auth/export')).data;
    assert.equal(data.user.email, 'editor@example.com');
    assert.ok(data.memberships.some((m) => m.workspaceId === wsId && m.role === 'editor'));
    assert.ok(!data.ownedWorkspaces.some((w) => w.id === wsId));
    assert.ok(!JSON.stringify(data).includes('0909123456'));
  });

  await t.test('requires login', async () => {
    assert.equal((await client(base)('GET', '/api/auth/export')).status, 401);
  });
});

test('ownership transfer and account deletion', async (t) => {
  const { server, base, db, outbox } = await startServer();
  t.after(() => server.close());

  const owner = client(base);
  await signup(owner, 'owner@example.com');
  const ownerId = db.prepare('SELECT id FROM users WHERE email = ?').get('owner@example.com').id;
  const wsId = (await owner('GET', '/api/auth/me')).data.workspaces[0].id;
  db.prepare("UPDATE workspaces SET plan = 'pro' WHERE id = ?").run(wsId);

  const admin = client(base);
  await signup(admin, 'admin@example.com');
  const adminId = db.prepare('SELECT id FROM users WHERE email = ?').get('admin@example.com').id;
  await owner('POST', `/api/workspaces/${wsId}/members`, { email: 'admin@example.com', role: 'admin' });
  const editor = client(base);
  await signup(editor, 'editor@example.com');
  const editorId = db.prepare('SELECT id FROM users WHERE email = ?').get('editor@example.com').id;
  await owner('POST', `/api/workspaces/${wsId}/members`, { email: 'editor@example.com' });
  const outsider = client(base);
  await signup(outsider, 'outsider@example.com');
  const outsiderId = db.prepare('SELECT id FROM users WHERE email = ?').get('outsider@example.com').id;

  const role = (userId) => db.prepare('SELECT role FROM memberships WHERE workspace_id = ? AND user_id = ?').get(wsId, userId)?.role;
  const del = (c, body) => c('POST', '/api/auth/delete-account', body);

  await t.test('only the owner can transfer, to an existing member', async () => {
    assert.equal((await admin('POST', `/api/workspaces/${wsId}/transfer`, { userId: adminId })).status, 403);
    assert.equal((await editor('POST', `/api/workspaces/${wsId}/transfer`, { userId: editorId })).status, 403);
    assert.equal((await outsider('POST', `/api/workspaces/${wsId}/transfer`, { userId: outsiderId })).status, 404);
    assert.equal((await owner('POST', `/api/workspaces/${wsId}/transfer`, { userId: outsiderId })).status, 404);
    assert.equal((await owner('POST', `/api/workspaces/${wsId}/transfer`, { userId: ownerId })).status, 400);
    assert.equal((await owner('POST', `/api/workspaces/${wsId}/transfer`, { userId: 'abc' })).status, 400);
    assert.equal(role(ownerId), 'owner');
  });

  await t.test('deletion requires confirmation and the password', async () => {
    assert.equal((await del(owner, { password: 'matkhau123', confirm: 'xoa' })).status, 400);
    const wrong = await del(owner, { password: 'saimatkhau', confirm: 'XOA TAI KHOAN' });
    assert.equal(wrong.status, 400);
    assert.match(wrong.data.error, /Mật khẩu/);
  });

  await t.test('owner of a workspace with other members cannot delete the account', async () => {
    const r = await del(owner, { password: 'matkhau123', confirm: 'XOA TAI KHOAN' });
    assert.equal(r.status, 409);
    assert.match(r.data.error, /chuyển quyền sở hữu/);
    assert.ok(db.prepare('SELECT 1 FROM users WHERE id = ?').get(ownerId));
  });

  await t.test('transfer to an editor; the old owner becomes admin', async () => {
    assert.equal((await owner('POST', `/api/workspaces/${wsId}/transfer`, { userId: editorId })).status, 200);
    assert.equal(role(editorId), 'owner');
    assert.equal(role(ownerId), 'admin');
    assert.equal(outbox.at(-1).to, 'editor@example.com');
    // The former owner has lost the right to transfer.
    assert.equal((await owner('POST', `/api/workspaces/${wsId}/transfer`, { userId: adminId })).status, 403);
  });

  await t.test('successful deletion cascades owned data and keeps shared workspaces', async () => {
    // The former owner also owns a personal single-member workspace with content.
    const personal = (await owner('POST', '/api/workspaces', { name: 'Cá nhân' })).data.id;
    const site = (await owner('POST', `/api/workspaces/${personal}/sites`, { name: 'Riêng', subdomain: 'rieng', template: 'blank' })).data;
    db.prepare("INSERT INTO leads (site_id, data_json) VALUES (?, '{}')").run(site.id);

    const r = await del(owner, { password: 'matkhau123', confirm: 'XOA TAI KHOAN' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.deletedWorkspaces, 1);
    assert.match(r.headers.get('set-cookie'), /htc_session=;/);
    assert.equal((await owner('GET', '/api/auth/me')).status, 401);

    const count = (sql, ...args) => db.prepare(sql).get(...args).n;
    assert.equal(count('SELECT COUNT(*) AS n FROM users WHERE id = ?', ownerId), 0);
    assert.equal(count('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?', ownerId), 0);
    assert.equal(count('SELECT COUNT(*) AS n FROM memberships WHERE user_id = ?', ownerId), 0);
    assert.equal(count('SELECT COUNT(*) AS n FROM workspaces WHERE id = ?', personal), 0);
    assert.equal(count('SELECT COUNT(*) AS n FROM sites WHERE id = ?', site.id), 0);
    assert.equal(count('SELECT COUNT(*) AS n FROM leads WHERE site_id = ?', site.id), 0);
    // The transferred workspace and its members are untouched.
    assert.equal(count('SELECT COUNT(*) AS n FROM workspaces WHERE id = ?', wsId), 1);
    assert.equal(role(editorId), 'owner');
    assert.equal(role(adminId), 'admin');

    const mail = outbox.at(-1);
    assert.equal(mail.to, 'owner@example.com');
    assert.match(mail.subject, /đã được xóa/);
    // The account can no longer log in.
    assert.equal((await client(base)('POST', '/api/auth/login', { email: 'owner@example.com', password: 'matkhau123' })).status, 401);
  });
});

test('signup requires consent to the terms and records which version was accepted', async (t) => {
  const { server, base, db } = await startServer({ requireTermsConsent: true, termsVersion: '2026-10' });
  t.after(() => server.close());
  const c = client(base);
  const body = { name: 'Đồng Ý', email: 'dongy@example.com', password: 'matkhau123' };

  for (const acceptTerms of [undefined, false, '0', 'yes']) {
    const r = await c('POST', '/api/auth/signup', { ...body, acceptTerms });
    assert.equal(r.status, 400);
    assert.match(r.data.error, /Điều khoản sử dụng/);
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 0);

  // The signup form posts the checkbox as "1".
  assert.equal((await c('POST', '/api/auth/signup', { ...body, acceptTerms: '1' })).status, 201);
  const row = db.prepare('SELECT terms_accepted_at, terms_version FROM users WHERE email = ?').get('dongy@example.com');
  assert.ok(row.terms_accepted_at);
  assert.equal(row.terms_version, '2026-10');
  const exported = (await c('GET', '/api/auth/export')).data;
  assert.equal(exported.user.terms_version, '2026-10');
});
