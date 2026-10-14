'use strict';

const express = require('express');
const { handler } = require('../http');
const { monthStart, leadsThisMonth } = require('../usage');
const { hashPassword, verifyPassword, requireUser } = require('../auth');
const { HttpError } = require('../access');
const { addMonths } = require('../billing');
const { createRateLimiter } = require('../ratelimit');
const { acceptInvitation, createInvitation, sendVerificationEmail, isEmailVerified, assertEmailVerified } = require('./account');
const { couponView, parseCouponInput } = require('../coupons');
const siteSettings = require('../siteSettings');
const { snapshotVersion } = require('./content');
const { assertNotInRunningTest } = require('./abtests');
const { createDomainVerifier, newDomainToken, CLAIM_TTL_HOURS } = require('../domains');
const { transaction } = require('../db');
const { PLANS, workspacePlan, workspacePlanById, effectivePlanId, publicPlan } = require('../plans');
const { renderTemplate, listTemplates, listBlocks, BASE_CSS } = require('../templates');
const { createSafety, assertSiteActive } = require('../safety');
const { workspaceAssetKeys, removeObjects } = require('../storage');
const { logger } = require('../logger');

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const DOMAIN_RE = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESERVED_SUBDOMAINS = new Set(['www', 'app', 'api', 'admin', 'mail', 'cdn', 'static', 'dashboard']);

function str(value, { max = 200, required = false, field = 'Trường' } = {}) {
  const s = typeof value === 'string' ? value.trim() : '';
  if (required && !s) throw new HttpError(400, `${field} là bắt buộc`);
  if (s.length > max) throw new HttpError(400, `${field} quá dài (tối đa ${max} ký tự)`);
  return s;
}

function slug(value, field) {
  const s = str(value, { max: 63, required: true, field }).toLowerCase();
  if (!SLUG_RE.test(s)) {
    throw new HttpError(400, `${field} chỉ gồm chữ thường, số và dấu gạch ngang`);
  }
  return s;
}

function isUniqueViolation(err) {
  return /UNIQUE constraint failed/.test(String(err && err.message));
}


