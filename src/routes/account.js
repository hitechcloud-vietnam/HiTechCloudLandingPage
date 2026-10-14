'use strict';

const crypto = require('node:crypto');
const express = require('express');
const { handler } = require('../http');
const { hashPassword, verifyPassword, requireUser, SESSION_COOKIE } = require('../auth');
const { HttpError, createAccess } = require('../access');
const { transaction } = require('../db');
const { createRateLimiter } = require('../ratelimit');
const { workspaceAssetKeys, removeObjects } = require('../storage');
const { logger } = require('../logger');

const RESET_TTL_MS = 60 * 60 * 1000;
const INVITE_TTL_MS = 7 * 86400_000;
const VERIFY_TTL_MS = 24 * 3600_000;
const DELETE_CONFIRM = 'XOA TAI KHOAN';

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
    // The token was delivered to this address, which proves ownership.
    markEmailVerified(db, user.id);
  });
  return inv.workspace_id;
}

// ---------- Email verification ----------

function markEmailVerified(db, userId) {
  db.prepare("UPDATE users SET email_verified_at = COALESCE(email_verified_at, datetime('now')) WHERE id = ?").run(userId);
}

function isEmailVerified(db, userId) {
  const row = db.prepare('SELECT email_verified_at FROM users WHERE id = ?').get(userId);
  return !!(row && row.email_verified_at);
}

// Soft enforcement: the app is usable, but publishing and paying need a verified email.
function assertEmailVerified(db, userId, action) {
  if (!isEmailVerified(db, userId)) {
    throw new HttpError(403, `Vui lòng xác minh email trước khi ${action}. Kiểm tra hộp thư hoặc bấm "Gửi lại email xác minh" trên bảng điều khiển.`);
  }
}

// Issues a fresh single-use token (older unused ones are revoked) and emails it.
async function sendVerificationEmail(db, { mailer, config }, user) {
  const token = newToken();
  transaction(db, () => {
    db.prepare('DELETE FROM email_verifications WHERE user_id = ? AND used_at IS NULL').run(user.id);
    db.prepare('INSERT INTO email_verifications (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(
      sha256(token),
      user.id,
      new Date(Date.now() + VERIFY_TTL_MS).toISOString()
    );
  });
  await mailer.send({
    to: user.email,
    subject: 'Xác minh địa chỉ email HiTechCloud',
    text: `Chào ${user.name},\n\nBấm vào liên kết sau để xác minh địa chỉ email của bạn (hiệu lực 24 giờ):\n${config.appUrl}/api/auth/verify?token=${token}\n\nSau khi xác minh, bạn có thể xuất bản trang và nâng cấp gói dịch vụ.\nNếu bạn không đăng ký tài khoản HiTechCloud, hãy bỏ qua email này.`,
  });
}

// ---------- Personal data export (Decree 13/2023) ----------

function parseJson(value) {
  try {
    return JSON.parse(value || '{}');
  } catch {
    return {};
  }
}

