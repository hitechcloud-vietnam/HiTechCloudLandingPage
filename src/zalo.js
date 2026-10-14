'use strict';

const crypto = require('node:crypto');
const { logger } = require('./logger');

// Zalo Official Account (OA) Open API: customer-service ("tư vấn") text messages.
// The platform owns one Zalo app (ZALO_APP_ID / ZALO_APP_SECRET); each site
// authorizes its own OA and saves the OA refresh token in its settings.
// Access tokens live ~25h and every refresh rotates the (single-use) refresh
// token, so the live token pair is kept server-side in zalo_tokens.
const SEND_URL = 'https://openapi.zalo.me/v3.0/oa/message/cs';
const TOKEN_URL = 'https://oauth.zaloapp.com/v4/oa/access_token';
const TIMEOUT_MS = 10000;
// Renew a little before the reported expiry (clock skew, slow requests).
const EXPIRY_MARGIN_MS = 5 * 60 * 1000;
// Error codes Zalo returns for a rejected access token (invalid / expired).
const INVALID_TOKEN_CODES = new Set([-216, -124]);
const MAX_RECIPIENTS = 5;
const USER_ID_RE = /^\d{6,25}$/;

class ZaloError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

async function readJson(res, name) {
  let body = null;
  try {
    body = await res.json();
  } catch {
    // not JSON
  }
  if (!body || typeof body !== 'object') throw new Error(`${name} trả về HTTP ${res.status}`);
  return body;
}

function createZaloClient({ db, config, fetch = config.fetch || globalThis.fetch, now = () => Date.now() }) {
  const app = config.zalo || {};
  const log = config.logger || logger;
  const refreshing = new Map(); // siteId -> in-flight refresh promise

  const enabled = () => !!(app.appId && app.appSecret);

  // Token state of a site, (re)seeded whenever the refresh token saved in
  // settings changes: a newly pasted token replaces the rotated chain.
  function state(siteId, seed) {
    const seedHash = hashToken(seed);
    const row = db.prepare('SELECT * FROM zalo_tokens WHERE site_id = ?').get(siteId);
    if (row && row.seed_hash === seedHash) return row;
    db.prepare(
      `INSERT INTO zalo_tokens (site_id, seed_hash, refresh_token, access_token, expires_at, updated_at)
       VALUES (?, ?, ?, NULL, NULL, datetime('now'))
       ON CONFLICT(site_id) DO UPDATE SET seed_hash = excluded.seed_hash, refresh_token = excluded.refresh_token,
         access_token = NULL, expires_at = NULL, updated_at = excluded.updated_at`
    ).run(siteId, seedHash, seed);
    return { site_id: siteId, seed_hash: seedHash, refresh_token: seed, access_token: null, expires_at: null };
  }

  async function refresh(siteId, seed) {
    const row = state(siteId, seed);
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', secret_key: app.appSecret },
      body: new URLSearchParams({ refresh_token: row.refresh_token, app_id: app.appId, grant_type: 'refresh_token' }).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = await readJson(res, 'Zalo OAuth');
    if (!body.access_token) {
      throw new ZaloError(`Zalo OA: không làm mới được access token (mã ${body.error ?? res.status}). Hãy cấp quyền OA và nhập lại refresh token`, body.error);
    }
    const expiresIn = Number(body.expires_in) > 0 ? Number(body.expires_in) : 3600;
    // The old refresh token is now spent: persist the rotated one immediately.
    db.prepare("UPDATE zalo_tokens SET refresh_token = ?, access_token = ?, expires_at = ?, updated_at = datetime('now') WHERE site_id = ? AND seed_hash = ?").run(
      body.refresh_token || row.refresh_token,
      body.access_token,
      now() + expiresIn * 1000,
      siteId,
      row.seed_hash
    );
    log.info(`[zalo] đã làm mới access token cho site ${siteId}`, { component: 'notify', siteId });
    return body.access_token;
  }

  // Single flight per site: concurrent leads share one refresh, because a
  // refresh token can be used only once.
  function refreshOnce(siteId, seed) {
    let p = refreshing.get(siteId);
    if (!p) {
      p = refresh(siteId, seed).finally(() => refreshing.delete(siteId));
      refreshing.set(siteId, p);
    }
    return p;
  }

  // A usable access token. `rejected` is a token the API just refused: any
  // other unexpired token (e.g. from a concurrent refresh) is reused instead.
  function accessToken(siteId, seed, rejected) {
    const row = state(siteId, seed);
    const fresh = row.access_token && row.access_token !== rejected && Number(row.expires_at) > now() + EXPIRY_MARGIN_MS;
    return fresh ? Promise.resolve(row.access_token) : refreshOnce(siteId, seed);
  }

  async function sendOne(token, userId, text) {
    const res = await fetch(SEND_URL, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/json', access_token: token },
      body: JSON.stringify({ recipient: { user_id: userId }, message: { text } }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = await readJson(res, 'Zalo OA');
    const code = Number(body.error ?? NaN);
    if (code !== 0) {
      const detail = body.message ? `: ${String(body.message).slice(0, 200)}` : '';
      throw new ZaloError(`Zalo OA lỗi ${Number.isNaN(code) ? `HTTP ${res.status}` : code}${detail}`, code);
    }
  }

  // Sends `text` to every recipient. When the API rejects the access token,
  // the token is refreshed once and those recipients are retried once.
  // Throws when any recipient finally failed.
  async function send({ siteId, refreshToken, userIds, text }) {
    if (!enabled()) throw new Error('Nền tảng chưa cấu hình Zalo OA (ZALO_APP_ID / ZALO_APP_SECRET)');
    const attempt = (token, ids) => Promise.allSettled(ids.map((userId) => sendOne(token, userId, text)));
    const token = await accessToken(siteId, refreshToken);
    const errors = new Map();
    (await attempt(token, userIds)).forEach((r, i) => {
      if (r.status === 'rejected') errors.set(userIds[i], r.reason);
    });
    const rejected = userIds.filter((id) => errors.has(id) && INVALID_TOKEN_CODES.has(errors.get(id).code));
    if (rejected.length) {
      const fresh = await accessToken(siteId, refreshToken, token);
      (await attempt(fresh, rejected)).forEach((r, i) => {
        if (r.status === 'rejected') errors.set(rejected[i], r.reason);
        else errors.delete(rejected[i]);
      });
    }
    if (!errors.size) return;
    const first = errors.values().next().value;
    if (errors.size === userIds.length) throw first;
    throw new Error(`${errors.size}/${userIds.length} người nhận Zalo lỗi: ${first.message}`);
  }

  // Drops the stored token pair (channel removed from settings).
  function forget(siteId) {
    db.prepare('DELETE FROM zalo_tokens WHERE site_id = ?').run(siteId);
  }

  return { enabled, send, forget };
}

module.exports = { createZaloClient, SEND_URL, TOKEN_URL, INVALID_TOKEN_CODES, MAX_RECIPIENTS, USER_ID_RE };
