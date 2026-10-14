'use strict';

const { HttpError } = require('./access');

// VAT invoice (hóa đơn GTGT điện tử) requests. No e-invoice provider is
// integrated: accounting issues the invoice in their own software and records
// the number here.

// Mã số thuế: 10 digits, or 10 digits + "-" + 3 digits for a dependent unit.
const TAX_CODE_RE = /^\d{10}(?:-\d{3})?$/;
// From 1/7/2025 an individual's 12-digit personal ID number is their tax code.
const PERSONAL_ID_RE = /^\d{12}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^https?:\/\/[^\s"'<>]+$/;
const BUYER_TYPES = ['company', 'individual'];
const INVOICE_STATUSES = ['pending', 'issued', 'cancelled'];
const SNAPSHOT_COLUMNS = ['buyer_type', 'company_name', 'tax_code', 'address', 'email', 'buyer_name'];

function text(value, { max, field, required = false }) {
  const s = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (required && !s) throw new HttpError(400, `${field} là bắt buộc`);
  if (s.length > max) throw new HttpError(400, `${field} quá dài (tối đa ${max} ký tự)`);
  return s;
}

// Validates the billing profile form; returns a column -> value map.
function parseBillingProfile(body = {}) {
  const buyerType = body.buyerType;
  if (!BUYER_TYPES.includes(buyerType)) throw new HttpError(400, 'Loại người mua không hợp lệ');
  const company = buyerType === 'company';
  const out = {
    buyer_type: buyerType,
    company_name: company ? text(body.companyName, { max: 300, field: 'Tên đơn vị', required: true }) : '',
    tax_code: text(body.taxCode, { max: 20, field: 'Mã số thuế' }).replace(/\s/g, ''),
    address: text(body.address, { max: 300, field: 'Địa chỉ', required: company }),
    email: text(body.email, { max: 200, field: 'Email nhận hóa đơn', required: true }).toLowerCase(),
    buyer_name: text(body.buyerName, { max: 100, field: 'Họ tên người mua', required: !company }),
    auto_invoice: body.autoInvoice === true || body.autoInvoice === 'true' || body.autoInvoice === 'on' ? 1 : 0,
  };
  if (company) {
    if (!out.tax_code) throw new HttpError(400, 'Mã số thuế là bắt buộc');
    if (!TAX_CODE_RE.test(out.tax_code)) throw new HttpError(400, 'Mã số thuế gồm 10 chữ số, hoặc 10 chữ số kèm "-" và 3 chữ số (VD: 0312345678-001)');
  } else if (out.tax_code && !TAX_CODE_RE.test(out.tax_code) && !PERSONAL_ID_RE.test(out.tax_code)) {
    throw new HttpError(400, 'Mã số thuế cá nhân gồm 10 chữ số hoặc 12 chữ số (số định danh cá nhân)');
  }
  if (!EMAIL_RE.test(out.email)) throw new HttpError(400, 'Email nhận hóa đơn không hợp lệ');
  return out;
}

function profileView(row) {
  if (!row) return null;
  return {
    buyerType: row.buyer_type,
    companyName: row.company_name,
    taxCode: row.tax_code,
    address: row.address,
    email: row.email,
    buyerName: row.buyer_name,
    autoInvoice: !!row.auto_invoice,
    updatedAt: row.updated_at,
  };
}

function invoiceView(row) {
  if (!row) return null;
  return {
    id: row.id,
    orderId: row.order_id,
    status: row.status,
    auto: !!row.auto,
    buyerType: row.buyer_type,
    companyName: row.company_name,
    taxCode: row.tax_code,
    address: row.address,
    email: row.email,
    buyerName: row.buyer_name,
    invoiceNo: row.invoice_no,
    lookupCode: row.lookup_code,
    lookupUrl: row.lookup_url,
    cancelReason: row.cancel_reason,
    createdAt: row.created_at,
    processedAt: row.processed_at,
  };
}

function getProfile(db, workspaceId) {
  return db.prepare('SELECT * FROM billing_profiles WHERE workspace_id = ?').get(workspaceId);
}

function saveProfile(db, workspaceId, profile, userId) {
  const cols = Object.keys(profile);
  db.prepare(
    `INSERT INTO billing_profiles (workspace_id, ${cols.join(', ')}, updated_by) VALUES (?, ${cols.map(() => '?').join(', ')}, ?)
     ON CONFLICT (workspace_id) DO UPDATE SET ${cols.map((c) => `${c} = excluded.${c}`).join(', ')},
       updated_by = excluded.updated_by, updated_at = datetime('now')`
  ).run(workspaceId, ...Object.values(profile), userId);
  return getProfile(db, workspaceId);
}

// Inserts a request with the profile copied onto it. A cancelled request for
// the same order is reopened with the current profile; otherwise one per order.
// Returns true when a request was created or reopened.
function snapshotRequest(db, order, profile, { userId = null, auto = false } = {}) {
  const cols = ['order_id', 'workspace_id', 'requested_by', 'auto', ...SNAPSHOT_COLUMNS];
  const values = [order.id, order.workspace_id, userId, auto ? 1 : 0, ...SNAPSHOT_COLUMNS.map((c) => profile[c])];
  const reset = ['requested_by', 'auto', ...SNAPSHOT_COLUMNS].map((c) => `${c} = excluded.${c}`).join(', ');
  const info = db
    .prepare(
      `INSERT INTO invoice_requests (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})
       ON CONFLICT (order_id) DO UPDATE SET ${reset}, status = 'pending', invoice_no = NULL, lookup_code = NULL,
         lookup_url = NULL, cancel_reason = NULL, processed_by = NULL, processed_at = NULL, created_at = datetime('now')
       WHERE invoice_requests.status = 'cancelled'`
    )
    .run(...values);
  return info.changes > 0;
}

// Called inside the billing fulfil transaction for a newly paid order. A
// zero-amount (fully discounted) order has nothing to invoice.
function autoRequestInvoice(db, order) {
  if (!(order.amount > 0)) return false;
  const profile = db.prepare('SELECT * FROM billing_profiles WHERE workspace_id = ? AND auto_invoice = 1').get(order.workspace_id);
  if (!profile) return false;
  if (db.prepare('SELECT 1 FROM invoice_requests WHERE order_id = ?').get(order.id)) return false;
  return snapshotRequest(db, order, profile, { auto: true });
}

module.exports = {
  TAX_CODE_RE,
  INVOICE_STATUSES,
  parseBillingProfile,
  profileView,
  invoiceView,
  getProfile,
  saveProfile,
  snapshotRequest,
  autoRequestInvoice,
  URL_RE,
};
