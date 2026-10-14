'use strict';

const path = require('node:path');
const express = require('express');
const { createSessionStore } = require('./auth');
const { createAccess } = require('./access');
const { createApiRouter } = require('./routes/api');
const { createSitesRouter } = require('./routes/sites');
const { createBilling } = require('./billing');

const ROOT = path.join(__dirname, '..');

function createApp({ db, config }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback, linklocal, uniquelocal');

  const sessions = createSessionStore(db, config);
  const access = createAccess(db);
  const appOrigin = new URL(config.appUrl).origin;

  const billing = createBilling({ db, config });

  app.use(sessions.load);

  // Payment gateway webhooks and return URLs (no session / CSRF checks; verified by signature).
  app.use(billing.router);

  // Published customer sites (custom domains, subdomains, /p/, /preview, lead capture).
  app.use(createSitesRouter({ db, config, access }));

  // CSRF protection for the JSON API: reject cross-origin writes and require a
  // JSON body (which a cross-site HTML form cannot produce).
  app.use('/api', (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') return next();
    const origin = req.get('origin');
    if (origin && origin !== appOrigin) return res.status(403).json({ error: 'Origin không hợp lệ' });
    if (['POST', 'PUT', 'PATCH'].includes(req.method) && !req.is('application/json')) {
      return res.status(415).json({ error: 'Yêu cầu phải ở định dạng JSON' });
    }
    next();
  });
  app.use('/api', express.json({ limit: '5mb' }));
  app.use('/api', createApiRouter({ db, sessions, access, billing }).router);
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

  app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'] }));

  app.use((err, _req, res, _next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'Lỗi máy chủ' : err.message });
  });

  return app;
}

module.exports = { createApp };
