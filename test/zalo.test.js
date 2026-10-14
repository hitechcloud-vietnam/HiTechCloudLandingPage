'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client } = require('./helpers');
const { createLogger } = require('../src/logger');
const { zaloText } = require('../src/notify');
const { SEND_URL, TOKEN_URL } = require('../src/zalo');

const APP_ID = '4321987654321';
const APP_SECRET = 'AppSECRETzalo_0123456789';
const SEED = 'SeedSECRET_refresh-token.0123456789abcdefABCDEF';
const USERS = ['1111111111111111111', '2222222222222222222'];

// Fake Zalo OA: single-use refresh tokens that rotate, access tokens that can be revoked.
function fakeZalo() {
  const z = {
    tokenCalls: [],
    sendCalls: [],
    refreshTokens: new Set([SEED]),
    accessTokens: new Set(),
    failUsers: new Set(),
    refreshBroken: false,
    sendDown: false,
    issued: 0,
  };
  const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  z.fetch = async (url, opts) => {
    if (url === TOKEN_URL) {
      const form = Object.fromEntries(new URLSearchParams(opts.body));
      z.tokenCalls.push({ headers: opts.headers, form });
      if (z.refreshBroken || opts.headers.secret_key !== APP_SECRET || !z.refreshTokens.delete(form.refresh_token)) {
        return json(200, { error: -14014, error_name: 'Invalid refresh token', error_description: 'Refresh token is invalid' });
      }
      z.issued += 1;
      const access = `AccessTOKEN_${z.issued}_xxxxxxxxxxxxxxxx`;
      const refresh = `RotatedREFRESH_${z.issued}_yyyyyyyyyyyyyyyy`;
      z.refreshTokens.add(refresh);
      z.accessTokens.add(access);
      return json(200, { access_token: access, refresh_token: refresh, expires_in: '90000' });
    }
    if (url === SEND_URL) {
      const body = JSON.parse(opts.body);
      z.sendCalls.push({ headers: opts.headers, body });
      if (z.sendDown) throw new Error('fetch failed');
      if (!z.accessTokens.has(opts.headers.access_token)) return json(200, { error: -216, message: 'Access token is invalid' });
      if (z.failUsers.has(body.recipient.user_id)) return json(200, { error: -230, message: 'User has not interacted with the OA in the last 7 days' });
      return json(200, { error: 0, message: 'Success', data: { message_id: `m${z.sendCalls.length}`, user_id: body.recipient.user_id } });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  return z;
}

async function until(cond, ms = 2000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 10));
  }
}

async function setupSite(base) {
  const c = client(base);
  await c('POST', '/api/auth/signup', { name: 'Chủ', email: 'owner@example.com', password: 'matkhau123' });
  const wsId = (await c('GET', '/api/auth/me')).data.workspaces[0].id;
  const site = (await c('POST', `/api/workspaces/${wsId}/sites`, { name: 'Shop Hoa', subdomain: 'shophoa', template: 'leadgen' })).data;
  const pages = (await c('GET', `/api/sites/${site.id}/pages`)).data;
  await c('POST', `/api/pages/${pages[0].id}/publish`, {});
  return { c, wsId, site };
}

