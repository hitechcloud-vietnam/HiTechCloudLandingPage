'use strict';

const express = require('express');
const { handler } = require('../http');
const { HttpError } = require('../access');
const { requireUser } = require('../auth');
const { transaction } = require('../db');
const { workspacePlanById } = require('../plans');
const { snapshotVersion } = require('./content');
const { createSafety } = require('../safety');

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

function createAbRouter({ db, access, config, mailer }) {
  const safety = createSafety({ db, config, mailer });
  const r = express.Router();
  r.use(requireUser);

  const h = handler;

  // Exact per-bucket counts: views are recorded when a test serves a page and
  // leads carry the test id + bucket from the form, so pre-test traffic and
  // direct visits to the variant URL never skew the comparison.
  function stats(test) {
    const leads = (bucket) => db.prepare("SELECT COUNT(*) AS n FROM leads WHERE ab_test_id = ? AND ab_bucket = ? AND status != 'spam'").get(test.id, bucket).n;
    const a = { pageId: test.page_id, views: test.views_a, leads: leads('a') };
    const b = { pageId: test.variant_page_id, views: test.views_b, leads: leads('b') };
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
    if (!workspacePlanById(db, site.workspace_id).abTesting) throw new HttpError(402, 'A/B testing chỉ có ở gói Pro trở lên');
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
    if (winner === 'b') {
      const variant = db.prepare('SELECT published_html FROM pages WHERE id = ?').get(test.variant_page_id);
      if (!variant || variant.published_html === null) throw new HttpError(400, 'Trang biến thể chưa được xuất bản');
      // Keep the original's current draft restorable from version history.
      snapshotVersion(db, test.page_id, req.user.id);
    }
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
    // The variant was scanned at its own URL; its content now serves the original URL too.
    if (winner === 'b') safety.onPublish(test.page_id);
    return view(db.prepare('SELECT * FROM ab_tests WHERE id = ?').get(test.id));
  }));

  return r;
}

// Picks the page to serve for a URL under a running test, keeping each visitor
// on one version via a cookie. Returns { page, test, bucket }.
function pickVariant(db, page, req, res) {
  const test = db.prepare("SELECT * FROM ab_tests WHERE page_id = ? AND status = 'running'").get(page.id);
  if (!test) return { page, test: null, bucket: null };
  const name = `htc_ab_${test.id}`;
  const match = (req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${name}=([ab])`));
  let bucket = match && match[1];
  if (!bucket) {
    bucket = Math.random() * 100 < test.split ? 'b' : 'a';
    res.cookie(name, bucket, { maxAge: 30 * 86400_000, httpOnly: true, sameSite: 'lax', path: '/' });
  }
  const variant = bucket === 'b' && db.prepare('SELECT * FROM pages WHERE id = ? AND published_html IS NOT NULL').get(test.variant_page_id);
  if (bucket === 'b' && !variant) return { page, test: null, bucket: null };
  return { page: variant || page, test, bucket };
}

function recordAbView(db, test, bucket) {
  db.prepare(`UPDATE ab_tests SET ${bucket === 'b' ? 'views_b = views_b + 1' : 'views_a = views_a + 1'} WHERE id = ?`).run(test.id);
}

// Pages taking part in a running test (as original or variant) cannot be
// unpublished or deleted until the test is stopped.
function assertNotInRunningTest(db, pageId) {
  const busy = db.prepare("SELECT 1 FROM ab_tests WHERE status = 'running' AND (page_id = ? OR variant_page_id = ?)").get(pageId, pageId);
  if (busy) throw new HttpError(400, 'Trang đang nằm trong một thử nghiệm A/B. Hãy dừng thử nghiệm trước.');
}

module.exports = { createAbRouter, pickVariant, recordAbView, assertNotInRunningTest, confidence };
