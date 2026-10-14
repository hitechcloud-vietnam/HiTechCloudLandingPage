'use strict';

const crypto = require('node:crypto');

// payOS (https://payos.vn/docs) – VietQR bank transfer gateway.
// Signature rules mirror the official @payos/node SDK:
//  - payment request: HMAC-SHA256 over
//    "amount=..&cancelUrl=..&description=..&orderCode=..&returnUrl=.."
//  - responses / webhooks: HMAC-SHA256 over the `data` object with keys sorted
//    alphabetically, serialised as key=value joined by "&" (null -> "").

const BASE_URL = 'https://api-merchant.payos.vn';

function hmac(key, text) {
  return crypto.createHmac('sha256', key).update(text).digest('hex');
}

function sortObject(obj) {
  return Object.keys(obj)
    .sort()
    .reduce((out, k) => {
      out[k] = obj[k];
      return out;
    }, {});
}

function dataToQuery(data) {
  const sorted = sortObject(data);
  return Object.keys(sorted)
    .filter((k) => sorted[k] !== undefined)
    .map((k) => {
      let value = sorted[k];
      if (Array.isArray(value)) value = JSON.stringify(value.map((v) => (v && typeof v === 'object' ? sortObject(v) : v)));
      if ([null, undefined, 'undefined', 'null'].includes(value)) value = '';
      return `${k}=${value}`;
    })
    .join('&');
}

function signData(data, checksumKey) {
  return hmac(checksumKey, dataToQuery(data));
}

function signPaymentRequest({ amount, cancelUrl, description, orderCode, returnUrl }, checksumKey) {
  return hmac(
    checksumKey,
    `amount=${amount}&cancelUrl=${cancelUrl}&description=${description}&orderCode=${orderCode}&returnUrl=${returnUrl}`
  );
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function createPayOS({ clientId, apiKey, checksumKey, baseUrl = BASE_URL, fetch = globalThis.fetch }) {
  async function call(method, path, body) {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'x-client-id': clientId, 'x-api-key': apiKey, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
    const json = await res.json().catch(() => null);
    if (!json || json.code !== '00' || !json.data) {
      throw new Error(`payOS: ${(json && json.desc) || `HTTP ${res.status}`}`);
    }
    if (!safeEqual(signData(json.data, checksumKey), json.signature)) {
      throw new Error('payOS: chữ ký phản hồi không hợp lệ');
    }
    return json.data;
  }

  return {
    id: 'payos',
    name: 'payOS (VietQR – chuyển khoản ngân hàng)',

    // Returns { checkoutUrl, providerRef }.
    async createPayment({ orderCode, amount, description, returnUrl, cancelUrl, buyerEmail, buyerName, itemName }) {
      const payload = {
        orderCode: Number(orderCode),
        amount,
        description,
        returnUrl,
        cancelUrl,
        buyerName,
        buyerEmail,
        items: [{ name: itemName, quantity: 1, price: amount }],
        expiredAt: Math.floor(Date.now() / 1000) + 30 * 60,
      };
      payload.signature = signPaymentRequest(payload, checksumKey);
      const data = await call('POST', '/v2/payment-requests', payload);
      return { checkoutUrl: data.checkoutUrl, providerRef: data.paymentLinkId };
    },

    // Server-to-server status lookup (used on return URL in case the webhook is late).
    async getStatus(orderCode) {
      const data = await call('GET', `/v2/payment-requests/${encodeURIComponent(orderCode)}`);
      return { status: data.status, amountPaid: data.amountPaid, amount: data.amount };
    },

    // Verifies a webhook body { code, desc, success, data, signature }.
    // Returns { orderCode, amount, paid, ref } or throws.
    verifyWebhook(body) {
      if (!body || !body.data || !body.signature) throw new Error('payOS webhook thiếu dữ liệu');
      if (!safeEqual(signData(body.data, checksumKey), body.signature)) throw new Error('payOS webhook sai chữ ký');
      return {
        orderCode: String(body.data.orderCode),
        amount: Number(body.data.amount),
        paid: body.code === '00' && body.data.code === '00',
        ref: body.data.reference || body.data.paymentLinkId || null,
      };
    },
  };
}

module.exports = { createPayOS, signData, signPaymentRequest, dataToQuery };
