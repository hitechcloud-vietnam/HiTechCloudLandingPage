'use strict';

const express = require('express');
const { handler } = require('../http');
const { requireUser } = require('../auth');
const { HttpError } = require('../access');
const { PLANS } = require('../plans');
const { csvCell } = require('./api');
const {
  INVOICE_STATUSES,
  URL_RE,
  parseBillingProfile,
  profileView,
  invoiceView,
  getProfile,
  saveProfile,
  snapshotRequest,
} = require('../invoices');

const vnd = (n) => `${Number(n).toLocaleString('vi-VN')}đ`;
const planName = (id) => (PLANS[id] ? PLANS[id].name : id);
// SQLite UTC "YYYY-MM-DD HH:MM:SS" -> Vietnam time (UTC+7, no DST), same format.
const vnTime = (s) => (s ? new Date(Date.parse(`${s.replace(' ', 'T')}Z`) + 7 * 3600_000).toISOString().slice(0, 19).replace('T', ' ') : '');
const field = (value, max, name) => {
  const s = typeof value === 'string' ? value.trim() : '';
  if (s.length > max) throw new HttpError(400, `${name} quá dài (tối đa ${max} ký tự)`);
  return s;
};
const buyerLine = (x) => (x.buyer_type === 'company' ? `${x.company_name} – MST ${x.tax_code}` : `${x.buyer_name}${x.tax_code ? ` – MST ${x.tax_code}` : ''}`);

