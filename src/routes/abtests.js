'use strict';

const express = require('express');
const { HttpError } = require('../access');
const { requireUser } = require('../auth');
const { transaction } = require('../db');
const { workspacePlan } = require('../plans');

// Normal CDF via Abramowitz–Stegun erf approximation (enough for a confidence readout).
function normalCdf(z) {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t) * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

// Two-proportion z-test; returns the confidence (0–100) that the rates differ.
function confidence(convA, viewsA, convB, viewsB) {
  if (!viewsA || !viewsB) return 0;
  const pA = convA / viewsA;
  const pB = convB / viewsB;
  const p = (convA + convB) / (viewsA + viewsB);
  const se = Math.sqrt(p * (1 - p) * (1 / viewsA + 1 / viewsB));
  if (!se) return 0;
  const z = Math.abs(pA - pB) / se;
  return Math.round((2 * normalCdf(z) - 1) * 1000) / 10;
}

function createAbRouter({ db, access }) {
  const r = express.Router();
  r.use(requireUser);

  const h = (fn) => (req, res, next) => {
    try {
      const out = fn(req, res);
      if (out !== undefined && !res.headersSent) res.json(out);
    } catch (err) {
      next(err);
    }
  };

  function stats(test) {
    const since = test.started_at;
    const until = test.stopped_at || '9999-12-31';
    const views = (pageId) =>
      db.prepare('SELECT COALESCE(SUM(views), 0) AS n FROM page_views WHERE page_id = ? AND day >= ? AND day <= ?').get(pageId, since.slice(0, 10), until.slice(0, 10)).n;
    const leads = (pageId) =>
      db.prepare('SELECT COUNT(*) AS n FROM leads WHERE page_id = ? AND created_at >= ? AND created_at <= ?').get(pageId, since, until).n;
    const a = { pageId: test.page_id, views: views(test.page_id), leads: leads(test.page_id) };
    const b = { pageId: test.variant_page_id, views: views(test.variant_page_id), leads: leads(test.variant_page_id) };
    for (const x of [a, b]) x.rate = x.views ? Math.round((x.leads / x.views) * 10000) / 100 : 0;
    return { a, b, confidence: confidence(a.leads, a.views, b.leads, b.views) };
  }

  function view(test) {
    const title = (id) => (db.prepare('SELECT title, slug FROM pages WHERE id = ?').get(id) || {});
    return { ...test, control: title(test.page_id), variant: title(test.variant_page_id), stats: stats(test) };
  }

  r.get('/sites/:sid/ab-tests', h((req) => {
    const { site } = access.site(req.user, req.params.sid);
    return db.prepare('SELECT * FROM ab_tests WHERE site_id = ? ORDER BY id DESC').all(site.id).map(view);
  }));

  r.post('/sites/:sid/ab-tests', h((req, res) => {
    const { site } = access.site(req.user, req.params.sid);
    const ws = db.prepare('SELECT plan, plan_expires_at FROM workspaces WHERE id = ?').get(site.workspace_id);
    if (!workspacePlan(ws).abTesting) throw new HttpError(402, 'A/B testing chỉ có ở gói Pro trở lên');
    const pageId = Number(req.body.pageId);
    const variantId = Number(req.body.variantPageId);
    const split = Number(req.body.split ?? 50);
    if (!Number.isInteger(split) || split < 1 || split > 99) throw new HttpError(400, 'Tỉ lệ chia phải từ 1 đến 99%');
    if (pageId === variantId) throw new HttpError(400, 'Hãy chọn hai trang khác nhau');
    const pages = db.prepare('SELECT id, published_at FROM pages WHERE site_id = ? AND id IN (?, ?)').all(site.id, pageId, variantId);
    if (pages.length !== 2) throw new HttpError(400, 'Trang không thuộc website này');
    if (pages.some((p) => !p.published_at)) throw new HttpError(400, 'Cả hai trang cần được xuất bản trước khi thử nghiệm');
    const busy = db
      .prepare("SELECT 1 FROM ab_tests WHERE status = 'running' AND (page_id IN (?, ?) OR variant_page_id IN (?, ?))")
      .get(pageId, variantId, pageId, variantId);
    if (busy) throw new HttpError(409, 'Một trong hai trang đang nằm trong thử nghiệm khác');
    const info = db.prepare('INSERT INTO ab_tests (site_id, page_id, variant_page_id, split) VALUES (?, ?, ?, ?)').run(site.id, pageId, variantId, split);
    res.status(201);
    return view(db.prepare('SELECT * FROM ab_tests WHERE id = ?').get(info.lastInsertRowid));
  }));

  // Stops a test. winner "b" promotes the variant's content into the original URL.
  r.post('/ab-tests/:id/stop', h((req) => {
    const test = db.prepare('SELECT * FROM ab_tests WHERE id = ?').get(req.params.id);
    if (!test) throw new HttpError(404, 'Không tìm thấy');
    access.site(req.user, test.site_id);
    if (test.status !== 'running') throw new HttpError(400, 'Thử nghiệm đã dừng');
    const winner = ['a', 'b'].includes(req.body.winner) ? req.body.winner : null;
    transaction(db, () => {
      db.prepare("UPDATE ab_tests SET status = 'stopped', winner = ?, stopped_at = datetime('now') WHERE id = ?").run(winner, test.id);
      if (winner === 'b') {
        db.prepare(
          `UPDATE pages SET (draft_html, draft_css, project_json, published_html, published_css) =
             (SELECT draft_html, draft_css, project_json, published_html, published_css FROM pages WHERE id = ?),
             published_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`
        ).run(test.variant_page_id, test.page_id);
      }
    });
    return view(db.prepare('SELECT * FROM ab_tests WHERE id = ?').get(test.id));
  }));

  return r;
}

// Picks the page to serve for a URL under a running test, keeping each visitor
// on one variant via a cookie. Returns the page row to render.
function pickVariant(db, page, req, res) {
  const test = db.prepare("SELECT * FROM ab_tests WHERE page_id = ? AND status = 'running'").get(page.id);
  if (!test) return page;
  const name = `htc_ab_${test.id}`;
  const match = (req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${name}=([ab])`));
  let bucket = match && match[1];
  if (!bucket) {
    bucket = Math.random() * 100 < test.split ? 'b' : 'a';
    res.cookie(name, bucket, { maxAge: 30 * 86400_000, httpOnly: true, sameSite: 'lax', path: '/' });
  }
  if (bucket === 'a') return page;
  const variant = db.prepare('SELECT * FROM pages WHERE id = ? AND published_html IS NOT NULL').get(test.variant_page_id);
  return variant || page;
}

module.exports = { createAbRouter, pickVariant, confidence };
