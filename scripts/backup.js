'use strict';

// Consistent online backup of the SQLite database (safe while the app runs).
// Usage: node scripts/backup.js [output-dir]   (default: ./backups)
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = require('../src/config');

const outDir = path.resolve(process.argv[2] || 'backups');
fs.mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const target = path.join(outDir, `hitechcloud-${stamp}.db`);

const db = new DatabaseSync(config.dbFile, { readOnly: true });
db.prepare('VACUUM INTO ?').run(target);
db.close();
console.log(`Đã sao lưu: ${target}`);
