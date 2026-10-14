'use strict';

const express = require('express');
const { getPlan } = require('../plans');
const { renderPage, renderMessage } = require('../render');
const { monthStart } = require('./api');

// Pages served from the dashboard origin get an opaque origin via CSP sandbox,
// so customer-authored scripts can never act on the dashboard session.
const SANDBOX_CSP = 'sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals';

function createRateLimiter({ windowMs, max }) {
  const hits = new Map();
  return (key) => {
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || now - entry.start > windowMs) {
      hits.set(key, { start: now, count: 1 });
      if (hits.size > 10000) {
        for (const [k, v] of hits) if (now - v.start > windowMs) hits.delete(k);
      }
      return true;
    }
    entry.count += 1;
    return entry.count <= max;
  };
}

function createSitesRouter({ db, config, access }) {
  const r = express.Router();
  const leadLimiter = createRateLimiter({ windowMs: 60_000, max: 10 });

  function sendHtml(res, { status = 200, html }, sandbox) {
    res.status(status);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (sandbox) res.setHeader('Content-Security-Policy', SANDBOX_CSP);
    res.send(html);
  }

  function servePublished(req, res, site, pageSlug, sandbox) {
    const page = db
      .prepare('SELECT * FROM pages WHERE site_id = ? AND slug = ? AND published_html IS NOT NULL')
      .get(site.id, pageSlug || 'index');
    if (!page) return sendHtml(res, renderMessage('404', 'Trang không tồn tại hoặc chưa được xuất bản'), sandbox);
    const ws = db.prepare('SELECT plan FROM workspaces WHERE id = ?').get(site.workspace_id);
    res.setHeader('Cache-Control', 'public, max-age=60');
    sendHtml(
      res,
      {
        html: renderPage({
          page,
          site,
          html: page.published_html,
          css: page.published_css,
          showBranding: !getPlan(ws.plan).removeBranding,
          notice: req.query.submitted === '1' ? 'Cảm ơn bạn! Thông tin đã được gửi thành công.' : '',
        }),
      },
      sandbox
    );
  }

  function siteForHost(hostname) {
    const host = String(hostname || '').toLowerCase();
    if (!host) return null;
    const byDomain = db.prepare('SELECT * FROM sites WHERE custom_domain = ?').get(host);
    if (byDomain) return byDomain;
    const root = config.publishRootDomain;
    if (root && host.endsWith(`.${root}`)) {
      const sub = host.slice(0, -root.length - 1);
      if (!sub.includes('.')) return db.prepare('SELECT * FROM sites WHERE subdomain = ?').get(sub);
    }
    return null;
  }

  // Lead capture endpoint used by every published form (all hosts).
  r.post('/_htc/lead', express.urlencoded({ extended: false, limit: '64kb' }), (req, res) => {
    const site = db.prepare('SELECT * FROM sites WHERE id = ?').get(Number(req.query.site));
    if (!site) return sendHtml(res, renderMessage('404', 'Không tìm thấy website'));
    const rawSlug = String(req.query.page || '');
    const pageSlug = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(rawSlug) ? rawSlug : 'index';
    const prefix = siteForHost(req.hostname) ? '' : `/p/${site.subdomain}`;
    const back = `${prefix}/${pageSlug === 'index' ? '' : pageSlug}?submitted=1`;

    const { _hp, ...fields } = req.body || {};
    if (_hp) return res.redirect(303, back); // honeypot filled: silently drop spam
    if (!leadLimiter(`${req.ip}:${site.id}`)) {
      return sendHtml(res, renderMessage('Quá nhiều yêu cầu', 'Vui lòng thử lại sau ít phút.', 429));
    }

    const data = {};
    for (const [k, v] of Object.entries(fields).slice(0, 30)) {
      data[String(k).slice(0, 64)] = String(Array.isArray(v) ? v.join(', ') : v).slice(0, 2000);
    }
    if (!Object.keys(data).length) return res.redirect(303, back);

    const ws = db.prepare('SELECT plan FROM workspaces WHERE id = ?').get(site.workspace_id);
    const used = db
      .prepare(
        `SELECT COUNT(*) AS n FROM leads l JOIN sites s ON s.id = l.site_id
         WHERE s.workspace_id = ? AND l.created_at >= ?`
      )
      .get(site.workspace_id, monthStart()).n;
    if (used >= getPlan(ws.plan).maxLeadsPerMonth) {
      return sendHtml(res, renderMessage('Tạm ngưng nhận đăng ký', 'Website đã đạt giới hạn tiếp nhận trong tháng.', 503));
    }
    db.prepare('INSERT INTO leads (site_id, page_slug, data_json, ip) VALUES (?, ?, ?, ?)').run(
      site.id,
      pageSlug,
      JSON.stringify(data),
      req.ip
    );
    res.redirect(303, back);
  });

  // Custom domains and <subdomain>.<PUBLISH_ROOT_DOMAIN>.
  r.get(['/', '/:slug'], (req, res, next) => {
    const site = siteForHost(req.hostname);
    if (!site) return next();
    servePublished(req, res, site, req.params.slug, false);
  });

  // Path-based hosting on the dashboard origin (always sandboxed).
  r.get(['/p/:subdomain', '/p/:subdomain/:slug'], (req, res) => {
    const site = db.prepare('SELECT * FROM sites WHERE subdomain = ?').get(String(req.params.subdomain).toLowerCase());
    if (!site) return sendHtml(res, renderMessage('404', 'Website không tồn tại'), true);
    servePublished(req, res, site, req.params.slug, true);
  });

  // Draft preview for workspace members.
  r.get('/preview/:pid', (req, res) => {
    if (!req.user) return res.redirect('/app/login.html');
    let found;
    try {
      found = access.page(req.user, req.params.pid);
    } catch (err) {
      return sendHtml(res, renderMessage(String(err.status || 500), err.message, err.status || 500), true);
    }
    const { page, site } = found;
    res.setHeader('Cache-Control', 'no-store');
    sendHtml(res, { html: renderPage({ page, site, html: page.draft_html, css: page.draft_css, showBranding: false }) }, true);
  });

  return r;
}

module.exports = { createSitesRouter, SANDBOX_CSP };
