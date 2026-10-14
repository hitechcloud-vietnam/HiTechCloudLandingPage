'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, verifyEmail } = require('./helpers');

// Smallest valid PNG (1x1 transparent).
const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082',
  'hex'
);

test('assets, versions and duplication', async (t) => {
  const { server, base, db } = await startServer();
  t.after(() => server.close());

  const c = client(base);
  await c('POST', '/api/auth/signup', { name: 'Chủ', email: 'owner@example.com', password: 'matkhau123' });
  verifyEmail(db, 'owner@example.com');
  const wsId = (await c('GET', '/api/auth/me')).data.workspaces[0].id;
  const site = (await c('POST', `/api/workspaces/${wsId}/sites`, { name: 'Shop', subdomain: 'shop', template: 'blank' })).data;
  const page = (await c('GET', `/api/sites/${site.id}/pages`)).data[0];

  const upload = (body, type = 'image/png', extra = {}) =>
    c('POST', `/api/workspaces/${wsId}/assets`, body, { raw: true, headers: { 'Content-Type': type, 'X-File-Name': encodeURIComponent('Ảnh bìa.png'), ...extra } });

  await t.test('upload validates image content and serves it', async () => {
    const r = await upload(PNG);
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.match(r.data.src, new RegExp(`^/uploads/${wsId}/[0-9a-f]{24}\\.png$`));
    assert.equal(r.data.name, 'Ảnh bìa.png');
    const img = await fetch(base + r.data.src);
    assert.equal(img.status, 200);
    assert.equal(img.headers.get('content-type'), 'image/png');
    assert.match(img.headers.get('content-security-policy'), /default-src 'none'/);
    assert.deepEqual(Buffer.from(await img.arrayBuffer()), PNG);

    // Malformed file name header: upload still succeeds with a default name.
    const odd = await upload(PNG, 'image/png', { 'X-File-Name': '%E0%A4%A' });
    assert.equal(odd.status, 201);
    assert.equal(odd.data.name, 'image');
    await c('DELETE', `/api/assets/${odd.data.id}`);

    // HTML disguised as an image is rejected; SVG / other types are not accepted.
    assert.equal((await upload(Buffer.from('<html><script>alert(1)</script></html>'))).status, 415);
    assert.equal((await upload(Buffer.from('<svg onload="alert(1)"/>'), 'image/svg+xml')).status, 415);
    // Cross-origin uploads are blocked like the rest of the API.
    assert.equal((await upload(PNG, 'image/png', { Origin: 'https://evil.example' })).status, 403);

    const list = await c('GET', `/api/workspaces/${wsId}/assets`);
    assert.equal(list.data.assets.length, 1);
    assert.equal(list.data.usedBytes, PNG.length);
    assert.equal(list.data.limitBytes, 50 * 1024 * 1024);
  });

  await t.test('storage quota is enforced', async () => {
    db.prepare('UPDATE assets SET size = ? WHERE workspace_id = ?').run(50 * 1024 * 1024, wsId);
    assert.equal((await upload(PNG)).status, 402);
    db.prepare('UPDATE assets SET size = ? WHERE workspace_id = ?').run(PNG.length, wsId);
  });

  await t.test('other tenants cannot see or delete assets', async () => {
    const intruder = client(base);
    await intruder('POST', '/api/auth/signup', { name: 'X', email: 'x@example.com', password: 'matkhau123' });
    assert.equal((await intruder('GET', `/api/workspaces/${wsId}/assets`)).status, 404);
    const id = (await c('GET', `/api/workspaces/${wsId}/assets`)).data.assets[0].id;
    assert.equal((await intruder('DELETE', `/api/assets/${id}`)).status, 404);
    const asset = (await c('GET', `/api/workspaces/${wsId}/assets`)).data.assets[0];
    assert.equal((await c('DELETE', `/api/assets/${id}`)).status, 200);
    assert.equal((await fetch(base + asset.src)).status, 404);
  });

  await t.test('publish snapshots versions and restore brings back the draft', async () => {
    const save = (html) => c('PUT', `/api/pages/${page.id}/project`, { project: { v: html }, html, css: '' });
    await save('<h1>Phiên bản 1</h1>');
    await c('POST', `/api/pages/${page.id}/publish`, {});
    await save('<h1>Phiên bản 2</h1>');
    await c('POST', `/api/pages/${page.id}/publish`, {});
    await save('<h1>Nháp lỗi</h1>');

    const versions = (await c('GET', `/api/pages/${page.id}/versions`)).data;
    assert.equal(versions.length, 2);
    assert.equal(versions[0].author, 'Chủ');
    const v1 = versions[1];
    assert.equal((await c('POST', `/api/pages/${page.id}/versions/${v1.id}/restore`, {})).status, 200);
    const project = (await c('GET', `/api/pages/${page.id}/project`)).data;
    assert.equal(project.html, '<h1>Phiên bản 1</h1>');
    assert.deepEqual(project.project, { v: '<h1>Phiên bản 1</h1>' });
    // Published page is untouched until republished.
    assert.match(await (await fetch(`${base}/p/shop`)).text(), /Phiên bản 2/);
  });

  await t.test('only the latest 20 versions are kept', async () => {
    for (let i = 0; i < 22; i++) await c('POST', `/api/pages/${page.id}/publish`, {});
    assert.equal((await c('GET', `/api/pages/${page.id}/versions`)).data.length, 20);
  });

  await t.test('duplicate page', async () => {
    const d1 = await c('POST', `/api/pages/${page.id}/duplicate`, {});
    assert.equal(d1.status, 201);
    assert.equal(d1.data.slug, 'trang-chu-copy');
    const d2 = await c('POST', `/api/pages/${page.id}/duplicate`, {});
    assert.equal(d2.data.slug, 'trang-chu-copy-2');
    assert.equal((await c('GET', `/api/pages/${d1.data.id}/project`)).data.html, '<h1>Phiên bản 1</h1>');
    // Free plan: max 3 pages per site.
    assert.equal((await c('POST', `/api/pages/${page.id}/duplicate`, {})).status, 402);
    // Long slugs still produce valid "-copy" slugs.
    db.prepare("UPDATE workspaces SET plan = 'pro' WHERE id = ?").run(wsId);
    const longSlug = `${'a'.repeat(50)}-${'b'.repeat(12)}`;
    const long = (await c('POST', `/api/sites/${site.id}/pages`, { title: 'Dài', slug: longSlug })).data;
    const d3 = (await c('POST', `/api/pages/${long.id}/duplicate`, {})).data;
    assert.match(d3.slug, /^a{50}-copy$/);
    assert.equal((await c('PATCH', `/api/pages/${d3.id}`, { slug: d3.slug })).status, 200);
  });

});

