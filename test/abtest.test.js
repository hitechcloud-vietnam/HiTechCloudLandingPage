'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client } = require('./helpers');
const { confidence } = require('../src/routes/abtests');

test('confidence of a two-proportion test', () => {
  assert.equal(confidence(0, 0, 0, 0), 0);
  assert.equal(confidence(50, 1000, 50, 1000), 0);
  assert.ok(confidence(50, 1000, 80, 1000) > 99);
  assert.ok(confidence(5, 100, 7, 100) < 80);
});

test('A/B testing: split traffic, sticky buckets, stats, promote winner', async (t) => {
  const { server, base, db } = await startServer();
  t.after(() => server.close());

  const c = client(base);
  await c('POST', '/api/auth/signup', { name: 'Chủ', email: 'owner@example.com', password: 'matkhau123' });
  const wsId = (await c('GET', '/api/auth/me')).data.workspaces[0].id;
  const site = (await c('POST', `/api/workspaces/${wsId}/sites`, { name: 'Shop', subdomain: 'shop', template: 'blank' })).data;
  const control = (await c('GET', `/api/sites/${site.id}/pages`)).data[0];
  const variant = (await c('POST', `/api/sites/${site.id}/pages`, { title: 'Biến thể B', slug: 'bien-the-b' })).data;
  const save = (id, html) => c('PUT', `/api/pages/${id}/project`, { project: {}, html, css: '' });
  await save(control.id, '<h1>Phiên bản A</h1><form><input name="phone"></form>');
  await save(variant.id, '<h1>Phiên bản B</h1><form><input name="phone"></form>');
  await c('POST', `/api/pages/${control.id}/publish`, {});

  await t.test('requires Pro plan and published pages', async () => {
    assert.equal((await c('POST', `/api/sites/${site.id}/ab-tests`, { pageId: control.id, variantPageId: variant.id })).status, 402);
    db.prepare("UPDATE workspaces SET plan = 'pro' WHERE id = ?").run(wsId);
    assert.equal((await c('POST', `/api/sites/${site.id}/ab-tests`, { pageId: control.id, variantPageId: variant.id })).status, 400);
    await c('POST', `/api/pages/${variant.id}/publish`, {});
    assert.equal((await c('POST', `/api/sites/${site.id}/ab-tests`, { pageId: control.id, variantPageId: control.id })).status, 400);
    assert.equal((await c('POST', `/api/sites/${site.id}/ab-tests`, { pageId: control.id, variantPageId: variant.id, split: 100 })).status, 400);
  });

  let testId;
  await t.test('start test; one running test per page', async () => {
    const r = await c('POST', `/api/sites/${site.id}/ab-tests`, { pageId: control.id, variantPageId: variant.id, split: 50 });
    assert.equal(r.status, 201);
    testId = r.data.id;
    assert.equal(r.data.variant.slug, 'bien-the-b');
    assert.equal((await c('POST', `/api/sites/${site.id}/ab-tests`, { pageId: control.id, variantPageId: variant.id })).status, 409);
  });

  // Visitors with their cookie and the form action they were served.
  const visitors = [];
  await t.test('visitors are split and stay in their bucket', async () => {
    const seen = { A: 0, B: 0 };
    for (let i = 0; i < 60; i++) {
      const res = await fetch(`${base}/p/shop`);
      const html = await res.text();
      const which = html.includes('Phiên bản B') ? 'B' : 'A';
      seen[which]++;
      const cookie = res.headers.get('set-cookie');
      assert.match(cookie, new RegExp(`htc_ab_${testId}=[ab]`));
      // Form posts back to the original URL, tagged with test + bucket.
      const action = html.match(/action="([^"]+)"/)[1].replace(/&amp;/g, '&');
      assert.match(action, new RegExp(`page=index&pid=\\d+&ab=${testId}${which.toLowerCase()}$`));
      visitors.push({ which, action });
      // Same visitor (cookie) always gets the same version.
      const again = await (await fetch(`${base}/p/shop`, { headers: { Cookie: cookie.split(';')[0] } })).text();
      assert.equal(again.includes('Phiên bản B') ? 'B' : 'A', which);
      assert.match(again, /rel="canonical" href="https:\/\/shop\.sites\.test\/"/);
    }
    assert.ok(seen.A > 10 && seen.B > 10, JSON.stringify(seen));
  });

  await t.test('stats count only test traffic, per bucket', async () => {
    const post = (action) =>
      fetch(base + action, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'phone=0901234567' });
    const a = visitors.find((v) => v.which === 'A');
    const bs = visitors.filter((v) => v.which === 'B').slice(0, 2);
    const res = await post(a.action);
    assert.equal(res.headers.get('location'), '/p/shop/?submitted=1');
    for (const b of bs) await post(b.action);
    // Direct visits / leads on the variant's own URL are not part of the test.
    await fetch(`${base}/p/shop/bien-the-b`);
    await post(`/_htc/lead?site=${site.id}&page=bien-the-b`);
    const [t1] = (await c('GET', `/api/sites/${site.id}/ab-tests`)).data;
    assert.equal(t1.stats.a.views + t1.stats.b.views, 120);
    assert.equal(t1.stats.a.leads, 1);
    assert.equal(t1.stats.b.leads, 2);
    assert.ok(t1.stats.b.rate > 0);
    assert.equal(typeof t1.stats.confidence, 'number');
    const leadPages = db.prepare('SELECT page_id FROM leads WHERE ab_bucket = ?').all('b').map((l) => l.page_id);
    assert.deepEqual(leadPages, [variant.id, variant.id]);
  });

  await t.test('pages in a running test cannot be unpublished or deleted', async () => {
    assert.equal((await c('POST', `/api/pages/${variant.id}/unpublish`, {})).status, 400);
    assert.equal((await c('DELETE', `/api/pages/${variant.id}`)).status, 400);
    const sitemap = await (await fetch(`${base}/p/shop/sitemap.xml`)).text();
    assert.doesNotMatch(sitemap, /bien-the-b/);
  });

  await t.test('thank-you view is not counted and not re-bucketed', async () => {
    const before = db.prepare('SELECT SUM(views) AS n FROM page_views').get().n;
    const res = await fetch(`${base}/p/shop/?submitted=1`);
    assert.equal(res.headers.get('set-cookie'), null);
    assert.equal(db.prepare('SELECT SUM(views) AS n FROM page_views').get().n, before);
  });

  await t.test('split pauses when the plan lapses', async () => {
    db.prepare("UPDATE workspaces SET plan = 'free' WHERE id = ?").run(wsId);
    for (let i = 0; i < 10; i++) {
      const res = await fetch(`${base}/p/shop`);
      assert.match(await res.text(), /Phiên bản A/);
      assert.equal(res.headers.get('set-cookie'), null);
    }
    db.prepare("UPDATE workspaces SET plan = 'pro' WHERE id = ?").run(wsId);
  });

  await t.test('stopping with winner B promotes the variant to the original URL', async () => {
    const intruder = client(base);
    await intruder('POST', '/api/auth/signup', { name: 'X', email: 'x@example.com', password: 'matkhau123' });
    assert.equal((await intruder('POST', `/api/ab-tests/${testId}/stop`, { winner: 'b' })).status, 404);

    await save(control.id, '<h1>Nháp chưa xuất bản của A</h1>');
    const r = await c('POST', `/api/ab-tests/${testId}/stop`, { winner: 'b' });
    assert.equal(r.data.status, 'stopped');
    // The original's unpublished draft was snapshotted before being replaced.
    const versions = (await c('GET', `/api/pages/${control.id}/versions`)).data;
    const latest = db.prepare('SELECT html FROM page_versions WHERE id = ?').get(versions[0].id);
    assert.equal(latest.html, '<h1>Nháp chưa xuất bản của A</h1>');
    assert.equal(r.data.winner, 'b');
    for (let i = 0; i < 5; i++) assert.match(await (await fetch(`${base}/p/shop`)).text(), /Phiên bản B/);
    assert.equal((await c('GET', `/api/pages/${control.id}/project`)).data.html, '<h1>Phiên bản B</h1><form><input name="phone"></form>');
    assert.equal((await c('POST', `/api/ab-tests/${testId}/stop`, {})).status, 400);
  });
});
