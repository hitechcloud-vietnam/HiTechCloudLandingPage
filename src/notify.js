'use strict';

const crypto = require('node:crypto');
const dnsCb = require('node:dns');
const https = require('node:https');
const net = require('node:net');
const { parse } = require('./siteSettings');

// Blocks webhook delivery to loopback, private, link-local (cloud metadata)
// and other non-public ranges so a customer webhook cannot probe our network.
function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224
    );
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return isPrivateAddress(v.slice(7));
  return v === '::' || v === '::1' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb');
}

// Validates the URL shape; IP-literal hosts are checked here because no DNS
// lookup happens for them at connect time.
function assertPublicUrl(url) {
  const u = new URL(url);
  if (u.protocol !== 'https:') throw new Error('Webhook phải dùng https');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host) && isPrivateAddress(host)) throw new Error('Webhook trỏ tới địa chỉ nội bộ');
}

// DNS lookup used for the actual connection: rejects private addresses at
// connect time, so a rebinding DNS answer cannot slip past an earlier check.
function guardedLookup(hostname, options, callback) {
  dnsCb.lookup(hostname, { ...options, all: true }, (err, addrs) => {
    if (err) return callback(err);
    if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) {
      return callback(new Error('Webhook trỏ tới địa chỉ nội bộ'));
    }
    if (options && options.all) return callback(null, addrs);
    callback(null, addrs[0].address, addrs[0].family);
  });
}

function httpsPostJson(url, body, headers) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: 'POST', headers: { ...headers, 'Content-Length': Buffer.byteLength(body) }, lookup: guardedLookup, timeout: 10000 }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('timeout', () => req.destroy(new Error('Webhook quá thời gian chờ')));
    req.on('error', reject);
    req.end(body);
  });
}

function formatLead(data) {
  return Object.entries(data)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
}

// Cuts text to at most max UTF-16 units without splitting a surrogate pair.
function truncate(text, max) {
  if (text.length <= max) return text;
  let cut = text.slice(0, max - 1);
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
  return `${cut}…`;
}

