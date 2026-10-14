'use strict';

const crypto = require('node:crypto');

const SESSION_COOKIE = 'htc_session';

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [algo, saltHex, hashHex] = String(stored).split('$');
  if (algo !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function parseCookies(header) {
  const out = {};
  for (const part of (header || '').split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    if (key) out[key] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function createSessionStore(db, config) {
  return {
    create(res, userId) {
      const token = crypto.randomBytes(32).toString('base64url');
      const expires = new Date(Date.now() + config.sessionDays * 86400_000);
      db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(
        sha256(token),
        userId,
        expires.toISOString()
      );
      res.cookie(SESSION_COOKIE, token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: config.secureCookies,
        expires,
        path: '/',
      });
    },

    destroy(req, res) {
      const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
      if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
      res.clearCookie(SESSION_COOKIE, { path: '/' });
    },

    // Express middleware: sets req.user when a valid session cookie is present.
    load(req, _res, next) {
      const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
      if (token) {
        const row = db
          .prepare(
            `SELECT u.id, u.email, u.name, s.expires_at FROM sessions s
             JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND u.suspended_at IS NULL`
          )
          .get(sha256(token));
        if (row && new Date(row.expires_at) > new Date()) {
          req.user = { id: row.id, email: row.email, name: row.name };
          req.user.isSuperAdmin = config.superAdmins.includes(row.email.toLowerCase());
        }
      }
      next();
    },
  };
}

function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Vui lòng đăng nhập' });
  next();
}

module.exports = {
  SESSION_COOKIE,
  hashPassword,
  verifyPassword,
  createSessionStore,
  requireUser,
  parseCookies,
};
