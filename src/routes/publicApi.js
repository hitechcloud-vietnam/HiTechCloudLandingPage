'use strict';

const crypto = require('node:crypto');
const express = require('express');
const { logger } = require('../logger');
const { handler } = require('../http');
const { HttpError } = require('../access');
const { requireUser } = require('../auth');
const { workspacePlanById } = require('../plans');
const { createRateLimiter } = require('../ratelimit');
const { snapshotVersion } = require('./content');
const { createSafety, assertSiteActive } = require('../safety');
const { assertEmailVerified } = require('./account');

const KEY_PREFIX = 'htc_live_';
const KEY_RE = /^htc_live_[A-Za-z0-9_-]{32,64}$/;
const DISPLAY_PREFIX_LEN = 13; // "htc_live_" + 4 random chars
const MAX_ACTIVE_KEYS = 20;
// 'spam' is set by lead filtering; spam leads are hidden unless requested explicitly.
const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'won', 'lost', 'spam'];
const PLAN_MESSAGE = 'API chỉ có ở gói Pro trở lên. Vui lòng nâng cấp gói để sử dụng.';

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

function generateKey() {
  const key = KEY_PREFIX + crypto.randomBytes(24).toString('base64url');
  return { key, prefix: key.slice(0, DISPLAY_PREFIX_LEN), hash: sha256(key) };
}

function keyView(k) {
  return {
    id: k.id,
    name: k.name,
    prefix: k.prefix,
    createdBy: k.created_by_name || null,
    createdAt: k.created_at,
    lastUsedAt: k.last_used_at,
    revokedAt: k.revoked_at,
  };
}

function leadView(l) {
  return {
    id: l.id,
    page: l.page_slug,
    data: JSON.parse(l.data_json),
    source: JSON.parse(l.source_json || '{}'),
    status: l.status,
    note: l.note,
    createdAt: l.created_at,
  };
}

// Session-authenticated key management for the dashboard (owner/admin only).
function createApiKeysRouter({ db, access }) {
  const r = express.Router();
  const h = handler;

  const KEY_SELECT = `SELECT k.*, u.name AS created_by_name FROM api_keys k
    LEFT JOIN users u ON u.id = k.created_by`;

  r.get('/workspaces/:wid/api-keys', requireUser, h((req) => {
    const { ws } = access.workspace(req.user, req.params.wid, 'admin');
    return db.prepare(`${KEY_SELECT} WHERE k.workspace_id = ? ORDER BY k.id DESC`).all(ws.id).map(keyView);
  }));

  r.post('/workspaces/:wid/api-keys', requireUser, h((req, res) => {
    const { ws } = access.workspace(req.user, req.params.wid, 'admin');
    if (!workspacePlanById(db, ws.id).apiAccess) throw new HttpError(402, PLAN_MESSAGE);
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    if (!name) throw new HttpError(400, 'Tên API key là bắt buộc');
    if (name.length > 100) throw new HttpError(400, 'Tên API key quá dài (tối đa 100 ký tự)');
    const active = db.prepare('SELECT COUNT(*) AS n FROM api_keys WHERE workspace_id = ? AND revoked_at IS NULL').get(ws.id).n;
    if (active >= MAX_ACTIVE_KEYS) throw new HttpError(400, `Mỗi workspace có tối đa ${MAX_ACTIVE_KEYS} API key đang hoạt động`);
    const { key, prefix, hash } = generateKey();
    const row = db
      .prepare('INSERT INTO api_keys (workspace_id, name, prefix, key_hash, created_by) VALUES (?, ?, ?, ?, ?)')
      .run(ws.id, name, prefix, hash, req.user.id);
    res.status(201);
    // The full key is returned only once; only its hash is stored.
    return { ...keyView(db.prepare(`${KEY_SELECT} WHERE k.id = ?`).get(row.lastInsertRowid)), key };
  }));

  r.delete('/api-keys/:id', requireUser, h((req) => {
    const k = db.prepare('SELECT id, workspace_id FROM api_keys WHERE id = ?').get(req.params.id);
    if (!k) throw new HttpError(404, 'Không tìm thấy');
    access.workspace(req.user, k.workspace_id, 'admin');
    db.prepare("UPDATE api_keys SET revoked_at = COALESCE(revoked_at, datetime('now')) WHERE id = ?").run(k.id);
    return { ok: true };
  }));

  return r;
}

