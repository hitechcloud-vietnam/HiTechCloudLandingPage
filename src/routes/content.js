'use strict';

const crypto = require('node:crypto');
const express = require('express');
const { handler } = require('../http');
const { logger } = require('../logger');
const { HttpError } = require('../access');
const { requireUser } = require('../auth');
const { transaction } = require('../db');
const { workspacePlan, workspacePlanById } = require('../plans');
const { createStorage } = require('../storage');

const MAX_UPLOAD = 5 * 1024 * 1024;
const MAX_VERSIONS = 20;

// Allowed image types, checked by magic bytes (the Content-Type header is not trusted).
// SVG is deliberately excluded: it can carry script and is served from our origin.
const SIGNATURES = [
  { mime: 'image/png', ext: 'png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/jpeg', ext: 'jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/gif', ext: 'gif', test: (b) => ['GIF87a', 'GIF89a'].includes(b.subarray(0, 6).toString('ascii')) },
  { mime: 'image/webp', ext: 'webp', test: (b) => b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP' },
];

function sniff(buf) {
  return buf.length >= 12 ? SIGNATURES.find((s) => s.test(buf)) : undefined;
}

function cleanName(name) {
  return String(name || 'image').replace(/[^\p{L}\p{N}._ -]/gu, '').slice(0, 120) || 'image';
}

// Assets (image library), page version history and page duplication.
function createContentRouter({ db, config, access, storage = createStorage(config) }) {
  const r = express.Router();
  r.use(requireUser);

  const h = handler;

  function storageUsed(workspaceId) {
    return db.prepare('SELECT COALESCE(SUM(size), 0) AS n FROM assets WHERE workspace_id = ?').get(workspaceId).n;
  }

  const assetView = (a) => ({ id: a.id, src: storage.urlFor(a.path), name: a.name, type: 'image', size: a.size, createdAt: a.created_at });

  r.get('/workspaces/:wid/assets', h((req) => {
    const { ws } = access.workspace(req.user, req.params.wid);
    const plan = workspacePlan(ws);
    return {
      assets: db.prepare('SELECT * FROM assets WHERE workspace_id = ? ORDER BY id DESC LIMIT 500').all(ws.id).map(assetView),
      usedBytes: storageUsed(ws.id),
      limitBytes: plan.storageMb * 1024 * 1024,
    };
  }));

  // Raw image body (Content-Type: image/*). Image content types cannot be sent by
  // a cross-site HTML form, so the request is CSRF-safe like the JSON API.
  r.post(
    '/workspaces/:wid/assets',
    express.raw({ type: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'], limit: MAX_UPLOAD }),
    h(async (req, res) => {
      const { ws } = access.workspace(req.user, req.params.wid);
      // express.raw yields a Buffer only for the accepted image types; anything
      // else (missing body, other content types, arrays) is rejected here.
      if (!Buffer.isBuffer(req.body) || Array.isArray(req.body) || typeof req.body === 'string') {
        throw new HttpError(415, 'Chỉ hỗ trợ ảnh PNG, JPEG, GIF, WEBP (tối đa 5MB)');
      }
      const buf = Buffer.from(req.body);
      if (!buf.length) throw new HttpError(415, 'Chỉ hỗ trợ ảnh PNG, JPEG, GIF, WEBP (tối đa 5MB)');
      const kind = sniff(buf);
      if (!kind) throw new HttpError(415, 'Tệp không phải ảnh hợp lệ');
      const plan = workspacePlan(ws);
      if (storageUsed(ws.id) + buf.length > plan.storageMb * 1024 * 1024) {
        throw new HttpError(402, `Đã hết dung lượng lưu trữ của gói ${plan.name} (${plan.storageMb} MB)`);
      }
      let name = 'image';
      try {
        name = cleanName(decodeURIComponent(req.get('x-file-name') || 'image'));
      } catch {
        // Malformed percent-encoding: keep the default name.
      }
      const rel = `${ws.id}/${crypto.randomBytes(12).toString('hex')}.${kind.ext}`;
      try {
        await storage.put(rel, buf, kind.mime);
      } catch (err) {
        (req.log || logger).error('Storage upload failed', { err: err.message });
        throw new HttpError(502, 'Không thể lưu ảnh lúc này, vui lòng thử lại sau');
      }
      // Re-check the quota after the async upload so concurrent uploads cannot overshoot.
      if (storageUsed(ws.id) + buf.length > plan.storageMb * 1024 * 1024) {
        await storage.remove(rel).catch(() => {});
        throw new HttpError(402, `Đã hết dung lượng lưu trữ của gói ${plan.name} (${plan.storageMb} MB)`);
      }
      const info = db
        .prepare('INSERT INTO assets (workspace_id, path, name, mime, size) VALUES (?, ?, ?, ?, ?)')
        .run(ws.id, rel, name, kind.mime, buf.length);
      res.status(201);
      return assetView(db.prepare('SELECT * FROM assets WHERE id = ?').get(info.lastInsertRowid));
    })
  );

  r.delete('/assets/:id', h(async (req) => {
    const asset = db.prepare('SELECT * FROM assets WHERE id = ?').get(req.params.id);
    if (!asset) throw new HttpError(404, 'Không tìm thấy');
    access.workspace(req.user, asset.workspace_id);
    // Remove the object first so a storage failure leaves the asset listed for a retry.
    try {
      await storage.remove(asset.path);
    } catch (err) {
      (req.log || logger).error('Storage delete failed', { err: err.message });
      throw new HttpError(502, 'Không thể xóa ảnh lúc này, vui lòng thử lại sau');
    }
    db.prepare('DELETE FROM assets WHERE id = ?').run(asset.id);
    return { ok: true };
  }));

  // ---------- Versions ----------
  r.get('/pages/:pid/versions', h((req) => {
    const { page } = access.page(req.user, req.params.pid);
    return db
      .prepare(
        `SELECT v.id, v.created_at, u.name AS author FROM page_versions v
         LEFT JOIN users u ON u.id = v.created_by WHERE v.page_id = ? ORDER BY v.id DESC`
      )
      .all(page.id);
  }));

  r.post('/pages/:pid/versions/:vid/restore', h((req) => {
    const { page } = access.page(req.user, req.params.pid);
    const v = db.prepare('SELECT * FROM page_versions WHERE id = ? AND page_id = ?').get(req.params.vid, page.id);
    if (!v) throw new HttpError(404, 'Không tìm thấy phiên bản');
    db.prepare("UPDATE pages SET draft_html = ?, draft_css = ?, project_json = ?, updated_at = datetime('now') WHERE id = ?").run(
      v.html,
      v.css,
      v.project_json,
      page.id
    );
    return { ok: true };
  }));

  // ---------- Duplicate ----------
  r.post('/pages/:pid/duplicate', h((req, res) => {
    const { page, site } = access.page(req.user, req.params.pid);
    const plan = workspacePlanById(db, site.workspace_id);
    const count = db.prepare('SELECT COUNT(*) AS n FROM pages WHERE site_id = ?').get(site.id).n;
    if (count >= plan.maxPagesPerSite) throw new HttpError(402, `Gói ${plan.name} cho phép tối đa ${plan.maxPagesPerSite} trang mỗi website`);
    // Pick the first free "<slug>-copy[-n]".
    // Trim the source so "-copy" (and a "-NN" counter) always fit in 63 chars.
    const stem = (page.slug === 'index' ? 'trang-chu' : page.slug).slice(0, 51).replace(/-+$/, '');
    const baseSlug = `${stem}-copy`;
    let slug = baseSlug;
    for (let i = 2; db.prepare('SELECT 1 FROM pages WHERE site_id = ? AND slug = ?').get(site.id, slug); i++) slug = `${baseSlug}-${i}`;
    const info = db
      .prepare('INSERT INTO pages (site_id, title, slug, meta_description, og_image, project_json, draft_html, draft_css) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(site.id, `${page.title} (bản sao)`.slice(0, 200), slug, page.meta_description, page.og_image, page.project_json, page.draft_html, page.draft_css);
    res.status(201);
    return db.prepare('SELECT id, site_id, title, slug FROM pages WHERE id = ?').get(info.lastInsertRowid);
  }));

  return r;
}

// Snapshot taken on every publish; only the latest MAX_VERSIONS are kept.
function snapshotVersion(db, pageId, userId) {
  transaction(db, () => {
    db.prepare(
      'INSERT INTO page_versions (page_id, html, css, project_json, created_by) SELECT id, draft_html, draft_css, project_json, ? FROM pages WHERE id = ?'
    ).run(userId, pageId);
    db.prepare(
      'DELETE FROM page_versions WHERE page_id = ? AND id NOT IN (SELECT id FROM page_versions WHERE page_id = ? ORDER BY id DESC LIMIT ?)'
    ).run(pageId, pageId, MAX_VERSIONS);
  });
}

module.exports = { createContentRouter, snapshotVersion, sniff };
