'use strict';

const crypto = require('node:crypto');
const express = require('express');
const { hashPassword, verifyPassword, requireUser } = require('../auth');
const { HttpError } = require('../access');
const { transaction } = require('../db');
const { createRateLimiter } = require('../ratelimit');

const RESET_TTL_MS = 60 * 60 * 1000;
const INVITE_TTL_MS = 7 * 86400_000;

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function newToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function validPassword(password) {
  if (typeof password !== 'string' || password.length < 8 || password.length > 200) {
    throw new HttpError(400, 'Mật khẩu cần ít nhất 8 ký tự');
  }
  return password;
}

// Shared by signup and the accept endpoint: joins the invited workspace
// when the token is valid and was issued to this user's email.
function acceptInvitation(db, token, user) {
  const inv = db
    .prepare("SELECT * FROM invitations WHERE token_hash = ? AND accepted_at IS NULL AND expires_at > ?")
    .get(sha256(String(token || '')), new Date().toISOString());
  if (!inv) throw new HttpError(404, 'Lời mời không tồn tại hoặc đã hết hạn');
  if (inv.email !== user.email.toLowerCase()) {
    throw new HttpError(403, `Lời mời này dành cho ${inv.email}`);
  }
  transaction(db, () => {
    db.prepare('INSERT OR IGNORE INTO memberships (workspace_id, user_id, role) VALUES (?, ?, ?)').run(inv.workspace_id, user.id, inv.role);
    db.prepare("UPDATE invitations SET accepted_at = datetime('now') WHERE id = ?").run(inv.id);
  });
  return inv.workspace_id;
}

function createInvitation(db, { workspaceId, email, role, invitedBy }) {
  const token = newToken();
  const expires = new Date(Date.now() + INVITE_TTL_MS).toISOString();
  db.prepare(
    `INSERT INTO invitations (workspace_id, email, role, token_hash, invited_by, expires_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (workspace_id, email) DO UPDATE SET role = excluded.role, token_hash = excluded.token_hash,
       invited_by = excluded.invited_by, expires_at = excluded.expires_at, accepted_at = NULL, created_at = datetime('now')`
  ).run(workspaceId, email, role, sha256(token), invitedBy, expires);
  return token;
}

function createAccountRouter({ db, config, mailer, sessions }) {
  const r = express.Router();
  const forgotLimiter = createRateLimiter({ windowMs: 3600_000, max: 5 });

  const h = (fn) => (req, res, next) => {
    Promise.resolve()
      .then(() => fn(req, res))
      .then((out) => {
        if (out !== undefined && !res.headersSent) res.json(out);
      })
      .catch(next);
  };

  r.post('/auth/forgot', h(async (req) => {
    if (!forgotLimiter(req.ip)) throw new HttpError(429, 'Bạn thao tác quá nhanh, vui lòng thử lại sau');
    const email = String(req.body.email || '').trim().toLowerCase();
    const user = db.prepare('SELECT id, name, email FROM users WHERE email = ?').get(email);
    // Same response whether or not the account exists (no account enumeration).
    if (user) {
      const token = newToken();
      db.prepare('INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(
        sha256(token),
        user.id,
        new Date(Date.now() + RESET_TTL_MS).toISOString()
      );
      await mailer.send({
        to: user.email,
        subject: 'Đặt lại mật khẩu HiTechCloud',
        text: `Chào ${user.name},\n\nBấm vào liên kết sau để đặt lại mật khẩu (hiệu lực 60 phút):\n${config.appUrl}/app/reset?token=${token}\n\nNếu bạn không yêu cầu, hãy bỏ qua email này.`,
      });
    }
    return { ok: true };
  }));

  r.post('/auth/reset', h((req, res) => {
    const password = validPassword(req.body.password);
    const row = db
      .prepare('SELECT * FROM password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?')
      .get(sha256(String(req.body.token || '')), new Date().toISOString());
    if (!row) throw new HttpError(400, 'Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn');
    transaction(db, () => {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), row.user_id);
      db.prepare("UPDATE password_resets SET used_at = datetime('now') WHERE user_id = ? AND used_at IS NULL").run(row.user_id);
      // Sign out every existing session.
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.user_id);
    });
    sessions.create(res, row.user_id);
    return { ok: true };
  }));

  r.get('/invitations/:token', h((req) => {
    const inv = db
      .prepare(
        `SELECT i.email, i.role, w.name AS workspace FROM invitations i JOIN workspaces w ON w.id = i.workspace_id
         WHERE i.token_hash = ? AND i.accepted_at IS NULL AND i.expires_at > ?`
      )
      .get(sha256(req.params.token), new Date().toISOString());
    if (!inv) throw new HttpError(404, 'Lời mời không tồn tại hoặc đã hết hạn');
    const hasAccount = !!db.prepare('SELECT 1 FROM users WHERE email = ?').get(inv.email);
    return { ...inv, hasAccount };
  }));

  r.post('/invitations/accept', requireUser, h((req) => ({ workspaceId: acceptInvitation(db, req.body.token, req.user) })));

  r.post('/auth/change-password', requireUser, h((req, res) => {
    const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    if (!verifyPassword(String(req.body.currentPassword || ''), user.password_hash)) {
      throw new HttpError(400, 'Mật khẩu hiện tại không đúng');
    }
    const password = validPassword(req.body.newPassword);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), req.user.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(req.user.id);
    sessions.create(res, req.user.id);
    return { ok: true };
  }));

  r.patch('/auth/me', requireUser, h((req) => {
    const name = String(req.body.name || '').trim();
    if (!name || name.length > 100) throw new HttpError(400, 'Họ tên không hợp lệ');
    db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, req.user.id);
    return { ok: true };
  }));

  return r;
}

module.exports = { createAccountRouter, acceptInvitation, createInvitation, sha256 };
