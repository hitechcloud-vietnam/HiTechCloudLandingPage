'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

// Lead quality checks for the public lead endpoint: Vietnamese phone/email
// validation, spam heuristics, signed render timestamps, duplicates, Turnstile.

const SPAM_THRESHOLD = 5;
const TS_MIN_MS = 2000;
const TS_MAX_MS = 24 * 3600_000;
const DEFAULT_DEDUPE_HOURS = 24;
const MAX_DEDUPE_HOURS = 168;
const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TURNSTILE_SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js';

// Friendly messages for ?lead_error=<code>; unknown codes show nothing.
const LEAD_ERRORS = {
  phone: 'Số điện thoại chưa đúng. Vui lòng nhập số di động hoặc số cố định Việt Nam, ví dụ 0901234567.',
  email: 'Địa chỉ email chưa đúng. Vui lòng kiểm tra lại.',
  expired: 'Phiên biểu mẫu đã hết hạn. Vui lòng điền lại thông tin và gửi lại.',
};

function leadErrorMessage(code) {
  return Object.prototype.hasOwnProperty.call(LEAD_ERRORS, code) ? LEAD_ERRORS[code] : '';
}

// ---------- Phone / email ----------

// Returns the number as 0xxxxxxxxx (mobile, 10 digits) or 02xxxxxxxxx
// (landline, 11 digits), or null when it is not a valid Vietnamese number.
function normalizePhone(raw) {
  let s = String(raw ?? '').trim().replace(/[\s.\-()]/g, '');
  if (s.startsWith('+84')) s = `0${s.slice(3)}`;
  else if (/^84\d{9,10}$/.test(s)) s = `0${s.slice(2)}`;
  if (s.startsWith('00')) s = s.slice(1); // "+84 0901..." style
  if (/^0[35789]\d{8}$/.test(s) || /^02\d{9}$/.test(s)) return s;
  return null;
}

function isPhoneField(name, telNames = []) {
  const n = String(name || '').toLowerCase();
  if (telNames.includes(name)) return true;
  return /phone|sdt|so_?dien_?thoai|dien_?thoai|mobile|(^|_)tel($|_)/.test(n.replace(/[\s-]+/g, '_'));
}

const EMAIL_RE = /^[^\s@<>"(),;:]{1,64}@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/i;

function isValidEmail(value) {
  const v = String(value ?? '').trim();
  return v.length <= 254 && EMAIL_RE.test(v);
}

function isEmailField(name) {
  return /e-?mail/i.test(String(name || ''));
}

// ---------- Signed render timestamp (_ts) ----------

let cachedSecret = null;

// LEAD_SECRET, else derived from an existing server secret, else a random key
// persisted next to the database in production (per process otherwise).
function resolveSecret(cfg) {
  if (cfg.leadSecret) return String(cfg.leadSecret);
  const p = cfg.payments || {};
  const existing = [p.payos && p.payos.checksumKey, p.pay2s && p.pay2s.secretKey, cfg.smtpUrl].filter(Boolean).join('|');
  if (existing) return crypto.createHmac('sha256', existing).update('htc-lead-ts').digest('hex');
  if (process.env.NODE_ENV === 'production' && cfg.dbFile && cfg.dbFile !== ':memory:') {
    const file = path.join(path.dirname(cfg.dbFile), 'lead-secret');
    try {
      return fs.readFileSync(file, 'utf8').trim();
    } catch {
      const s = crypto.randomBytes(32).toString('hex');
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, s, { mode: 0o600, flag: 'wx' });
      } catch {
        try {
          return fs.readFileSync(file, 'utf8').trim(); // another process won the race
        } catch {
          /* fall through to the in-memory key */
        }
      }
      return s;
    }
  }
  return crypto.randomBytes(32).toString('hex');
}

function leadSecret() {
  if (!cachedSecret) cachedSecret = resolveSecret(require('./config'));
  return cachedSecret;
}

// Overrides the signing secret (tests, embedding).
function setLeadSecret(secret) {
  cachedSecret = secret ? String(secret) : null;
}

function tsMac(secret, siteId, ts) {
  return crypto.createHmac('sha256', secret).update(`lead-ts:${siteId}:${ts}`).digest('base64url').slice(0, 32);
}

function signTs(siteId, now = Date.now(), secret = leadSecret()) {
  return `${now}.${tsMac(secret, siteId, now)}`;
}

// ok: whether the submission may proceed; reason: missing|invalid|too_fast|expired.
function checkTs(token, siteId, now = Date.now(), secret = leadSecret()) {
  if (token === undefined || token === null || token === '') return { ok: true, reason: 'missing' };
  const m = /^(\d{10,16})\.([A-Za-z0-9_-]{32})$/.exec(String(token));
  if (!m) return { ok: false, reason: 'invalid' };
  const expected = Buffer.from(tsMac(secret, siteId, m[1]));
  const given = Buffer.from(m[2]);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return { ok: false, reason: 'invalid' };
  const age = now - Number(m[1]);
  if (age < TS_MIN_MS) return { ok: false, reason: 'too_fast' };
  if (age > TS_MAX_MS) return { ok: false, reason: 'expired' };
  return { ok: true, reason: 'valid' };
}

// ---------- Settings ----------

