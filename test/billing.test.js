'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/db');
const { createApp } = require('../src/app');
const payosLib = require('../src/payments/payos');
const pay2sLib = require('../src/payments/pay2s');

const APP_URL = 'http://localhost:3999';
const PAYOS = { clientId: 'cid', apiKey: 'key', checksumKey: 'payos-checksum' };
const PAY2S = { partnerCode: 'PARTNER1', accessKey: 'ACCESS1', secretKey: 'pay2s-secret', environment: 'sandbox' };

// Fake gateway servers behind an injected fetch.
function createGatewayMock() {
  const state = { payos: {}, pay2sRequests: [], payosStatus: {} };
  async function fetch(url, opts = {}) {
    const u = new URL(url);
    const body = opts.body ? JSON.parse(opts.body) : null;
    const reply = (json, status = 200) => ({ ok: status < 300, status, json: async () => json });

    if (u.host === 'api-merchant.payos.vn') {
      assert.equal(opts.headers['x-client-id'], PAYOS.clientId);
      if (opts.method === 'POST' && u.pathname === '/v2/payment-requests') {
        assert.equal(body.signature, payosLib.signPaymentRequest(body, PAYOS.checksumKey), 'payOS request signature');
        state.payos[body.orderCode] = body;
        const data = {
          bin: '970422', accountNumber: '123', accountName: 'HTC', amount: body.amount, description: body.description,
          orderCode: body.orderCode, currency: 'VND', paymentLinkId: `pl_${body.orderCode}`, status: 'PENDING',
          checkoutUrl: `https://pay.payos.vn/web/pl_${body.orderCode}`, qrCode: 'qr',
        };
        return reply({ code: '00', desc: 'success', data, signature: payosLib.signData(data, PAYOS.checksumKey) });
      }
      const m = u.pathname.match(/^\/v2\/payment-requests\/(\d+)$/);
      if (m) {
        const req = state.payos[m[1]];
        const status = state.payosStatus[m[1]] || 'PENDING';
        const data = { id: `pl_${m[1]}`, orderCode: Number(m[1]), amount: req.amount, amountPaid: status === 'PAID' ? req.amount : 0, status, transactions: [] };
        return reply({ code: '00', desc: 'success', data, signature: payosLib.signData(data, PAYOS.checksumKey) });
      }
    }
    if (u.host === 'sandbox-payment.pay2s.vn' && u.pathname === '/v1/gateway/api/create') {
      assert.equal(body.signature, pay2sLib.sign(pay2sLib.CREATE_FIELDS, body, PAY2S.secretKey), 'Pay2S request signature');
      assert.match(body.orderInfo, /^[A-Za-z0-9]{10,32}$/);
      state.pay2sRequests.push(body);
      return reply({ resultCode: 0, requestId: body.requestId, payUrl: `https://sandbox-payment.pay2s.vn/pay/${body.orderId}` });
    }
    throw new Error(`Unexpected request ${url}`);
  }
  return { fetch, state };
}

function payosWebhook(req, { amount = req.amount, signatureKey = PAYOS.checksumKey } = {}) {
  const data = {
    orderCode: req.orderCode, amount, description: req.description, accountNumber: '123', reference: `REF${req.orderCode}`,
    transactionDateTime: '2026-10-14 10:00:00', currency: 'VND', paymentLinkId: `pl_${req.orderCode}`, code: '00', desc: 'success',
    counterAccountBankId: null, counterAccountBankName: null, counterAccountName: null, counterAccountNumber: null,
    virtualAccountName: null, virtualAccountNumber: null,
  };
  return { code: '00', desc: 'success', success: true, data, signature: payosLib.signData(data, signatureKey) };
}

