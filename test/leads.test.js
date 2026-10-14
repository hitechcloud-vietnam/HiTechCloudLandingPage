'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, verifyEmail } = require('./helpers');

test('lead management: attribution, status, notes, filters', async (t) => {
  const { server, base, db } = await startServer();
  t.after(() => server.close());

  const c = client(base);
  await c('POST', '/api/auth/signup', { name: 'Chủ', email: 'owner@example.com', password: 'matkhau123' });
  verifyEmail(db, 'owner@example.com');
  const wsId = (await c('GET', '/api/auth/me')).data.workspaces[0].id;
  db.prepare("UPDATE workspaces SET plan = 'pro' WHERE id = ?").run(wsId);
  const site = (await c('POST', `/api/workspaces/${wsId}/sites`, { name: 'Shop', subdomain: 'shop', template: 'leadgen' })).data;
  const page = (await c('GET', `/api/sites/${site.id}/pages`)).data[0];
  await c('POST', `/api/pages/${page.id}/publish`, {});

  const submit = (body) =>
    fetch(`${base}/_htc/lead?site=${site.id}&page=index`, {
      method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString(),
    });

  await t.test('published forms carry the attribution script', async () => {
    const html = await (await fetch(`${base}/p/shop?utm_source=facebook`)).text();
    assert.match(html, /utm_source/);
    assert.match(html, /document\.addEventListener\('submit'/);
  });

  await t.test('UTM fields are stored as source, not form data', async () => {
    await submit({ name: 'Nguyễn An', phone: '0901', _utm_source: 'facebook', _utm_campaign: 'tet2027', _ref: 'https://m.facebook.com/', _evil: 'x' });
    await submit({ name: 'Trần Bình', phone: '0902', _utm_source: 'google' });
    await submit({ name: 'Lê 100%_off', phone: '0903' });
    const leads = (await c('GET', `/api/sites/${site.id}/leads`)).data;
    assert.equal(leads.length, 3);
    const an = leads.find((l) => l.data.name === 'Nguyễn An');
    assert.deepEqual(an.data, { name: 'Nguyễn An', phone: '0901' });
    assert.deepEqual(an.source, { utm_source: 'facebook', utm_campaign: 'tet2027', ref: 'https://m.facebook.com/' });
    assert.equal(an.status, 'new');
    const row = db.prepare('SELECT page_id FROM leads WHERE id = ?').get(an.id);
    assert.equal(row.page_id, page.id);
  });

  await t.test('update status and note', async () => {
    const leads = (await c('GET', `/api/sites/${site.id}/leads`)).data;
    const an = leads.find((l) => l.data.name === 'Nguyễn An');
    assert.equal((await c('PATCH', `/api/leads/${an.id}`, { status: 'bogus' })).status, 400);
    assert.equal((await c('PATCH', `/api/leads/${an.id}`, { status: 'won', note: 'Đã chốt đơn 2 máy' })).status, 200);
    const intruder = client(base);
    await intruder('POST', '/api/auth/signup', { name: 'X', email: 'x@example.com', password: 'matkhau123' });
    assert.equal((await intruder('PATCH', `/api/leads/${an.id}`, { status: 'lost' })).status, 404);
  });

  await t.test('filters: status, search (with LIKE wildcards escaped), dates', async () => {
    const get = async (qs) => (await c('GET', `/api/sites/${site.id}/leads?${qs}`)).data.map((l) => l.data.name).sort();
    assert.deepEqual(await get('status=won'), ['Nguyễn An']);
    assert.deepEqual(await get('status=new'), ['Lê 100%_off', 'Trần Bình']);
    assert.deepEqual(await get(`q=${encodeURIComponent('chốt đơn')}`), ['Nguyễn An']);
    assert.deepEqual(await get('q=0902'), ['Trần Bình']);
    assert.deepEqual(await get(`q=${encodeURIComponent('%_')}`), ['Lê 100%_off']);
    const today = new Date().toISOString().slice(0, 10);
    assert.equal((await get(`from=${today}&to=${today}`)).length, 3);
    assert.equal((await get('to=2000-01-01')).length, 0);
  });

  await t.test('CSV export includes status, note and source', async () => {
    const csv = (await c('GET', `/api/sites/${site.id}/leads?format=csv&status=won`)).data;
    const [header, row] = csv.replace(/^﻿/, '').split('\r\n');
    assert.match(header, /"status","note".*"utm_source".*"ref"/);
    assert.match(row, /"won","Đã chốt đơn 2 máy".*"facebook"/);
  });
});
