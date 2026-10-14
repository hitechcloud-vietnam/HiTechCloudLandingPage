'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workspaces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS memberships (
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'editor')),
  PRIMARY KEY (workspace_id, user_id)
);

CREATE TABLE IF NOT EXISTS sites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  subdomain TEXT NOT NULL UNIQUE,
  custom_domain TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  meta_description TEXT NOT NULL DEFAULT '',
  project_json TEXT,
  draft_html TEXT NOT NULL DEFAULT '',
  draft_css TEXT NOT NULL DEFAULT '',
  published_html TEXT,
  published_css TEXT,
  published_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (site_id, slug)
);

CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  page_slug TEXT,
  data_json TEXT NOT NULL,
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  plan TEXT NOT NULL,
  months INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  provider TEXT NOT NULL,
  order_code TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'cancelled', 'failed')),
  checkout_url TEXT,
  provider_ref TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  paid_at TEXT
);

CREATE TABLE IF NOT EXISTS page_views (
  page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  views INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (page_id, day)
);

CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

CREATE TABLE IF NOT EXISTS email_verifications (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

CREATE TABLE IF NOT EXISTS invitations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'editor')),
  token_hash TEXT NOT NULL UNIQUE,
  invited_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (workspace_id, email)
);

CREATE TABLE IF NOT EXISTS assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  path TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS page_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  html TEXT NOT NULL,
  css TEXT NOT NULL,
  project_json TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ab_tests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  variant_page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  split INTEGER NOT NULL CHECK (split BETWEEN 1 AND 99),
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'stopped')),
  winner TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  stopped_at TEXT
);

CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS abuse_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER REFERENCES sites(id) ON DELETE SET NULL,
  page_slug TEXT,
  url TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  contact_email TEXT,
  ip TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  resolution TEXT,
  resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  resolved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS safety_flags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  page_id INTEGER REFERENCES pages(id) ON DELETE CASCADE,
  score INTEGER NOT NULL,
  reasons_json TEXT NOT NULL DEFAULT '[]',
  content_hash TEXT,
  auto_suspended INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'dismissed', 'actioned')),
  reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_abuse_reports_status ON abuse_reports(status, id);
CREATE INDEX IF NOT EXISTS idx_safety_flags_status ON safety_flags(status, id);
CREATE INDEX IF NOT EXISTS idx_safety_flags_page ON safety_flags(page_id, status);
CREATE INDEX IF NOT EXISTS idx_api_keys_workspace ON api_keys(workspace_id, id);
CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys(prefix);

CREATE TABLE IF NOT EXISTS coupons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  percent_off INTEGER CHECK (percent_off BETWEEN 1 AND 100),
  amount_off_vnd INTEGER CHECK (amount_off_vnd > 0),
  applies_to_plans TEXT,
  applies_to_months INTEGER CHECK (applies_to_months IN (1, 12)),
  max_redemptions INTEGER,
  redeemed_count INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK ((percent_off IS NULL) <> (amount_off_vnd IS NULL))
);

-- VAT invoice (hóa đơn GTGT) buyer details, one per workspace.
CREATE TABLE IF NOT EXISTS billing_profiles (
  workspace_id INTEGER PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  buyer_type TEXT NOT NULL CHECK (buyer_type IN ('company', 'individual')),
  company_name TEXT NOT NULL DEFAULT '',
  tax_code TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL,
  buyer_name TEXT NOT NULL DEFAULT '',
  auto_invoice INTEGER NOT NULL DEFAULT 0,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Invoice requests snapshot the buyer details at request time; issued manually
-- in the e-invoice software and recorded here.
CREATE TABLE IF NOT EXISTS invoice_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  requested_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  auto INTEGER NOT NULL DEFAULT 0,
  buyer_type TEXT NOT NULL,
  company_name TEXT NOT NULL DEFAULT '',
  tax_code TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL,
  buyer_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'issued', 'cancelled')),
  invoice_no TEXT,
  lookup_code TEXT,
  lookup_url TEXT,
  cancel_reason TEXT,
  processed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  processed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_invoice_requests_status ON invoice_requests(status, id);
CREATE INDEX IF NOT EXISTS idx_invoice_requests_workspace ON invoice_requests(workspace_id, id);
CREATE INDEX IF NOT EXISTS idx_ab_page ON ab_tests(page_id, status);
CREATE INDEX IF NOT EXISTS idx_assets_workspace ON assets(workspace_id, id);
CREATE INDEX IF NOT EXISTS idx_versions_page ON page_versions(page_id, id);
CREATE INDEX IF NOT EXISTS idx_orders_workspace ON orders(workspace_id, id);
CREATE INDEX IF NOT EXISTS idx_leads_site ON leads(site_id, created_at);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
`;

function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

// Additive column migrations for databases created by earlier versions.
function migrate(db) {
  const hasColumn = (table, column) =>
    db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  const add = (table, column, ddl) => {
    if (hasColumn(table, column)) return false;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
    return true;
  };
  add('workspaces', 'plan_expires_at', 'TEXT');
  add('sites', 'settings_json', "TEXT NOT NULL DEFAULT '{}'");
  add('pages', 'og_image', "TEXT NOT NULL DEFAULT ''");
  add('sites', 'domain_token', 'TEXT');
  add('sites', 'domain_verified_at', 'TEXT');
  add('sites', 'domain_claimed_at', 'TEXT');
  add('workspaces', 'expiry_notice', 'TEXT');
  add('leads', 'status', "TEXT NOT NULL DEFAULT 'new'");
  add('leads', 'note', "TEXT NOT NULL DEFAULT ''");
  add('leads', 'source_json', "TEXT NOT NULL DEFAULT '{}'");
  add('leads', 'page_id', 'INTEGER');
  add('leads', 'ab_test_id', 'INTEGER');
  add('leads', 'ab_bucket', 'TEXT');
  add('leads', 'spam_score', 'INTEGER NOT NULL DEFAULT 0');
  add('leads', 'flags_json', "TEXT NOT NULL DEFAULT '[]'");
  add('leads', 'duplicate_of', 'INTEGER');
  add('ab_tests', 'views_a', 'INTEGER NOT NULL DEFAULT 0');
  add('ab_tests', 'views_b', 'INTEGER NOT NULL DEFAULT 0');
  // Accounts created before email verification existed count as verified.
  if (add('users', 'email_verified_at', 'TEXT')) db.exec('UPDATE users SET email_verified_at = created_at');
  add('orders', 'coupon_code', 'TEXT');
  add('orders', 'discount_vnd', 'INTEGER NOT NULL DEFAULT 0');
  add('orders', 'list_amount', 'INTEGER');
  // Trust & safety suspensions.
  add('sites', 'suspended_at', 'TEXT');
  add('sites', 'suspended_reason', 'TEXT');
  add('users', 'suspended_at', 'TEXT');
  add('users', 'terms_accepted_at', 'TEXT');
  add('users', 'terms_version', 'TEXT');
  add('users', 'suspended_reason', 'TEXT');
}

// Runs fn inside a transaction, rolling back on error.
function transaction(db, fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

module.exports = { openDb, transaction };