test('deleting a workspace or an account removes its uploaded files', async (t) => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { server, base, db, config } = await startServer();
  t.after(() => server.close());
  const c = client(base);
  await c('POST', '/api/auth/signup', { name: 'Chủ', email: 'xoa@example.com', password: 'matkhau123' });
  const firstWs = (await c('GET', '/api/auth/me')).data.workspaces[0].id;
  const secondWs = (await c('POST', '/api/workspaces', { name: 'Thứ hai' })).data.id;
  const upload = async (wsId) => {
    const r = await c('POST', `/api/workspaces/${wsId}/assets`, PNG, { raw: true, headers: { 'Content-Type': 'image/png' } });
    assert.equal(r.status, 201);
    return path.join(config.uploadsDir, decodeURIComponent(r.data.src.replace(/^\/uploads\//, '')));
  };
  const a = await upload(firstWs);
  const b = await upload(secondWs);
  assert.ok(fs.existsSync(a) && fs.existsSync(b));

  assert.equal((await c('DELETE', `/api/workspaces/${secondWs}`)).status, 200);
  assert.equal(fs.existsSync(b), false);
  assert.ok(fs.existsSync(a));

  assert.equal((await c('POST', '/api/auth/delete-account', { password: 'matkhau123', confirm: 'XOA TAI KHOAN' })).status, 200);
  assert.equal(fs.existsSync(a), false);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM assets').get().n, 0);
});
