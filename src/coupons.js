'use strict';

const { PLANS, BILLING_CYCLES } = require('./plans');
const { HttpError } = require('./access');

const CODE_RE = /^[A-Z0-9_-]{3,32}$/;
// Lowest non-zero amount sent to a gateway; 0 (fully discounted) skips the gateway.
const MIN_PAID_AMOUNT = 10000;
const MAX_AMOUNT_OFF = 100_000_000;

function normalizeCode(value) {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function vnd(n) {
  return `${Number(n).toLocaleString('vi-VN')}đ`;
}

function couponView(row) {
  if (!row) return null;
  let plans = null;
  try {
    plans = row.applies_to_plans ? JSON.parse(row.applies_to_plans) : null;
  } catch {
    plans = null;
  }
  return { ...row, applies_to_plans: plans, active: Boolean(row.active) };
}

function findCoupon(db, code) {
  return couponView(db.prepare('SELECT * FROM coupons WHERE code = ?').get(code));
}

const blank = (v) => v === undefined || v === null || v === '';

function intField(value, { min, max, message }) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, message);
  return n;
}

// Validates admin input. On create every field is read; on update only the
// keys present in body. Returns a column -> value map ready for SQL.
function parseCouponInput(body, { create = false, current = null } = {}) {
  const has = (k) => create || Object.prototype.hasOwnProperty.call(body, k);
  const out = {};

  if (create) {
    const code = normalizeCode(body.code);
    if (!CODE_RE.test(code)) throw new HttpError(400, 'Mã chỉ gồm chữ A-Z, số, dấu "-" và "_" (3–32 ký tự)');
    out.code = code;
    const pct = blank(body.percent_off) ? null : body.percent_off;
    const off = blank(body.amount_off_vnd) ? null : body.amount_off_vnd;
    if ((pct === null) === (off === null)) throw new HttpError(400, 'Chọn một kiểu giảm: theo % hoặc số tiền cố định');
    out.percent_off = pct === null ? null : intField(pct, { min: 1, max: 100, message: 'Phần trăm giảm phải từ 1 đến 100' });
    out.amount_off_vnd = off === null ? null : intField(off, { min: 1000, max: MAX_AMOUNT_OFF, message: 'Số tiền giảm phải từ 1.000đ' });
  }

  if (has('applies_to_plans')) {
    let plans = body.applies_to_plans;
    if (typeof plans === 'string') plans = plans.split(',').map((s) => s.trim()).filter(Boolean);
    if (blank(plans) || (Array.isArray(plans) && !plans.length)) out.applies_to_plans = null;
    else {
      if (!Array.isArray(plans) || !plans.every((p) => PLANS[p] && PLANS[p].priceVnd > 0)) {
        throw new HttpError(400, 'Danh sách gói áp dụng không hợp lệ');
      }
      out.applies_to_plans = JSON.stringify([...new Set(plans)]);
    }
  }

  if (has('applies_to_months')) {
    const m = body.applies_to_months;
    if (blank(m)) out.applies_to_months = null;
    else if (BILLING_CYCLES[Number(m)]) out.applies_to_months = Number(m);
    else throw new HttpError(400, 'Chu kỳ áp dụng chỉ có thể là 1 hoặc 12 tháng');
  }

  if (has('max_redemptions')) {
    const v = body.max_redemptions;
    out.max_redemptions = blank(v) ? null : intField(v, { min: 1, max: 1_000_000, message: 'Giới hạn lượt dùng không hợp lệ' });
    if (current && out.max_redemptions !== null && out.max_redemptions < current.redeemed_count) {
      throw new HttpError(400, `Giới hạn không được nhỏ hơn số lượt đã dùng (${current.redeemed_count})`);
    }
  }

  if (has('expires_at')) {
    const v = body.expires_at;
    if (blank(v)) out.expires_at = null;
    else {
      // A bare date means the end of that day, Vietnam time.
      const s = String(v);
      const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T23:59:59.999+07:00` : s);
      if (Number.isNaN(d.getTime())) throw new HttpError(400, 'Ngày hết hạn không hợp lệ');
      out.expires_at = d.toISOString();
    }
  }

  if (has('note')) {
    const note = typeof body.note === 'string' ? body.note.trim() : '';
    if (note.length > 200) throw new HttpError(400, 'Ghi chú quá dài (tối đa 200 ký tự)');
    out.note = note;
  }

  // New coupons are active unless explicitly disabled.
  if (has('active')) out.active = [false, 0, 'false', '0'].includes(body.active) ? 0 : 1;

  return out;
}

// Applies coupon `c` (a couponView) to a list price. Returns
// { valid, listAmount, discount, amount, message }.
function applyCoupon(c, { plan, months, listAmount, now = new Date() }) {
  const fail = (message) => ({ valid: false, listAmount, discount: 0, amount: listAmount, message });
  if (!c || !c.active) return fail('Mã giảm giá không tồn tại hoặc đã ngừng áp dụng');
  if (c.expires_at && new Date(c.expires_at) <= now) return fail('Mã giảm giá đã hết hạn');
  if (c.applies_to_plans && !c.applies_to_plans.includes(plan)) {
    return fail(`Mã giảm giá không áp dụng cho gói ${PLANS[plan].name}`);
  }
  if (c.applies_to_months && c.applies_to_months !== months) {
    return fail(`Mã giảm giá chỉ áp dụng cho chu kỳ ${c.applies_to_months} tháng`);
  }
  if (c.max_redemptions !== null && c.redeemed_count >= c.max_redemptions) return fail('Mã giảm giá đã hết lượt sử dụng');

  const discount = c.percent_off !== null
    ? Math.floor((listAmount * c.percent_off) / 100)
    : Math.min(c.amount_off_vnd, listAmount);
  const amount = listAmount - discount;
  if (amount > 0 && amount < MIN_PAID_AMOUNT) {
    return fail(`Số tiền sau giảm giá phải từ ${vnd(MIN_PAID_AMOUNT)} trở lên`);
  }
  const message = amount === 0
    ? `Mã ${c.code}: miễn phí hoàn toàn`
    : `Mã ${c.code}: giảm ${vnd(discount)}`;
  return { valid: true, listAmount, discount, amount, message, code: c.code };
}

module.exports = { CODE_RE, MIN_PAID_AMOUNT, normalizeCode, couponView, findCoupon, parseCouponInput, applyCoupon };
