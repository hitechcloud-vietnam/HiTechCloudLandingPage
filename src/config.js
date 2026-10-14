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
  // Hostname customers point their CNAME at, e.g. sites.hitechcloud.vn
  cnameTarget: (process.env.CNAME_TARGET || '').toLowerCase(),
  dbFile: process.env.DB_FILE || path.join(__dirname, '..', 'data', 'hitechcloud.db'),
  uploadsDir: process.env.UPLOADS_DIR || path.join(__dirname, '..', 'data', 'uploads'),
  // S3-compatible object storage for uploaded images; local disk when S3_BUCKET is empty.
  s3: {
    bucket: process.env.S3_BUCKET || '',
    endpoint: process.env.S3_ENDPOINT || '',
    region: process.env.S3_REGION || 'us-east-1',
    accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
    publicUrl: process.env.S3_PUBLIC_URL || '',
    forcePathStyle: ['1', 'true', 'yes'].includes(String(process.env.S3_FORCE_PATH_STYLE || '').toLowerCase()),
  },
  superAdmins: list(process.env.SUPERADMIN_EMAILS),
  sessionDays: Number(process.env.SESSION_DAYS || 30),
  secureCookies: process.env.NODE_ENV === 'production',
  // smtp(s)://user:pass@host:port — leave empty to log emails to stdout.
  smtpUrl: process.env.SMTP_URL || '',
  mailFrom: process.env.MAIL_FROM || 'HiTechCloud <no-reply@hitechcloud.vn>',
  // Observability. Logs are silent under the test runner unless LOG_LEVEL is set.
  logLevel: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'test' || process.env.NODE_TEST_CONTEXT ? 'silent' : 'info'),
  logFormat: process.env.LOG_FORMAT || (process.env.NODE_ENV === 'production' ? 'json' : 'pretty'),
  // Bearer token for GET /metrics on the APP_URL host; unset = endpoint disabled (404).
  metricsToken: process.env.METRICS_TOKEN || '',
  // Slack/Discord-compatible incoming webhook for 5xx / crash alerts.
  errorWebhookUrl: process.env.ERROR_WEBHOOK_URL || '',
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