// Slack mrkdwn: escape control characters so lead data cannot inject links or @channel.
function slackEscape(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const DISCORD_MAX = 2000;
const SLACK_MAX = 39000;

function slackPayload({ site, pageSlug, data, link }) {
  const lines = Object.entries(data).map(([k, v]) => `*${slackEscape(k)}:* ${slackEscape(v)}`);
  const text = `:bell: *Lead mới từ "${slackEscape(site.name)}"* (/${pageSlug === 'index' ? '' : pageSlug})\n\n${lines.join('\n')}\n\n<${link}|Xem tất cả lead>`;
  return { text: truncate(text, SLACK_MAX) };
}

function discordPayload(text) {
  // allowed_mentions: lead data must never ping @everyone / roles / users.
  return { content: truncate(text, DISCORD_MAX), allowed_mentions: { parse: [] } };
}

// Flat row for a Google Apps Script appendRow(); built-in columns win over form fields of the same name.
function sheetsRow({ site, pageSlug, data, source = {}, createdAt }) {
  const row = { createdAt, site: site.name, page: pageSlug };
  for (const [k, v] of Object.entries(data)) if (!(k in row)) row[k] = v;
  row.utm_source = source.utm_source || '';
  row.utm_campaign = source.utm_campaign || '';
  row.ref = source.ref || '';
  return row;
}

function createNotifier({ db, config, mailer }) {
  const fetch = config.fetch || globalThis.fetch;
  const allowPrivateWebhooks = !!config.allowPrivateWebhooks; // tests only

  // POSTs JSON through the injected transport (tests) or the SSRF-guarded https client.
  // Redirects are never followed; okRedirect treats 3xx as delivered.
  async function postJson(url, payload, { headers = {}, okRedirect = false, name }) {
    const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const allHeaders = { 'Content-Type': 'application/json', 'User-Agent': 'HiTechCloud-Webhook/1.0', ...headers };
    let status;
    if (config.fetch) {
      status = (await fetch(url, { method: 'POST', redirect: 'manual', headers: allHeaders, body, signal: AbortSignal.timeout(10000) })).status;
    } else {
      status = await httpsPostJson(url, body, allHeaders);
    }
    const ok = status >= 200 && status < (okRedirect ? 400 : 300);
    if (!ok) throw new Error(`${name} trả về HTTP ${status}`);
  }

  async function sendWebhook(settings, payload) {
    if (!allowPrivateWebhooks) assertPublicUrl(settings.webhookUrl);
    const body = JSON.stringify(payload);
    const signature = crypto.createHmac('sha256', settings.webhookSecret || '').update(body).digest('hex');
    await postJson(settings.webhookUrl, body, { headers: { 'X-HTC-Signature': `sha256=${signature}` }, name: 'Webhook' });
  }

  async function sendTelegram(settings, text) {
    const res = await fetch(`https://api.telegram.org/bot${settings.telegramBotToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: settings.telegramChatId, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`Telegram trả về HTTP ${res.status}`);
  }

  function recipients(site, settings) {
    const list = new Set(settings.notifyEmails || []);
    if (settings.notifyOwners !== false) {
      for (const r of db
        .prepare("SELECT u.email FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? AND m.role IN ('owner', 'admin')")
        .all(site.workspace_id)) {
        list.add(r.email);
      }
    }
    return [...list];
  }

  // Delivers a new-lead notification on every configured channel.
  // Returns per-channel results; never throws.
  async function leadCreated({ site, pageSlug, data, source = {}, createdAt = new Date().toISOString() }) {
    const settings = parse(site);
    const link = `${config.appUrl}/app/site?id=${site.id}`;
    const text = `🔔 Lead mới từ "${site.name}" (/${pageSlug === 'index' ? '' : pageSlug})\n\n${formatLead(data)}\n\nXem tất cả: ${link}`;
    const jobs = {};
    const to = recipients(site, settings);
    if (to.length) {
      jobs.email = Promise.all(to.map((addr) => mailer.send({ to: addr, subject: `Lead mới từ ${site.name}`, text }))).then(() => true);
    }
    if (settings.webhookUrl) {
      jobs.webhook = sendWebhook(settings, { event: 'lead.created', site: { id: site.id, name: site.name, subdomain: site.subdomain }, page: pageSlug, data, createdAt });
    }
    if (settings.telegramBotToken && settings.telegramChatId) jobs.telegram = sendTelegram(settings, text);
    // Fixed public hosts (validated in siteSettings), so no private-address check needed.
    if (settings.slackWebhookUrl) {
      jobs.slack = postJson(settings.slackWebhookUrl, slackPayload({ site, pageSlug, data, link }), { name: 'Slack' });
    }
    if (settings.discordWebhookUrl) {
      jobs.discord = postJson(settings.discordWebhookUrl, discordPayload(text), { name: 'Discord' });
    }
    if (settings.sheetsWebhookUrl) {
      // Apps Script answers a POST with a 302 to the script output: that means success.
      jobs.sheets = postJson(settings.sheetsWebhookUrl, sheetsRow({ site, pageSlug, data, source, createdAt }), { okRedirect: true, name: 'Google Sheets' });
    }

    const results = {};
    await Promise.all(
      Object.entries(jobs).map(([name, p]) =>
        p.then(
          () => (results[name] = 'ok'),
          (err) => {
            results[name] = err.message;
            console.warn(`[notify] ${name} cho site ${site.id} lỗi: ${err.message}`);
          }
        )
      )
    );
    return results;
  }

  return { leadCreated };
}

module.exports = { createNotifier, isPrivateAddress, assertPublicUrl, guardedLookup, httpsPostJson, truncate, slackPayload, discordPayload, sheetsRow };
