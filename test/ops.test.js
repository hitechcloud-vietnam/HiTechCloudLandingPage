'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, getWithHost } = require('./helpers');
const { createMailer } = require('../src/mailer');
const { sendExpiryReminders } = require('../src/jobs');

test('custom domain verification and TLS ask', async (t) => {
  const dnsRecords = { txt: {}, cname: {} };
  const dnsResolver = {
    resolveTxt: async (name) => {
      if (!dnsRecords.txt[name]) throw Object.assign(new Error('ENODATA'), { code: 'ENODATA' });
      return dnsRecords.txt[name];
    },
    resolveCname: async (name) => {
      if (!dnsRecords.cname[name]) throw Object.assign(new Error('ENODATA'), { code: 'ENODATA' });
      return dnsRecords.cname[name];
    },
  };
  const { server, base, db } = await startServer({ dnsResolver, cnameTarget: 'sites.hitechcloud.site' });
  t.after(() => server.close());

  const c = client(base);
  await c('POST', '/api/auth/signup', { name: 'Chủ', email: 'owner@example.com', password: 'matkhau123' });
  const wsId = (await c('GET', '/api/auth/me')).data.workspaces[0].id;
  db.prepare("UPDATE workspaces SET plan = 'pro' WHERE id = ?").run(wsId);
  const site = (await c('POST', `/api/workspaces/${wsId}/sites`, { name: 'Shop', subdomain: 'shop' })).data;
  const page = (await c('GET', `/api/sites/${site.id}/pages`)).data[0];
  await c('POST', `/api/pages/${page.id}/publish`, {});

  const tlsAsk = async (domain) => (await fetch(`${base}/_htc/tls-ask?domain=${domain}`)).status;

  await t.test('unverified domain is not served and gets no certificate', async () => {
    const r = await c('PATCH', `/api/sites/${site.id}`, { customDomain: 'khuyenmai.congty.vn' });
    assert.equal(r.data.domain.verified, false);
    assert.equal(r.data.domain.txtName, '_htc-verify.khuyenmai.congty.vn');
    assert.match(r.data.domain.txtValue, /^htc-verify=[0-9a-f]{32}$/);
    assert.equal(r.data.domain.cnameTarget, 'sites.hitechcloud.site');
    assert.equal(r.data.domain_token, undefined);
    assert.equal((await getWithHost(base, '/', 'khuyenmai.congty.vn')).status, 404);
    assert.equal(await tlsAsk('khuyenmai.congty.vn'), 404);
    assert.equal((await c('POST', `/api/sites/${site.id}/verify-domain`, {})).status, 400);
  });

  await t.test('TXT record verifies the domain', async () => {
    const info = (await c('GET', `/api/sites/${site.id}`)).data.domain;
    dnsRecords.txt[info.txtName] = [['some-other'], [info.txtValue.slice(0, 10), info.txtValue.slice(10)]];
    const r = await c('POST', `/api/sites/${site.id}/verify-domain`, {});
    assert.equal(r.status, 200);
    assert.equal(r.data.domain.verified, true);
    assert.equal(await tlsAsk('khuyenmai.congty.vn'), 200);
    const res = await getWithHost(base, '/', 'khuyenmai.congty.vn');
    assert.equal(res.status, 200);
    assert.match(res.text, /rel="canonical" href="https:\/\/khuyenmai\.congty\.vn\/"/);
  });

  await t.test('changing the domain resets verification', async () => {
    const r = await c('PATCH', `/api/sites/${site.id}`, { customDomain: 'www.congty.vn' });
    assert.equal(r.data.domain.verified, false);
    assert.equal(await tlsAsk('khuyenmai.congty.vn'), 404);
    dnsRecords.cname['www.congty.vn'] = ['Sites.HiTechCloud.site.'];
    assert.equal((await c('POST', `/api/sites/${site.id}/verify-domain`, {})).data.domain.verified, true);
  });

  await t.test('TLS ask covers platform subdomains only for existing sites', async () => {
    assert.equal(await tlsAsk('shop.sites.test'), 200);
    assert.equal(await tlsAsk('nope.sites.test'), 404);
    assert.equal(await tlsAsk('a.b.sites.test'), 404);
    assert.equal(await tlsAsk('evil.example'), 404);
  });

  await t.test('editors cannot verify domains', async () => {
    const ed = client(base);
    await ed('POST', '/api/auth/signup', { name: 'Ed', email: 'ed@example.com', password: 'matkhau123' });
    await c('POST', `/api/workspaces/${wsId}/members`, { email: 'ed@example.com' });
    assert.equal((await ed('POST', `/api/sites/${site.id}/verify-domain`, {})).status, 403);
  });
});

test('subscription expiry reminders are sent once per stage', async () => {
  const { server, base, db } = await startServer();
  try {
    const c = client(base);
    await c('POST', '/api/auth/signup', { name: 'Chủ', email: 'owner@example.com', password: 'matkhau123' });
    const wsId = (await c('GET', '/api/auth/me')).data.workspaces[0].id;
    const mailer = createMailer({ quietMail: true });
    const config = { appUrl: 'https://app.test' };
    const now = new Date('2026-10-14T00:00:00Z');
    const expires = new Date('2026-10-20T00:00:00Z').toISOString(); // 6 days left
    db.prepare("UPDATE workspaces SET plan = 'pro', plan_expires_at = ? WHERE id = ?").run(expires, wsId);

    assert.equal(sendExpiryReminders({ db, mailer, config, now }), 1);
    assert.equal(mailer.outbox.length, 1);
    assert.match(mailer.outbox[0].subject, /sắp hết hạn/);
    assert.match(mailer.outbox[0].text, /còn 6 ngày/);
    assert.equal(sendExpiryReminders({ db, mailer, config, now: new Date('2026-10-15T00:00:00Z') }), 0);

    // 1-day stage fires once.
    assert.equal(sendExpiryReminders({ db, mailer, config, now: new Date('2026-10-19T06:00:00Z') }), 1);
    assert.equal(sendExpiryReminders({ db, mailer, config, now: new Date('2026-10-19T12:00:00Z') }), 0);

    // Renewal moves the expiry date, so reminders start again for the new period.
    db.prepare('UPDATE workspaces SET plan_expires_at = ? WHERE id = ?').run(new Date('2026-11-20T00:00:00Z').toISOString(), wsId);
    assert.equal(sendExpiryReminders({ db, mailer, config, now: new Date('2026-11-14T00:00:00Z') }), 1);
    // Free / no-expiry workspaces are ignored.
    db.prepare("UPDATE workspaces SET plan = 'free' WHERE id = ?").run(wsId);
    assert.equal(sendExpiryReminders({ db, mailer, config, now: new Date('2026-11-19T00:00:00Z') }), 0);
  } finally {
    server.close();
  }
});