test('Zalo OA lead notifications', async (t) => {
  const z = fakeZalo();
  const logLines = [];
  const log = createLogger({ level: 'debug', format: 'json', stream: { write: (s) => logLines.push(s) } });
  const { server, base, db } = await startServer({ fetch: z.fetch, zalo: { appId: APP_ID, appSecret: APP_SECRET }, logger: log });
  t.after(() => server.close());
  const { c, wsId, site } = await setupSite(base);
  const patch = (body) => c('PATCH', `/api/sites/${site.id}/settings`, body);
  const testZalo = async () => (await c('POST', `/api/sites/${site.id}/notify-test`, { channel: 'zalo' })).data;
  const tokenRow = () => db.prepare('SELECT * FROM zalo_tokens WHERE site_id = ?').get(site.id);
  const postLead = (fields) =>
    fetch(`${base}/_htc/lead?site=${site.id}&page=index`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields).toString(),
    });
  const leadCount = () => db.prepare('SELECT COUNT(*) AS n FROM leads WHERE site_id = ?').get(site.id).n;

  await t.test('validates recipients and refresh token', async () => {
    for (const [body, re] of [
      [{ zaloUserIds: '12345abc' }, /Zalo user ID không hợp lệ: 12345abc/],
      [{ zaloUserIds: '-1234567' }, /Zalo user ID không hợp lệ/],
      [{ zaloUserIds: '123' }, /Zalo user ID không hợp lệ/],
      [{ zaloUserIds: '1000001, 1000002, 1000003, 1000004, 1000005, 1000006' }, /Tối đa 5 người nhận Zalo/],
      [{ zaloRefreshToken: 'short' }, /Zalo OA refresh token không hợp lệ/],
      [{ zaloRefreshToken: `${SEED} <script>` }, /Zalo OA refresh token không hợp lệ/],
      [{ zaloRefreshToken: 'a'.repeat(1001) }, /Zalo OA refresh token không hợp lệ/],
    ]) {
      const r = await patch(body);
      assert.equal(r.status, 400, JSON.stringify(body));
      assert.match(r.data.error, re);
    }
    // Five recipients (duplicates collapse) and a long token are fine.
    const ok = await patch({ zaloUserIds: '1000001;1000002 1000003,1000004,1000005,1000001', zaloRefreshToken: `x${'a'.repeat(999)}` });
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.data.settings.zaloUserIds, ['1000001', '1000002', '1000003', '1000004', '1000005']);
  });

  await t.test('secrets are stored but never echoed', async () => {
    const r = await patch({ notifyOwners: false, dedupeHours: '0', zaloRefreshToken: SEED, zaloUserIds: `${USERS[0]}, ${USERS[1]}` });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.settings.hasZaloRefreshToken, true);
    assert.equal(r.data.settings.zaloRefreshToken, undefined);
    assert.deepEqual(r.data.settings.zaloUserIds, USERS);
    assert.deepEqual(r.data.integrations, { zalo: true });
    for (const data of [r.data, (await c('GET', `/api/sites/${site.id}`)).data, (await c('GET', `/api/workspaces/${wsId}/sites`)).data]) {
      assert.doesNotMatch(JSON.stringify(data), /SeedSECRET/);
    }
    // Blank keeps the stored token.
    await patch({ zaloRefreshToken: '' });
    assert.equal((await c('GET', `/api/sites/${site.id}`)).data.settings.hasZaloRefreshToken, true);
  });

  await t.test('first lead refreshes the token, fans out to every recipient', async () => {
    const res = await postLead({
      ho_ten: 'Nguyễn Văn An',
      email: 'an@example.com',
      so_dien_thoai: '0909123456',
      ghi_chu: `Cần tư vấn\n${'rất '.repeat(100)}gấp`,
      f1: 'a', f2: 'b', f3: 'c', f4: 'd', f5: 'e',
      _utm_source: 'facebook',
      _utm_campaign: 'tet',
    });
    assert.equal(res.status, 303);
    await until(() => z.sendCalls.length === 2);

    assert.equal(z.tokenCalls.length, 1);
    assert.equal(z.tokenCalls[0].headers.secret_key, APP_SECRET);
    assert.deepEqual(z.tokenCalls[0].form, { refresh_token: SEED, app_id: APP_ID, grant_type: 'refresh_token' });

    assert.deepEqual(z.sendCalls.map((x) => x.body.recipient.user_id).sort(), USERS);
    for (const call of z.sendCalls) {
      assert.equal(call.headers.access_token, 'AccessTOKEN_1_xxxxxxxxxxxxxxxx');
      assert.deepEqual(Object.keys(call.body), ['recipient', 'message']);
      assert.deepEqual(Object.keys(call.body.message), ['text']);
    }
    const text = z.sendCalls[0].body.message.text;
    const lines = text.split('\n');
    assert.equal(lines[0], '🔔 Lead mới từ "Shop Hoa" (/)');
    assert.equal(lines[1], 'Họ tên: Nguyễn Văn An');
    assert.equal(lines[2], 'SĐT: 0909123456');
    assert.equal(lines[3], 'Email: an@example.com');
    assert.match(lines[4], /^ghi_chu: Cần tư vấn rất rất .*…$/);
    assert.ok(lines[4].length <= 'ghi_chu: '.length + 120);
    assert.deepEqual(lines.slice(5, 9), ['f1: a', 'f2: b', 'f3: c', 'f4: d']);
    assert.equal(lines[9], '(+1 trường khác)');
    assert.equal(lines[10], 'Nguồn: facebook / tet');
    assert.match(lines[11], /^Xem chi tiết: http:\/\/localhost:3999\/app\/site\?id=\d+$/);

    // Rotated pair persisted server-side, never exposed.
    await until(() => tokenRow() && tokenRow().access_token);
    const row = tokenRow();
    assert.equal(row.refresh_token, 'RotatedREFRESH_1_yyyyyyyyyyyyyyyy');
    assert.equal(row.access_token, 'AccessTOKEN_1_xxxxxxxxxxxxxxxx');
    assert.ok(Math.abs(row.expires_at - (Date.now() + 90000 * 1000)) < 60000);
    assert.doesNotMatch(JSON.stringify((await c('GET', `/api/sites/${site.id}`)).data), /RotatedREFRESH|AccessTOKEN/);
  });

  await t.test('a valid access token is reused', async () => {
    z.sendCalls.length = 0;
    assert.deepEqual(await testZalo(), { zalo: 'ok' });
    assert.equal(z.tokenCalls.length, 1);
    assert.equal(z.sendCalls.length, 2);
    assert.match(z.sendCalls[0].body.message.text, /Họ tên: Khách hàng thử nghiệm\nSĐT: 0900000000\nmessage: Đây là thông báo thử/);
  });

  await t.test('an expired access token is refreshed with the rotated refresh token', async () => {
    db.prepare('UPDATE zalo_tokens SET expires_at = ? WHERE site_id = ?').run(Date.now() - 1000, site.id);
    assert.deepEqual(await testZalo(), { zalo: 'ok' });
    assert.equal(z.tokenCalls.length, 2);
    assert.equal(z.tokenCalls[1].form.refresh_token, 'RotatedREFRESH_1_yyyyyyyyyyyyyyyy');
    assert.equal(tokenRow().refresh_token, 'RotatedREFRESH_2_yyyyyyyyyyyyyyyy');
  });

  await t.test('an invalid-token error refreshes once and retries once', async () => {
    z.accessTokens.clear(); // revoked on Zalo's side, still unexpired locally
    z.sendCalls.length = 0;
    assert.deepEqual(await testZalo(), { zalo: 'ok' });
    assert.equal(z.tokenCalls.length, 3, 'one shared refresh for both recipients');
    assert.equal(z.sendCalls.length, 4);
    assert.deepEqual(z.sendCalls.map((x) => x.headers.access_token).slice(2), ['AccessTOKEN_3_xxxxxxxxxxxxxxxx', 'AccessTOKEN_3_xxxxxxxxxxxxxxxx']);

    // Rejected again right after the refresh: give up instead of looping.
    z.accessTokens.clear();
    z.refreshTokens.clear();
    const tokensBefore = z.tokenCalls.length;
    assert.match((await testZalo()).zalo, /không làm mới được access token \(mã -14014\)/);
    assert.equal(z.tokenCalls.length, tokensBefore + 1);
  });

  await t.test('failures never affect lead capture', async () => {
    const before = leadCount();
    logLines.length = 0;
    z.refreshBroken = true;
    const res = await postLead({ name: 'Bình', phone: '0912345678' });
    assert.equal(res.status, 303);
    assert.match(res.headers.get('location'), /submitted=1/);
    assert.equal(leadCount(), before + 1);
    await until(() => logLines.some((l) => l.includes('[notify] zalo')));
    const warn = JSON.parse(logLines.find((l) => l.includes('[notify] zalo')));
    assert.equal(warn.level, 'warn');
    assert.match(warn.msg, /không làm mới được access token/);

    // Network failure on send.
    z.refreshBroken = false;
    z.refreshTokens.add('RotatedREFRESH_3_yyyyyyyyyyyyyyyy');
    z.sendDown = true;
    db.prepare('UPDATE zalo_tokens SET refresh_token = ?, access_token = NULL WHERE site_id = ?').run('RotatedREFRESH_3_yyyyyyyyyyyyyyyy', site.id);
    const res2 = await postLead({ name: 'Cường', phone: '0987654321' });
    assert.equal(res2.status, 303);
    assert.equal(leadCount(), before + 2);
    await until(() => logLines.filter((l) => l.includes('[notify] zalo')).length >= 2);
    z.sendDown = false;

    // One recipient failing is reported, the other still receives the message.
    z.failUsers.add(USERS[1]);
    z.sendCalls.length = 0;
    const r = await testZalo();
    assert.match(r.zalo, /^1\/2 người nhận Zalo lỗi: Zalo OA lỗi -230/);
    assert.equal(z.sendCalls.length, 2);
    z.failUsers.clear();

    for (const line of logLines) assert.doesNotMatch(line, /SeedSECRET|RotatedREFRESH|AccessTOKEN|AppSECRET/);
  });

  await t.test('a newly pasted refresh token restarts the chain', async () => {
    const NEW = 'BrandNewREFRESH_token_abcdefghijklmnop';
    z.refreshTokens.add(NEW);
    await patch({ zaloRefreshToken: NEW });
    assert.deepEqual(await testZalo(), { zalo: 'ok' });
    assert.equal(z.tokenCalls.at(-1).form.refresh_token, NEW);
  });

  await t.test('"-" clears the channel and forgets stored tokens', async () => {
    await patch({ zaloRefreshToken: '-', zaloUserIds: '' });
    const st = (await c('GET', `/api/sites/${site.id}`)).data.settings;
    assert.equal(st.hasZaloRefreshToken, false);
    assert.equal(st.zaloUserIds, undefined);
    assert.equal(tokenRow(), undefined);
    assert.deepEqual(await testZalo(), {});
  });
});

