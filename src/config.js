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
  // smtp(s)://user:pass@host:port — leave empty to log emails to stdout.
  smtpUrl: process.env.SMTP_URL || '',
  mailFrom: process.env.MAIL_FROM || 'HiTechCloud <no-reply@hitechcloud.vn>',
  payments: {
    payos: {
      clientId: process.env.PAYOS_CLIENT_ID,
      apiKey: process.env.PAYOS_API_KEY,
      checksumKey: process.env.PAYOS_CHECKSUM_KEY,
    },
    pay2s: {
      partnerCode: process.env.PAY2S_PARTNER_CODE,
      accessKey: process.env.PAY2S_ACCESS_KEY,
      secretKey: process.env.PAY2S_SECRET_KEY,
      partnerName: process.env.PAY2S_PARTNER_NAME || 'HiTechCloud',
      environment: process.env.PAY2S_ENV === 'production' ? 'production' : 'sandbox',
    },
  },
};

module.exports = config;
