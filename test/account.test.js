'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client } = require('./helpers');

const tokenFrom = (mail) => mail.text.match(/token=([\w-]+)/)[1];

test('accounts: password reset, invitations, change password', async (t) => {
  const { server, base, outbox, db } = await startServer();
  t.after(() => server.close());

  const owner = client(base);
  await owner('POST', '/api/auth/signup', { name: 'Chủ', email: 'owner@example.com', password: 'matkhau123' });
  const wsId = (await owner('GET', '/api/auth/me')).data.workspaces[0].id;

  await t.test('security headers and health check', async () => {
    const res = await fetch(`${base}/healthz`);
    assert.deepEqual(await res.json(), { ok: true });
    const page = await fetch(`${base}/app/login`);
    assert.equal(page.headers.get('x-frame-options'), 'SAMEORIGIN');
    assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
  });

  await t.test('forgot password does not reveal accounts', async () => {
    const anon = client(base);
    const before = outbox.length;
    assert.equal((await anon('POST', '/api/auth/forgot', { email: 'nobody@example.com' })).status, 200);
    assert.equal(outbox.length, before);
    assert.equal((await anon('POST', '/api/auth/forgot', { email: 'OWNER@example.com' })).status, 200);
    assert.equal(outbox.at(-1).to, 'owner@example.com');
  });

  await t.test('reset password with token signs out other sessions', async () => {
    const token = tokenFrom(outbox.at(-1));
    const anon = client(base);
    assert.equal((await anon('POST', '/api/auth/reset', { token: 'bad', password: 'moimatkhau1' })).status, 400);
    assert.equal((await anon('POST', '/api/auth/reset', { token, password: 'short' })).status, 400);
    assert.equal((await anon('POST', '/api/auth/reset', { token, password: 'moimatkhau1' })).status, 200);
    assert.equal((await anon('GET', '/api/auth/me')).status, 200);
    // Token is single-use; old session is revoked.
    assert.equal((await anon('POST', '/api/auth/reset', { token, password: 'khac123456' })).status, 400);
    assert.equal((await owner('GET', '/api/auth/me')).status, 401);
    assert.equal((await owner('POST', '/api/auth/login', { email: 'owner@example.com', password: 'moimatkhau1' })).status, 200);
  });

  await t.test('change password requires the current one', async () => {
    assert.equal((await owner('POST', '/api/auth/change-password', { currentPassword: 'sai', newPassword: 'abcdefgh1' })).status, 400);
    assert.equal((await owner('POST', '/api/auth/change-password', { currentPassword: 'moimatkhau1', newPassword: 'abcdefgh1' })).status, 200);
    assert.equal((await owner('GET', '/api/auth/me')).status, 200);
  });

  await t.test('invite a new user by email', async () => {
    db.prepare("UPDATE workspaces SET plan = 'pro' WHERE id = ?").run(wsId);
    const r = await owner('POST', `/api/workspaces/${wsId}/members`, { email: 'new@example.com', role: 'editor' });
    assert.equal(r.status, 201);
    assert.equal(r.data.status, 'invited');
    const mail = outbox.at(-1);
    assert.equal(mail.to, 'new@example.com');
    const token = tokenFrom(mail);

    const invites = await owner('GET', `/api/workspaces/${wsId}/invitations`);
    assert.equal(invites.data.length, 1);

    const info = await client(base)('GET', `/api/invitations/${token}`);
    assert.equal(info.data.email, 'new@example.com');
    assert.equal(info.data.hasAccount, false);

    // Signing up with the token joins the inviter's workspace (no personal workspace).
    const invitee = client(base);
    const s = await invitee('POST', '/api/auth/signup', { name: 'Mới', email: 'new@example.com', password: 'matkhau123', inviteToken: token });
    assert.equal(s.data.workspaceId, wsId);
    const me = await invitee('GET', '/api/auth/me');
    assert.deepEqual(me.data.workspaces.map((w) => [w.id, w.role]), [[wsId, 'editor']]);
    assert.equal((await owner('GET', `/api/workspaces/${wsId}/invitations`)).data.length, 0);
  });

  await t.test('invitation is bound to the invited email', async () => {
    await owner('POST', `/api/workspaces/${wsId}/members`, { email: 'target@example.com' });
    const token = tokenFrom(outbox.at(-1));
    const other = client(base);
    await other('POST', '/api/auth/signup', { name: 'Khác', email: 'other@example.com', password: 'matkhau123' });
    assert.equal((await other('POST', '/api/invitations/accept', { token })).status, 403);
  });

  await t.test('adding an existing user notifies them', async () => {
    const r = await owner('POST', `/api/workspaces/${wsId}/members`, { email: 'other@example.com' });
    assert.equal(r.data.status, 'added');
    assert.equal(outbox.at(-1).to, 'other@example.com');
  });

  await t.test('pending invitations count toward member limit', async () => {
    db.prepare("UPDATE workspaces SET plan = 'free' WHERE id = ?").run(wsId);
    assert.equal((await owner('POST', `/api/workspaces/${wsId}/members`, { email: 'x@example.com' })).status, 402);
  });

  await t.test('login is rate limited', async () => {
    const anon = client(base);
    let last;
    for (let i = 0; i < 11; i++) last = await anon('POST', '/api/auth/login', { email: 'brute@example.com', password: 'wrong' });
    assert.equal(last.status, 429);
  });
});
