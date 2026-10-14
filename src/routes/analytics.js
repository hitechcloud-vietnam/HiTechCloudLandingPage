'use strict';

const express = require('express');
const { handler } = require('../http');
const { HttpError } = require('../access');
const { requireUser } = require('../auth');

const RANGES = [7, 30, 90];
const STATUSES = ['new', 'contacted', 'qualified', 'won', 'lost'];
const DIRECT = 'Trực tiếp';
const DAY_MS = 86400_000;

const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

// Percentage with two decimals; null when there is no denominator.
function rate(leads, views) {
  return views ? Math.round((leads / views) * 10000) / 100 : null;
}

// Relative change in percent (one decimal); null when the previous period is 0.
function change(current, previous) {
  if (!previous) return current ? null : 0;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

// UTC day range [from, to] ending today, plus the period right before it.
function ranges(days, now = Date.now()) {
  const today = Math.floor(now / DAY_MS) * DAY_MS;
  const start = today - (days - 1) * DAY_MS;
  return {
    current: { from: isoDay(start), to: isoDay(today), startMs: start },
    previous: { from: isoDay(start - days * DAY_MS), to: isoDay(start - DAY_MS) },
  };
}

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

// Hosts of the site itself: referrals from them are internal navigation.
function ownHosts(site, config) {
  const hosts = new Set([hostOf(config.appUrl)]);
  if (site.custom_domain) hosts.add(site.custom_domain.toLowerCase().replace(/^www\./, ''));
  if (config.publishRootDomain) hosts.add(`${site.subdomain}.${config.publishRootDomain}`.toLowerCase());
  return hosts;
}

// utm_source, else the external referrer host, else direct.
function sourceLabel(utm, ref, own) {
  const s = String(utm ?? '').trim().toLowerCase();
  if (s) return s.slice(0, 100);
  const host = ref ? hostOf(String(ref)) : '';
  return host && !own.has(host) ? host : DIRECT;
}

function createAnalyticsRouter({ db, config, access }) {
  const r = express.Router();
  r.use(requireUser);

  // Lead timestamps are 'YYYY-MM-DD HH:MM:SS' UTC; compare against day bounds.
  const leadRange = (range) => [`${range.from} 00:00:00`, `${range.to} 23:59:59`];

  const q = {
    viewsByDay: db.prepare(
      `SELECT v.day, SUM(v.views) AS n FROM pages p JOIN page_views v ON v.page_id = p.id
       WHERE p.site_id = ? AND v.day BETWEEN ? AND ? GROUP BY v.day`
    ),
    leadsByDay: db.prepare(
      `SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS n FROM leads
       WHERE site_id = ? AND created_at BETWEEN ? AND ? AND status != 'spam' GROUP BY day`
    ),
    viewsTotal: db.prepare(
      `SELECT COALESCE(SUM(v.views), 0) AS n FROM pages p JOIN page_views v ON v.page_id = p.id
       WHERE p.site_id = ? AND v.day BETWEEN ? AND ?`
    ),
    leadsTotal: db.prepare("SELECT COUNT(*) AS n FROM leads WHERE site_id = ? AND created_at BETWEEN ? AND ? AND status != 'spam'"),
    pages: db.prepare('SELECT id, title, slug FROM pages WHERE site_id = ? ORDER BY id'),
    viewsByPage: db.prepare(
      `SELECT v.page_id, SUM(v.views) AS n FROM pages p JOIN page_views v ON v.page_id = p.id
       WHERE p.site_id = ? AND v.day BETWEEN ? AND ? GROUP BY v.page_id`
    ),
    leadsByPage: db.prepare(
      `SELECT page_id, page_slug, COUNT(*) AS n FROM leads
       WHERE site_id = ? AND created_at BETWEEN ? AND ? AND status != 'spam' GROUP BY page_id, page_slug`
    ),
    leadsBySource: db.prepare(
      `SELECT CASE WHEN json_valid(source_json) THEN json_extract(source_json, '$.utm_source') END AS utm,
              CASE WHEN json_valid(source_json) THEN json_extract(source_json, '$.ref') END AS ref,
              COUNT(*) AS n
       FROM leads WHERE site_id = ? AND created_at BETWEEN ? AND ? AND status != 'spam' GROUP BY utm, ref`
    ),
    leadsByStatus: db.prepare(
      "SELECT status, COUNT(*) AS n FROM leads WHERE site_id = ? AND created_at BETWEEN ? AND ? AND status != 'spam' GROUP BY status"
    ),
  };

  r.get('/sites/:sid/analytics', handler((req) => {
    const { site } = access.site(req.user, req.params.sid);
    const days = req.query.days === undefined ? 30 : Number(req.query.days);
    if (!RANGES.includes(days)) throw new HttpError(400, 'Khoảng thời gian phải là 7, 30 hoặc 90 ngày');

    const { current, previous } = ranges(days);
    const cur = leadRange(current);
    const prev = leadRange(previous);

    // Daily series, zero-filled.
    const views = new Map(q.viewsByDay.all(site.id, current.from, current.to).map((x) => [x.day, x.n]));
    const leads = new Map(q.leadsByDay.all(site.id, ...cur).map((x) => [x.day, x.n]));
    const series = [];
    for (let i = 0; i < days; i++) {
      const day = isoDay(current.startMs + i * DAY_MS);
      series.push({ day, views: views.get(day) || 0, leads: leads.get(day) || 0 });
    }

    const totalViews = series.reduce((s, d) => s + d.views, 0);
    const totalLeads = series.reduce((s, d) => s + d.leads, 0);
    const prevViews = q.viewsTotal.get(site.id, previous.from, previous.to).n;
    const prevLeads = q.leadsTotal.get(site.id, ...prev).n;

    // Per page. Older leads have no page_id, so fall back to the slug.
    const pages = q.pages.all(site.id);
    const byId = new Map(pages.map((p) => [p.id, { pageId: p.id, title: p.title, slug: p.slug, views: 0, leads: 0 }]));
    const bySlug = new Map(pages.map((p) => [p.slug, byId.get(p.id)]));
    for (const v of q.viewsByPage.all(site.id, current.from, current.to)) byId.get(v.page_id).views = v.n;
    const orphans = new Map();
    for (const l of q.leadsByPage.all(site.id, ...cur)) {
      const row = byId.get(l.page_id) || (l.page_id == null && bySlug.get(l.page_slug));
      if (row) {
        row.leads += l.n;
      } else {
        const key = l.page_slug || '';
        if (!orphans.has(key)) orphans.set(key, { pageId: null, title: 'Trang đã xóa', slug: key, views: 0, leads: 0 });
        orphans.get(key).leads += l.n;
      }
    }
    const byPage = [...byId.values(), ...orphans.values()]
      .filter((p) => p.views || p.leads)
      .map((p) => ({ ...p, rate: rate(p.leads, p.views) }))
      .sort((a, b) => b.views - a.views || b.leads - a.leads || String(a.slug).localeCompare(String(b.slug)));

    // Per source: utm_source, else referrer host, else direct.
    const own = ownHosts(site, config);
    const sources = new Map();
    for (const s of q.leadsBySource.all(site.id, ...cur)) {
      const label = sourceLabel(s.utm, s.ref, own);
      sources.set(label, (sources.get(label) || 0) + s.n);
    }
    const bySource = [...sources]
      .map(([source, n]) => ({ source, leads: n }))
      .sort((a, b) => b.leads - a.leads || a.source.localeCompare(b.source));

    const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0]));
    for (const s of q.leadsByStatus.all(site.id, ...cur)) byStatus[s.status] = s.n;

    return {
      days,
      from: current.from,
      to: current.to,
      series,
      totals: {
        views: totalViews,
        leads: totalLeads,
        conversionRate: rate(totalLeads, totalViews),
        previous: { from: previous.from, to: previous.to, views: prevViews, leads: prevLeads, conversionRate: rate(prevLeads, prevViews) },
        change: { views: change(totalViews, prevViews), leads: change(totalLeads, prevLeads) },
      },
      byPage,
      bySource,
      byStatus,
    };
  }));

  return r;
}

module.exports = { createAnalyticsRouter, ranges, change, rate, ownHosts, sourceLabel };
