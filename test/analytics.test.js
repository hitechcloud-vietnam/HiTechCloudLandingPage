'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client } = require('./helpers');
const { ranges, change } = require('../src/routes/analytics');

const day = (offset) => new Date(Date.now() - offset * 86400_000).toISOString().slice(0, 10);

test('UTC ranges and relative change', () => {
  const now = Date.UTC(2026, 9, 14, 23, 30);
  const r = ranges(7, now);
  assert.deepEqual([r.current.from, r.current.to], ['2026-10-08', '2026-10-14']);
  assert.deepEqual([r.previous.from, r.previous.to], ['2026-10-01', '2026-10-07']);
  assert.equal(change(150, 100), 50);
  assert.equal(change(50, 200), -75);
  assert.equal(change(0, 0), 0);
  assert.equal(change(5, 0), null);
});

test('site analytics: series, totals, grouping, isolation', async (t) => {
  const { server, base, db } = await startServer();
  t.after(() => server.close());

  const c = client(base);
  await c('POST', '/api/auth/signup', { name: 'Chủ', email: 'owner@example.com', password: 'matkhau123' });
  const wsId = (await c('GET', '/api/auth/me')).data.workspaces[0].id;
  const site = (await c('POST', `/api/workspaces/${wsId}/sites`, { name: 'Shop', subdomain: 'shop', template: 'blank' })).data;
  const index = (await c('GET', `/api/sites/${site.id}/pages`)).data[0];
  const promo = (await c('POST', `/api/sites/${site.id}/pages`, { title: 'Khuyến mãi', slug: 'khuyen-mai' })).data;

  const views = db.prepare('INSERT INTO page_views (page_id, day, views) VALUES (?, ?, ?)');
  views.run(index.id, day(0), 100);
  views.run(index.id, day(3), 50);
  views.run(promo.id, day(1), 50);
  views.run(index.id, day(10), 40); // outside 7 days, inside 30
  views.run(index.id, day(8), 80); // previous 7-day period
  views.run(promo.id, day(40), 999); // outside 30 days

  const lead = db.prepare('INSERT INTO leads (site_id, page_id, page_slug, data_json, source_json, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const at = (offset, time = '12:00:00') => `${day(offset)} ${time}`;
  lead.run(site.id, index.id, 'index', '{}', JSON.stringify({ utm_source: 'Facebook', ref: 'https://google.com/' }), 'new', at(0, '00:00:00'));
  lead.run(site.id, index.id, 'index', '{}', JSON.stringify({ utm_source: 'facebook' }), 'won', at(0, '23:59:59'));
  lead.run(site.id, promo.id, 'khuyen-mai', '{}', JSON.stringify({ ref: 'https://www.google.com/search?q=x' }), 'contacted', at(1));
  lead.run(site.id, null, 'khuyen-mai', '{}', '{}', 'new', at(2)); // legacy lead without page_id
  lead.run(site.id, index.id, 'index', '{}', JSON.stringify({ ref: 'https://shop.sites.test/khuyen-mai' }), 'lost', at(6)); // internal referral
  lead.run(site.id, index.id, 'index', '{}', '{}', 'new', at(9)); // previous period
  lead.run(site.id, index.id, 'index', '{}', '{}', 'new', at(7, '23:59:59')); // previous period, last second

  await t.test('zero-filled series covers each day of the range', async () => {
    for (const days of [7, 30, 90]) {
      const r = await c('GET', `/api/sites/${site.id}/analytics?days=${days}`);
      assert.equal(r.status, 200);
      assert.equal(r.data.series.length, days);
      assert.equal(r.data.series[0].day, day(days - 1));
      assert.equal(r.data.series.at(-1).day, day(0));
      assert.equal(r.data.from, day(days - 1));
    }
    const def = await c('GET', `/api/sites/${site.id}/analytics`);
    assert.equal(def.data.days, 30);
    assert.equal(def.data.series.length, 30);
    const s7 = (await c('GET', `/api/sites/${site.id}/analytics?days=7`)).data.series;
    assert.deepEqual(s7.at(-1), { day: day(0), views: 100, leads: 2 });
    assert.deepEqual(s7.at(-2), { day: day(1), views: 50, leads: 1 });
    assert.deepEqual(s7.at(-5), { day: day(4), views: 0, leads: 0 });
  });

  await t.test('totals, conversion rate and previous-period change', async () => {
    const { totals } = (await c('GET', `/api/sites/${site.id}/analytics?days=7`)).data;
    assert.equal(totals.views, 200);
    assert.equal(totals.leads, 5);
    assert.equal(totals.conversionRate, 2.5);
    assert.equal(totals.previous.views, 120);
    assert.equal(totals.previous.leads, 2);
    assert.equal(totals.previous.conversionRate, 1.67);
    assert.equal(totals.change.views, 66.7);
    assert.equal(totals.change.leads, 150);

    const t30 = (await c('GET', `/api/sites/${site.id}/analytics?days=30`)).data.totals;
    assert.equal(t30.views, 320);
    assert.equal(t30.leads, 7);
    assert.equal(t30.previous.views, 999);
    assert.equal(t30.previous.leads, 0);
    assert.equal(t30.change.leads, null);
  });

  await t.test('groups by page, source and status', async () => {
    const r = (await c('GET', `/api/sites/${site.id}/analytics?days=7`)).data;
    assert.deepEqual(r.byPage, [
      { pageId: index.id, title: index.title, slug: 'index', views: 150, leads: 3, rate: 2 },
      { pageId: promo.id, title: 'Khuyến mãi', slug: 'khuyen-mai', views: 50, leads: 2, rate: 4 },
    ]);
    // utm_source wins over referrer, case-insensitive; www. stripped; own host = direct.
    assert.deepEqual(r.bySource, [
      { source: 'facebook', leads: 2 },
      { source: 'Trực tiếp', leads: 2 },
      { source: 'google.com', leads: 1 },
    ]);
    assert.deepEqual(r.byStatus, { new: 2, contacted: 1, qualified: 0, won: 1, lost: 1 });
  });

  await t.test('invalid days is rejected', async () => {
    for (const d of ['0', '14', 'abc', '-7', '7.5', '']) {
      assert.equal((await c('GET', `/api/sites/${site.id}/analytics?days=${d}`)).status, 400, d);
    }
  });

  await t.test('other workspaces cannot read it', async () => {
    const other = client(base);
    await other('POST', '/api/auth/signup', { name: 'Khác', email: 'other@example.com', password: 'matkhau123' });
    assert.equal((await other('GET', `/api/sites/${site.id}/analytics`)).status, 404);
    // Their own empty site: zero totals, null rates, nothing grouped.
    const otherWs = (await other('GET', '/api/auth/me')).data.workspaces[0].id;
    const own = (await other('POST', `/api/workspaces/${otherWs}/sites`, { name: 'Trống', subdomain: 'trong', template: 'blank' })).data;
    const r = (await other('GET', `/api/sites/${own.id}/analytics?days=7`)).data;
    assert.equal(r.totals.views, 0);
    assert.equal(r.totals.conversionRate, null);
    assert.equal(r.totals.change.views, 0);
    assert.deepEqual(r.byPage, []);
    assert.deepEqual(r.bySource, []);
    assert.ok(r.series.every((d) => d.views === 0 && d.leads === 0));
    const anon = client(base);
    assert.equal((await anon('GET', `/api/sites/${site.id}/analytics`)).status, 401);
  });
});
