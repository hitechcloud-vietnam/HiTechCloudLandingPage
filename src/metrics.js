'use strict';

const crypto = require('node:crypto');
const { monitorEventLoopDelay } = require('node:perf_hooks');
const { isSensitiveKey } = require('./logger');
const { version } = require('../package.json');

const BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);

// One event-loop delay monitor per process (its timer does not keep the process alive).
const LOOP_RESOLUTION_MS = 20;
let loopDelay = null;
function eventLoopMonitor() {
  if (!loopDelay) {
    loopDelay = monitorEventLoopDelay({ resolution: LOOP_RESOLUTION_MS });
    loopDelay.enable();
  }
  return loopDelay;
}

function routePath(route) {
  const p = route && route.path;
  if (Array.isArray(p)) return p.map(String).join('|');
  return p === undefined ? '' : String(p);
}

// Records the matched Express route pattern (with its mount path) on req.routePattern,
// so labels stay bounded (/api/sites/:id, not /api/sites/42). Express sets req.route
// when a route starts handling; a later reset (see `unmatched`) clears it.
function trackRoute(req) {
  let route;
  Object.defineProperty(req, 'route', {
    configurable: true,
    enumerable: true,
    get: () => route,
    set: (value) => {
      route = value;
      req.routePattern = value ? (req.baseUrl || '') + routePath(value) : undefined;
      const params = (value && req.params) || {};
      req.sensitiveParams = Object.keys(params)
        .filter((k) => isSensitiveKey(k) && params[k])
        .map((k) => String(params[k]));
    },
  });
}

function routeLabel(req, status) {
  if (req.routePattern) return req.routePattern;
  const path = req.path || '';
  if (path.startsWith('/uploads/')) return '/uploads/*';
  if (path.startsWith('/vendor/')) return '/vendor/*';
  if ((req.method === 'GET' || req.method === 'HEAD') && status < 400) return 'static';
  return 'other';
}

function esc(v) {
  return String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}
function labels(obj) {
  const parts = Object.entries(obj).map(([k, v]) => `${k}="${esc(v)}"`);
  return parts.length ? `{${parts.join(',')}}` : '';
}
function num(n) {
  if (n === Infinity) return '+Inf';
  return Number.isFinite(n) ? String(n) : '0';
}

function tokenMatches(given, expected) {
  const a = crypto.createHash('sha256').update(String(given)).digest();
  const b = crypto.createHash('sha256').update(String(expected)).digest();
  return crypto.timingSafeEqual(a, b);
}