function guardSettings(settings = {}) {
  const hours = Number(settings.dedupeHours);
  return {
    requireValidPhone: settings.requireValidPhone !== false,
    dedupeHours: Number.isInteger(hours) && hours >= 0 && hours <= MAX_DEDUPE_HOURS ? hours : DEFAULT_DEDUPE_HOURS,
    turnstile: !!(settings.turnstileSiteKey && settings.turnstileSecret),
  };
}

// ---------- Validation + spam scoring ----------

const SPAM_WORDS = [
  'viagra', 'cialis', 'casino', 'porn', 'backlink', 'seo service', 'crypto investment', 'forex signal',
  'nhà cái', 'cá cược', 'cá độ', 'tài xỉu', 'lô đề', 'nổ hũ', 'bắn cá đổi thưởng', 'game bài đổi thưởng',
  'kiếm tiền online',
];
const URL_RE = /https?:\/\/|www\.|\[url=|<a\s/gi;

// Validates and scores a submission. Returns { error } or a normalised copy of
// the data with { score, flags, spam, contacts }.
function inspectLead(data, { telNames = [], ts, siteId, now = Date.now(), settings = {}, secret } = {}) {
  const opts = guardSettings(settings);
  const out = { ...data };
  const flags = [];
  let score = 0;
  const contacts = { phones: [], emails: [] };

  for (const [k, v] of Object.entries(out)) {
    const value = String(v).trim();
    if (!value) continue;
    if (isEmailField(k)) {
      if (!isValidEmail(value)) return { error: 'email' };
      out[k] = value.toLowerCase();
      contacts.emails.push(out[k]);
    } else if (isPhoneField(k, telNames)) {
      const phone = normalizePhone(value);
      if (phone) {
        out[k] = phone;
        contacts.phones.push(phone);
      } else if (opts.requireValidPhone) {
        return { error: 'phone' };
      } else if (!flags.includes('invalid_phone')) {
        flags.push('invalid_phone');
        score += 1;
      }
    }
  }

  const tsCheck = checkTs(ts, siteId, now, secret);
  if (tsCheck.reason === 'expired') return { error: 'expired' };
  if (tsCheck.reason === 'missing') {
    flags.push('no_ts');
    score += 1;
  } else if (!tsCheck.ok) {
    flags.push(tsCheck.reason === 'too_fast' ? 'too_fast' : 'bad_ts');
    score += SPAM_THRESHOLD;
  }

  const values = Object.values(out).map((v) => String(v).trim()).filter(Boolean);
  const text = values.join('\n').toLowerCase();
  const urls = (text.match(URL_RE) || []).length;
  if (urls >= 2) {
    flags.push('links');
    score += urls >= 3 ? SPAM_THRESHOLD : 2;
  }
  const words = SPAM_WORDS.filter((w) => new RegExp(`(^|[^\\p{L}])${w}($|[^\\p{L}])`, 'u').test(text));
  if (words.length) {
    flags.push('keywords');
    score += Math.min(words.length, 2) * 3;
  }
  if (values.length >= 2 && new Set(values.map((v) => v.toLowerCase())).size === 1) {
    flags.push('identical');
    score += values.length >= 3 ? SPAM_THRESHOLD : 3;
  }

  return { error: null, data: out, score, flags, spam: score >= SPAM_THRESHOLD, contacts };
}

// ---------- Duplicates ----------

// Most recent non-spam lead of the site within `hours` sharing a phone or
// email; returns the id of the original lead, or null.
function findDuplicate(db, siteId, contacts, hours) {
  if (!hours) return null;
  const keys = [...new Set([...contacts.phones, ...contacts.emails])];
  if (!keys.length) return null;
  const like = keys.map(() => "data_json LIKE ? ESCAPE '\\'");
  const rows = db
    .prepare(
      `SELECT id, data_json, duplicate_of FROM leads WHERE site_id = ? AND status != 'spam'
       AND created_at >= datetime('now', ?) AND (${like.join(' OR ')}) ORDER BY id DESC LIMIT 50`
    )
    .all(siteId, `-${hours} hours`, ...keys.map((k) => `%${JSON.stringify(k).replace(/[\\%_]/g, (c) => `\\${c}`)}%`));
  for (const row of rows) {
    let data;
    try {
      data = JSON.parse(row.data_json);
    } catch {
      continue;
    }
    const vals = Object.values(data).map((v) => String(v).trim().toLowerCase());
    if (keys.some((k) => vals.includes(k))) return row.duplicate_of || row.id;
  }
  return null;
}

// ---------- Cloudflare Turnstile ----------

// Fails closed: any error or a non-success answer returns ok: false.
async function verifyTurnstile({ secret, token, ip, fetch = globalThis.fetch }) {
  if (!token) return { ok: false, reason: 'missing' };
  try {
    const res = await fetch(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret, response: String(token).slice(0, 2048), ...(ip ? { remoteip: ip } : {}) }).toString(),
      signal: AbortSignal.timeout(10000),
    });
    const body = await res.json();
    return body && body.success === true ? { ok: true } : { ok: false, reason: 'rejected' };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}

module.exports = {
  SPAM_THRESHOLD,
  LEAD_ERRORS,
  TURNSTILE_SCRIPT_URL,
  TURNSTILE_VERIFY_URL,
  leadErrorMessage,
  normalizePhone,
  isPhoneField,
  isValidEmail,
  isEmailField,
  leadSecret,
  setLeadSecret,
  resolveSecret,
  signTs,
  checkTs,
  guardSettings,
  inspectLead,
  findDuplicate,
  verifyTurnstile,
};
