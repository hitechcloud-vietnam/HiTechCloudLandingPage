'use strict';

const crypto = require('node:crypto');
const express = require('express');
const { transaction } = require('./db');
const { PLANS, BILLING_CYCLES, effectivePlanId, priceFor } = require('./plans');
const { createPayOS } = require('./payments/payos');
const { createPay2S } = require('./payments/pay2s');
const { HttpError } = require('./access');

function createProviders(config) {
  const providers = {};
  const fetch = config.fetch || globalThis.fetch;
  const { payos, pay2s } = config.payments || {};
  if (payos && payos.clientId && payos.apiKey && payos.checksumKey) {
    providers.payos = createPayOS({ ...payos, fetch });
  }
  if (pay2s && pay2s.partnerCode && pay2s.accessKey && pay2s.secretKey) {
    providers.pay2s = createPay2S({ ...pay2s, fetch });
  }
  return providers;
}

// Adds calendar months, clamping to the month's last day (31 Jan + 1 = 28/29 Feb).
function addMonths(date, months) {
  const d = new Date(date);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}

// Unique numeric order code (payOS requires a positive integer ≤ 2^53-1).
function newOrderCode() {
  return String(Date.now() * 1000 + crypto.randomInt(1000));
}

// Expiry after paying for `order`:
//  - same plan, still active: stacks onto the remaining time;
//  - switching between paid plans: the unused time of the old plan is
//    converted to the new plan by price and added on top;
//  - otherwise: starts now.
function newExpiry(ws, currentPlan, order, now) {
  const end = addMonths(now, order.months);
  const remainingMs = ws.plan_expires_at ? new Date(ws.plan_expires_at) - now : 0;
  if (currentPlan === 'free' || remainingMs <= 0) return end;
  if (currentPlan === order.plan) return addMonths(new Date(ws.plan_expires_at), order.months);
  const credit = remainingMs * (PLANS[currentPlan].priceVnd / PLANS[order.plan].priceVnd);
  return new Date(end.getTime() + Math.floor(credit));
}

