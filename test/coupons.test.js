'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const payosLib = require('../src/payments/payos');
const { startServer, client, verifyEmail } = require('./helpers');

const PAYOS = { clientId: 'cid', apiKey: 'key', checksumKey: 'payos-checksum' };

// Minimal payOS mock behind an injected fetch; records payment requests.
function payosMock() {
  const requests = [];
  async function fetch(url, opts = {}) {
    const u = new URL(url);
    const body = opts.body ? JSON.parse(opts.body) : null;
    if (u.host === 'api-merchant.payos.vn' && opts.method === 'POST' && u.pathname === '/v2/payment-requests') {
      assert.equal(body.signature, payosLib.signPaymentRequest(body, PAYOS.checksumKey));
      requests.push(body);
      const data = {
        amount: body.amount, description: body.description, orderCode: body.orderCode, currency: 'VND',
        paymentLinkId: `pl_${body.orderCode}`, status: 'PENDING', checkoutUrl: `https://pay.payos.vn/web/pl_${body.orderCode}`,
      };
      return { ok: true, status: 200, json: async () => ({ code: '00', desc: 'success', data, signature: payosLib.signData(data, PAYOS.checksumKey) }) };
    }
    throw new Error(`Unexpected request ${url}`);
  }
  return { fetch, requests };
}

function payosWebhook(req, amount = req.amount) {
  const data = {
    orderCode: req.orderCode, amount, description: req.description, accountNumber: '123', reference: `REF${req.orderCode}`,
    transactionDateTime: '2026-10-14 10:00:00', currency: 'VND', paymentLinkId: `pl_${req.orderCode}`, code: '00', desc: 'success',
  };
  return { code: '00', desc: 'success', success: true, data, signature: payosLib.signData(data, PAYOS.checksumKey) };
}