// Profile, memberships and the content of workspaces the user owns. Never
// includes password hashes, session/reset/verification tokens, domain tokens,
// integration secrets or other members' details.
function exportUserData(db, userId) {
  const user = db.prepare('SELECT id, email, name, created_at, email_verified_at, terms_accepted_at, terms_version FROM users WHERE id = ?').get(userId);
  const memberships = db
    .prepare(
      `SELECT w.id AS workspaceId, w.name AS workspaceName, m.role FROM memberships m
       JOIN workspaces w ON w.id = m.workspace_id WHERE m.user_id = ? ORDER BY w.id`
    )
    .all(userId);
  const owned = db
    .prepare(
      `SELECT w.id, w.name, w.plan, w.plan_expires_at, w.created_at FROM memberships m
       JOIN workspaces w ON w.id = m.workspace_id WHERE m.user_id = ? AND m.role = 'owner' ORDER BY w.id`
    )
    .all(userId);
  const sites = db.prepare('SELECT id, name, subdomain, custom_domain, domain_verified_at, created_at FROM sites WHERE workspace_id = ? ORDER BY id');
  const pages = db.prepare(
    `SELECT id, title, slug, meta_description, og_image, draft_html, draft_css, published_html, published_css, published_at, updated_at
     FROM pages WHERE site_id = ? ORDER BY id`
  );
  const leads = db.prepare('SELECT id, page_slug, data_json, source_json, status, note, ip, created_at FROM leads WHERE site_id = ? ORDER BY id');
  const orders = db.prepare('SELECT id, plan, months, amount, provider, order_code, status, created_at, paid_at FROM orders WHERE workspace_id = ? ORDER BY id');
  return {
    exportedAt: new Date().toISOString(),
    user,
    memberships,
    ownedWorkspaces: owned.map((ws) => ({
      ...ws,
      sites: sites.all(ws.id).map((site) => ({
        ...site,
        pages: pages.all(site.id),
        leads: leads.all(site.id).map(({ data_json, source_json, ...lead }) => ({
          ...lead,
          data: parseJson(data_json),
          source: parseJson(source_json),
        })),
      })),
      orders: orders.all(ws.id),
    })),
  };
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

function createAccountRouter({ db, config, mailer, sessions, storage }) {
  const r = express.Router();
  const forgotLimiter = createRateLimiter({ windowMs: 3600_000, max: 5 });
  const resendLimiter = createRateLimiter({ windowMs: 3600_000, max: 3 });
  const deleteLimiter = createRateLimiter({ windowMs: 15 * 60_000, max: 5 });
  const access = createAccess(db);

  const h = handler;

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

  // ---------- Email verification ----------
  // Plain GET so the link works straight from the mail client; tokens are single-use.
  r.get('/auth/verify', h((req, res) => {
    const row = db
      .prepare('SELECT * FROM email_verifications WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?')
      .get(sha256(String(req.query.token || '')), new Date().toISOString());
    if (!row) return res.redirect('/app/?verified=0');
    transaction(db, () => {
      db.prepare("UPDATE email_verifications SET used_at = datetime('now') WHERE token_hash = ?").run(row.token_hash);
      markEmailVerified(db, row.user_id);
    });
    res.redirect('/app/?verified=1');
  }));

  r.post('/auth/resend-verification', requireUser, h(async (req) => {
    if (isEmailVerified(db, req.user.id)) throw new HttpError(400, 'Email của bạn đã được xác minh');
    if (!resendLimiter(`u${req.user.id}`)) throw new HttpError(429, 'Bạn đã yêu cầu gửi lại quá nhiều lần, vui lòng thử lại sau 1 giờ');
    await sendVerificationEmail(db, { mailer, config }, req.user);
    return { ok: true };
  }));

  // ---------- Personal data rights (Decree 13/2023) ----------
  r.get('/auth/export', requireUser, h((req, res) => {
    const data = exportUserData(db, req.user.id);
    res.setHeader('Content-Disposition', `attachment; filename="hitechcloud-du-lieu-ca-nhan-${data.exportedAt.slice(0, 10)}.json"`);
    res.setHeader('Cache-Control', 'no-store');
    res.type('application/json').send(JSON.stringify(data, null, 2));
  }));

  r.post('/auth/delete-account', requireUser, h(async (req, res) => {
    if (!deleteLimiter(`u${req.user.id}`)) throw new HttpError(429, 'Bạn thao tác quá nhanh, vui lòng thử lại sau');
    if (req.body.confirm !== DELETE_CONFIRM) {
      throw new HttpError(400, `Vui lòng nhập chính xác "${DELETE_CONFIRM}" để xác nhận`);
    }
    const user = db.prepare('SELECT id, email, name, password_hash FROM users WHERE id = ?').get(req.user.id);
    if (!verifyPassword(String(req.body.password || ''), user.password_hash)) {
      throw new HttpError(400, 'Mật khẩu không đúng');
    }
    const owned = db
      .prepare(
        `SELECT w.id, w.name, (SELECT COUNT(*) FROM memberships x WHERE x.workspace_id = w.id) AS members
         FROM memberships m JOIN workspaces w ON w.id = m.workspace_id WHERE m.user_id = ? AND m.role = 'owner'`
      )
      .all(user.id);
    const shared = owned.filter((w) => w.members > 1);
    if (shared.length) {
      throw new HttpError(
        409,
        `Bạn đang là chủ sở hữu workspace có thành viên khác (${shared.map((w) => `"${w.name}"`).join(', ')}). ` +
          'Hãy chuyển quyền sở hữu hoặc xóa các thành viên trước khi xóa tài khoản.'
      );
    }
    // Owned workspaces cascade to sites, pages, leads, orders…; the user row
    // cascades to sessions, memberships and tokens. Uploaded files go afterwards.
    const assetKeys = workspaceAssetKeys(db, owned.map((w) => w.id));
    transaction(db, () => {
      const delWorkspace = db.prepare('DELETE FROM workspaces WHERE id = ?');
      for (const w of owned) delWorkspace.run(w.id);
      db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
    });
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    if (storage) await removeObjects(storage, assetKeys, req.log || logger);
    await mailer.send({
      to: user.email,
      subject: 'Tài khoản HiTechCloud của bạn đã được xóa',
      text: `Chào ${user.name},\n\nTheo yêu cầu của bạn, tài khoản ${user.email} và ${owned.length} workspace do bạn sở hữu (website, trang, lead, lịch sử thanh toán) đã được xóa vĩnh viễn khỏi HiTechCloud LandingPage.\n\nNếu bạn không thực hiện yêu cầu này, hãy liên hệ ngay với bộ phận hỗ trợ.`,
    });
    return { ok: true, deletedWorkspaces: owned.length };
  }));

  r.post('/workspaces/:wid/transfer', requireUser, h(async (req) => {
    const { ws } = access.workspace(req.user, req.params.wid, 'owner');
    const targetId = Number(req.body.userId);
    if (!Number.isInteger(targetId) || targetId === req.user.id) throw new HttpError(400, 'Thành viên nhận quyền không hợp lệ');
    const target = db
      .prepare('SELECT m.role, u.email, u.name FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? AND m.user_id = ?')
      .get(ws.id, targetId);
    if (!target || !['admin', 'editor'].includes(target.role)) throw new HttpError(404, 'Không tìm thấy thành viên');
    transaction(db, () => {
      db.prepare("UPDATE memberships SET role = 'owner' WHERE workspace_id = ? AND user_id = ?").run(ws.id, targetId);
      db.prepare("UPDATE memberships SET role = 'admin' WHERE workspace_id = ? AND user_id = ?").run(ws.id, req.user.id);
    });
    await mailer.send({
      to: target.email,
      subject: `Bạn đã trở thành chủ sở hữu workspace "${ws.name}"`,
      text: `Chào ${target.name},\n\n${req.user.name} đã chuyển quyền sở hữu workspace "${ws.name}" trên HiTechCloud LandingPage cho bạn.\nQuản lý workspace: ${config.appUrl}/app/`,
    });
    return { ok: true };
  }));

  return r;
}

module.exports = {
  createAccountRouter,
  acceptInvitation,
  createInvitation,
  sha256,
  sendVerificationEmail,
  isEmailVerified,
  assertEmailVerified,
  exportUserData,
};
