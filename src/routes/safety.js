'use strict';

const express = require('express');
const { handler } = require('../http');
const { HttpError } = require('../access');
const { createRateLimiter } = require('../ratelimit');
const { escapeHtml, renderPage, renderMessage } = require('../render');
const { REPORT_REASONS, AUTO_REASON, createSafety } = require('../safety');
const { siteBaseUrl } = require('./sites');

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// The report form has no scripts; sandboxed so it is inert on every host.
const REPORT_CSP = "sandbox allow-forms; default-src 'none'; style-src 'unsafe-inline'";
// Admin preview of a suspicious page: no scripts, no forms.
const PREVIEW_CSP = "sandbox; default-src 'none'; img-src * data:; style-src 'unsafe-inline' *; font-src * data:";

const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

function reportForm({ site, siteUrl, pageSlug, values = {}, error = '' }) {
  const reasons = Object.entries(REPORT_REASONS)
    .map(([id, label]) => `<label class="opt"><input type="radio" name="reason" value="${id}"${values.reason === id ? ' checked' : ''} required> ${escapeHtml(label)}</label>`)
    .join('');
  const target = site
    ? `<p class="muted">Trang bị báo cáo: <strong>${escapeHtml(siteUrl)}</strong></p>
<input type="hidden" name="site" value="${site.id}"><input type="hidden" name="page" value="${escapeHtml(pageSlug)}">`
    : `<label>Đường dẫn trang vi phạm<input name="url" type="url" maxlength="500" required value="${escapeHtml(values.url || '')}" placeholder="https://…"></label>`;
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Báo cáo vi phạm · HiTechCloud</title>
<style>body{font-family:system-ui,sans-serif;background:#f8fafc;color:#0f172a;margin:0;padding:24px 16px}main{max-width:560px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:24px}
h1{font-size:22px;margin:0 0 8px}label{display:block;margin:14px 0 4px;font-weight:600}.opt{font-weight:400;margin:6px 0}input[type=url],input[type=email],textarea{display:block;width:100%;box-sizing:border-box;margin-top:6px;padding:9px 10px;border:1px solid #cbd5e1;border-radius:8px;font:inherit}
textarea{min-height:110px}button{margin-top:18px;background:#dc2626;color:#fff;border:0;border-radius:8px;padding:10px 18px;font:inherit;font-weight:600;cursor:pointer}.muted{color:#64748b;font-size:14px}.err{background:#fee2e2;color:#991b1b;padding:10px 12px;border-radius:8px}fieldset{border:0;padding:0;margin:14px 0 0}legend{font-weight:600}
.hp{position:absolute;left:-9999px}</style></head>
<body><main><h1>Báo cáo vi phạm</h1>
<p class="muted">Báo cáo trang lừa đảo, giả mạo hoặc vi phạm điều khoản được tạo trên nền tảng HiTechCloud. Đội ngũ an toàn nội dung sẽ xem xét mọi báo cáo.</p>
${error ? `<p class="err">${escapeHtml(error)}</p>` : ''}
<form method="post" action="/_htc/report">
${target}
<fieldset><legend>Lý do</legend>${reasons}</fieldset>
<label>Mô tả chi tiết<textarea name="details" maxlength="2000" placeholder="Ví dụ: trang giả mạo ngân hàng, yêu cầu nhập mật khẩu và mã OTP">${escapeHtml(values.details || '')}</textarea></label>
<label>Email liên hệ (không bắt buộc)<input name="email" type="email" maxlength="200" value="${escapeHtml(values.email || '')}"></label>
<input class="hp" type="text" name="_hp" tabindex="-1" autocomplete="off" aria-hidden="true">
<button type="submit">Gửi báo cáo</button>
<p class="muted">Email chỉ dùng để liên hệ khi cần thêm thông tin về báo cáo này.</p>
</form></main></body></html>`;
}

function createSafetyRouter({ db, config, mailer }) {
  const r = express.Router();
  const h = handler;
  const safety = createSafety({ db, config, mailer });
  const reportLimiter = createRateLimiter({ windowMs: 3600_000, max: config.reportRateLimitPerHour || 5 });

  function siteForHost(hostname) {
    const host = String(hostname || '').toLowerCase();
    const byDomain = host && db.prepare('SELECT * FROM sites WHERE custom_domain = ? AND domain_verified_at IS NOT NULL').get(host);
    if (byDomain) return byDomain;
    const root = config.publishRootDomain;
    if (root && host.endsWith(`.${root}`)) {
      const sub = host.slice(0, -root.length - 1);
      if (!sub.includes('.')) return db.prepare('SELECT * FROM sites WHERE subdomain = ?').get(sub) || null;
    }
    return null;
  }

  const pageUrl = (site, slug) => `${siteBaseUrl(site, config)}/${!slug || slug === 'index' ? '' : slug}`;

  // Resolves the reported site from ?site= / form field, falling back to the host.
  function target(req, source) {
    const raw = String(source.page || '').toLowerCase();
    const pageSlug = SLUG_RE.test(raw) ? raw : 'index';
    if (source.site !== undefined && source.site !== '') {
      const site = db.prepare('SELECT * FROM sites WHERE id = ?').get(Number(source.site) || 0);
      if (!site) return { invalid: true };
      return { site, pageSlug };
    }
    return { site: siteForHost(req.hostname), pageSlug };
  }

  function send(res, status, html) {
    res.status(status);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Security-Policy', REPORT_CSP);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex');
    res.send(html);
  }

  // ---------- Public abuse reports (any host, no auth) ----------
  r.get('/_htc/report', (req, res) => {
    const t = target(req, req.query);
    if (t.invalid) return send(res, 404, renderMessage('404', 'Không tìm thấy website').html);
    send(res, 200, reportForm({ site: t.site, siteUrl: t.site ? pageUrl(t.site, t.pageSlug) : '', pageSlug: t.pageSlug }));
  });

  r.post('/_htc/report', express.urlencoded({ extended: false, limit: '16kb' }), (req, res) => {
    const body = req.body || {};
    const thanks = () => send(res, 200, renderMessage('Cảm ơn bạn đã báo cáo', 'Chúng tôi đã nhận được báo cáo và sẽ xem xét trong thời gian sớm nhất.', 200).html);
    if (body._hp) return thanks(); // honeypot filled: silently drop
    if (!reportLimiter(req.ip)) {
      return send(res, 429, renderMessage('Quá nhiều yêu cầu', 'Bạn đã gửi quá nhiều báo cáo. Vui lòng thử lại sau.', 429).html);
    }
    const t = target(req, body);
    if (t.invalid) return send(res, 404, renderMessage('404', 'Không tìm thấy website').html);
    const values = { reason: text(body.reason, 20), details: text(body.details, 2000), email: text(body.email, 200).toLowerCase(), url: text(body.url, 500) };
    const fail = (error) =>
      send(res, 400, reportForm({ site: t.site, siteUrl: t.site ? pageUrl(t.site, t.pageSlug) : '', pageSlug: t.pageSlug, values, error }));
    if (!REPORT_REASONS[values.reason]) return fail('Vui lòng chọn lý do báo cáo');
    if (values.email && !EMAIL_RE.test(values.email)) return fail('Email không hợp lệ');
    if (!t.site && !/^https?:\/\/\S+$/i.test(values.url)) return fail('Vui lòng nhập đường dẫn trang vi phạm (bắt đầu bằng http:// hoặc https://)');
    const url = t.site ? pageUrl(t.site, t.pageSlug) : values.url;
    const info = db
      .prepare('INSERT INTO abuse_reports (site_id, page_slug, url, reason, details, contact_email, ip) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(t.site ? t.site.id : null, t.site ? t.pageSlug : null, url, values.reason, values.details, values.email || null, req.ip);
    for (const to of config.superAdmins || []) {
      mailer.send({
        to,
        subject: `[An toàn nội dung] Báo cáo vi phạm mới #${info.lastInsertRowid}: ${REPORT_REASONS[values.reason]}`,
        text: `Trang: ${url}\nLý do: ${REPORT_REASONS[values.reason]}\n\n${values.details || '(không có mô tả)'}\n\nXem xét tại ${config.appUrl}/app/admin`,
      });
    }
    thanks();
  });

  // ---------- Platform admin ----------
  const requireSuperAdmin = (req, _res, next) => {
    if (!req.user) return next(new HttpError(401, 'Vui lòng đăng nhập'));
    next(req.user.isSuperAdmin ? undefined : new HttpError(403, 'Chỉ dành cho quản trị nền tảng'));
  };
  r.use(['/api/admin/safety', '/api/admin/sites', '/api/admin/users'], requireSuperAdmin);

  const OWNER_JOIN = `LEFT JOIN memberships m ON m.workspace_id = s.workspace_id AND m.role = 'owner'
    LEFT JOIN users u ON u.id = m.user_id`;
  const SITE_COLS = `s.name AS site_name, s.subdomain, s.custom_domain, s.domain_verified_at, s.suspended_at AS site_suspended_at,
    s.suspended_reason AS site_suspended_reason, u.id AS owner_id, u.email AS owner_email, u.suspended_at AS owner_suspended_at`;
  const status = (value, allowed) => (allowed.includes(value) ? value : allowed[0]);
  const reason = (body) => {
    const s = text(body && body.reason, 500);
    if (!s) throw new HttpError(400, 'Vui lòng nhập lý do');
    return s;
  };

  r.get('/api/admin/safety/reports', h((req) =>
    db
      .prepare(
        `SELECT r.*, ${SITE_COLS} FROM abuse_reports r LEFT JOIN sites s ON s.id = r.site_id ${OWNER_JOIN}
         WHERE r.status = ? GROUP BY r.id ORDER BY r.id DESC LIMIT 200`
      )
      .all(status(req.query.status, ['open', 'resolved']))
  ));

  r.post('/api/admin/safety/reports/:id/resolve', h((req) => {
    const note = text(req.body && req.body.note, 500);
    const info = db
      .prepare("UPDATE abuse_reports SET status = 'resolved', resolution = ?, resolved_by = ?, resolved_at = datetime('now') WHERE id = ?")
      .run(note || null, req.user.id, Number(req.params.id));
    if (!info.changes) throw new HttpError(404, 'Không tìm thấy báo cáo');
    return { ok: true };
  }));

  r.get('/api/admin/safety/flags', h((req) =>
    db
      .prepare(
        `SELECT f.*, p.title AS page_title, p.slug AS page_slug, ${SITE_COLS}
         FROM safety_flags f JOIN sites s ON s.id = f.site_id LEFT JOIN pages p ON p.id = f.page_id ${OWNER_JOIN}
         WHERE f.status = ? GROUP BY f.id ORDER BY f.score DESC, f.id DESC LIMIT 200`
      )
      .all(status(req.query.status, ['open', 'dismissed', 'actioned']))
      .map(({ reasons_json, content_hash, ...f }) => ({ ...f, reasons: JSON.parse(reasons_json || '[]') }))
  ));

  // Dismissing a false positive also lifts the automatic suspension it caused.
  r.post('/api/admin/safety/flags/:id/dismiss', h((req) => {
    const flag = db.prepare('SELECT * FROM safety_flags WHERE id = ?').get(Number(req.params.id));
    if (!flag) throw new HttpError(404, 'Không tìm thấy cảnh báo');
    db.prepare("UPDATE safety_flags SET status = 'dismissed', reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ?").run(req.user.id, flag.id);
    const site = db.prepare('SELECT suspended_at, suspended_reason FROM sites WHERE id = ?').get(flag.site_id);
    const unsuspended = !!(flag.auto_suspended && site && site.suspended_at && site.suspended_reason === AUTO_REASON);
    if (unsuspended) safety.unsuspendSite(flag.site_id);
    return { ok: true, unsuspended };
  }));

  r.get('/api/admin/safety/suspended', h(() => ({
    sites: db
      .prepare(`SELECT s.id, ${SITE_COLS} FROM sites s ${OWNER_JOIN} WHERE s.suspended_at IS NOT NULL GROUP BY s.id ORDER BY s.suspended_at DESC LIMIT 200`)
      .all(),
    users: db
      .prepare('SELECT id, email, name, suspended_at, suspended_reason FROM users WHERE suspended_at IS NOT NULL ORDER BY suspended_at DESC LIMIT 200')
      .all(),
  })));

  // Inert preview (no scripts, no form posts) of the published page, or the draft.
  r.get('/api/admin/safety/pages/:pid/preview', (req, res) => {
    const page = db.prepare('SELECT * FROM pages WHERE id = ?').get(Number(req.params.pid));
    const site = page && db.prepare('SELECT * FROM sites WHERE id = ?').get(page.site_id);
    if (!page || !site) return res.status(404).type('html').send(renderMessage('404', 'Không tìm thấy trang').html);
    const published = page.published_html !== null;
    res.setHeader('Content-Security-Policy', PREVIEW_CSP);
    res.setHeader('Cache-Control', 'no-store');
    res.type('html').send(
      renderPage({
        page,
        site,
        html: published ? page.published_html : page.draft_html,
        css: published ? page.published_css : page.draft_css,
        showBranding: false,
        notice: `Bản xem trước cho quản trị viên (${published ? 'bản đã xuất bản' : 'bản nháp'}) — đã tắt script và biểu mẫu`,
      })
    );
  });

  r.post('/api/admin/sites/:sid/suspend', h((req) => {
    const site = safety.suspendSite(Number(req.params.sid), reason(req.body));
    // Suspension settles the site's pending queue items.
    db.prepare("UPDATE safety_flags SET status = 'actioned', reviewed_by = ?, reviewed_at = datetime('now') WHERE site_id = ? AND status = 'open'").run(req.user.id, site.id);
    db.prepare("UPDATE abuse_reports SET status = 'resolved', resolution = ?, resolved_by = ?, resolved_at = datetime('now') WHERE site_id = ? AND status = 'open'")
      .run(`Đã tạm ngưng website: ${site.suspended_reason}`, req.user.id, site.id);
    return { ok: true, suspendedAt: site.suspended_at };
  }));

  r.post('/api/admin/sites/:sid/unsuspend', h((req) => {
    safety.unsuspendSite(Number(req.params.sid));
    return { ok: true };
  }));

  r.post('/api/admin/users/:uid/suspend', h((req) => {
    safety.suspendUser(Number(req.params.uid), reason(req.body));
    return { ok: true };
  }));

  r.post('/api/admin/users/:uid/unsuspend', h((req) => {
    safety.unsuspendUser(Number(req.params.uid));
    return { ok: true };
  }));

  return r;
}

module.exports = { createSafetyRouter };