// Prometheus metrics: HTTP traffic, runtime and cheap business gauges.
function createMetrics({ db, config, cacheMs = 15_000, now = () => Date.now() }) {
  const appHost = new URL(config.appUrl).hostname.toLowerCase();
  const requests = new Map(); // method|route|class -> count
  const durations = new Map(); // method|route -> { counts, sum, count }
  const loop = eventLoopMonitor();
  let business = { at: -Infinity, lines: [] };

  function observe(method, route, status, seconds) {
    const m = METHODS.has(method) ? method : 'OTHER';
    const cls = `${Math.floor(status / 100)}xx`;
    const rk = `${m}\0${route}\0${cls}`;
    requests.set(rk, (requests.get(rk) || 0) + 1);
    const dk = `${m}\0${route}`;
    let h = durations.get(dk);
    if (!h) durations.set(dk, (h = { counts: new Array(BUCKETS.length).fill(0), sum: 0, count: 0 }));
    for (let i = 0; i < BUCKETS.length; i++) if (seconds <= BUCKETS[i]) h.counts[i]++;
    h.sum += seconds;
    h.count++;
  }

  function middleware(req, res, next) {
    trackRoute(req);
    const start = process.hrtime.bigint();
    res.once('close', () => {
      observe(req.method, routeLabel(req, res.statusCode), res.statusCode, Number(process.hrtime.bigint() - start) / 1e9);
    });
    next();
  }

  // Mounted just before the catch-all static handler: requests that fell through
  // earlier routes are not attributed to them.
  function unmatched(req, _res, next) {
    req.route = undefined;
    next();
  }

  function businessLines() {
    if (now() - business.at < cacheMs) return business.lines;
    const lines = [];
    const gauge = (name, help, rows) => {
      lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} gauge`);
      for (const [lbl, value] of rows) lines.push(`${name}${labels(lbl)} ${num(value)}`);
    };
    const count = (sql, ...args) => {
      try {
        return Number(db.prepare(sql).get(...args).n) || 0;
      } catch {
        return NaN;
      }
    };
    const nowIso = new Date(now()).toISOString();
    const today = nowIso.slice(0, 10);
    gauge('hitechcloud_users', 'Registered users.', [[{}, count('SELECT COUNT(*) AS n FROM users')]]);
    gauge('hitechcloud_workspaces', 'Workspaces.', [[{}, count('SELECT COUNT(*) AS n FROM workspaces')]]);
    let paid = [];
    try {
      paid = db
        .prepare("SELECT plan, COUNT(*) AS n FROM workspaces WHERE plan != 'free' AND (plan_expires_at IS NULL OR plan_expires_at > ?) GROUP BY plan")
        .all(nowIso)
        .map((r) => [{ plan: r.plan }, r.n]);
    } catch {
      // table/column missing: report nothing
    }
    gauge('hitechcloud_workspaces_paid', 'Workspaces on an active paid plan.', paid.length ? paid : [[{ plan: 'none' }, 0]]);
    gauge('hitechcloud_sites', 'Sites.', [[{}, count('SELECT COUNT(*) AS n FROM sites')]]);
    gauge('hitechcloud_pages_published', 'Published pages.', [[{}, count('SELECT COUNT(*) AS n FROM pages WHERE published_html IS NOT NULL')]]);
    gauge('hitechcloud_leads_today', 'Leads captured since 00:00 UTC today.', [[{}, count("SELECT COUNT(*) AS n FROM leads WHERE created_at >= ? AND status != 'spam'", today)]]);
    business = { at: now(), lines };
    return lines;
  }

  function render() {
    const out = [];
    out.push('# HELP http_requests_total HTTP requests by method, route pattern and status class.', '# TYPE http_requests_total counter');
    for (const [key, n] of requests) {
      const [method, route, status_class] = key.split('\0');
      out.push(`http_requests_total${labels({ method, route, status_class })} ${n}`);
    }
    out.push('# HELP http_request_duration_seconds HTTP request duration by method and route pattern.', '# TYPE http_request_duration_seconds histogram');
    for (const [key, h] of durations) {
      const [method, route] = key.split('\0');
      BUCKETS.forEach((le, i) => out.push(`http_request_duration_seconds_bucket${labels({ method, route, le })} ${h.counts[i]}`));
      out.push(`http_request_duration_seconds_bucket${labels({ method, route, le: '+Inf' })} ${h.count}`);
      out.push(`http_request_duration_seconds_sum${labels({ method, route })} ${num(h.sum)}`);
      out.push(`http_request_duration_seconds_count${labels({ method, route })} ${h.count}`);
    }

    const mem = process.memoryUsage();
    const cpu = process.cpuUsage();
    const simple = (name, type, help, value, lbl = {}) => out.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`, `${name}${labels(lbl)} ${num(value)}`);
    simple('hitechcloud_build_info', 'gauge', 'Application version and Node.js runtime.', 1, { version, node: process.version });
    simple('process_uptime_seconds', 'gauge', 'Process uptime in seconds.', process.uptime());
    simple('process_start_time_seconds', 'gauge', 'Process start time (unix seconds).', Math.round(Date.now() / 1000 - process.uptime()));
    simple('process_cpu_seconds_total', 'counter', 'User + system CPU time in seconds.', (cpu.user + cpu.system) / 1e6);
    simple('process_resident_memory_bytes', 'gauge', 'Resident set size in bytes.', mem.rss);
    simple('nodejs_heap_used_bytes', 'gauge', 'V8 heap used in bytes.', mem.heapUsed);
    simple('nodejs_heap_total_bytes', 'gauge', 'V8 heap total in bytes.', mem.heapTotal);
    simple('nodejs_external_memory_bytes', 'gauge', 'Memory used by C++ objects bound to JS.', mem.external);

    // Event-loop delay since the previous scrape (histogram resets after each read).
    out.push('# HELP nodejs_eventloop_lag_seconds Event loop delay quantiles since the previous scrape.', '# TYPE nodejs_eventloop_lag_seconds gauge');
    // Samples are full timer intervals; subtract the sampling resolution to get the delay.
    const lag = (ns) => (loop.count ? Math.max(0, Math.round(ns / 1e3 - LOOP_RESOLUTION_MS * 1e3) / 1e6) : 0);
    for (const q of [0.5, 0.9, 0.99]) out.push(`nodejs_eventloop_lag_seconds${labels({ quantile: q })} ${num(lag(loop.percentile(q * 100)))}`);
    simple('nodejs_eventloop_lag_max_seconds', 'gauge', 'Maximum event loop delay since the previous scrape.', lag(loop.max));
    loop.reset();

    out.push(...businessLines());
    return out.join('\n') + '\n';
  }

  // GET /metrics: only on the dashboard host and only with METRICS_TOKEN. Otherwise the
  // request falls through, so a customer page with slug "metrics" keeps working.
  function handler(req, res, next) {
    if (!config.metricsToken || String(req.hostname || '').toLowerCase() !== appHost) return next();
    const m = /^Bearer\s+(.+)$/i.exec(req.get('authorization') || '');
    if (!m || !tokenMatches(m[1].trim(), config.metricsToken)) {
      res.setHeader('WWW-Authenticate', 'Bearer realm="metrics"');
      return res.status(401).type('text/plain').send('Unauthorized\n');
    }
    res.setHeader('Cache-Control', 'no-store');
    res.type('text/plain; version=0.0.4; charset=utf-8').send(render());
  }

  return { middleware, unmatched, handler, render, observe };
}

module.exports = { createMetrics, routeLabel, trackRoute };