test('coupons', async (t) => {
  const gw = payosMock();
  const { db, server, base, outbox } = await startServer({ payments: { payos: PAYOS }, fetch: gw.fetch });
  t.after(() => server.close());

  const root = client(base);
  await root('POST', '/api/auth/signup', { name: 'Root', email: 'root@hitechcloud.vn', password: 'matkhau123' });
  const owner = client(base);
  await owner('POST', '/api/auth/signup', { name: 'Owner', email: 'owner@example.com', password: 'matkhau123' });
  verifyEmail(db, 'owner@example.com');
  const wsId = (await owner('GET', '/api/auth/me')).data.workspaces[0].id;
  const wsRow = () => db.prepare('SELECT * FROM workspaces WHERE id = ?').get(wsId);
  const coupon = (code) => db.prepare('SELECT * FROM coupons WHERE code = ?').get(code);
  const webhook = (body) =>
    fetch(`${base}/api/billing/webhooks/payos`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const preview = (body) => owner('POST', `/api/workspaces/${wsId}/coupon/preview`, body);
  const create = async (body) => {
    const r = await root('POST', '/api/admin/coupons', body);
    assert.equal(r.status, 201, JSON.stringify(r.data));
    return r.data;
  };

  await t.test('only platform admins manage coupons', async () => {
    assert.equal((await owner('GET', '/api/admin/coupons')).status, 403);
    assert.equal((await owner('POST', '/api/admin/coupons', { code: 'HACK', percent_off: 100 })).status, 403);
    assert.equal((await client(base)('GET', '/api/admin/coupons')).status, 401);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM coupons').get().n, 0);
  });

  await t.test('admin CRUD with validation', async () => {
    const bad = [
      { code: 'ab', percent_off: 10 },
      { code: 'CÓ DẤU', percent_off: 10 },
      { code: 'NONE' },
      { code: 'BOTH', percent_off: 10, amount_off_vnd: 5000 },
      { code: 'PCT0', percent_off: 0 },
      { code: 'PCT101', percent_off: 101 },
      { code: 'PLANS', percent_off: 10, applies_to_plans: ['free'] },
      { code: 'MONTHS', percent_off: 10, applies_to_months: 3 },
      { code: 'DATE', percent_off: 10, expires_at: 'not-a-date' },
    ];
    for (const body of bad) assert.equal((await root('POST', '/api/admin/coupons', body)).status, 400, JSON.stringify(body));

    const c = await create({ code: ' tet2027 ', percent_off: 20, note: 'Khuyến mãi Tết', max_redemptions: 2 });
    assert.equal(c.code, 'TET2027');
    assert.equal(c.active, true);
    assert.equal(c.applies_to_plans, null);
    assert.equal(c.redeemed_count, 0);
    assert.equal((await root('POST', '/api/admin/coupons', { code: 'TET2027', percent_off: 5 })).status, 409);

    const p = await root('PATCH', `/api/admin/coupons/${c.id}`, { active: false, note: 'Tạm dừng', expires_at: '2099-12-31', percent_off: 99 });
    assert.equal(p.status, 200);
    assert.equal(p.data.active, false);
    assert.equal(p.data.note, 'Tạm dừng');
    assert.equal(p.data.percent_off, 20, 'discount value is immutable');
    assert.equal(p.data.expires_at, '2099-12-31T16:59:59.999Z');
    assert.equal((await owner('PATCH', `/api/admin/coupons/${c.id}`, { active: true })).status, 403);
    assert.equal((await root('PATCH', '/api/admin/coupons/9999', { active: true })).status, 404);
    await root('PATCH', `/api/admin/coupons/${c.id}`, { active: true, expires_at: null });

    const list = await root('GET', '/api/admin/coupons');
    assert.equal(list.data.length, 1);
    assert.equal(list.data[0].discount_total_vnd, 0);
  });

  await t.test('preview math: percent, fixed and price floor', async () => {
    let r = await preview({ coupon: 'tet2027', plan: 'pro', months: 1 });
    assert.equal(r.status, 200);
    assert.deepEqual(
      { valid: r.data.valid, listAmount: r.data.listAmount, discount: r.data.discount, amount: r.data.amount },
      { valid: true, listAmount: 199000, discount: 39800, amount: 159200 }
    );
    assert.match(r.data.message, /TET2027/);

    r = await preview({ coupon: 'TET2027', plan: 'business', months: 12 });
    assert.equal(r.data.listAmount, 5990000);
    assert.equal(r.data.amount, 4792000);

    // Percentages round the discount down to whole đồng.
    await create({ code: 'ODD33', percent_off: 33 });
    r = await preview({ coupon: 'ODD33', plan: 'pro', months: 1 });
    assert.equal(r.data.discount, 65670);
    assert.equal(r.data.amount, 133330);

    await create({ code: 'GIAM50K', amount_off_vnd: 50000 });
    r = await preview({ coupon: 'GIAM50K', plan: 'pro', months: 1 });
    assert.equal(r.data.discount, 50000);
    assert.equal(r.data.amount, 149000);

    // Leaves less than 10.000đ to pay: rejected.
    await create({ code: 'GIAM195K', amount_off_vnd: 195000 });
    r = await preview({ coupon: 'GIAM195K', plan: 'pro', months: 1 });
    assert.equal(r.data.valid, false);
    assert.equal(r.data.amount, 199000);
    assert.match(r.data.message, /10\.000đ/);
    assert.equal((await preview({ coupon: 'GIAM195K', plan: 'pro', months: 12 })).data.amount, 1795000);

    assert.equal((await preview({ coupon: 'TET2027', plan: 'free', months: 1 })).status, 400);
    assert.equal((await preview({ coupon: 'TET2027', plan: 'pro', months: 6 })).status, 400);
    assert.equal((await client(base)('POST', `/api/workspaces/${wsId}/coupon/preview`, { coupon: 'TET2027', plan: 'pro', months: 1 })).status, 401);
  });

  await t.test('invalid, inactive, expired, wrong plan/cycle and exhausted coupons', async () => {
    const invalid = async (body, re) => {
      const r = await preview(body);
      assert.equal(r.data.valid, false, JSON.stringify(body));
      assert.match(r.data.message, re);
    };
    await invalid({ coupon: 'KHONGCO', plan: 'pro', months: 1 }, /không tồn tại/);
    await invalid({ coupon: '', plan: 'pro', months: 1 }, /nhập mã/);

    const off = await create({ code: 'OFF', percent_off: 10, active: false });
    await invalid({ coupon: 'OFF', plan: 'pro', months: 1 }, /ngừng áp dụng/);
    assert.equal(off.active, false);

    await create({ code: 'OLD', percent_off: 10, expires_at: '2020-01-01T00:00:00Z' });
    await invalid({ coupon: 'OLD', plan: 'pro', months: 1 }, /hết hạn/);

    await create({ code: 'BIZONLY', percent_off: 10, applies_to_plans: ['business'] });
    await invalid({ coupon: 'BIZONLY', plan: 'pro', months: 1 }, /gói Pro/);
    assert.equal((await preview({ coupon: 'BIZONLY', plan: 'business', months: 1 })).data.valid, true);

    await create({ code: 'YEARLY', percent_off: 10, applies_to_months: 12 });
    await invalid({ coupon: 'YEARLY', plan: 'pro', months: 1 }, /12 tháng/);
    assert.equal((await preview({ coupon: 'YEARLY', plan: 'pro', months: 12 })).data.valid, true);

    await create({ code: 'HETLUOT', percent_off: 10, max_redemptions: 1 });
    db.prepare("UPDATE coupons SET redeemed_count = 1 WHERE code = 'HETLUOT'").run();
    await invalid({ coupon: 'HETLUOT', plan: 'pro', months: 1 }, /hết lượt/);

    // Checkout refuses invalid coupons without creating an order or calling the gateway.
    const before = gw.requests.length;
    const r = await owner('POST', `/api/workspaces/${wsId}/checkout`, { plan: 'pro', months: 1, provider: 'payos', coupon: 'OLD' });
    assert.equal(r.status, 400);
    assert.match(r.data.error, /hết hạn/);
    assert.equal(gw.requests.length, before);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM orders').get().n, 0);
  });

  await t.test('checkout charges the discounted amount; webhook activates and counts once', async () => {
    const r = await owner('POST', `/api/workspaces/${wsId}/checkout`, { plan: 'pro', months: 1, provider: 'payos', coupon: 'tet2027' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.amount, 159200);
    const req = gw.requests.at(-1);
    assert.equal(req.amount, 159200);
    assert.equal(req.items[0].price, 159200);
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(r.data.orderId);
    assert.equal(order.coupon_code, 'TET2027');
    assert.equal(order.list_amount, 199000);
    assert.equal(order.discount_vnd, 39800);
    assert.equal(coupon('TET2027').redeemed_count, 0, 'not counted until paid');

    // The full list price no longer matches the order.
    const err = t.mock.method(console, 'error', () => {});
    await webhook(payosWebhook(req, 199000));
    err.mock.restore();
    assert.equal(wsRow().plan, 'free');
    assert.equal(coupon('TET2027').redeemed_count, 0);
    db.prepare("UPDATE orders SET status = 'pending' WHERE id = ?").run(order.id);

    const mails = outbox.length;
    assert.equal((await webhook(payosWebhook(req))).status, 200);
    assert.equal(wsRow().plan, 'pro');
    await webhook(payosWebhook(req));
    await webhook(payosWebhook(req));
    assert.equal(coupon('TET2027').redeemed_count, 1);

    const receipts = outbox.slice(mails).filter((m) => /Xác nhận thanh toán/.test(m.subject));
    assert.equal(receipts.length, 1);
    assert.match(receipts[0].text, /Giá niêm yết: 199\.000đ/);
    assert.match(receipts[0].text, /Giảm giá \(mã TET2027\): -39\.800đ/);
    assert.match(receipts[0].text, /Đã thanh toán: 159\.200đ/);

    const orders = await owner('GET', `/api/workspaces/${wsId}/orders`);
    assert.equal(orders.data[0].discount_vnd, 39800);
    assert.equal(orders.data[0].list_amount, 199000);
    assert.equal(orders.data[0].coupon_code, 'TET2027');
    const list = await root('GET', '/api/admin/coupons');
    assert.equal(list.data.find((c) => c.code === 'TET2027').discount_total_vnd, 39800);
    assert.equal((await root('GET', '/api/admin/orders')).data[0].coupon_code, 'TET2027');

    // Without a coupon nothing changes.
    const plain = await owner('POST', `/api/workspaces/${wsId}/checkout`, { plan: 'pro', months: 1, provider: 'payos' });
    assert.equal(plain.data.amount, 199000);
    const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(plain.data.orderId);
    assert.equal(row.coupon_code, null);
    assert.equal(row.discount_vnd, 0);
  });

  await t.test('redemption limit is re-checked when orders are paid', async () => {
    await create({ code: 'MOTLAN', percent_off: 10, max_redemptions: 1 });
    // Two checkouts pass validation before either is paid.
    const a = await owner('POST', `/api/workspaces/${wsId}/checkout`, { plan: 'pro', months: 1, provider: 'payos', coupon: 'MOTLAN' });
    const reqA = gw.requests.at(-1);
    const b = await owner('POST', `/api/workspaces/${wsId}/checkout`, { plan: 'pro', months: 1, provider: 'payos', coupon: 'MOTLAN' });
    const reqB = gw.requests.at(-1);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);

    await webhook(payosWebhook(reqA));
    const warn = t.mock.method(console, 'warn', () => {});
    await webhook(payosWebhook(reqB));
    assert.equal(coupon('MOTLAN').redeemed_count, 1, 'never exceeds the limit');
    // The second customer paid, so the order is still honoured, and the overrun logged.
    assert.equal(db.prepare('SELECT status FROM orders WHERE id = ?').get(b.data.orderId).status, 'paid');
    assert.ok(warn.mock.calls.some((c) => /MOTLAN/.test(c.arguments[0])));
    warn.mock.restore();

    assert.equal((await preview({ coupon: 'MOTLAN', plan: 'pro', months: 1 })).data.valid, false);
    assert.equal((await root('PATCH', `/api/admin/coupons/${coupon('MOTLAN').id}`, { max_redemptions: 0 })).status, 400);
    assert.equal((await root('PATCH', `/api/admin/coupons/${coupon('BIZONLY').id}`, { max_redemptions: 0 })).status, 400);
  });

  await t.test('100% coupon activates immediately without the gateway', async () => {
    db.prepare("UPDATE workspaces SET plan = 'free', plan_expires_at = NULL WHERE id = ?").run(wsId);
    await create({ code: 'FREE100', percent_off: 100, max_redemptions: 5 });
    const r0 = await preview({ coupon: 'FREE100', plan: 'business', months: 1 });
    assert.equal(r0.data.valid, true);
    assert.equal(r0.data.amount, 0);

    const before = gw.requests.length;
    const mails = outbox.length;
    // No provider needed when nothing is charged.
    const r = await owner('POST', `/api/workspaces/${wsId}/checkout`, { plan: 'business', months: 1, coupon: 'FREE100' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.amount, 0);
    assert.equal(r.data.paid, true);
    assert.equal(r.data.checkoutUrl, `/app/?tab=billing&order=${r.data.orderId}`);
    assert.equal(gw.requests.length, before, 'gateway not called');

    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(r.data.orderId);
    assert.equal(order.status, 'paid');
    assert.equal(order.provider, 'coupon');
    assert.equal(order.amount, 0);
    assert.equal(order.discount_vnd, 599000);
    assert.equal(wsRow().plan, 'business');
    const days = (new Date(wsRow().plan_expires_at) - Date.now()) / 86400_000;
    assert.ok(days > 27 && days < 32, `expiry in ${days} days`);
    assert.equal(coupon('FREE100').redeemed_count, 1);
    assert.match(outbox.slice(mails).find((m) => /Xác nhận thanh toán/.test(m.subject)).text, /Đã thanh toán: 0đ/);

    // A fixed discount covering the full price is also free.
    await create({ code: 'TANG1THANG', amount_off_vnd: 199000, applies_to_plans: ['pro'], applies_to_months: 1 });
    const r2 = await owner('POST', `/api/workspaces/${wsId}/checkout`, { plan: 'pro', months: 1, provider: 'payos', coupon: 'TANG1THANG' });
    assert.equal(r2.data.paid, true);
    assert.equal(gw.requests.length, before);
  });

  await t.test('editors cannot check out or preview', async () => {
    const editor = client(base);
    await editor('POST', '/api/auth/signup', { name: 'Ed', email: 'ed@example.com', password: 'matkhau123' });
    const edId = db.prepare("SELECT id FROM users WHERE email = 'ed@example.com'").get().id;
    db.prepare("INSERT INTO memberships (workspace_id, user_id, role) VALUES (?, ?, 'editor')").run(wsId, edId);
    assert.equal((await editor('POST', `/api/workspaces/${wsId}/coupon/preview`, { coupon: 'TET2027', plan: 'pro', months: 1 })).status, 403);
    assert.equal((await editor('POST', `/api/workspaces/${wsId}/checkout`, { plan: 'pro', months: 1, coupon: 'FREE100' })).status, 403);
  });
});
