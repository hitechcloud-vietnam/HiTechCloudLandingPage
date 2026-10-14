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
    if (!hasColumn(table, column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  };
  add('workspaces', 'plan_expires_at', 'TEXT');
  add('sites', 'settings_json', "TEXT NOT NULL DEFAULT '{}'");
  add('pages', 'og_image', "TEXT NOT NULL DEFAULT ''");
  add('sites', 'domain_token', 'TEXT');
  add('sites', 'domain_verified_at', 'TEXT');
  add('workspaces', 'expiry_notice', 'TEXT');
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