function csvCell(value) {
  let s = String(value ?? '');
  // Prevent spreadsheet formula injection.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

function createApiRouter({ db, sessions, access, billing, mailer, config, notifier, storage }) {
  const r = express.Router();
  const domains = createDomainVerifier(config);
  const safety = createSafety({ db, config, mailer });
  const loginLimiter = createRateLimiter({ windowMs: 15 * 60_000, max: 10 });
  const signupLimiter = createRateLimiter({ windowMs: 3600_000, max: 10 });
  // Slows down guessing of coupon codes.
  const couponLimiter = createRateLimiter({ windowMs: 10 * 60_000, max: 60 });
  const checkCouponRate = (req) => {
    if (!couponLimiter(`u${req.user.id}`)) throw new HttpError(429, 'Bạn thử mã giảm giá quá nhiều lần, vui lòng thử lại sau');
  };

  // Wrap handlers so thrown HttpErrors become JSON responses.
  const h = handler;

  const ha = handler;

  function usage(workspaceId) {
    return {
      sites: db.prepare('SELECT COUNT(*) AS n FROM sites WHERE workspace_id = ?').get(workspaceId).n,
      members: db.prepare('SELECT COUNT(*) AS n FROM memberships WHERE workspace_id = ?').get(workspaceId).n,
      leadsThisMonth: leadsThisMonth(db, workspaceId),
    };
  }

  // ---------- Public metadata ----------
  r.get('/plans', h(() => Object.values(PLANS).map(publicPlan)));
  r.get('/templates', h(() => listTemplates()));
  r.get('/blocks', h(() => ({ css: BASE_CSS, blocks: listBlocks() })));
  r.get('/billing/providers', h(() => billing.providers()));

  // ---------- Auth ----------
  r.post('/auth/signup', ha(async (req, res) => {
    if (!signupLimiter(req.ip)) throw new HttpError(429, 'Bạn thao tác quá nhanh, vui lòng thử lại sau');
    const name = str(req.body.name, { required: true, field: 'Họ tên', max: 100 });
    const email = str(req.body.email, { required: true, field: 'Email', max: 200 }).toLowerCase();
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const workspaceName = str(req.body.workspaceName, { field: 'Tên workspace', max: 100 }) || `Workspace của ${name}`;
    const inviteToken = typeof req.body.inviteToken === 'string' ? req.body.inviteToken : '';
    if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Email không hợp lệ');
    if (password.length < 8 || password.length > 200) throw new HttpError(400, 'Mật khẩu cần ít nhất 8 ký tự');

    let userId;
    try {
      userId = transaction(db, () => {
        const u = db
          .prepare('INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)')
          .run(email, name, hashPassword(password));
        const id = Number(u.lastInsertRowid);
        // Invited users join the inviter's workspace instead of getting their own.
        if (!inviteToken) {
          const w = db.prepare('INSERT INTO workspaces (name) VALUES (?)').run(workspaceName);
          db.prepare('INSERT INTO memberships (workspace_id, user_id, role) VALUES (?, ?, ?)').run(w.lastInsertRowid, id, 'owner');
        }
        return id;
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new HttpError(409, 'Email đã được đăng ký');
      throw err;
    }
    let workspaceId = null;
    if (inviteToken) {
      try {
        workspaceId = acceptInvitation(db, inviteToken, { id: userId, email });
      } catch {
        // Invalid/expired invite: fall back to a personal workspace.
        const w = db.prepare('INSERT INTO workspaces (name) VALUES (?)').run(workspaceName);
        db.prepare('INSERT INTO memberships (workspace_id, user_id, role) VALUES (?, ?, ?)').run(w.lastInsertRowid, userId, 'owner');
      }
    }
    // Accepting an emailed invitation already verifies the address.
    if (!workspaceId) await sendVerificationEmail(db, { mailer, config }, { id: userId, email, name });
    sessions.create(res, userId);
    res.status(201);
    return { ok: true, workspaceId };
  }));

  r.post('/auth/login', h((req, res) => {
    const email = str(req.body.email, { max: 200 }).toLowerCase();
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    if (!loginLimiter(`${req.ip}:${email}`)) throw new HttpError(429, 'Đăng nhập sai quá nhiều lần, vui lòng thử lại sau 15 phút');
    const user = db.prepare('SELECT id, password_hash, suspended_at FROM users WHERE email = ?').get(email);
    if (!user || !verifyPassword(password, user.password_hash)) {
      throw new HttpError(401, 'Email hoặc mật khẩu không đúng');
    }
    if (user.suspended_at) throw new HttpError(403, 'Tài khoản đã bị tạm ngưng do vi phạm điều khoản sử dụng. Vui lòng liên hệ bộ phận hỗ trợ.');
    sessions.create(res, user.id);
    return { ok: true };
  }));

  r.post('/auth/logout', h((req, res) => {
    sessions.destroy(req, res);
    return { ok: true };
  }));

  r.use(requireUser);

  r.get('/auth/me', h((req) => ({
    user: { ...req.user, emailVerified: isEmailVerified(db, req.user.id) },
    workspaces: db
      .prepare(
        `SELECT w.id, w.name, w.plan, w.plan_expires_at, m.role FROM memberships m
         JOIN workspaces w ON w.id = m.workspace_id WHERE m.user_id = ? ORDER BY w.id`
      )
      .all(req.user.id)
      .map((w) => ({ ...w, plan: effectivePlanId(w) })),
  })));

  // ---------- Workspaces ----------
  r.post('/workspaces', h((req, res) => {
    const name = str(req.body.name, { required: true, field: 'Tên workspace', max: 100 });
    const id = transaction(db, () => {
      const w = db.prepare('INSERT INTO workspaces (name) VALUES (?)').run(name);
      db.prepare('INSERT INTO memberships (workspace_id, user_id, role) VALUES (?, ?, ?)').run(
        w.lastInsertRowid,
        req.user.id,
        'owner'
      );
      return Number(w.lastInsertRowid);
    });
    res.status(201);
    return { id, name, plan: 'free', role: 'owner' };
  }));

  r.get('/workspaces/:wid', h((req) => {
    const { ws, role } = access.workspace(req.user, req.params.wid);
    return { ...ws, role, effectivePlan: effectivePlanId(ws), planDetails: publicPlan(workspacePlan(ws)), usage: usage(ws.id) };
  }));

  r.patch('/workspaces/:wid', h((req) => {
    const { ws } = access.workspace(req.user, req.params.wid, 'admin');
    const name = str(req.body.name, { required: true, field: 'Tên workspace', max: 100 });
    db.prepare('UPDATE workspaces SET name = ? WHERE id = ?').run(name, ws.id);
    return { ok: true };
  }));

  r.delete('/workspaces/:wid', h(async (req) => {
    const { ws } = access.workspace(req.user, req.params.wid, 'owner');
    const assetKeys = workspaceAssetKeys(db, [ws.id]);
    db.prepare('DELETE FROM workspaces WHERE id = ?').run(ws.id);
    if (storage) await removeObjects(storage, assetKeys, req.log || logger);
    return { ok: true };
  }));

  // ---------- Billing ----------
  r.post('/workspaces/:wid/checkout', ha(async (req) => {
    const { ws } = access.workspace(req.user, req.params.wid, 'admin');
    assertEmailVerified(db, req.user.id, 'thanh toán nâng cấp gói');
    const { plan, months, provider, coupon } = req.body;
    if (coupon) checkCouponRate(req);
    return billing.checkout({ ws, user: req.user, plan, months, provider, coupon });
  }));

  r.post('/workspaces/:wid/coupon/preview', h((req) => {
    access.workspace(req.user, req.params.wid, 'admin');
    checkCouponRate(req);
    const { valid, listAmount, discount, amount, message } = billing.quote(req.body);
    return { valid, listAmount, discount, amount, message };
  }));

  r.get('/workspaces/:wid/orders', h((req) => {
    const { ws } = access.workspace(req.user, req.params.wid);
    return db
      .prepare(
        `SELECT o.id, o.plan, o.months, o.amount, o.list_amount, o.discount_vnd, o.coupon_code, o.provider, o.status, o.checkout_url, o.created_at, o.paid_at,
           ir.status AS invoice_status, ir.invoice_no, ir.lookup_code, ir.lookup_url, ir.cancel_reason
         FROM orders o LEFT JOIN invoice_requests ir ON ir.order_id = o.id WHERE o.workspace_id = ? ORDER BY o.id DESC LIMIT 100`
      )
      .all(ws.id)
      .map(({ invoice_status, invoice_no, lookup_code, lookup_url, cancel_reason, ...o }) => ({
        ...o,
        checkout_url: o.status === 'pending' ? o.checkout_url : null,
        invoice: invoice_status
          ? { status: invoice_status, invoiceNo: invoice_no, lookupCode: lookup_code, lookupUrl: lookup_url, cancelReason: cancel_reason }
          : null,
      }));
  }));

  // ---------- Platform admin ----------
  const requireSuperAdmin = (req, _res, next) => next(req.user.isSuperAdmin ? undefined : new HttpError(403, 'Chỉ dành cho quản trị nền tảng'));

  r.get('/admin/stats', requireSuperAdmin, h(() => {
    const one = (sql, ...args) => db.prepare(sql).get(...args).n;
    const paidWorkspaces = db
      .prepare("SELECT plan, plan_expires_at FROM workspaces WHERE plan != 'free'")
      .all()
      .filter((w) => effectivePlanId(w) !== 'free');
    return {
      users: one('SELECT COUNT(*) AS n FROM users'),
      workspaces: one('SELECT COUNT(*) AS n FROM workspaces'),
      paidWorkspaces: paidWorkspaces.length,
      mrrVnd: paidWorkspaces.reduce((sum, w) => sum + PLANS[w.plan].priceVnd, 0),
      sites: one('SELECT COUNT(*) AS n FROM sites'),
      publishedPages: one('SELECT COUNT(*) AS n FROM pages WHERE published_at IS NOT NULL'),
      leadsThisMonth: one("SELECT COUNT(*) AS n FROM leads WHERE created_at >= ? AND status != 'spam'", monthStart()),
      revenueThisMonthVnd: one("SELECT COALESCE(SUM(amount), 0) AS n FROM orders WHERE status = 'paid' AND paid_at >= ?", monthStart()),
      revenueTotalVnd: one("SELECT COALESCE(SUM(amount), 0) AS n FROM orders WHERE status = 'paid'"),
    };
  }));

  r.get('/admin/workspaces', requireSuperAdmin, h(() =>
    db
      .prepare(
        `SELECT w.id, w.name, w.plan, w.plan_expires_at, w.created_at,
           (SELECT u.email FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = w.id AND m.role = 'owner' LIMIT 1) AS owner_email,
           (SELECT COUNT(*) FROM sites s WHERE s.workspace_id = w.id) AS sites
         FROM workspaces w ORDER BY w.id DESC LIMIT 500`
      )
      .all()
      .map((w) => ({ ...w, effectivePlan: effectivePlanId(w) }))
  ));

  r.get('/admin/orders', requireSuperAdmin, h(() =>
    db
      .prepare(
        `SELECT o.id, o.workspace_id, w.name AS workspace_name, o.plan, o.months, o.amount, o.discount_vnd, o.coupon_code, o.provider, o.status, o.order_code, o.created_at, o.paid_at
         FROM orders o LEFT JOIN workspaces w ON w.id = o.workspace_id ORDER BY o.id DESC LIMIT 200`
      )
      .all()
  ));

  // Coupons: discount value and code are fixed after creation (orders refer to them).
  const couponById = (id) => {
    const row = db.prepare('SELECT * FROM coupons WHERE id = ?').get(id);
    if (!row) throw new HttpError(404, 'Không tìm thấy mã giảm giá');
    return row;
  };

  r.get('/admin/coupons', requireSuperAdmin, h(() =>
    db
      .prepare(
        `SELECT c.*,
           (SELECT COALESCE(SUM(o.discount_vnd), 0) FROM orders o WHERE o.coupon_code = c.code AND o.status = 'paid') AS discount_total_vnd
         FROM coupons c ORDER BY c.id DESC`
      )
      .all()
      .map(couponView)
  ));

  r.post('/admin/coupons', requireSuperAdmin, h((req, res) => {
    const c = parseCouponInput(req.body, { create: true });
    const cols = Object.keys(c);
    try {
      const info = db.prepare(`INSERT INTO coupons (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...Object.values(c));
      res.status(201);
      return couponView(couponById(Number(info.lastInsertRowid)));
    } catch (err) {
      if (isUniqueViolation(err)) throw new HttpError(409, 'Mã giảm giá đã tồn tại');
      throw err;
    }
  }));

  r.patch('/admin/coupons/:id', requireSuperAdmin, h((req) => {
    const current = couponById(req.params.id);
    const c = parseCouponInput(req.body, { current });
    const cols = Object.keys(c);
    if (cols.length) {
      db.prepare(`UPDATE coupons SET ${cols.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...Object.values(c), current.id);
    }
    return couponView(couponById(current.id));
  }));

  // Manual plan grant (e.g. bank transfer outside the gateways, enterprise deals).
  r.post('/workspaces/:wid/plan', requireSuperAdmin, h((req) => {
    const ws = db.prepare('SELECT id FROM workspaces WHERE id = ?').get(req.params.wid);
    if (!ws) throw new HttpError(404, 'Không tìm thấy workspace');
    if (!PLANS[req.body.plan]) throw new HttpError(400, 'Gói không hợp lệ');
    let expires = null;
    if (req.body.plan !== 'free' && req.body.months !== undefined && req.body.months !== null && req.body.months !== '') {
      const months = Number(req.body.months);
      if (!Number.isInteger(months) || months < 1 || months > 120) throw new HttpError(400, 'Số tháng không hợp lệ');
      expires = addMonths(new Date(), months).toISOString();
    }
    db.prepare('UPDATE workspaces SET plan = ?, plan_expires_at = ? WHERE id = ?').run(req.body.plan, expires, ws.id);
    return { ok: true };
  }));

  // ---------- Members ----------
  r.get('/workspaces/:wid/members', h((req) => {
    const { ws } = access.workspace(req.user, req.params.wid);
    return db
      .prepare(
        `SELECT u.id, u.email, u.name, m.role FROM memberships m
         JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? ORDER BY u.id`
      )
      .all(ws.id);
  }));

  r.get('/workspaces/:wid/invitations', h((req) => {
    const { ws } = access.workspace(req.user, req.params.wid);
    return db
      .prepare('SELECT id, email, role, expires_at, created_at FROM invitations WHERE workspace_id = ? AND accepted_at IS NULL AND expires_at > ? ORDER BY id DESC')
      .all(ws.id, new Date().toISOString());
  }));

  r.delete('/workspaces/:wid/invitations/:iid', h((req) => {
    const { ws } = access.workspace(req.user, req.params.wid, 'admin');
    db.prepare('DELETE FROM invitations WHERE id = ? AND workspace_id = ?').run(req.params.iid, ws.id);
    return { ok: true };
  }));

  r.post('/workspaces/:wid/members', ha(async (req, res) => {
    const { ws, role: myRole } = access.workspace(req.user, req.params.wid, 'admin');
    const email = str(req.body.email, { required: true, field: 'Email' }).toLowerCase();
    if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Email không hợp lệ');
    const role = req.body.role === 'admin' ? 'admin' : 'editor';
    if (role === 'admin' && myRole !== 'owner') throw new HttpError(403, 'Chỉ chủ sở hữu mới thêm được quản trị viên');
    const plan = workspacePlan(ws);
    const pending = db
      .prepare('SELECT COUNT(*) AS n FROM invitations WHERE workspace_id = ? AND accepted_at IS NULL AND expires_at > ? AND email != ?')
      .get(ws.id, new Date().toISOString(), email).n;
    if (usage(ws.id).members + pending >= plan.maxMembers) {
      throw new HttpError(402, `Gói ${plan.name} cho phép tối đa ${plan.maxMembers} thành viên`);
    }
    const user = db.prepare('SELECT id, name FROM users WHERE email = ?').get(email);
    res.status(201);
    if (user) {
      try {
        db.prepare('INSERT INTO memberships (workspace_id, user_id, role) VALUES (?, ?, ?)').run(ws.id, user.id, role);
      } catch (err) {
        if (isUniqueViolation(err)) throw new HttpError(409, 'Người dùng đã là thành viên');
        throw err;
      }
      await mailer.send({
        to: email,
        subject: `Bạn đã được thêm vào workspace "${ws.name}"`,
        text: `Chào ${user.name},\n\n${req.user.name} đã thêm bạn vào workspace "${ws.name}" trên HiTechCloud LandingPage.\nĐăng nhập để bắt đầu: ${config.appUrl}/app/`,
      });
      return { status: 'added' };
    }
    const token = createInvitation(db, { workspaceId: ws.id, email, role, invitedBy: req.user.id });
    await mailer.send({
      to: email,
      subject: `${req.user.name} mời bạn tham gia "${ws.name}" trên HiTechCloud`,
      text: `Xin chào,\n\n${req.user.name} mời bạn cùng thiết kế landing page trong workspace "${ws.name}".\nNhận lời mời (hiệu lực 7 ngày): ${config.appUrl}/app/invite?token=${token}`,
    });
    return { status: 'invited' };
  }));

  r.delete('/workspaces/:wid/members/:uid', h((req) => {
    const { ws, role: myRole } = access.workspace(req.user, req.params.wid, 'admin');
    const target = db
      .prepare('SELECT role FROM memberships WHERE workspace_id = ? AND user_id = ?')
      .get(ws.id, req.params.uid);
    if (!target) throw new HttpError(404, 'Không tìm thấy thành viên');
    if (target.role === 'owner') throw new HttpError(400, 'Không thể xóa chủ sở hữu workspace');
    if (target.role === 'admin' && myRole !== 'owner') throw new HttpError(403, 'Chỉ chủ sở hữu mới xóa được quản trị viên');
    db.prepare('DELETE FROM memberships WHERE workspace_id = ? AND user_id = ?').run(ws.id, req.params.uid);
    return { ok: true };
  }));

  // ---------- Sites ----------
  r.get('/workspaces/:wid/sites', h((req) => {
    const { ws } = access.workspace(req.user, req.params.wid);
    return db
      .prepare(
        `SELECT s.id, s.workspace_id, s.name, s.subdomain, s.custom_domain, s.created_at,
           (SELECT COUNT(*) FROM pages p WHERE p.site_id = s.id) AS page_count
         FROM sites s WHERE s.workspace_id = ? ORDER BY s.id DESC`
      )
      .all(ws.id);
  }));

  r.post('/workspaces/:wid/sites', h((req, res) => {
    const { ws } = access.workspace(req.user, req.params.wid);
    const name = str(req.body.name, { required: true, field: 'Tên website', max: 100 });
    const subdomain = slug(req.body.subdomain, 'Tên miền phụ');
    if (RESERVED_SUBDOMAINS.has(subdomain)) throw new HttpError(400, 'Tên miền phụ này đã được hệ thống dành riêng');
    const plan = workspacePlan(ws);
    if (usage(ws.id).sites >= plan.maxSites) {
      throw new HttpError(402, `Gói ${plan.name} cho phép tối đa ${plan.maxSites} website. Vui lòng nâng cấp.`);
    }
    const tpl = renderTemplate(req.body.template || 'saas') || renderTemplate('blank');
    try {
      const id = transaction(db, () => {
        const s = db.prepare('INSERT INTO sites (workspace_id, name, subdomain) VALUES (?, ?, ?)').run(ws.id, name, subdomain);
        db.prepare('INSERT INTO pages (site_id, title, slug, draft_html, draft_css) VALUES (?, ?, ?, ?, ?)').run(
          s.lastInsertRowid,
          name,
          'index',
          tpl.html,
          tpl.css
        );
        return Number(s.lastInsertRowid);
      });
      res.status(201);
      return siteView(db.prepare('SELECT * FROM sites WHERE id = ?').get(id), 'owner');
    } catch (err) {
      if (isUniqueViolation(err)) throw new HttpError(409, 'Tên miền phụ đã được sử dụng');
      throw err;
    }
  }));

  function siteView(site, role) {
    const { settings_json, domain_token, ...rest } = site;
    const settings = siteSettings.publicSettings(siteSettings.parse(site));
    if (role === 'editor') delete settings.webhookSecret;
    const domain = site.custom_domain
      ? { name: site.custom_domain, verified: !!site.domain_verified_at, ...domains.instructions(site) }
      : null;
    return { ...rest, role, settings, domain };
  }

  r.get('/sites/:sid', h((req) => {
    const { site, role } = access.site(req.user, req.params.sid);
    return siteView(site, role);
  }));

  r.patch('/sites/:sid/settings', h((req) => {
    const { site, role } = access.site(req.user, req.params.sid, 'admin');
    const next = siteSettings.applyUpdate(siteSettings.parse(site), req.body || {}, workspacePlanById(db, site.workspace_id));
    db.prepare('UPDATE sites SET settings_json = ? WHERE id = ?').run(JSON.stringify(next), site.id);
    return siteView(db.prepare('SELECT * FROM sites WHERE id = ?').get(site.id), role);
  }));

  r.post('/sites/:sid/verify-domain', ha(async (req) => {
    const { site, role } = access.site(req.user, req.params.sid, 'admin');
    if (!site.custom_domain) throw new HttpError(400, 'Website chưa gắn tên miền riêng');
    const result = await domains.verify(site);
    if (!result.ok) {
      throw new HttpError(400, 'Chưa tìm thấy bản ghi TXT xác minh. DNS có thể mất vài phút đến vài giờ để cập nhật.');
    }
    db.prepare("UPDATE sites SET domain_verified_at = datetime('now') WHERE id = ?").run(site.id);
    return siteView(db.prepare('SELECT * FROM sites WHERE id = ?').get(site.id), role);
  }));

  r.post('/sites/:sid/notify-test', ha(async (req) => {
    const { site } = access.site(req.user, req.params.sid, 'admin');
    return notifier.leadCreated({ site, pageSlug: 'index', data: { name: 'Khách hàng thử nghiệm', phone: '0900000000', message: 'Đây là thông báo thử từ HiTechCloud' } });
  }));

  r.patch('/sites/:sid', h((req) => {
    const { site } = access.site(req.user, req.params.sid, 'admin');
    const plan = workspacePlanById(db, site.workspace_id);
    const name = req.body.name !== undefined ? str(req.body.name, { required: true, field: 'Tên website', max: 100 }) : site.name;
    let customDomain = site.custom_domain;
    if (req.body.customDomain !== undefined) {
      const d = str(req.body.customDomain, { max: 253, field: 'Tên miền' }).toLowerCase();
      if (d) {
        if (!plan.customDomain) throw new HttpError(402, 'Tên miền riêng chỉ có ở gói Pro trở lên');
        if (!DOMAIN_RE.test(d)) throw new HttpError(400, 'Tên miền không hợp lệ');
      }
      customDomain = d || null;
    }
    const domainChanged = customDomain !== site.custom_domain;
    try {
      if (domainChanged && customDomain) {
        // Release a stale, never-verified claim on this domain held by another site.
        db.prepare(
          `UPDATE sites SET custom_domain = NULL, domain_token = NULL, domain_claimed_at = NULL
           WHERE custom_domain = ? AND id != ? AND domain_verified_at IS NULL AND (domain_claimed_at IS NULL OR domain_claimed_at < datetime('now', ?))`
        ).run(customDomain, site.id, `-${CLAIM_TTL_HOURS} hours`);
      }
      db.prepare('UPDATE sites SET name = ?, custom_domain = ? WHERE id = ?').run(name, customDomain, site.id);
      if (domainChanged) {
        db.prepare("UPDATE sites SET domain_token = ?, domain_verified_at = NULL, domain_claimed_at = CASE WHEN ? IS NULL THEN NULL ELSE datetime('now') END WHERE id = ?").run(
          customDomain ? newDomainToken() : null,
          customDomain,
          site.id
        );
      }
    } catch (err) {
      if (isUniqueViolation(err)) throw new HttpError(409, 'Tên miền đã được gắn với website khác');
      throw err;
    }
    return siteView(db.prepare('SELECT * FROM sites WHERE id = ?').get(site.id), 'admin');
  }));

  r.delete('/sites/:sid', h((req) => {
    const { site } = access.site(req.user, req.params.sid, 'admin');
    db.prepare('DELETE FROM sites WHERE id = ?').run(site.id);
    return { ok: true };
  }));

  // ---------- Pages ----------
  const PAGE_FIELDS = 'id, site_id, title, slug, meta_description, og_image, published_at, updated_at';

  r.get('/sites/:sid/pages', h((req) => {
    const { site } = access.site(req.user, req.params.sid);
    const since = new Date(Date.now() - 29 * 86400_000).toISOString().slice(0, 10);
    return db
      .prepare(
        `SELECT ${PAGE_FIELDS.split(', ').map((f) => `p.${f}`).join(', ')},
           (SELECT COALESCE(SUM(v.views), 0) FROM page_views v WHERE v.page_id = p.id AND v.day >= ?) AS views_30d,
           (SELECT COUNT(*) FROM leads l WHERE l.site_id = p.site_id AND l.page_slug = p.slug AND l.created_at >= ? AND l.status != 'spam') AS leads_30d
         FROM pages p WHERE p.site_id = ? ORDER BY p.slug = 'index' DESC, p.id`
      )
      .all(since, since, site.id);
  }));

  r.post('/sites/:sid/pages', h((req, res) => {
    const { site } = access.site(req.user, req.params.sid);
    const plan = workspacePlanById(db, site.workspace_id);
    const count = db.prepare('SELECT COUNT(*) AS n FROM pages WHERE site_id = ?').get(site.id).n;
    if (count >= plan.maxPagesPerSite) {
      throw new HttpError(402, `Gói ${plan.name} cho phép tối đa ${plan.maxPagesPerSite} trang mỗi website`);
    }
    const title = str(req.body.title, { required: true, field: 'Tiêu đề', max: 200 });
    const pageSlug = slug(req.body.slug, 'Đường dẫn');
    const tpl = renderTemplate(req.body.template || 'blank') || renderTemplate('blank');
    try {
      const p = db
        .prepare('INSERT INTO pages (site_id, title, slug, draft_html, draft_css) VALUES (?, ?, ?, ?, ?)')
        .run(site.id, title, pageSlug, tpl.html, tpl.css);
      res.status(201);
      return db.prepare(`SELECT ${PAGE_FIELDS} FROM pages WHERE id = ?`).get(p.lastInsertRowid);
    } catch (err) {
      if (isUniqueViolation(err)) throw new HttpError(409, 'Đường dẫn trang đã tồn tại');
      throw err;
    }
  }));

  r.get('/pages/:pid', h((req) => {
    const { page, site, role } = access.page(req.user, req.params.pid);
    const { project_json, draft_html, draft_css, published_html, published_css, ...meta } = page;
    return { ...meta, role, site: { id: site.id, workspace_id: site.workspace_id, name: site.name, subdomain: site.subdomain, custom_domain: site.custom_domain } };
  }));

  r.patch('/pages/:pid', h((req) => {
    const { page } = access.page(req.user, req.params.pid);
    const title = req.body.title !== undefined ? str(req.body.title, { required: true, field: 'Tiêu đề', max: 200 }) : page.title;
    const meta = req.body.metaDescription !== undefined ? str(req.body.metaDescription, { max: 300, field: 'Mô tả' }) : page.meta_description;
    let ogImage = page.og_image;
    if (req.body.ogImage !== undefined) {
      ogImage = str(req.body.ogImage, { max: 500, field: 'Ảnh chia sẻ' });
      if (ogImage && !/^https?:\/\/[^\s"'<>]+$|^\/uploads\/[\w./-]+$/.test(ogImage)) throw new HttpError(400, 'Ảnh chia sẻ phải là URL http(s)');
    }
    let pageSlug = page.slug;
    if (req.body.slug !== undefined && req.body.slug !== page.slug) {
      if (page.slug === 'index') throw new HttpError(400, 'Không thể đổi đường dẫn trang chủ');
      pageSlug = slug(req.body.slug, 'Đường dẫn');
    }
    try {
      db.prepare("UPDATE pages SET title = ?, meta_description = ?, og_image = ?, slug = ?, updated_at = datetime('now') WHERE id = ?").run(
        title,
        meta,
        ogImage,
        pageSlug,
        page.id
      );
    } catch (err) {
      if (isUniqueViolation(err)) throw new HttpError(409, 'Đường dẫn trang đã tồn tại');
      throw err;
    }
    return { ok: true };
  }));

  r.delete('/pages/:pid', h((req) => {
    const { page } = access.page(req.user, req.params.pid);
    if (page.slug === 'index') throw new HttpError(400, 'Không thể xóa trang chủ của website');
    assertNotInRunningTest(db, page.id);
    db.prepare('DELETE FROM pages WHERE id = ?').run(page.id);
    return { ok: true };
  }));

  // GrapesJS remote storage endpoints.
  r.get('/pages/:pid/project', h((req) => {
    const { page } = access.page(req.user, req.params.pid);
    return {
      project: page.project_json ? JSON.parse(page.project_json) : null,
      html: page.draft_html,
      css: page.draft_css,
    };
  }));

  r.put('/pages/:pid/project', h((req) => {
    const { page } = access.page(req.user, req.params.pid);
    const { project, html, css } = req.body || {};
    if (!project || typeof project !== 'object') throw new HttpError(400, 'Dữ liệu dự án không hợp lệ');
    if (typeof html !== 'string' || typeof css !== 'string') throw new HttpError(400, 'Thiếu HTML/CSS');
    db.prepare(
      "UPDATE pages SET project_json = ?, draft_html = ?, draft_css = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(JSON.stringify(project), html, css, page.id);
    return { ok: true };
  }));

  r.post('/pages/:pid/publish', h((req) => {
    const { page } = access.page(req.user, req.params.pid);
    assertEmailVerified(db, req.user.id, 'xuất bản trang');
    assertSiteActive(db, page.site_id);
    snapshotVersion(db, page.id, req.user.id);
    db.prepare("UPDATE pages SET published_html = draft_html, published_css = draft_css, published_at = datetime('now') WHERE id = ?").run(page.id);
    const review = safety.onPublish(page.id);
    return { ok: true, publishedAt: db.prepare('SELECT published_at FROM pages WHERE id = ?').get(page.id).published_at, ...(review.suspended && { suspended: true }) };
  }));

  r.post('/pages/:pid/unpublish', h((req) => {
    const { page } = access.page(req.user, req.params.pid);
    assertNotInRunningTest(db, page.id);
    db.prepare('UPDATE pages SET published_html = NULL, published_css = NULL, published_at = NULL WHERE id = ?').run(page.id);
    return { ok: true };
  }));

  // ---------- Leads ----------
  // 'spam' is set by the lead guard (src/leadGuard.js) and hidden unless filtered for.
  const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'won', 'lost', 'spam'];

  r.get('/sites/:sid/leads', h((req, res) => {
    const { site } = access.site(req.user, req.params.sid);
    const where = ['site_id = ?'];
    const args = [site.id];
    if (LEAD_STATUSES.includes(req.query.status)) {
      where.push('status = ?');
      args.push(req.query.status);
    } else {
      where.push("status != 'spam'");
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '')) {
      where.push('created_at >= ?');
      args.push(req.query.from);
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(req.query.to || '')) {
      where.push("created_at < date(?, '+1 day')");
      args.push(req.query.to);
    }
    const q = String(req.query.q || '').trim().slice(0, 100);
    if (q) {
      where.push("(data_json LIKE ? ESCAPE '\\' OR note LIKE ? ESCAPE '\\')");
      const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      args.push(like, like);
    }
    const rows = db
      .prepare(`SELECT id, page_slug, data_json, source_json, status, note, created_at, spam_score, flags_json, duplicate_of FROM leads WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT 5000`)
      .all(...args)
      .map((l) => ({
        id: l.id,
        page: l.page_slug,
        data: JSON.parse(l.data_json),
        source: JSON.parse(l.source_json || '{}'),
        status: l.status,
        note: l.note,
        createdAt: l.created_at,
        spamScore: l.spam_score,
        flags: JSON.parse(l.flags_json || '[]'),
        duplicateOf: l.duplicate_of,
      }));

    if (req.query.format !== 'csv') return rows;

    const keys = [...new Set(rows.flatMap((l) => Object.keys(l.data)))];
    const srcKeys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'ref'];
    const lines = [['id', 'page', 'created_at', 'status', 'note', ...keys, ...srcKeys].map(csvCell).join(',')];
    for (const l of rows) {
      lines.push([l.id, l.page, l.createdAt, l.status, l.note, ...keys.map((k) => l.data[k]), ...srcKeys.map((k) => l.source[k])].map(csvCell).join(','));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="leads-${site.subdomain}.csv"`);
    res.send('\uFEFF' + lines.join('\r\n'));
  }));

  r.patch('/leads/:lid', h((req) => {
    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.lid);
    if (!lead) throw new HttpError(404, 'Không tìm thấy');
    access.site(req.user, lead.site_id);
    const status = req.body.status !== undefined ? req.body.status : lead.status;
    if (!LEAD_STATUSES.includes(status)) throw new HttpError(400, 'Trạng thái không hợp lệ');
    const note = req.body.note !== undefined ? str(req.body.note, { max: 2000, field: 'Ghi chú' }) : lead.note;
    db.prepare('UPDATE leads SET status = ?, note = ? WHERE id = ?').run(status, note, lead.id);
    return { ok: true };
  }));

  r.delete('/leads/:lid', h((req) => {
    const lead = db.prepare('SELECT site_id FROM leads WHERE id = ?').get(req.params.lid);
    if (!lead) throw new HttpError(404, 'Không tìm thấy');
    access.site(req.user, lead.site_id);
    db.prepare('DELETE FROM leads WHERE id = ?').run(req.params.lid);
    return { ok: true };
  }));

  return { router: r, usage };
}

module.exports = { createApiRouter, csvCell };
