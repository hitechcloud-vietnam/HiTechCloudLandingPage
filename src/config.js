'use strict';

const path = require('node:path');

function list(value) {
  return (value || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

const config = {
  port: Number(process.env.PORT || 3000),
  // Public URL of the dashboard/API, used for Origin (CSRF) checks and links.
  appUrl: (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, ''),
  // Published sites are served at <subdomain>.<publishRootDomain>, e.g. shop.hitechcloud.site
  publishRootDomain: (process.env.PUBLISH_ROOT_DOMAIN || '').toLowerCase(),
  dbFile: process.env.DB_FILE || path.join(__dirname, '..', 'data', 'hitechcloud.db'),
  superAdmins: list(process.env.SUPERADMIN_EMAILS),
  sessionDays: Number(process.env.SESSION_DAYS || 30),
  secureCookies: process.env.NODE_ENV === 'production',
};

module.exports = config;
