'use strict';

const express = require('express');
const { hashPassword, verifyPassword, requireUser } = require('../auth');
const { HttpError } = require('../access');
const { transaction } = require('../db');
const { PLANS, getPlan, publicPlan } = require('../plans');
const { renderTemplate, listTemplates, listBlocks, BASE_CSS } = require('../templates');

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

function monthStart() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 19).replace('T', ' ');
}

function csvCell(value) {
  let s = String(value ?? '');
  // Prevent spreadsheet formula injection.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

function createApiRouter({ db, sessions, access }) {
  const r = express.Router();

  // Wrap handlers so thrown HttpErrors become JSON responses.
  const h = (fn) => (req, res, next) => {
    try {
      const out = fn(req, res);
      if (out !== undefined && !res.headersSent) res.json(out);
    } catch (err) {
      next(err);
    }
  };

  function usage(workspaceId) {
    return {
      sites: db.prepare('SELECT COUNT(*) AS n FROM sites WHERE workspace_id = ?').get(workspaceId).n,
      members: db.prepare('SELECT COUNT(*) AS n FROM memberships WHERE workspace_id = ?').get(workspaceId).n,
      leadsThisMonth: db
        .prepare(
          `SELECT COUNT(*) AS n FROM leads l JOIN sites s ON s.id = l.site_id
           WHERE s.workspace_id = ? AND l.created_at >= ?`
        )
        .get(workspaceId, monthStart()).n,
    };
  }

  // ---------- Public metadata ----------
  r.get('/plans', h(() => Object.values(PLANS).map(publicPlan)));
  r.get('/templates', h(() => listTemplates()));
  r.get('/blocks', h(() => ({ css: BASE_CSS, blocks: listBlocks() })));

  // ---------- Auth ----------
  r.post('/auth/signup', h((req, res) => {
    const name = str(req.body.name, { required: true, field: 'Họ tên', max: 100 });
    const email = str(req.body.email, { required: true, field: 'Email', max: 200 }).toLowerCase();
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const workspaceName = str(req.body.workspaceName, { field: 'Tên workspace', max: 100 }) || `Workspace của ${name}`;
    if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Email không hợp lệ');
    if (password.length < 8 || password.length > 200) throw new HttpError(400, 'Mật khẩu cần ít nhất 8 ký tự');

    let userId;
    try {
      userId = transaction(db, () => {
        const u = db
          .prepare('INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)')
          .run(email, name, hashPassword(password));
        const w = db.prepare('INSERT INTO workspaces (name) VALUES (?)').run(workspaceName);
        db.prepare('INSERT INTO memberships (workspace_id, user_id, role) VALUES (?, ?, ?)').run(
          w.lastInsertRowid,
          u.lastInsertRowid,
          'owner'
        );
        return Number(u.lastInsertRowid);
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new HttpError(409, 'Email đã được đăng ký');
      throw err;
    }
    sessions.create(res, userId);
    res.status(201);
    return { ok: true };
  }));

  r.post('/auth/login', h((req, res) => {
    const email = str(req.body.email, { max: 200 }).toLowerCase();
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const user = db.prepare('SELECT id, password_hash FROM users WHERE email = ?').get(email);
    if (!user || !verifyPassword(password, user.password_hash)) {
      throw new HttpError(401, 'Email hoặc mật khẩu không đúng');
    }
    sessions.create(res, user.id);
    return { ok: true };
  }));

  r.post('/auth/logout', h((req, res) => {
    sessions.destroy(req, res);
    return { ok: true };
  }));

  r.use(requireUser);

  r.get('/auth/me', h((req) => ({
    user: req.user,
    workspaces: db
      .prepare(
        `SELECT w.id, w.name, w.plan, m.role FROM memberships m
         JOIN workspaces w ON w.id = m.workspace_id WHERE m.user_id = ? ORDER BY w.id`
      )
      .all(req.user.id),
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
    return { ...ws, role, planDetails: publicPlan(getPlan(ws.plan)), usage: usage(ws.id) };
  }));

  r.patch('/workspaces/:wid', h((req) => {
    const { ws } = access.workspace(req.user, req.params.wid, 'admin');
    const name = str(req.body.name, { required: true, field: 'Tên workspace', max: 100 });
    db.prepare('UPDATE workspaces SET name = ? WHERE id = ?').run(name, ws.id);
    return { ok: true };
  }));

  r.delete('/workspaces/:wid', h((req) => {
    const { ws } = access.workspace(req.user, req.params.wid, 'owner');
    db.prepare('DELETE FROM workspaces WHERE id = ?').run(ws.id);
    return { ok: true };
  }));

  // Billing placeholder: until a payment gateway (VNPay/MoMo/Stripe) is wired
  // in, only platform super admins can change a workspace's plan.
  r.post('/workspaces/:wid/plan', h((req) => {
    if (!req.user.isSuperAdmin) {
      throw new HttpError(403, 'Vui lòng liên hệ HiTechCloud để nâng cấp gói');
    }
    const ws = db.prepare('SELECT id FROM workspaces WHERE id = ?').get(req.params.wid);
    if (!ws) throw new HttpError(404, 'Không tìm thấy workspace');
    if (!PLANS[req.body.plan]) throw new HttpError(400, 'Gói không hợp lệ');
    db.prepare('UPDATE workspaces SET plan = ? WHERE id = ?').run(req.body.plan, ws.id);
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

  r.post('/workspaces/:wid/members', h((req, res) => {
    const { ws, role: myRole } = access.workspace(req.user, req.params.wid, 'admin');
    const email = str(req.body.email, { required: true, field: 'Email' }).toLowerCase();
    const role = req.body.role === 'admin' ? 'admin' : 'editor';
    if (role === 'admin' && myRole !== 'owner') throw new HttpError(403, 'Chỉ chủ sở hữu mới thêm được quản trị viên');
    const plan = getPlan(ws.plan);
    if (usage(ws.id).members >= plan.maxMembers) {
      throw new HttpError(402, `Gói ${plan.name} cho phép tối đa ${plan.maxMembers} thành viên`);
    }
    const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (!user) throw new HttpError(404, 'Người dùng chưa có tài khoản HiTechCloud');
    try {
      db.prepare('INSERT INTO memberships (workspace_id, user_id, role) VALUES (?, ?, ?)').run(ws.id, user.id, role);
    } catch (err) {
      if (isUniqueViolation(err)) throw new HttpError(409, 'Người dùng đã là thành viên');
      throw err;
    }
    res.status(201);
    return { ok: true };
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
        `SELECT s.*, (SELECT COUNT(*) FROM pages p WHERE p.site_id = s.id) AS page_count
         FROM sites s WHERE s.workspace_id = ? ORDER BY s.id DESC`
      )
      .all(ws.id);
  }));

  r.post('/workspaces/:wid/sites', h((req, res) => {
    const { ws } = access.workspace(req.user, req.params.wid);
    const name = str(req.body.name, { required: true, field: 'Tên website', max: 100 });
    const subdomain = slug(req.body.subdomain, 'Tên miền phụ');
    if (RESERVED_SUBDOMAINS.has(subdomain)) throw new HttpError(400, 'Tên miền phụ này đã được hệ thống dành riêng');
    const plan = getPlan(ws.plan);
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
      return db.prepare('SELECT * FROM sites WHERE id = ?').get(id);
    } catch (err) {
      if (isUniqueViolation(err)) throw new HttpError(409, 'Tên miền phụ đã được sử dụng');
      throw err;
    }
  }));

  r.get('/sites/:sid', h((req) => access.site(req.user, req.params.sid).site));

  r.patch('/sites/:sid', h((req) => {
    const { site } = access.site(req.user, req.params.sid, 'admin');
    const ws = db.prepare('SELECT plan FROM workspaces WHERE id = ?').get(site.workspace_id);
    const name = req.body.name !== undefined ? str(req.body.name, { required: true, field: 'Tên website', max: 100 }) : site.name;
    let customDomain = site.custom_domain;
    if (req.body.customDomain !== undefined) {
      const d = str(req.body.customDomain, { max: 253, field: 'Tên miền' }).toLowerCase();
      if (d) {
        if (!getPlan(ws.plan).customDomain) throw new HttpError(402, 'Tên miền riêng chỉ có ở gói Pro trở lên');
        if (!DOMAIN_RE.test(d)) throw new HttpError(400, 'Tên miền không hợp lệ');
      }
      customDomain = d || null;
    }
    try {
      db.prepare('UPDATE sites SET name = ?, custom_domain = ? WHERE id = ?').run(name, customDomain, site.id);
    } catch (err) {
      if (isUniqueViolation(err)) throw new HttpError(409, 'Tên miền đã được gắn với website khác');
      throw err;
    }
    return db.prepare('SELECT * FROM sites WHERE id = ?').get(site.id);
  }));

  r.delete('/sites/:sid', h((req) => {
    const { site } = access.site(req.user, req.params.sid, 'admin');
    db.prepare('DELETE FROM sites WHERE id = ?').run(site.id);
    return { ok: true };
  }));

  // ---------- Pages ----------
  const PAGE_FIELDS = 'id, site_id, title, slug, meta_description, published_at, updated_at';

  r.get('/sites/:sid/pages', h((req) => {
    const { site } = access.site(req.user, req.params.sid);
    return db.prepare(`SELECT ${PAGE_FIELDS} FROM pages WHERE site_id = ? ORDER BY slug = 'index' DESC, id`).all(site.id);
  }));

  r.post('/sites/:sid/pages', h((req, res) => {
    const { site } = access.site(req.user, req.params.sid);
    const ws = db.prepare('SELECT plan FROM workspaces WHERE id = ?').get(site.workspace_id);
    const plan = getPlan(ws.plan);
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
    return { ...meta, role, site: { id: site.id, name: site.name, subdomain: site.subdomain, custom_domain: site.custom_domain } };
  }));

  r.patch('/pages/:pid', h((req) => {
    const { page } = access.page(req.user, req.params.pid);
    const title = req.body.title !== undefined ? str(req.body.title, { required: true, field: 'Tiêu đề', max: 200 }) : page.title;
    const meta = req.body.metaDescription !== undefined ? str(req.body.metaDescription, { max: 300, field: 'Mô tả' }) : page.meta_description;
    let pageSlug = page.slug;
    if (req.body.slug !== undefined && req.body.slug !== page.slug) {
      if (page.slug === 'index') throw new HttpError(400, 'Không thể đổi đường dẫn trang chủ');
      pageSlug = slug(req.body.slug, 'Đường dẫn');
    }
    try {
      db.prepare("UPDATE pages SET title = ?, meta_description = ?, slug = ?, updated_at = datetime('now') WHERE id = ?").run(
        title,
        meta,
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
    db.prepare("UPDATE pages SET published_html = draft_html, published_css = draft_css, published_at = datetime('now') WHERE id = ?").run(page.id);
    return { ok: true, publishedAt: db.prepare('SELECT published_at FROM pages WHERE id = ?').get(page.id).published_at };
  }));

  r.post('/pages/:pid/unpublish', h((req) => {
    const { page } = access.page(req.user, req.params.pid);
    db.prepare('UPDATE pages SET published_html = NULL, published_css = NULL, published_at = NULL WHERE id = ?').run(page.id);
    return { ok: true };
  }));

  // ---------- Leads ----------
  r.get('/sites/:sid/leads', h((req, res) => {
    const { site } = access.site(req.user, req.params.sid);
    const rows = db
      .prepare('SELECT id, page_slug, data_json, created_at FROM leads WHERE site_id = ? ORDER BY id DESC LIMIT 5000')
      .all(site.id)
      .map((l) => ({ id: l.id, page: l.page_slug, data: JSON.parse(l.data_json), createdAt: l.created_at }));

    if (req.query.format !== 'csv') return rows;

    const keys = [...new Set(rows.flatMap((l) => Object.keys(l.data)))];
    const lines = [['id', 'page', 'created_at', ...keys].map(csvCell).join(',')];
    for (const l of rows) lines.push([l.id, l.page, l.createdAt, ...keys.map((k) => l.data[k])].map(csvCell).join(','));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="leads-${site.subdomain}.csv"`);
    res.send('﻿' + lines.join('\r\n'));
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

module.exports = { createApiRouter, monthStart };