function pay2sIpn(req, overrides = {}) {
  const payload = {
    partnerCode: PAY2S.partnerCode, orderId: req.orderId, requestId: req.requestId, amount: req.amount, orderInfo: req.orderInfo,
    orderType: 'pay2s', transId: 'T123', resultCode: 0, message: 'Success', payType: 'qr', responseTime: 1760000000000, extraData: '',
    ...overrides,
  };
  payload.m2signature = pay2sLib.sign(pay2sLib.IPN_FIELDS, { ...payload, accessKey: PAY2S.accessKey }, PAY2S.secretKey);
  return payload;
}

function client(base) {
  let cookie = '';
  return async function call(method, path, body) {
    const res = await fetch(base + path, {
      method,
      redirect: 'manual',
      headers: { Origin: APP_URL, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    const data = (res.headers.get('content-type') || '').includes('json') ? await res.json() : await res.text();
    return { status: res.status, data, headers: res.headers };
  };
}

test('billing with payOS and Pay2S', async (t) => {
  const gw = createGatewayMock();
  const db = openDb(':memory:');
  const config = {
    appUrl: APP_URL, publishRootDomain: '', superAdmins: ['root@hitechcloud.vn'], sessionDays: 1, secureCookies: false,
    payments: { payos: PAYOS, pay2s: PAY2S }, fetch: gw.fetch,
  };
  const server = createApp({ db, config }).listen(0);
  await new Promise((r) => server.once('listening', r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  const c = client(base);
  await c('POST', '/api/auth/signup', { name: 'Owner', email: 'owner@example.com', password: 'matkhau123' });
  const wsId = (await c('GET', '/api/auth/me')).data.workspaces[0].id;
  const wsRow = () => db.prepare('SELECT * FROM workspaces WHERE id = ?').get(wsId);
  const webhook = (provider, body) =>
    fetch(`${base}/api/billing/webhooks/${provider}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  await t.test('providers are listed', async () => {
    const r = await c('GET', '/api/billing/providers');
    assert.deepEqual(r.data.map((p) => p.id), ['payos', 'pay2s']);
  });

  await t.test('checkout validation and permissions', async () => {
    assert.equal((await c('POST', `/api/workspaces/${wsId}/checkout`, { plan: 'free', months: 1, provider: 'payos' })).status, 400);
    assert.equal((await c('POST', `/api/workspaces/${wsId}/checkout`, { plan: 'pro', months: 3, provider: 'payos' })).status, 400);
    assert.equal((await c('POST', `/api/workspaces/${wsId}/checkout`, { plan: 'pro', months: 1, provider: 'stripe' })).status, 400);
    const other = client(base);
    await other('POST', '/api/auth/signup', { name: 'X', email: 'x@example.com', password: 'matkhau123' });
    assert.equal((await other('POST', `/api/workspaces/${wsId}/checkout`, { plan: 'pro', months: 1, provider: 'payos' })).status, 404);
  });

  let payosReq;
  await t.test('payOS checkout + webhook activates plan', async () => {
    const r = await c('POST', `/api/workspaces/${wsId}/checkout`, { plan: 'pro', months: 1, provider: 'payos' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.amount, 199000);
    assert.match(r.data.checkoutUrl, /^https:\/\/pay\.payos\.vn\//);
    payosReq = Object.values(gw.state.payos).at(-1);
    assert.ok(payosReq.description.length <= 9);
    assert.equal(payosReq.returnUrl, `${APP_URL}/billing/return/payos?order=${r.data.orderId}`);

    // Forged / tampered webhooks are rejected.
    assert.equal((await webhook('payos', payosWebhook(payosReq, { signatureKey: 'wrong' }))).status, 400);
    const underpaid = await webhook('payos', payosWebhook(payosReq, { amount: 1000 }));
    assert.equal(underpaid.status, 200);
    assert.equal(wsRow().plan, 'free');

    assert.equal((await webhook('payos', payosWebhook(payosReq))).status, 200);
    const ws = wsRow();
    assert.equal(ws.plan, 'pro');
    const days = (new Date(ws.plan_expires_at) - Date.now()) / 86400_000;
    assert.ok(days > 27 && days < 32, `expiry in ${days} days`);

    // Duplicate delivery doesn't extend twice.
    await webhook('payos', payosWebhook(payosReq));
    assert.equal(wsRow().plan_expires_at, ws.plan_expires_at);

    const me = await c('GET', `/api/workspaces/${wsId}`);
    assert.equal(me.data.effectivePlan, 'pro');
    const orders = await c('GET', `/api/workspaces/${wsId}/orders`);
    assert.equal(orders.data[0].status, 'paid');
  });

  await t.test('payOS unknown order (confirm-webhook test) is acknowledged', async () => {
    const res = await webhook('payos', payosWebhook({ orderCode: 123, amount: 3000, description: 'VQRIO123' }));
    assert.equal(res.status, 200);
  });

  await t.test('payOS return URL confirms via status API and stacks renewal', async () => {
    const before = new Date(wsRow().plan_expires_at);
    const r = await c('POST', `/api/workspaces/${wsId}/checkout`, { plan: 'pro', months: 12, provider: 'payos' });
    assert.equal(r.data.amount, 1990000);
    const req = Object.values(gw.state.payos).at(-1);

    let res = await fetch(`${base}/billing/return/payos?order=${r.data.orderId}`, { redirect: 'manual' });
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), `/app/?tab=billing&order=${r.data.orderId}`);
    assert.equal(db.prepare('SELECT status FROM orders WHERE id = ?').get(r.data.orderId).status, 'pending');

    gw.state.payosStatus[req.orderCode] = 'PAID';
    res = await fetch(`${base}/billing/return/payos?order=${r.data.orderId}`, { redirect: 'manual' });
    assert.equal(db.prepare('SELECT status FROM orders WHERE id = ?').get(r.data.orderId).status, 'paid');
    const after = new Date(wsRow().plan_expires_at);
    const months = (after - before) / (30.44 * 86400_000);
    assert.ok(months > 11.5 && months < 12.5, `extended by ${months} months`);
  });

  await t.test('cancel URL marks pending order cancelled', async () => {
    const r = await c('POST', `/api/workspaces/${wsId}/checkout`, { plan: 'business', months: 1, provider: 'payos' });
    await fetch(`${base}/billing/cancel/payos?order=${r.data.orderId}`, { redirect: 'manual' });
    assert.equal(db.prepare('SELECT status FROM orders WHERE id = ?').get(r.data.orderId).status, 'cancelled');
  });

  await t.test('Pay2S checkout + IPN switches to business', async () => {
    const r = await c('POST', `/api/workspaces/${wsId}/checkout`, { plan: 'business', months: 1, provider: 'pay2s' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.match(r.data.checkoutUrl, /sandbox-payment\.pay2s\.vn\/pay\//);
    const req = gw.state.pay2sRequests.at(-1);
    assert.equal(req.ipnUrl, `${APP_URL}/api/billing/webhooks/pay2s`);

    assert.equal((await webhook('pay2s', { ...pay2sIpn(req), m2signature: 'deadbeef' })).status, 400);
    assert.equal((await webhook('pay2s', pay2sIpn(req, { partnerCode: 'OTHER' }))).status, 400);
    await webhook('pay2s', pay2sIpn(req, { resultCode: 1006 })); // failed payment
    assert.equal(wsRow().plan, 'pro');

    assert.equal((await webhook('pay2s', pay2sIpn(req))).status, 200);
    assert.equal(wsRow().plan, 'business');
  });

  await t.test('Pay2S signed browser return confirms payment', async () => {
    const r = await c('POST', `/api/workspaces/${wsId}/checkout`, { plan: 'business', months: 1, provider: 'pay2s' });
    const req = gw.state.pay2sRequests.at(-1);
    const q = { partnerCode: PAY2S.partnerCode, orderId: req.orderId, requestId: req.requestId, amount: req.amount, orderInfo: req.orderInfo,
      orderType: 'pay2s', message: 'Success', payType: 'qr', responseTime: '1760000000000', resultCode: '0' };
    q.m2signature = pay2sLib.sign(pay2sLib.RETURN_FIELDS, { ...q, accessKey: PAY2S.accessKey }, PAY2S.secretKey);

    const forged = new URLSearchParams({ ...q, m2signature: 'x'.repeat(64), order: r.data.orderId });
    await fetch(`${base}/billing/return/pay2s?${forged}`, { redirect: 'manual' });
    assert.equal(db.prepare('SELECT status FROM orders WHERE id = ?').get(r.data.orderId).status, 'pending');

    await fetch(`${base}/billing/return/pay2s?${new URLSearchParams({ ...q, order: r.data.orderId })}`, { redirect: 'manual' });
    assert.equal(db.prepare('SELECT status FROM orders WHERE id = ?').get(r.data.orderId).status, 'paid');
  });

  await t.test('expired subscription falls back to free limits', async () => {
    db.prepare("UPDATE workspaces SET plan = 'pro', plan_expires_at = '2020-01-01T00:00:00.000Z' WHERE id = ?").run(wsId);
    const ws = await c('GET', `/api/workspaces/${wsId}`);
    assert.equal(ws.data.effectivePlan, 'free');
    assert.equal(ws.data.planDetails.id, 'free');
    assert.equal((await c('POST', `/api/workspaces/${wsId}/sites`, { name: 'A', subdomain: 'site-a' })).status, 201);
    assert.equal((await c('POST', `/api/workspaces/${wsId}/sites`, { name: 'B', subdomain: 'site-b' })).status, 402);
    // Renewing after expiry starts from now, not from the old expiry date.
    const r = await c('POST', `/api/workspaces/${wsId}/checkout`, { plan: 'pro', months: 1, provider: 'payos' });
    await webhook('payos', payosWebhook(Object.values(gw.state.payos).at(-1)));
    const days = (new Date(wsRow().plan_expires_at) - Date.now()) / 86400_000;
    assert.ok(days > 27 && days < 32, `expiry in ${days} days (order ${r.data.orderId})`);
  });

  await t.test('platform admin console', async () => {
    assert.equal((await c('GET', '/api/admin/stats')).status, 403);
    const root = client(base);
    await root('POST', '/api/auth/signup', { name: 'Root', email: 'root@hitechcloud.vn', password: 'matkhau123' });
    const stats = await root('GET', '/api/admin/stats');
    assert.equal(stats.status, 200);
    assert.equal(stats.data.paidWorkspaces, 1);
    assert.equal(stats.data.mrrVnd, 199000);
    assert.ok(stats.data.revenueTotalVnd >= 199000 + 1990000 + 599000 * 2);
    assert.equal((await root('GET', '/api/admin/orders')).data.length >= 6, true);
    const grant = await root('POST', `/api/workspaces/${wsId}/plan`, { plan: 'business', months: 2 });
    assert.equal(grant.status, 200);
    const w = (await root('GET', '/api/admin/workspaces')).data.find((x) => x.id === wsId);
    assert.equal(w.effectivePlan, 'business');
  });
});

test('payOS signature matches the official SDK algorithm', () => {
  // Keys are sorted, nulls become empty strings, arrays are JSON with sorted keys.
  const q = payosLib.dataToQuery({ b: 2, a: null, c: [{ y: 1, x: 2 }] });
  assert.equal(q, 'a=&b=2&c=[{"x":2,"y":1}]');
  assert.equal(
    payosLib.signPaymentRequest({ amount: 1000, cancelUrl: 'c', description: 'd', orderCode: 1, returnUrl: 'r' }, 'k'),
    require('node:crypto').createHmac('sha256', 'k').update('amount=1000&cancelUrl=c&description=d&orderCode=1&returnUrl=r').digest('hex')
  );
});
