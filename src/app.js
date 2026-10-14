'use strict';

const path = require('node:path');
const express = require('express');
const { createSessionStore } = require('./auth');
const { createAccess } = require('./access');
const { createApiRouter } = require('./routes/api');
const { createSitesRouter } = require('./routes/sites');
const { createBilling } = require('./billing');
const { createMailer } = require('./mailer');
const { createAccountRouter } = require('./routes/account');
const { createNotifier } = require('./notify');
const { createContentRouter } = require('./routes/content');
const { createAbRouter } = require('./routes/abtests');
const { logger, requestLogger } = require('./logger');
const { createMetrics } = require('./metrics');
const { createErrorReporter } = require('./errors');

const ROOT = path.join(__dirname, '..');

function createApp({ db, config }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback, linklocal, uniquelocal');

  const sessions = createSessionStore(db, config);
  const access = createAccess(db);
  const appOrigin = new URL(config.appUrl).origin;
  const uploadsDir = config.uploadsDir || path.join(ROOT, 'data', 'uploads');

  const mailer = config.mailer || createMailer(config);
  const billing = createBilling({ db, config, mailer });
  const notifier = createNotifier({ db, config, mailer });
  app.locals.mailer = mailer;

  // Observability: request id + access log, Prometheus metrics, error alerts.
  const log = config.logger || logger;
  const metrics = createMetrics({ db, config });
  const errors = config.errorReporter || createErrorReporter({ url: config.errorWebhookUrl, log });
  app.use(requestLogger({ log }));
  app.use(metrics.middleware);
  app.get('/metrics', metrics.handler);

  // Readiness: the database accepts a write lock (no data is written).
  app.get('/readyz', (_req, res) => {
    try {
      db.exec('BEGIN IMMEDIATE');
      db.exec('ROLLBACK');
      res.json({ ok: true });
    } catch (err) {
      log.warn('Readiness check failed', { err });
      res.status(503).json({ ok: false });
    }
  });

  app.get('/healthz', (_req, res) => {
    try {
      db.prepare('SELECT 1').get();
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false });
    }
  });

  // Uploaded images, served on every host so published pages can use /uploads/… paths.
  app.use(
    '/uploads',
    express.static(uploadsDir, {
      maxAge: '30d',
      immutable: true,
      index: false,
      fallthrough: false,
      setHeaders: (res) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'");
        res.setHeader('Access-Control-Allow-Origin', '*');
      },
    })
  );

  app.use(sessions.load);

  // Payment gateway webhooks and return URLs (no session / CSRF checks; verified by signature).
  app.use(billing.router);

  // Published customer sites (custom domains, subdomains, /p/, /preview, lead capture).
  app.use(createSitesRouter({ db, config, access, notifier }));

  // Security headers for the dashboard, editor and API (published pages set their own).
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (config.secureCookies) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  });

  // CSRF protection for the JSON API: reject cross-origin writes and require a
  // JSON body (which a cross-site HTML form cannot produce).
  app.use('/api', (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') return next();
    const origin = req.get('origin');
    if (origin && origin !== appOrigin) return res.status(403).json({ error: 'Origin không hợp lệ' });
    const isImageUpload = /^\/workspaces\/\d+\/assets$/.test(req.path) && req.is('image/*');
    if (['POST', 'PUT', 'PATCH'].includes(req.method) && !req.is('application/json') && !isImageUpload) {
      return res.status(415).json({ error: 'Yêu cầu phải ở định dạng JSON' });
    }
    next();
  });
  app.use('/api', express.json({ limit: '5mb' }));
  app.use('/api', createAccountRouter({ db, config, mailer, sessions }));
  app.use('/api', createApiRouter({ db, sessions, access, billing, mailer, config, notifier }).router);
  app.use('/api', createContentRouter({ db, config: { ...config, uploadsDir }, access }));
  app.use('/api', createAbRouter({ db, access }));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Không tìm thấy' }));

  // Editor vendor assets (GrapesJS + plugins BSD-3-Clause, Font Awesome OFL/MIT).
  const vendor = (pkg, file) => path.join(ROOT, 'node_modules', pkg, file);
  const vendorFiles = {
    'grapes.min.js': vendor('grapesjs', 'dist/grapes.min.js'),
    'grapes.min.css': vendor('grapesjs', 'dist/css/grapes.min.css'),
    'blocks-basic.js': vendor('grapesjs-blocks-basic', 'dist/index.js'),
    'plugin-forms.js': vendor('grapesjs-plugin-forms', 'dist/index.js'),
  };
  for (const dir of ['css', 'fonts']) {
    app.use(`/vendor/font-awesome/${dir}`, express.static(vendor('font-awesome', dir), { maxAge: '7d', index: false }));
  }
  app.get('/vendor/:file', (req, res, next) => {
    const file = vendorFiles[req.params.file];
    if (!file) return next();
    res.sendFile(file, { maxAge: '7d' });
  });

  app.use(metrics.unmatched);
  app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'] }));

  app.use((err, req, res, _next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) {
      (req.log || log).error('Request failed', { err, method: req.method, route: req.routePattern, host: req.hostname });
      errors.report(err, { kind: 'http_5xx', requestId: req.id, method: req.method, route: req.routePattern, host: req.hostname });
    }
    res.status(status).json(status >= 500 ? { error: 'Lỗi máy chủ', requestId: req.id } : { error: err.message });
  });

  return app;
}

module.exports = { createApp };
