'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { openDb } = require('../src/db');
const { createApp } = require('../src/app');
const { verifyEmail } = require('./helpers');

const APP_URL = 'http://localhost:3999';

async function startServer() {
  const db = openDb(':memory:');
  const config = {
    appUrl: APP_URL,
    publishRootDomain: 'sites.test',
    superAdmins: ['root@hitechcloud.vn'],
    sessionDays: 1,
    secureCookies: false,
    quietMail: true,
  };
  const server = createApp({ db, config }).listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { db, server, base };
}

// Minimal cookie-aware client.
function client(base) {
  let cookie = '';
  return async function call(method, path, { body, headers = {}, raw = false } = {}) {
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
    http.get({ host: '127.0.0.1', port, path, headers: { Host: host } }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (d) => (text += d));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
    }).on('error', reject);
  });
}

async function signup(base, email, extra = {}) {
  const c = client(base);
  const r = await c('POST', '/api/auth/signup', { body: { name: 'Test', email, password: 'matkhau123', ...extra } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const me = await c('GET', '/api/auth/me');
  return { c, ws: me.data.workspaces[0] };
}

test('SaaS end-to-end flow', async (t) => {
  const { server, base, db } = await startServer();
  t.after(() => server.close());

  const { c, ws } = await signup(base, 'owner@example.com', { workspaceName: 'Công ty ABC' });
  verifyEmail(db, 'owner@example.com');
  assert.equal(ws.name, 'Công ty ABC');
  assert.equal(ws.role, 'owner');

  await t.test('auth', async () => {
    const anon = client(base);
    assert.equal((await anon('GET', '/api/auth/me')).status, 401);
    assert.equal((await anon('POST', '/api/auth/login', { body: { email: 'owner@example.com', password: 'sai' } })).status, 401);
    assert.equal((await anon('POST', '/api/auth/login', { body: { email: 'owner@example.com', password: 'matkhau123' } })).status, 200);
    assert.equal((await anon('GET', '/api/auth/me')).status, 200);
    assert.equal((await anon('POST', '/api/auth/signup', { body: { name: 'X', email: 'owner@example.com', password: 'matkhau123' } })).status, 409);
    await anon('POST', '/api/auth/logout', { body: {} });
    assert.equal((await anon('GET', '/api/auth/me')).status, 401);
  });

  await t.test('CSRF protection', async () => {
    const r = await c('POST', '/api/workspaces', { body: { name: 'x' }, headers: { Origin: 'https://evil.example' } });
    assert.equal(r.status, 403);
    const form = await c('POST', '/api/workspaces', { body: 'name=x', raw: true, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    assert.equal(form.status, 415);
  });

  let site, indexPage;
  await t.test('site creation from template + free plan limits', async () => {
    const r = await c('POST', `/api/workspaces/${ws.id}/sites`, { body: { name: 'Khuyến mãi', subdomain: 'khuyenmai', template: 'saas' } });
    assert.equal(r.status, 201);
    site = r.data;
    const pages = await c('GET', `/api/sites/${site.id}/pages`);
    assert.equal(pages.data.length, 1);
    indexPage = pages.data[0];
    assert.equal(indexPage.slug, 'index');

    const project = await c('GET', `/api/pages/${indexPage.id}/project`);
    assert.equal(project.data.project, null);
    assert.match(project.data.html, /<form/);

    assert.equal((await c('POST', `/api/workspaces/${ws.id}/sites`, { body: { name: 'B', subdomain: 'second' } })).status, 402);
    assert.equal((await c('PATCH', `/api/sites/${site.id}`, { body: { customDomain: 'shop.example.com' } })).status, 402);
  });

  await t.test('validation', async () => {
    const { c: other, ws: ws2 } = await signup(base, 'v@example.com');
    assert.equal((await other('POST', `/api/workspaces/${ws2.id}/sites`, { body: { name: 'A', subdomain: 'Bad Name' } })).status, 400);
    assert.equal((await other('POST', `/api/workspaces/${ws2.id}/sites`, { body: { name: 'A', subdomain: 'admin' } })).status, 400);
    assert.equal((await other('POST', `/api/workspaces/${ws2.id}/sites`, { body: { name: 'A', subdomain: 'khuyenmai' } })).status, 409);
  });

  await t.test('tenant isolation', async () => {
    const { c: intruder } = await signup(base, 'intruder@example.com');
    assert.equal((await intruder('GET', `/api/workspaces/${ws.id}`)).status, 404);
    assert.equal((await intruder('GET', `/api/sites/${site.id}`)).status, 404);
    assert.equal((await intruder('GET', `/api/pages/${indexPage.id}/project`)).status, 404);
    assert.equal((await intruder('PUT', `/api/pages/${indexPage.id}/project`, { body: { project: {}, html: '', css: '' } })).status, 404);
    assert.equal((await intruder('GET', `/api/sites/${site.id}/leads`)).status, 404);
    assert.equal((await intruder('GET', `/preview/${indexPage.id}`)).status, 404);
  });

  await t.test('editor save, publish and serve', async () => {
    const save = await c('PUT', `/api/pages/${indexPage.id}/project`, {
      body: { project: { pages: [] }, html: '<h1>Xin chào</h1><form action="https://x.test" method="get"><input name="phone"></form>', css: 'h1{color:red}</style><script>' },
    });
    assert.equal(save.status, 200);

    assert.equal((await fetch(`${base}/p/khuyenmai`)).status, 404);

    assert.equal((await c('POST', `/api/pages/${indexPage.id}/publish`, { body: {} })).status, 200);
    const res = await fetch(`${base}/p/khuyenmai`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-security-policy'), /^sandbox /);
    const html = await res.text();
    assert.match(html, /<h1>Xin chào<\/h1>/);
    assert.match(html, /action="\/_htc\/lead\?site=\d+&amp;page=index&amp;pid=\d+" method="post"/);
    assert.doesNotMatch(html, /x\.test/);
    assert.doesNotMatch(html, /<\/style><script>/);
    assert.match(html, /Tạo bởi HiTechCloud/); // free plan branding

    const byHost = await getWithHost(base, '/', 'khuyenmai.sites.test');
    assert.equal(byHost.status, 200);
    assert.equal(byHost.headers['content-security-policy'], undefined);
    assert.match(byHost.text, /Xin chào/);

    // Draft edits don't leak into the published version until republished.
    await c('PUT', `/api/pages/${indexPage.id}/project`, { body: { project: {}, html: '<h1>Bản nháp</h1>', css: '' } });
    assert.match(await (await fetch(`${base}/p/khuyenmai`)).text(), /Xin chào/);
    assert.match((await c('GET', `/preview/${indexPage.id}`)).data, /Bản nháp/);
  });

  await t.test('lead capture', async () => {
    const post = (body, ip) =>
      fetch(`${base}/_htc/lead?site=${site.id}&page=index`, {
        method: 'POST',
        redirect: 'manual',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...(ip ? { 'X-Forwarded-For': ip } : {}) },
        body,
      });
    const ok = await post('name=An&message=%3D1%2B2');
    assert.equal(ok.status, 303);
    assert.equal(ok.headers.get('location'), '/p/khuyenmai/?submitted=1');

    const spam = await post('name=Bot&_hp=1');
    assert.equal(spam.status, 303);

    const evil = await fetch(`${base}/_htc/lead?site=${site.id}&page=%2F%2Fevil.com`, {
      method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'a=1',
    });
    assert.equal(evil.headers.get('location'), '/p/khuyenmai/?submitted=1');

    const leads = await c('GET', `/api/sites/${site.id}/leads`);
    assert.equal(leads.data.length, 2);
    assert.deepEqual(leads.data[1].data, { name: 'An', message: '=1+2' });

    const csv = await c('GET', `/api/sites/${site.id}/leads?format=csv`);
    assert.match(csv.headers.get('content-type'), /text\/csv/);
    assert.match(csv.data, /"'=1\+2"/); // formula injection neutralised
  });

  await t.test('members and roles', async () => {
    const { c: editor } = await signup(base, 'editor@example.com');
    assert.equal((await c('POST', `/api/workspaces/${ws.id}/members`, { body: { email: 'editor@example.com' } })).status, 402); // free: 1 member

    const root = client(base);
    await root('POST', '/api/auth/signup', { body: { name: 'Root', email: 'root@hitechcloud.vn', password: 'matkhau123' } });
    assert.equal((await c('POST', `/api/workspaces/${ws.id}/plan`, { body: { plan: 'pro' } })).status, 403);
    assert.equal((await root('POST', `/api/workspaces/${ws.id}/plan`, { body: { plan: 'pro' } })).status, 200);

    assert.equal((await c('POST', `/api/workspaces/${ws.id}/members`, { body: { email: 'editor@example.com' } })).status, 201);
    assert.equal((await editor('GET', `/api/sites/${site.id}`)).status, 200);
    assert.equal((await editor('DELETE', `/api/sites/${site.id}`)).status, 403);
    assert.equal((await editor('POST', `/api/workspaces/${ws.id}/members`, { body: { email: 'v@example.com' } })).status, 403);

    // Pro plan: custom domain + no branding.
    const patch = await c('PATCH', `/api/sites/${site.id}`, { body: { customDomain: 'Shop.Example.com' } });
    assert.equal(patch.status, 200);
    assert.equal(patch.data.custom_domain, 'shop.example.com');
    db.prepare("UPDATE sites SET domain_verified_at = datetime('now') WHERE id = ?").run(site.id);
    await c('POST', `/api/pages/${indexPage.id}/publish`, { body: {} });
    const html = (await getWithHost(base, '/', 'shop.example.com')).text;
    assert.match(html, /Bản nháp/);
    assert.doesNotMatch(html, /Tạo bởi HiTechCloud/);
  });

  await t.test('pages CRUD', async () => {
    const created = await c('POST', `/api/sites/${site.id}/pages`, { body: { title: 'Cảm ơn', slug: 'cam-on' } });
    assert.equal(created.status, 201);
    assert.equal((await c('POST', `/api/sites/${site.id}/pages`, { body: { title: 'Dup', slug: 'cam-on' } })).status, 409);
    assert.equal((await c('DELETE', `/api/pages/${indexPage.id}`)).status, 400);
    assert.equal((await c('PATCH', `/api/pages/${created.data.id}`, { body: { metaDescription: 'Mô tả' } })).status, 200);
    assert.equal((await c('DELETE', `/api/pages/${created.data.id}`)).status, 200);
  });
});
