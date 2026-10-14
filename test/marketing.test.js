'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { startServer, client, getWithHost, verifyEmail } = require('./helpers');
const { isPrivateAddress, assertPublicUrl, guardedLookup, httpsPostJson } = require('../src/notify');

test('site integrations: tracking, SEO files, lead notifications', async (t) => {
  const calls = [];
  const fakeFetch = async (url, opts) => {
    calls.push({ url, opts });
    return { ok: true, status: 200, json: async () => ({}) };
  };
  const { server, base, db, outbox } = await startServer({ fetch: fakeFetch, allowPrivateWebhooks: true });
  t.after(() => server.close());

  const c = client(base);
  await c('POST', '/api/auth/signup', { name: 'Chủ', email: 'owner@example.com', password: 'matkhau123' });
  verifyEmail(db, 'owner@example.com');
  const wsId = (await c('GET', '/api/auth/me')).data.workspaces[0].id;
  const site = (await c('POST', `/api/workspaces/${wsId}/sites`, { name: 'Shop', subdomain: 'shop', template: 'leadgen' })).data;
  const pages = (await c('GET', `/api/sites/${site.id}/pages`)).data;
  await c('POST', `/api/pages/${pages[0].id}/publish`, {});

  await t.test('settings validation', async () => {
    const patch = (body) => c('PATCH', `/api/sites/${site.id}/settings`, body);
    assert.equal((await patch({ ga4Id: "G-1');alert(1)//" })).status, 400);
    assert.equal((await patch({ fbPixelId: 'abc' })).status, 400);
    assert.equal((await patch({ webhookUrl: 'http://insecure.example' })).status, 400);
    assert.equal((await patch({ notifyEmails: 'a@b.vn, bad' })).status, 400);
    assert.equal((await patch({ customHead: '<script>x</script>' })).status, 402); // free plan
    const ok = await patch({
      ga4Id: 'G-ABC1234', fbPixelId: '123456789012', tiktokPixelId: 'C1234567890ABC', gtmId: 'GTM-AB12CD',
      faviconUrl: 'https://cdn.example.com/f.png', notifyEmails: 'Sales@Example.com; ops@example.com',
      webhookUrl: 'https://hooks.example.com/lead', telegramBotToken: '123456789:AAAbbbCCCdddEEEfffGGGhhhIIIjjjKKKl', telegramChatId: '-100123456',
    });
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    assert.deepEqual(ok.data.settings.notifyEmails, ['sales@example.com', 'ops@example.com']);
    assert.equal(ok.data.settings.telegramBotToken, undefined);
    assert.equal(ok.data.settings.hasTelegramToken, true);
    assert.match(ok.data.settings.webhookSecret, /^[0-9a-f]{48}$/);
    // Secrets never leak through the site list.
    const list = await c('GET', `/api/workspaces/${wsId}/sites`);
    assert.doesNotMatch(JSON.stringify(list.data), /AAAbbb|settings_json/);
    // Blank secret keeps the stored token.
    await patch({ telegramBotToken: '' });
    assert.equal((await c('GET', `/api/sites/${site.id}`)).data.settings.hasTelegramToken, true);
  });

  await t.test('published page includes tracking and SEO tags', async () => {
    await c('PATCH', `/api/pages/${pages[0].id}`, { ogImage: 'https://cdn.example.com/og.jpg' });
    await c('POST', `/api/pages/${pages[0].id}/publish`, {});
    const html = await (await fetch(`${base}/p/shop`)).text();
    assert.match(html, /gtag\/js\?id=G-ABC1234/);
    assert.match(html, /fbq\('init','123456789012'\)/);
    assert.match(html, /ttq\.load\('C1234567890ABC'\)/);
    assert.match(html, /GTM-AB12CD/);
    assert.match(html, /<link rel="icon" href="https:\/\/cdn\.example\.com\/f\.png">/);
    assert.match(html, /og:image" content="https:\/\/cdn\.example\.com\/og\.jpg"/);
    assert.match(html, /rel="canonical" href="https:\/\/shop\.sites\.test\/"/);
    assert.doesNotMatch(html, /fbq\('track','Lead'\)/);
    const thanks = await (await fetch(`${base}/p/shop/?submitted=1`)).text();
    assert.match(thanks, /fbq\('track','Lead'\)/);
    assert.match(thanks, /ttq\.track\('SubmitForm'\)/);
  });

  await t.test('custom code on Pro plan', async () => {
    db.prepare("UPDATE workspaces SET plan = 'pro' WHERE id = ?").run(wsId);
    const r = await c('PATCH', `/api/sites/${site.id}/settings`, { customHead: '<meta name="x-custom" content="1">', customBody: '<div id="chat-widget"></div>' });
    assert.equal(r.status, 200);
    const html = await (await fetch(`${base}/p/shop`)).text();
    assert.match(html, /x-custom/);
    assert.match(html, /chat-widget/);
    // Lapsed subscription: custom code stops being injected.
    db.prepare("UPDATE workspaces SET plan_expires_at = '2020-01-01T00:00:00Z' WHERE id = ?").run(wsId);
    assert.doesNotMatch(await (await fetch(`${base}/p/shop`)).text(), /x-custom|chat-widget/);
    db.prepare('UPDATE workspaces SET plan_expires_at = NULL WHERE id = ?').run(wsId);
  });

  await t.test('sitemap.xml and robots.txt', async () => {
    const sm = await getWithHost(base, '/sitemap.xml', 'shop.sites.test');
    assert.match(sm.headers['content-type'], /xml/);
    assert.match(sm.text, /<loc>https:\/\/shop\.sites\.test\/<\/loc>/);
    const robots = await (await fetch(`${base}/p/shop/robots.txt`)).text();
    assert.match(robots, /Sitemap: https:\/\/shop\.sites\.test\/sitemap\.xml/);
  });

  await t.test('new lead notifies email, webhook (signed) and Telegram', async () => {
    calls.length = 0;
    const before = outbox.length;
    const res = await fetch(`${base}/_htc/lead?site=${site.id}&page=index`, {
      method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'name=An&phone=0909123456',
    });
    assert.equal(res.status, 303);
    await new Promise((r) => setTimeout(r, 50));

    const mails = outbox.slice(before).map((m) => m.to).sort();
    assert.deepEqual(mails, ['ops@example.com', 'owner@example.com', 'sales@example.com']);
    assert.match(outbox.at(-1).text, /phone: 0909123456/);

    const hook = calls.find((x) => x.url === 'https://hooks.example.com/lead');
    const payload = JSON.parse(hook.opts.body);
    assert.equal(payload.event, 'lead.created');
    assert.deepEqual(payload.data, { name: 'An', phone: '0909123456' });
    const secret = (await c('GET', `/api/sites/${site.id}`)).data.settings.webhookSecret;
    const expected = crypto.createHmac('sha256', secret).update(hook.opts.body).digest('hex');
    assert.equal(hook.opts.headers['X-HTC-Signature'], `sha256=${expected}`);

    const tg = calls.find((x) => x.url.startsWith('https://api.telegram.org/bot123456789:'));
    assert.equal(JSON.parse(tg.opts.body).chat_id, '-100123456');
  });

  await t.test('notify-test endpoint reports channel results', async () => {
    const r = await c('POST', `/api/sites/${site.id}/notify-test`, {});
    assert.deepEqual(r.data, { email: 'ok', webhook: 'ok', telegram: 'ok' });
  });
});

test('webhook SSRF guard', async () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '::1', 'fd00::1', '::ffff:10.0.0.1']) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700::1111']) assert.equal(isPrivateAddress(ip), false, ip);
  assert.throws(() => assertPublicUrl('https://127.0.0.1/hook'), /nội bộ/);
  assert.throws(() => assertPublicUrl('https://[::1]/hook'), /nội bộ/);
  assert.throws(() => assertPublicUrl('http://8.8.8.8/'), /https/);
  // Hostnames are checked at connect time, on the address actually used.
  await assert.rejects(httpsPostJson('https://localhost:9/hook', '{}', {}), /nội bộ/);
  await new Promise((resolve) => guardedLookup('localhost', {}, (err) => { assert.match(err.message, /nội bộ/); resolve(); }));
});