function createInvoicesRouter({ db, access, mailer, config }) {
  const r = express.Router();
  const h = handler;
  r.use(requireUser);

  // ---------- Workspace billing profile (owner/admin) ----------
  r.get('/workspaces/:wid/billing-profile', h((req) => {
    const { ws } = access.workspace(req.user, req.params.wid, 'admin');
    return { profile: profileView(getProfile(db, ws.id)) };
  }));

  r.put('/workspaces/:wid/billing-profile', h((req) => {
    const { ws } = access.workspace(req.user, req.params.wid, 'admin');
    const profile = parseBillingProfile(req.body);
    return { profile: profileView(saveProfile(db, ws.id, profile, req.user.id)) };
  }));

  // One request per paid order; a cancelled one can be sent again.
  r.post('/orders/:id/invoice-request', h((req, res) => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
    if (!order) throw new HttpError(404, 'Không tìm thấy đơn hàng');
    access.workspace(req.user, order.workspace_id, 'admin');
    if (order.status !== 'paid') throw new HttpError(400, 'Chỉ yêu cầu xuất hóa đơn cho đơn hàng đã thanh toán');
    if (!(order.amount > 0)) throw new HttpError(400, 'Đơn hàng 0đ không có giá trị để xuất hóa đơn');
    const profile = getProfile(db, order.workspace_id);
    if (!profile) throw new HttpError(400, 'Vui lòng cập nhật thông tin xuất hóa đơn trước khi gửi yêu cầu');
    if (!snapshotRequest(db, order, profile, { userId: req.user.id })) {
      throw new HttpError(409, 'Đơn hàng này đã có yêu cầu xuất hóa đơn');
    }
    res.status(201);
    return invoiceView(db.prepare('SELECT * FROM invoice_requests WHERE order_id = ?').get(order.id));
  }));

  // ---------- Platform admin: "Hóa đơn VAT" ----------
  const requireSuperAdmin = (req, _res, next) => next(req.user.isSuperAdmin ? undefined : new HttpError(403, 'Chỉ dành cho quản trị nền tảng'));
  r.use('/admin/invoices', requireSuperAdmin);

  const ADMIN_SELECT = `SELECT ir.*, o.order_code, o.plan, o.months, o.amount, o.list_amount, o.discount_vnd, o.provider, o.paid_at,
      w.name AS workspace_name, u.email AS requested_by_email
    FROM invoice_requests ir JOIN orders o ON o.id = ir.order_id
    LEFT JOIN workspaces w ON w.id = ir.workspace_id LEFT JOIN users u ON u.id = ir.requested_by`;

  const requestById = (id) => {
    const row = db.prepare(`${ADMIN_SELECT} WHERE ir.id = ?`).get(id);
    if (!row) throw new HttpError(404, 'Không tìm thấy yêu cầu xuất hóa đơn');
    return row;
  };

  r.get('/admin/invoices', h((req, res) => {
    const status = INVOICE_STATUSES.includes(req.query.status) ? req.query.status : null;
    const rows = db
      .prepare(`${ADMIN_SELECT} ${status ? 'WHERE ir.status = ?' : ''} ORDER BY ir.id DESC LIMIT 5000`)
      .all(...(status ? [status] : []));
    if (req.query.format !== 'csv') return rows.map((x) => ({ ...x, auto: !!x.auto }));

    const STATUS_LABEL = { pending: 'Đang xử lý', issued: 'Đã xuất', cancelled: 'Đã hủy' };
    const head = [
      'Mã yêu cầu', 'Mã đơn', 'Mã giao dịch', 'Cổng thanh toán', 'Ngày thanh toán (giờ VN)', 'Số tiền (VND)', 'Gói', 'Số tháng',
      'Workspace', 'Loại người mua', 'Tên đơn vị', 'Mã số thuế', 'Người mua', 'Địa chỉ', 'Email nhận hóa đơn',
      'Trạng thái', 'Số hóa đơn', 'Mã tra cứu', 'Link tra cứu', 'Lý do hủy', 'Ngày yêu cầu (giờ VN)', 'Ngày xử lý (giờ VN)',
    ];
    const lines = [head.map(csvCell).join(',')];
    for (const x of rows) {
      lines.push([
        x.id, x.order_id, x.order_code, x.provider, vnTime(x.paid_at), x.amount, planName(x.plan), x.months,
        x.workspace_name, x.buyer_type === 'company' ? 'Doanh nghiệp' : 'Cá nhân', x.company_name, x.tax_code, x.buyer_name, x.address, x.email,
        STATUS_LABEL[x.status], x.invoice_no, x.lookup_code, x.lookup_url, x.cancel_reason, vnTime(x.created_at), vnTime(x.processed_at),
      ].map(csvCell).join(','));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="hoa-don-vat-${status || 'tat-ca'}-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send('﻿' + lines.join('\r\n'));
  }));

  r.post('/admin/invoices/:id/issue', h(async (req) => {
    const current = requestById(req.params.id);
    const invoiceNo = field(req.body.invoiceNo, 50, 'Số hóa đơn');
    if (!invoiceNo) throw new HttpError(400, 'Vui lòng nhập số hóa đơn');
    const lookupCode = field(req.body.lookupCode, 100, 'Mã tra cứu');
    const lookupUrl = field(req.body.lookupUrl, 500, 'Link tra cứu');
    if (lookupUrl && !URL_RE.test(lookupUrl)) throw new HttpError(400, 'Link tra cứu phải là URL http(s)');
    const info = db
      .prepare(
        `UPDATE invoice_requests SET status = 'issued', invoice_no = ?, lookup_code = ?, lookup_url = ?, processed_by = ?, processed_at = datetime('now')
         WHERE id = ? AND status = 'pending'`
      )
      .run(invoiceNo, lookupCode || null, lookupUrl || null, req.user.id, current.id);
    if (!info.changes) throw new HttpError(409, 'Chỉ xuất hóa đơn cho yêu cầu đang xử lý');
    const x = requestById(current.id);
    await mailer.send({
      to: x.email,
      subject: `Hóa đơn GTGT số ${x.invoice_no} cho đơn #${x.order_id} – HiTechCloud`,
      text: `Kính gửi quý khách,\n\nHiTechCloud đã xuất hóa đơn GTGT điện tử cho đơn hàng #${x.order_id} (gói ${planName(x.plan)}, ${x.months} tháng, ${vnd(x.amount)}).\n\n` +
        `Người mua: ${buyerLine(x)}\nSố hóa đơn: ${x.invoice_no}\n` +
        `${x.lookup_code ? `Mã tra cứu: ${x.lookup_code}\n` : ''}${x.lookup_url ? `Tra cứu hóa đơn: ${x.lookup_url}\n` : ''}` +
        `\nLịch sử thanh toán: ${config.appUrl}/app/?tab=billing\nCảm ơn quý khách đã sử dụng HiTechCloud!`,
    });
    return { ...x, auto: !!x.auto };
  }));

  r.post('/admin/invoices/:id/cancel', h(async (req) => {
    const current = requestById(req.params.id);
    const reason = field(req.body.reason, 500, 'Lý do');
    if (!reason) throw new HttpError(400, 'Vui lòng nhập lý do hủy');
    const info = db
      .prepare(
        `UPDATE invoice_requests SET status = 'cancelled', cancel_reason = ?, processed_by = ?, processed_at = datetime('now')
         WHERE id = ? AND status = 'pending'`
      )
      .run(reason, req.user.id, current.id);
    if (!info.changes) throw new HttpError(409, 'Chỉ hủy được yêu cầu đang xử lý');
    const x = requestById(current.id);
    await mailer.send({
      to: x.email,
      subject: `Yêu cầu xuất hóa đơn cho đơn #${x.order_id} chưa được xử lý – HiTechCloud`,
      text: `Kính gửi quý khách,\n\nYêu cầu xuất hóa đơn GTGT cho đơn hàng #${x.order_id} (${buyerLine(x)}) đã bị hủy.\nLý do: ${reason}\n\n` +
        `Quý khách có thể cập nhật thông tin xuất hóa đơn và gửi lại yêu cầu tại: ${config.appUrl}/app/?tab=billing`,
    });
    return { ...x, auto: !!x.auto };
  }));

  return r;
}

module.exports = { createInvoicesRouter };
