'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { startServer, client } = require('./helpers');

// Bearer-token client for /api/v1 (no cookies, no Origin header).
function bearer(base, key) {
  return async (method, path, body, { headers = {} } = {}) => {
    const res = await fetch(base + '/api/v1' + path, {
      method,
      headers: {
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const type = res.headers.get('content-type') || '';
    return { status: res.status, data: type.includes('json') ? await res.json() : await res.text(), headers: res.headers };
  };
}

async function setupWorkspace(base, db, email, subdomain) {
  const c = client(base);
  await c('POST', '/api/auth/signup', { name: 'Chủ', email, password: 'matkhau123' });
  const wsId = (await c('GET', '/api/auth/me')).data.workspaces[0].id;
  db.prepare("UPDATE workspaces SET plan = 'pro' WHERE id = ?").run(wsId);
  const site = (await c('POST', `/api/workspaces/${wsId}/sites`, { name: 'Shop', subdomain, template: 'leadgen' })).data;
  const page = (await c('GET', `/api/sites/${site.id}/pages`)).data[0];
  await c('POST', `/api/pages/${page.id}/publish`, {});
  return { c, wsId, site, page };
}

function submitLead(base, siteId, body) {
  return fetch(`${base}/_htc/lead?site=${siteId}&page=index`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
}

test('public API v1: keys, tenant isolation, leads, publish', async (t) => {
  const { server, base, db } = await startServer();
  t.after(() => server.close());

  const a = await setupWorkspace(base, db, 'a@example.com', 'shop-a');
  const b = await setupWorkspace(base, db, 'b@example.com', 'shop-b');
  let keyA;
  let keyAId;

  await t.test('plan gating and roles for key management', async () => {
    db.prepare("UPDATE workspaces SET plan = 'free' WHERE id = ?").run(a.wsId);
    const res = await a.c('POST', `/api/workspaces/${a.wsId}/api-keys`, { name: 'Zapier' });
    assert.equal(res.status, 402);
    assert.match(res.data.error, /gói Pro/);
    db.prepare("UPDATE workspaces SET plan = 'pro' WHERE id = ?").run(a.wsId);

    assert.equal((await a.c('POST', `/api/workspaces/${a.wsId}/api-keys`, { name: '' })).status, 400);
    // Another tenant cannot list or create keys in workspace A.
    assert.equal((await b.c('GET', `/api/workspaces/${a.wsId}/api-keys`)).status, 404);
    assert.equal((await b.c('POST', `/api/workspaces/${a.wsId}/api-keys`, { name: 'x' })).status, 404);
    // Editors cannot manage keys.
    const editor = client(base);
    await editor('POST', '/api/auth/signup', { name: 'Biên tập', email: 'ed@example.com', password: 'matkhau123' });
    const edUser = db.prepare('SELECT id FROM users WHERE email = ?').get('ed@example.com');
    db.prepare("INSERT INTO memberships (workspace_id, user_id, role) VALUES (?, ?, 'editor')").run(a.wsId, edUser.id);
    assert.equal((await editor('GET', `/api/workspaces/${a.wsId}/api-keys`)).status, 403);
    // Unauthenticated access is rejected.
    assert.equal((await client(base)('GET', `/api/workspaces/${a.wsId}/api-keys`)).status, 401);
  });

  await t.test('create key: full key shown once, only the hash is stored', async () => {
    const res = await a.c('POST', `/api/workspaces/${a.wsId}/api-keys`, { name: 'Zapier' });
    assert.equal(res.status, 201);
    keyA = res.data.key;
    keyAId = res.data.id;
    assert.match(keyA, /^htc_live_[A-Za-z0-9_-]{32,}$/);
    assert.equal(res.data.prefix, keyA.slice(0, res.data.prefix.length));
    assert.ok(res.data.prefix.length >= 12 && res.data.prefix.length < 16);
    assert.equal(res.data.name, 'Zapier');

    const row = db.prepare('SELECT * FROM api_keys WHERE id = ?').get(keyAId);
    assert.equal(row.key_hash, crypto.createHash('sha256').update(keyA).digest('hex'));
    const dump = JSON.stringify(db.prepare('SELECT * FROM api_keys').all());
    assert.ok(!dump.includes(keyA), 'plaintext key must not be stored');

    const list = await a.c('GET', `/api/workspaces/${a.wsId}/api-keys`);
    assert.equal(list.status, 200);
    assert.equal(list.data.length, 1);
    assert.equal(list.data[0].prefix, res.data.prefix);
    assert.equal(list.data[0].key, undefined);
    assert.ok(!JSON.stringify(list.data).includes(keyA));
  });

  await t.test('missing or invalid keys get 401 JSON errors', async () => {
    let res = await bearer(base)('GET', '/sites');
    assert.equal(res.status, 401);
    assert.ok(res.data.error);
    res = await bearer(base, 'htc_live_' + 'x'.repeat(32))('GET', '/sites');
    assert.equal(res.status, 401);
    res = await bearer(base, keyA.slice(0, -1) + (keyA.endsWith('A') ? 'B' : 'A'))('GET', '/sites');
    assert.equal(res.status, 401);
    // A session cookie alone does not authenticate the v1 API.
    assert.equal((await a.c('GET', '/api/v1/sites')).status, 401);
  });

  await t.test('sites and pages are scoped to the key workspace', async () => {
    const api = bearer(base, keyA);
    const sites = await api('GET', '/sites');
    assert.equal(sites.status, 200);
    assert.deepEqual(sites.data.data.map((s) => s.id), [a.site.id]);
    assert.equal(sites.data.data[0].subdomain, 'shop-a');

    const pages = await api('GET', `/sites/${a.site.id}/pages`);
    assert.equal(pages.status, 200);
    assert.equal(pages.data.data[0].id, a.page.id);
    assert.equal(pages.data.data[0].published, true);
    assert.equal(pages.data.data[0].project_json, undefined);

    assert.equal((await api('GET', `/sites/${b.site.id}/pages`)).status, 404);
    assert.equal((await api('GET', `/sites/${b.site.id}/leads`)).status, 404);
    assert.equal((await api('POST', `/pages/${b.page.id}/publish`)).status, 404);
    assert.equal((await api('GET', '/nope')).status, 404);
    assert.ok(db.prepare('SELECT last_used_at FROM api_keys WHERE id = ?').get(keyAId).last_used_at);
  });

  await t.test('lead listing, filters, pagination and patch', async () => {
    for (let i = 1; i <= 5; i++) await submitLead(base, a.site.id, { name: `Khách ${i}`, phone: `090${i}`, _utm_source: 'zalo' });
    await submitLead(base, b.site.id, { name: 'Khách của B', phone: '0999' });
    const api = bearer(base, keyA);

    let res = await api('GET', `/sites/${a.site.id}/leads`);
    assert.equal(res.status, 200);
    assert.equal(res.data.data.length, 5);
    assert.equal(res.data.nextCursor, null);
    const newest = res.data.data[0];
    assert.deepEqual(Object.keys(newest).sort(), ['createdAt', 'data', 'id', 'note', 'page', 'source', 'status']);
    assert.deepEqual(newest.data, { name: 'Khách 5', phone: '0905' });
    assert.deepEqual(newest.source, { utm_source: 'zalo' });
    assert.ok(!JSON.stringify(res.data).includes('Khách của B'));

    // Cursor pagination, newest first.
    res = await api('GET', `/sites/${a.site.id}/leads?limit=2`);
    assert.deepEqual(res.data.data.map((l) => l.data.name), ['Khách 5', 'Khách 4']);
    res = await api('GET', `/sites/${a.site.id}/leads?limit=2&cursor=${res.data.nextCursor}`);
    assert.deepEqual(res.data.data.map((l) => l.data.name), ['Khách 3', 'Khách 2']);
    res = await api('GET', `/sites/${a.site.id}/leads?limit=2&cursor=${res.data.nextCursor}`);
    assert.deepEqual(res.data.data.map((l) => l.data.name), ['Khách 1']);
    assert.equal(res.data.nextCursor, null);

    // since filter (inclusive) and validation.
    db.prepare("UPDATE leads SET created_at = '2020-01-01 00:00:00' WHERE site_id = ? AND data_json LIKE '%Khách 1%'").run(a.site.id);
    res = await api('GET', `/sites/${a.site.id}/leads?since=2024-01-01T00:00:00Z`);
    assert.equal(res.data.data.length, 4);
    res = await api('GET', `/sites/${a.site.id}/leads?since=2020-01-01T00:00:00.000Z`);
    assert.equal(res.data.data.length, 5);
    assert.equal((await api('GET', `/sites/${a.site.id}/leads?since=hôm-qua`)).status, 400);
    assert.equal((await api('GET', `/sites/${a.site.id}/leads?limit=0`)).status, 400);
    assert.equal((await api('GET', `/sites/${a.site.id}/leads?status=bogus`)).status, 400);
    assert.equal((await api('GET', `/sites/${a.site.id}/leads?limit=9999`)).data.data.length, 5);

    // Patch status and note.
    assert.equal((await api('PATCH', `/leads/${newest.id}`, { status: 'bogus' })).status, 400);
    assert.equal((await api('PATCH', `/leads/${newest.id}`, {})).status, 400);
    res = await api('PATCH', `/leads/${newest.id}`, { status: 'won', note: 'Chốt qua Zapier' });
    assert.equal(res.status, 200);
    assert.equal(res.data.status, 'won');
    assert.equal(res.data.note, 'Chốt qua Zapier');
    res = await api('GET', `/sites/${a.site.id}/leads?status=won`);
    assert.deepEqual(res.data.data.map((l) => l.id), [newest.id]);
    // Visible in the dashboard too.
    const dash = (await a.c('GET', `/api/sites/${a.site.id}/leads?status=won`)).data;
    assert.equal(dash[0].note, 'Chốt qua Zapier');

    // Malformed JSON gets a JSON error.
    const bad = await fetch(`${base}/api/v1/leads/${newest.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${keyA}`, 'Content-Type': 'application/json' },
      body: '{bad',
    });
    assert.equal(bad.status, 400);
    assert.ok((await bad.json()).error);

    // Cannot touch another workspace's lead.
    const leadB = db.prepare('SELECT id, status FROM leads WHERE site_id = ?').get(b.site.id);
    assert.equal((await api('PATCH', `/leads/${leadB.id}`, { status: 'lost' })).status, 404);
    assert.equal(db.prepare('SELECT status FROM leads WHERE id = ?').get(leadB.id).status, 'new');
  });

  await t.test('publish a page via the API', async () => {
    db.prepare("UPDATE pages SET draft_html = '<h1>Phiên bản API</h1>' WHERE id = ?").run(a.page.id);
    const res = await bearer(base, keyA)('POST', `/pages/${a.page.id}/publish`);
    assert.equal(res.status, 200);
    assert.equal(res.data.ok, true);
    assert.ok(res.data.publishedAt);
    const html = await (await fetch(`${base}/p/shop-a`)).text();
    assert.match(html, /Phiên bản API/);
  });

  await t.test('plan downgrade disables existing keys', async () => {
    db.prepare("UPDATE workspaces SET plan = 'pro', plan_expires_at = '2020-01-01T00:00:00.000Z' WHERE id = ?").run(a.wsId);
    assert.equal((await bearer(base, keyA)('GET', '/sites')).status, 402);
    db.prepare('UPDATE workspaces SET plan_expires_at = NULL WHERE id = ?').run(a.wsId);
    assert.equal((await bearer(base, keyA)('GET', '/sites')).status, 200);
  });

  await t.test('revoked keys are rejected', async () => {
    assert.equal((await b.c('DELETE', `/api/api-keys/${keyAId}`)).status, 404);
    assert.equal((await a.c('DELETE', `/api/api-keys/${keyAId}`)).status, 200);
    const res = await bearer(base, keyA)('GET', '/sites');
    assert.equal(res.status, 401);
    const list = (await a.c('GET', `/api/workspaces/${a.wsId}/api-keys`)).data;
    assert.ok(list[0].revokedAt);
  });
});

test('public API v1: rate limit per key', async (t) => {
  const { server, base, db } = await startServer({ apiRateLimitPerMin: 5 });
  t.after(() => server.close());
  const a = await setupWorkspace(base, db, 'rl@example.com', 'shop-rl');
  const key1 = (await a.c('POST', `/api/workspaces/${a.wsId}/api-keys`, { name: 'Một' })).data.key;
  const key2 = (await a.c('POST', `/api/workspaces/${a.wsId}/api-keys`, { name: 'Hai' })).data.key;

  for (let i = 0; i < 5; i++) assert.equal((await bearer(base, key1)('GET', '/sites')).status, 200);
  const res = await bearer(base, key1)('GET', '/sites');
  assert.equal(res.status, 429);
  assert.equal(res.headers.get('retry-after'), '60');
  assert.ok(res.data.error);
  // Limits are per key.
  assert.equal((await bearer(base, key2)('GET', '/sites')).status, 200);
});