function createBilling({ db, config, mailer }) {
  const providers = createProviders(config);

  function getOrderByCode(provider, code) {
    return db.prepare('SELECT * FROM orders WHERE provider = ? AND order_code = ?').get(provider, String(code));
  }

  // Idempotently marks an order paid and extends the workspace subscription.
  function fulfill(order, { amount, ref }) {
    if (amount !== undefined && Number(amount) !== order.amount) {
      throw new Error(`Số tiền không khớp cho đơn ${order.order_code}`);
    }
    const changed = transaction(db, () => {
      const fresh = db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
      if (fresh.status === 'paid') return false;
      db.prepare("UPDATE orders SET status = 'paid', paid_at = datetime('now'), provider_ref = COALESCE(?, provider_ref) WHERE id = ?").run(ref || null, order.id);

      const ws = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(order.workspace_id);
      if (!ws) return true;
      const now = new Date();
      const current = effectivePlanId(ws, now);
      // A paid plan granted without expiry by a platform admin is never shortened.
      if (current === order.plan && !ws.plan_expires_at) return true;
      db.prepare('UPDATE workspaces SET plan = ?, plan_expires_at = ? WHERE id = ?').run(order.plan, newExpiry(ws, current, order, now).toISOString(), ws.id);
      return true;
    });
    if (changed) sendReceipt(order.id);
    return changed;
  }

  function sendReceipt(orderId) {
    if (!mailer) return;
    const o = db
      .prepare(
        `SELECT o.*, u.email, u.name, w.name AS ws_name, w.plan_expires_at FROM orders o
         LEFT JOIN users u ON u.id = o.user_id LEFT JOIN workspaces w ON w.id = o.workspace_id WHERE o.id = ?`
      )
      .get(orderId);
    if (!o || !o.email) return;
    const expires = o.plan_expires_at ? new Date(o.plan_expires_at).toLocaleDateString('vi-VN') : '';
    mailer.send({
      to: o.email,
      subject: `Xác nhận thanh toán đơn #${o.id} – HiTechCloud`,
      text: `Chào ${o.name},\n\nChúng tôi đã nhận ${o.amount.toLocaleString('vi-VN')}đ qua ${o.provider} cho gói ${PLANS[o.plan].name} (${o.months} tháng) của workspace "${o.ws_name}".\nGói có hiệu lực đến ${expires}.\n\nQuản lý gói: ${config.appUrl}/app/?tab=billing\nCảm ơn bạn đã sử dụng HiTechCloud!`,
    });
  }

  function markCancelled(order) {
    db.prepare("UPDATE orders SET status = 'cancelled' WHERE id = ? AND status = 'pending'").run(order.id);
  }

  async function checkout({ ws, user, plan, months, provider }) {
    const p = providers[provider];
    if (!p) throw new HttpError(400, 'Cổng thanh toán chưa được cấu hình');
    if (!PLANS[plan] || !PLANS[plan].priceVnd) throw new HttpError(400, 'Gói không hợp lệ');
    months = Number(months);
    if (!BILLING_CYCLES[months]) throw new HttpError(400, 'Chu kỳ thanh toán không hợp lệ');
    const amount = priceFor(plan, months);

    const orderCode = newOrderCode();
    const info = db
      .prepare('INSERT INTO orders (workspace_id, user_id, plan, months, amount, provider, order_code) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(ws.id, user.id, plan, months, amount, provider, orderCode);
    const orderId = Number(info.lastInsertRowid);
    const base = config.appUrl;
    try {
      const result = await p.createPayment({
        orderCode,
        amount,
        description: `HTC${orderId}`.slice(0, 9),
        itemName: `Gói ${PLANS[plan].name} ${months} tháng`,
        buyerEmail: user.email,
        buyerName: user.name,
        returnUrl: `${base}/billing/return/${provider}?order=${orderId}`,
        cancelUrl: `${base}/billing/cancel/${provider}?order=${orderId}`,
        ipnUrl: `${base}/api/billing/webhooks/${provider}`,
      });
      db.prepare('UPDATE orders SET checkout_url = ?, provider_ref = ? WHERE id = ?').run(result.checkoutUrl, result.providerRef, orderId);
      return { orderId, checkoutUrl: result.checkoutUrl, amount };
    } catch (err) {
      db.prepare("UPDATE orders SET status = 'failed' WHERE id = ?").run(orderId);
      console.error(err);
      throw new HttpError(502, 'Không tạo được giao dịch thanh toán, vui lòng thử lại');
    }
  }

  // Public routes: provider webhooks (server-to-server) and browser return/cancel URLs.
  const router = express.Router();

  router.post('/api/billing/webhooks/:provider', express.json({ limit: '100kb' }), (req, res) => {
    const p = providers[req.params.provider];
    if (!p) return res.status(404).json({ error: 'not found' });
    let event;
    try {
      event = p.verifyWebhook(req.body || {});
    } catch (err) {
      console.warn(`Webhook ${req.params.provider} bị từ chối: ${err.message}`);
      return res.status(400).json({ success: false });
    }
    const order = getOrderByCode(p.id, event.orderCode);
    // Unknown orders (e.g. payOS "confirm webhook" test events) are acknowledged.
    if (order && event.paid) {
      try {
        fulfill(order, event);
      } catch (err) {
        console.error(err);
        db.prepare("UPDATE orders SET status = 'failed' WHERE id = ? AND status = 'pending'").run(order.id);
      }
    }
    res.json({ success: true });
  });

  function finish(res, order) {
    res.redirect(303, `/app/?tab=billing&order=${order ? order.id : ''}`);
  }

  router.get('/billing/return/:provider', async (req, res) => {
    const p = providers[req.params.provider];
    const order = p && db.prepare('SELECT * FROM orders WHERE id = ? AND provider = ?').get(Number(req.query.order), p.id);
    if (!order) return finish(res, null);
    try {
      if (order.status === 'pending') {
        if (p.id === 'payos') {
          const s = await p.getStatus(order.order_code);
          if (s.status === 'PAID') fulfill(order, { amount: s.amount });
          else if (s.status === 'CANCELLED') markCancelled(order);
        } else if (p.id === 'pay2s' && req.query.m2signature) {
          const event = p.verifyReturn(req.query);
          if (event.orderCode === order.order_code && event.paid) fulfill(order, event);
        }
      }
    } catch (err) {
      console.warn(`Không xác nhận được đơn ${order.id}: ${err.message}`);
    }
    finish(res, order);
  });

  router.get('/billing/cancel/:provider', (req, res) => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ? AND provider = ?').get(Number(req.query.order), req.params.provider);
    if (order) markCancelled(order);
    finish(res, order);
  });

  return {
    router,
    checkout,
    fulfill,
    providers: () => Object.values(providers).map((p) => ({ id: p.id, name: p.name })),
  };
}

module.exports = { createBilling, addMonths, newExpiry };