// Public REST API v1: bearer API keys, every query scoped to the key's workspace.
function createPublicApiRouter({ db, config = {} }) {
  const r = express.Router();
  const h = handler;
  const limiter = createRateLimiter({ windowMs: 60_000, max: config.apiRateLimitPerMin || 120 });

  // Authenticate before parsing any request body.
  r.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    const m = /^Bearer\s+(\S+)$/i.exec(req.get('authorization') || '');
    if (!m || !KEY_RE.test(m[1])) {
      res.setHeader('WWW-Authenticate', 'Bearer');
      throw new HttpError(401, 'Thiếu API key hoặc API key không hợp lệ');
    }
    const token = m[1];
    const hash = Buffer.from(sha256(token), 'hex');
    const key = db
      .prepare('SELECT id, workspace_id, key_hash, revoked_at FROM api_keys WHERE prefix = ?')
      .all(token.slice(0, DISPLAY_PREFIX_LEN))
      .find((k) => crypto.timingSafeEqual(Buffer.from(k.key_hash, 'hex'), hash));
    if (!key || key.revoked_at) {
      res.setHeader('WWW-Authenticate', 'Bearer error="invalid_token"');
      throw new HttpError(401, 'API key không hợp lệ hoặc đã bị thu hồi');
    }
    const suspendedOwner = db
      .prepare("SELECT 1 FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? AND m.role = 'owner' AND u.suspended_at IS NOT NULL")
      .get(key.workspace_id);
    if (suspendedOwner) throw new HttpError(403, 'Tài khoản chủ sở hữu workspace đã bị tạm ngưng do vi phạm điều khoản sử dụng');
    if (!workspacePlanById(db, key.workspace_id).apiAccess) throw new HttpError(402, PLAN_MESSAGE);
    if (!limiter(key.id)) {
      res.setHeader('Retry-After', '60');
      throw new HttpError(429, 'Vượt giới hạn số yêu cầu, vui lòng thử lại sau');
    }
    // Throttle writes: last_used_at has minute precision at most.
    db.prepare(
      "UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ? AND (last_used_at IS NULL OR last_used_at < datetime('now', '-60 seconds'))"
    ).run(key.id);
    req.apiKey = key;
    next();
  });

  r.use(express.json({ limit: '100kb' }));

  function site(req, id) {
    const s = db.prepare('SELECT * FROM sites WHERE id = ? AND workspace_id = ?').get(id, req.apiKey.workspace_id);
    if (!s) throw new HttpError(404, 'Không tìm thấy website');
    return s;
  }

  r.get('/sites', h((req) => ({
    data: db
      .prepare('SELECT id, name, subdomain, custom_domain, domain_verified_at, created_at FROM sites WHERE workspace_id = ? ORDER BY id')
      .all(req.apiKey.workspace_id)
      .map((s) => ({
        id: s.id,
        name: s.name,
        subdomain: s.subdomain,
        customDomain: s.custom_domain,
        customDomainVerified: !!s.domain_verified_at,
        createdAt: s.created_at,
      })),
  })));

  r.get('/sites/:id/pages', h((req) => {
    const s = site(req, req.params.id);
    return {
      data: db
        .prepare('SELECT id, title, slug, published_at, updated_at FROM pages WHERE site_id = ? ORDER BY slug = \'index\' DESC, id')
        .all(s.id)
        .map((p) => ({
          id: p.id,
          title: p.title,
          slug: p.slug,
          published: !!p.published_at,
          publishedAt: p.published_at,
          updatedAt: p.updated_at,
        })),
    };
  }));

  // Newest first. Paginate with ?cursor=<nextCursor>; ?since=<ISO 8601> is inclusive.
  r.get('/sites/:id/leads', h((req) => {
    const s = site(req, req.params.id);
    const where = ['site_id = ?'];
    const args = [s.id];
    const { since, status, cursor } = req.query;
    if (since !== undefined) {
      const d = new Date(String(since));
      if (!since || Number.isNaN(d.getTime())) throw new HttpError(400, 'Tham số since không hợp lệ (dùng định dạng ISO 8601)');
      where.push('created_at >= ?');
      args.push(d.toISOString().slice(0, 19).replace('T', ' '));
    }
    if (status !== undefined) {
      if (!LEAD_STATUSES.includes(status)) throw new HttpError(400, 'Trạng thái không hợp lệ');
      where.push('status = ?');
      args.push(status);
    } else {
      where.push("status != 'spam'");
    }
    if (cursor !== undefined) {
      if (!/^\d+$/.test(String(cursor))) throw new HttpError(400, 'Tham số cursor không hợp lệ');
      where.push('id < ?');
      args.push(Number(cursor));
    }
    let limit = 100;
    if (req.query.limit !== undefined) {
      if (!/^\d+$/.test(String(req.query.limit)) || Number(req.query.limit) < 1) throw new HttpError(400, 'Tham số limit không hợp lệ');
      limit = Math.min(Number(req.query.limit), 500);
    }
    const rows = db
      .prepare(`SELECT id, page_slug, data_json, source_json, status, note, created_at FROM leads WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ?`)
      .all(...args, limit + 1);
    const more = rows.length > limit;
    const data = rows.slice(0, limit).map(leadView);
    return { data, nextCursor: more ? data[data.length - 1].id : null };
  }));

  r.patch('/leads/:id', h((req) => {
    const lead = db
      .prepare('SELECT l.* FROM leads l JOIN sites s ON s.id = l.site_id WHERE l.id = ? AND s.workspace_id = ?')
      .get(req.params.id, req.apiKey.workspace_id);
    if (!lead) throw new HttpError(404, 'Không tìm thấy lead');
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    if (body.status === undefined && body.note === undefined) throw new HttpError(400, 'Cần gửi status hoặc note');
    const status = body.status !== undefined ? body.status : lead.status;
    if (!LEAD_STATUSES.includes(status)) throw new HttpError(400, 'Trạng thái không hợp lệ');
    let note = lead.note;
    if (body.note !== undefined) {
      if (typeof body.note !== 'string') throw new HttpError(400, 'Ghi chú không hợp lệ');
      note = body.note.trim();
      if (note.length > 2000) throw new HttpError(400, 'Ghi chú quá dài (tối đa 2000 ký tự)');
    }
    db.prepare('UPDATE leads SET status = ?, note = ? WHERE id = ?').run(status, note, lead.id);
    return leadView(db.prepare('SELECT * FROM leads WHERE id = ?').get(lead.id));
  }));

  r.post('/pages/:id/publish', h((req) => {
    const page = db
      .prepare('SELECT p.id, p.site_id FROM pages p JOIN sites s ON s.id = p.site_id WHERE p.id = ? AND s.workspace_id = ?')
      .get(req.params.id, req.apiKey.workspace_id);
    if (!page) throw new HttpError(404, 'Không tìm thấy trang');
    // Same rule as the dashboard: the key's creator (or, if gone, the owner) must have a verified email.
    const actor = db
      .prepare(
        `SELECT COALESCE(k.created_by, (SELECT user_id FROM memberships WHERE workspace_id = k.workspace_id AND role = 'owner')) AS id
         FROM api_keys k WHERE k.id = ?`
      )
      .get(req.apiKey.id);
    assertEmailVerified(db, actor.id, 'xuất bản trang');
    assertSiteActive(db, page.site_id);
    snapshotVersion(db, page.id, null);
    db.prepare("UPDATE pages SET published_html = draft_html, published_css = draft_css, published_at = datetime('now') WHERE id = ?").run(page.id);
    const review = createSafety({ db, config, mailer: req.app.locals.mailer }).onPublish(page.id);
    return { ok: true, publishedAt: db.prepare('SELECT published_at FROM pages WHERE id = ?').get(page.id).published_at, ...(review.suspended && { suspended: true }) };
  }));

  r.use((_req, res) => res.status(404).json({ error: 'Không tìm thấy' }));

  // Keep errors inside the v1 API as JSON with Vietnamese messages.
  r.use((err, req, res, _next) => {
    let status = err.status || err.statusCode || 500;
    let message = err.message;
    if (err.type === 'entity.parse.failed') message = 'Dữ liệu JSON không hợp lệ';
    else if (err.type === 'entity.too.large') message = 'Dữ liệu gửi lên quá lớn';
    if (status >= 500) {
      (req.log || logger).error('Public API error', { err, stack: err.stack });
      status = 500;
      message = 'Lỗi máy chủ';
    }
    res.status(status).json({ error: message });
  });

  return r;
}

module.exports = { createPublicApiRouter, createApiKeysRouter, generateKey, KEY_RE };
