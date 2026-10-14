'use strict';

const crypto = require('node:crypto');
const { HttpError } = require('./access');
const { MAX_RECIPIENTS: MAX_ZALO_RECIPIENTS, USER_ID_RE: ZALO_USER_ID_RE } = require('./zalo');

// Per-site marketing and notification settings, stored as JSON on sites.settings_json.
// Every tracking ID is validated against a strict pattern because it is
// interpolated into a <script> on the published page.
const FIELDS = {
  ga4Id: { re: /^G-[A-Z0-9]{4,20}$/, label: 'Mã GA4 (G-XXXXXXX)' },
  gtmId: { re: /^GTM-[A-Z0-9]{4,12}$/, label: 'Mã Google Tag Manager (GTM-XXXX)' },
  fbPixelId: { re: /^\d{8,20}$/, label: 'Facebook Pixel ID' },
  tiktokPixelId: { re: /^[A-Z0-9]{10,30}$/, label: 'TikTok Pixel ID' },
  faviconUrl: { re: /^https:\/\/[^\s"'<>]{4,500}$/, label: 'Favicon URL (https)' },
  webhookUrl: { re: /^https:\/\/[^\s"'<>]{4,500}$/, label: 'Webhook URL (https)' },
  telegramChatId: { re: /^-?\d{3,20}$|^@[A-Za-z0-9_]{5,32}$/, label: 'Telegram chat ID' },
  telegramBotToken: { re: /^\d{5,12}:[A-Za-z0-9_-]{30,50}$/, label: 'Telegram bot token', secret: 'hasTelegramToken' },
  slackWebhookUrl: { re: /^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+$/, label: 'Slack webhook URL (https://hooks.slack.com/services/…)', secret: 'hasSlackWebhook' },
  discordWebhookUrl: { re: /^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+$/, label: 'Discord webhook URL (https://discord.com/api/webhooks/…)', secret: 'hasDiscordWebhook' },
  sheetsWebhookUrl: { re: /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/, label: 'Google Sheets (Apps Script) URL (https://script.google.com/macros/s/…/exec)', secret: 'hasSheetsWebhook' },
  // Zalo OA refresh tokens are long opaque strings; the live (rotated) pair is kept in zalo_tokens.
  zaloRefreshToken: { re: /^[A-Za-z0-9._-]{20,1000}$/, max: 1000, label: 'Zalo OA refresh token', secret: 'hasZaloRefreshToken' },
  turnstileSiteKey: { re: /^[0-9A-Za-z_-]{10,100}$/, label: 'Cloudflare Turnstile site key' },
  turnstileSecret: { re: /^[0-9A-Za-z_-]{10,100}$/, label: 'Cloudflare Turnstile secret key', secret: 'hasTurnstileSecret' },
};
const MAX_FIELD = 500;
const MAX_CUSTOM_CODE = 20000;
const EMAIL_RE = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;

function parse(site) {
  try {
    return JSON.parse(site.settings_json || '{}');
  } catch {
    return {};
  }
}

// Shape returned to the dashboard: secrets are reported as present, not echoed.
function publicSettings(settings) {
  const out = { ...settings };
  for (const [key, def] of Object.entries(FIELDS)) {
    if (!def.secret) continue;
    delete out[key];
    out[def.secret] = !!settings[key];
  }
  return out;
}

// Validates a partial update against the current settings and plan.
function applyUpdate(current, input, plan) {
  const next = { ...current };
  for (const [key, def] of Object.entries(FIELDS)) {
    if (input[key] === undefined) continue;
    const value = String(input[key] ?? '').trim();
    // Leaving a secret field blank keeps the stored value; "-" clears it.
    if (def.secret && value === '') continue;
    if (value === '' || value === '-') {
      delete next[key];
      continue;
    }
    if (value.length > (def.max || MAX_FIELD) || !def.re.test(value)) throw new HttpError(400, `${def.label} không hợp lệ`);
    next[key] = value;
  }

  if (input.notifyEmails !== undefined) {
    const emails = String(input.notifyEmails || '')
      .split(/[\s,;]+/)
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    if (emails.length > 5) throw new HttpError(400, 'Tối đa 5 email nhận thông báo');
    for (const e of emails) if (!EMAIL_RE.test(e)) throw new HttpError(400, `Email không hợp lệ: ${e}`);
    next.notifyEmails = emails;
  }
  if (input.zaloUserIds !== undefined) {
    // Zalo user IDs exceed Number precision: always kept as strings.
    const ids = [...new Set(String(input.zaloUserIds ?? '').split(/[\s,;]+/).filter(Boolean))];
    if (ids.length > MAX_ZALO_RECIPIENTS) throw new HttpError(400, `Tối đa ${MAX_ZALO_RECIPIENTS} người nhận Zalo`);
    for (const id of ids) if (!ZALO_USER_ID_RE.test(id)) throw new HttpError(400, `Zalo user ID không hợp lệ: ${id.slice(0, 40)}`);
    if (ids.length) next.zaloUserIds = ids;
    else delete next.zaloUserIds;
  }
  if (input.notifyOwners !== undefined) next.notifyOwners = !!input.notifyOwners;

  // Lead quality (see leadGuard.js).
  if (input.requireValidPhone !== undefined) {
    next.requireValidPhone = ![false, 0, '', '0', 'false', 'off', null].includes(input.requireValidPhone);
  }
  if (input.dedupeHours !== undefined) {
    const raw = String(input.dedupeHours ?? '').trim();
    const hours = Number(raw);
    if (raw === '') delete next.dedupeHours;
    else if (!/^\d{1,3}$/.test(raw) || hours > 168) throw new HttpError(400, 'Thời gian chặn lead trùng phải từ 0 đến 168 giờ');
    else next.dedupeHours = hours;
  }

  for (const key of ['customHead', 'customBody']) {
    if (input[key] === undefined) continue;
    const value = String(input[key] || '');
    if (value && !plan.customCode) throw new HttpError(402, 'Chèn mã tùy chỉnh chỉ có ở gói Pro trở lên');
    if (value.length > MAX_CUSTOM_CODE) throw new HttpError(400, 'Mã tùy chỉnh quá dài');
    if (value) next[key] = value;
    else delete next[key];
  }

  if (next.webhookUrl && !next.webhookSecret) next.webhookSecret = crypto.randomBytes(24).toString('hex');
  return next;
}

// Tracking snippets injected into <head> of published pages.
function trackingHead(s) {
  const parts = [];
  if (s.gtmId) {
    parts.push(`<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${s.gtmId}');</script>`);
  }
  if (s.ga4Id) {
    parts.push(`<script async src="https://www.googletagmanager.com/gtag/js?id=${s.ga4Id}"></script><script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${s.ga4Id}');</script>`);
  }
  if (s.fbPixelId) {
    parts.push(`<script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${s.fbPixelId}');fbq('track','PageView');</script>`);
  }
  if (s.tiktokPixelId) {
    parts.push(`<script>!function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie"];ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.load=function(e){var i="https://analytics.tiktok.com/i18n/pixel/events.js";ttq._i=ttq._i||{};ttq._i[e]=[];ttq._i[e]._u=i;ttq._t=ttq._t||{};ttq._t[e]=+new Date;var o=d.createElement("script");o.type="text/javascript";o.async=!0;o.src=i+"?sdkid="+e+"&lib="+t;var a=d.getElementsByTagName("script")[0];a.parentNode.insertBefore(o,a)};ttq.load('${s.tiktokPixelId}');ttq.page();}(window,document,'ttq');</script>`);
  }
  return parts.join('\n');
}

// Conversion events fired on the "thank you" view after a form submission.
function leadEvents(s) {
  const calls = [];
  if (s.ga4Id || s.gtmId) calls.push("window.gtag&&gtag('event','generate_lead');window.dataLayer&&dataLayer.push({event:'generate_lead'});");
  if (s.fbPixelId) calls.push("window.fbq&&fbq('track','Lead');");
  if (s.tiktokPixelId) calls.push("window.ttq&&ttq.track('SubmitForm');");
  return calls.length ? `<script>${calls.join('')}</script>` : '';
}

module.exports = { FIELDS, parse, publicSettings, applyUpdate, trackingHead, leadEvents };
