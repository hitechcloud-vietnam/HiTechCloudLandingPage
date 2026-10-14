'use strict';

const express = require('express');
const { workspacePlan } = require('../plans');
const { renderPage, renderMessage } = require('../render');
const { monthStart } = require('./api');
const { createRateLimiter } = require('../ratelimit');
const { parse: parseSettings } = require('../siteSettings');
const { pickVariant } = require('./abtests');

// Public base URL of a site, used for canonical links and sitemaps.
function siteBaseUrl(site, config) {
  if (site.custom_domain && site.domain_verified_at) return `https://${site.custom_domain}`;
  if (config.publishRootDomain) return `https://${site.subdomain}.${config.publishRootDomain}`;
  return `${config.appUrl}/p/${site.subdomain}`;
}

// Pages served from the dashboard origin get an opaque origin via CSP sandbox,
// so customer-authored scripts can never act on the dashboard session.
const SANDBOX_CSP = 'sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals';

const SOURCE_FIELDS = new Set(['_utm_source', '_utm_medium', '_utm_campaign', '_utm_term', '_utm_content', '_ref']);
const BOT_RE = /bot|crawl|spider|slurp|preview|monitor|curl|wget/i;

function createSitesRouter({ db, config, access, notifier }) {
  const r = express.Router();
  const leadLimiter = createRateLimiter({ windowMs: 60_000, max: 10 });

  function sendHtml(res, { status = 200, html }, sandbox) {
    res.status(status);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    if (sandbox) res.setHeader('Content-Security-Policy', SANDBOX_CSP);
    res.send(html);
  }

  function servePublished(req, res, site, pageSlug, sandbox) {
    const requested = db
      .prepare('SELECT * FROM pages WHERE site_id = ? AND slug = ? AND published_html IS NOT NULL')
      .get(site.id, pageSlug || 'index');
    if (!requested) return sendHtml(res, renderMessage('404', 'Trang không tồn tại hoặc chưa được xuất bản'), sandbox);
    const submitted = req.query.submitted === '1';
    // Under a running A/B test the visitor may get the variant at the same URL.
    const page = submitted ? requested : pickVariant(db, requested, req, res);
    const ws = db.prepare('SELECT plan, plan_expires_at FROM workspaces WHERE id = ?').get(site.workspace_id);
    if (!submitted && !BOT_RE.test(req.get('user-agent') || '')) {
      db.prepare(
        'INSERT INTO page_views (page_id, day, views) VALUES (?, ?, 1) ON CONFLICT (page_id, day) DO UPDATE SET views = views + 1'
      ).run(page.id, new Date().toISOString().slice(0, 10));
    }
    res.setHeader('Cache-Control', 'no-cache');
    sendHtml(
      res,
      {
        html: renderPage({
          page,
          site,
          html: page.published_html,
          css: page.published_css,
          showBranding: !workspacePlan(ws).removeBranding,
          notice: submitted ? 'Cảm ơn bạn! Thông tin đã được gửi thành công.' : '',
          settings: parseSettings(site),
          canonicalUrl: `${siteBaseUrl(site, config)}/${requested.slug === 'index' ? '' : requested.slug}`,
        }),
      },
      sandbox
    );
  }

  function siteForHost(hostname) {
    const host = String(hostname || '').toLowerCase();
    if (!host) return null;
    const byDomain = db.prepare('SELECT * FROM sites WHERE custom_domain = ? AND domain_verified_at IS NOT NULL').get(host);
    if (byDomain) return byDomain;
    const root = config.publishRootDomain;
    if (root && host.endsWith(`.${root}`)) {
      const sub = host.slice(0, -root.length - 1);
      if (!sub.includes('.')) return db.prepare('SELECT * FROM sites WHERE subdomain = ?').get(sub);
    }
    return null;
  }

  // Caddy on-demand TLS "ask" hook: only issue certificates for hosts we serve.
  r.get('/_htc/tls-ask', (req, res) => {
    const domain = String(req.query.domain || '').toLowerCase();
    res.status(siteForHost(domain) ? 200 : 404).end();
  });

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
    const source = {};
    for (const [k, v] of Object.entries(fields).slice(0, 40)) {
      const value = String(Array.isArray(v) ? v.join(', ') : v);
      if (SOURCE_FIELDS.has(k)) source[k.slice(1)] = value.slice(0, 500);
      else if (!k.startsWith('_')) data[String(k).slice(0, 64)] = value.slice(0, 2000);
    }
    if (!Object.keys(data).length) return res.redirect(303, back);

    const ws = db.prepare('SELECT plan, plan_expires_at FROM workspaces WHERE id = ?').get(site.workspace_id);
    const used = db
      .prepare(
        `SELECT COUNT(*) AS n FROM leads l JOIN sites s ON s.id = l.site_id
         WHERE s.workspace_id = ? AND l.created_at >= ?`
      )
      .get(site.workspace_id, monthStart()).n;
    if (used >= workspacePlan(ws).maxLeadsPerMonth) {
      return sendHtml(res, renderMessage('Tạm ngưng nhận đăng ký', 'Website đã đạt giới hạn tiếp nhận trong tháng.', 503));
    }
    const page = db.prepare('SELECT id FROM pages WHERE site_id = ? AND slug = ?').get(site.id, pageSlug);
    db.prepare('INSERT INTO leads (site_id, page_slug, page_id, data_json, source_json, ip) VALUES (?, ?, ?, ?, ?, ?)').run(
      site.id,
      pageSlug,
      page ? page.id : null,
      JSON.stringify(data),
      JSON.stringify(source),
      req.ip
    );
    if (notifier) notifier.leadCreated({ site, pageSlug, data });
    res.redirect(303, back);
  });

  function sitemap(site) {
    const base = siteBaseUrl(site, config);
    const pages = db.prepare('SELECT slug, published_at FROM pages WHERE site_id = ? AND published_at IS NOT NULL ORDER BY id').all(site.id);
    const urls = pages
      .map((p) => `<url><loc>${base}/${p.slug === 'index' ? '' : p.slug}</loc><lastmod>${p.published_at.slice(0, 10)}</lastmod></url>`)
      .join('');
    return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`;
  }

  function sendSeoFile(res, site, file) {
    res.setHeader('Cache-Control', 'public, max-age=300');
    if (file === 'sitemap.xml') return res.type('application/xml').send(sitemap(site));
    res.type('text/plain').send(`User-agent: *\nAllow: /\nSitemap: ${siteBaseUrl(site, config)}/sitemap.xml\n`);
  }

  r.get(['/sitemap.xml', '/robots.txt'], (req, res, next) => {
    const site = siteForHost(req.hostname);
    if (!site) return next();
    sendSeoFile(res, site, req.path.slice(1));
  });

  r.get(['/p/:subdomain/sitemap.xml', '/p/:subdomain/robots.txt'], (req, res) => {
    const site = db.prepare('SELECT * FROM sites WHERE subdomain = ?').get(String(req.params.subdomain).toLowerCase());
    if (!site) return res.status(404).end();
    sendSeoFile(res, site, req.path.split('/').pop());
  });

  // Hosts that belong to customers but cannot be served yet get a 404 page
  // instead of falling through to the HiTechCloud marketing site.
  function isCustomerHost(host) {
    const h = String(host || '').toLowerCase();
    const root = config.publishRootDomain;
    if (root && h.endsWith(`.${root}`)) return true;
    return !!db.prepare('SELECT 1 FROM sites WHERE custom_domain = ?').get(h);
  }

  // Custom domains and <subdomain>.<PUBLISH_ROOT_DOMAIN>.
  r.get(['/', '/:slug'], (req, res, next) => {
    const site = siteForHost(req.hostname);
    if (!site) {
      if (isCustomerHost(req.hostname)) {
        return sendHtml(res, renderMessage('404', 'Website không tồn tại hoặc tên miền chưa được xác minh'));
      }
      return next();
    }
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
    sendHtml(res, { html: renderPage({ page, site, html: page.draft_html, css: page.draft_css, showBranding: false, settings: parseSettings(site) }) }, true);
  });

  return r;
}

module.exports = { createSitesRouter, SANDBOX_CSP, siteBaseUrl };