test('Zalo channel without platform credentials', async (t) => {
  const z = fakeZalo();
  const { server, base } = await startServer({ fetch: z.fetch });
  t.after(() => server.close());
  const { c, site } = await setupSite(base);
  const r = await c('PATCH', `/api/sites/${site.id}/settings`, { zaloRefreshToken: SEED, zaloUserIds: USERS[0] });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.integrations, { zalo: false });
  const res = await c('POST', `/api/sites/${site.id}/notify-test`, { channel: 'zalo' });
  assert.deepEqual(res.data, { zalo: 'Nền tảng chưa cấu hình Zalo OA (ZALO_APP_ID / ZALO_APP_SECRET)' });
  assert.equal(z.tokenCalls.length + z.sendCalls.length, 0);
});

test('zaloText formatting', () => {
  const link = 'https://app.x.vn/app/site?id=1';
  const t1 = zaloText({ site: { name: 'A' }, pageSlug: 'uu-dai', data: { 'Full Name': 'Lan', tel: '0901', note: '' }, link });
  assert.equal(t1, `🔔 Lead mới từ "A" (/uu-dai)\nHọ tên: Lan\nSĐT: 0901\nXem chi tiết: ${link}`);
  // No recognisable contact fields: everything is listed as-is; no UTM line without UTM.
  const t2 = zaloText({ site: { name: 'A' }, pageSlug: 'index', data: { company: 'X  \n Y' }, source: { ref: 'https://fb.com' }, link });
  assert.equal(t2, `🔔 Lead mới từ "A" (/)\ncompany: X Y\nXem chi tiết: ${link}`);
  // Always within Zalo's text limit.
  const big = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`k${i}`.repeat(30), 'v'.repeat(2000)]));
  const t3 = zaloText({ site: { name: 'S'.repeat(100) }, pageSlug: 'index', data: { name: 'n'.repeat(2000), ...big }, source: { utm_source: 'u'.repeat(500) }, link });
  assert.ok(t3.length <= 2000);
  assert.match(t3, /\(\+35 trường khác\)/);
});
