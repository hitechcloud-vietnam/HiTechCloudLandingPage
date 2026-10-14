'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client } = require('./helpers');
const { truncate, discordPayload, slackPayload } = require('../src/notify');

const SLACK = 'https://hooks.slack.com/services/T000/B000/XXXXsecretSLACK';
const DISCORD = 'https://discord.com/api/webhooks/123456789/secretDISCORD_token-1';
const SHEETS = 'https://script.google.com/macros/s/AKfycbSecretSHEETS_id-1/exec';

test('Slack, Discord and Google Sheets lead channels', async (t) => {
  const calls = [];
  let sheetsStatus = 302;
  const fakeFetch = async (url, opts) => {
    calls.push({ url, opts });
    const status = url === SHEETS ? sheetsStatus : url === DISCORD ? 204 : 200;
    return { ok: status >= 200 && status < 300, status, json: async () => ({}) };
  };
  const { server, base } = await startServer({ fetch: fakeFetch });
  t.after(() => server.close());

  const c = client(base);
  await c('POST', '/api/auth/signup', { name: 'Chủ', email: 'owner@example.com', password: 'matkhau123' });
  const wsId = (await c('GET', '/api/auth/me')).data.workspaces[0].id;
  const site = (await c('POST', `/api/workspaces/${wsId}/sites`, { name: 'Shop', subdomain: 'shop', template: 'leadgen' })).data;
  const pages = (await c('GET', `/api/sites/${site.id}/pages`)).data;
  await c('POST', `/api/pages/${pages[0].id}/publish`, {});
  const patch = (body) => c('PATCH', `/api/sites/${site.id}/settings`, body);

  await t.test('rejects URLs outside the fixed provider hosts', async () => {
    for (const body of [
      { slackWebhookUrl: 'http://hooks.slack.com/services/T0/B0/x' },
      { slackWebhookUrl: 'https://hooks.slack.com.evil.com/services/T0/B0/x' },
      { slackWebhookUrl: 'https://evil.com/?https://hooks.slack.com/services/x' },
      { discordWebhookUrl: 'https://discord.com/api/webhooks/abc/token' },
      { discordWebhookUrl: 'https://evil.com/api/webhooks/1/token' },
      { discordWebhookUrl: `${DISCORD}?wait=true` },
      { sheetsWebhookUrl: 'https://script.google.com/macros/s/abc/dev' },
      { sheetsWebhookUrl: 'https://script.googleusercontent.com/macros/s/abc/exec' },
      { sheetsWebhookUrl: `https://script.google.com/macros/s/${'a'.repeat(600)}/exec` },
    ]) {
      const r = await patch(body);
      assert.equal(r.status, 400, JSON.stringify(body));
      assert.match(r.data.error, /không hợp lệ/);
    }
  });

  await t.test('secrets are stored but never echoed', async () => {
    const r = await patch({ notifyOwners: false, slackWebhookUrl: SLACK, discordWebhookUrl: DISCORD, sheetsWebhookUrl: SHEETS });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const st = r.data.settings;
    assert.equal(st.hasSlackWebhook, true);
    assert.equal(st.hasDiscordWebhook, true);
    assert.equal(st.hasSheetsWebhook, true);
    assert.equal(st.hasTelegramToken, false);
    assert.doesNotMatch(JSON.stringify(r.data), /secretSLACK|secretDISCORD|SecretSHEETS/);
    assert.doesNotMatch(JSON.stringify((await c('GET', `/api/sites/${site.id}`)).data), /secretSLACK|secretDISCORD|SecretSHEETS/);
    assert.doesNotMatch(JSON.stringify((await c('GET', `/api/workspaces/${wsId}/sites`)).data), /secretSLACK|secretDISCORD|SecretSHEETS/);

    // Blank keeps the stored value; discordapp.com is also accepted.
    await patch({ slackWebhookUrl: '', discordWebhookUrl: 'https://discordapp.com/api/webhooks/1/abc', sheetsWebhookUrl: '' });
    const kept = (await c('GET', `/api/sites/${site.id}`)).data.settings;
    assert.equal(kept.hasSlackWebhook, true);
    assert.equal(kept.hasSheetsWebhook, true);
    await patch({ discordWebhookUrl: DISCORD });
  });

  await t.test('notify-test reports each channel', async () => {
    calls.length = 0;
    const r = await c('POST', `/api/sites/${site.id}/notify-test`, {});
    assert.equal(r.status, 200);
    assert.deepEqual(r.data, { slack: 'ok', discord: 'ok', sheets: 'ok' });
    for (const call of calls) assert.equal(call.opts.redirect, 'manual');
  });

  await t.test('lead payload shapes per channel', async () => {
    calls.length = 0;
    const res = await fetch(`${base}/_htc/lead?site=${site.id}&page=index`, {
      method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ name: 'An <!channel>', phone: '0909', site: 'spoof', _utm_source: 'facebook', _utm_campaign: 'tet', _ref: 'https://fb.com/' }).toString(),
    });
    assert.equal(res.status, 303);
    await new Promise((r) => setTimeout(r, 50));

    const slack = JSON.parse(calls.find((x) => x.url === SLACK).opts.body);
    assert.deepEqual(Object.keys(slack), ['text']);
    assert.match(slack.text, /\*name:\* An &lt;!channel&gt;/);
    assert.match(slack.text, /\*phone:\* 0909/);
    assert.match(slack.text, /Lead mới từ "Shop"/);
    assert.match(slack.text, /<http:\/\/localhost:3999\/app\/site\?id=\d+\|Xem tất cả lead>/);

    const discord = JSON.parse(calls.find((x) => x.url === DISCORD).opts.body);
    assert.match(discord.content, /phone: 0909/);
    assert.deepEqual(discord.allowed_mentions, { parse: [] });

    const row = JSON.parse(calls.find((x) => x.url === SHEETS).opts.body);
    assert.match(row.createdAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.deepEqual({ ...row, createdAt: undefined }, {
      createdAt: undefined, site: 'Shop', page: 'index', name: 'An <!channel>', phone: '0909',
      utm_source: 'facebook', utm_campaign: 'tet', ref: 'https://fb.com/',
    });
  });

  await t.test('Sheets: 302 is success, errors are reported per channel', async () => {
    sheetsStatus = 200;
    assert.equal((await c('POST', `/api/sites/${site.id}/notify-test`, {})).data.sheets, 'ok');
    sheetsStatus = 500;
    const r = await c('POST', `/api/sites/${site.id}/notify-test`, {});
    assert.equal(r.data.sheets, 'Google Sheets trả về HTTP 500');
    assert.equal(r.data.slack, 'ok');
    sheetsStatus = 302;
  });

  await t.test('"-" clears a channel', async () => {
    await patch({ slackWebhookUrl: '-', discordWebhookUrl: '-', sheetsWebhookUrl: '-' });
    const st = (await c('GET', `/api/sites/${site.id}`)).data.settings;
    assert.equal(st.hasSlackWebhook, false);
    assert.equal(st.hasDiscordWebhook, false);
    assert.equal(st.hasSheetsWebhook, false);
    assert.deepEqual((await c('POST', `/api/sites/${site.id}/notify-test`, {})).data, {});
  });
});

test('Slack/Discord formatting helpers', () => {
  const long = 'x'.repeat(5000);
  const d = discordPayload(long);
  assert.equal(d.content.length, 2000);
  assert.ok(d.content.endsWith('…'));
  assert.equal(discordPayload('ngắn').content, 'ngắn');
  // Never splits a surrogate pair.
  const emoji = truncate('a' + '😀'.repeat(10), 5);
  assert.equal(emoji, 'a😀…');
  const s = slackPayload({ site: { name: 'A&B' }, pageSlug: 'uu-dai', data: { note: '<@U123> & co' }, link: 'https://x.vn/app' });
  assert.match(s.text, /"A&amp;B"\* \(\/uu-dai\)/);
  assert.match(s.text, /\*note:\* &lt;@U123&gt; &amp; co/);
});
