'use strict';

const crypto = require('node:crypto');

// Pay2S (https://docs.pay2s.vn) – payment gateway.
// Signatures are HMAC-SHA256 (hex) with the secret key over "field=value"
// pairs joined by "&" in a fixed canonical order (bankAccounts is always
// signed as the literal "Array").

const BASE_URLS = {
  sandbox: 'https://sandbox-payment.pay2s.vn',
  production: 'https://payment.pay2s.vn',
};

const CREATE_FIELDS = ['accessKey', 'amount', 'bankAccounts', 'ipnUrl', 'orderId', 'orderInfo', 'partnerCode', 'redirectUrl', 'requestId', 'requestType'];
// Signed fields of the browser redirect (payment notification) and the server IPN.
const RETURN_FIELDS = ['accessKey', 'amount', 'message', 'orderId', 'orderInfo', 'orderType', 'partnerCode', 'payType', 'requestId', 'responseTime', 'resultCode'];
const IPN_FIELDS = ['accessKey', 'amount', 'extraData', 'message', 'orderId', 'orderInfo', 'orderType', 'partnerCode', 'payType', 'requestId', 'responseTime', 'resultCode', 'transId'];

function canonical(fields, payload) {
  return fields
    .map((f) => {
      if (f === 'bankAccounts') return 'bankAccounts=Array';
      const v = payload[f];
      return `${f}=${v === undefined || v === null ? '' : String(v)}`;
    })
    .join('&');
}

function sign(fields, payload, secretKey) {
  return crypto.createHmac('sha256', secretKey).update(canonical(fields, payload), 'utf8').digest('hex');
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function createPay2S({ partnerCode, accessKey, secretKey, partnerName = 'HiTechCloud', environment = 'sandbox', baseUrl, fetch = globalThis.fetch }) {
  const base = baseUrl || BASE_URLS[environment] || BASE_URLS.sandbox;

  function verify(fields, payload) {
    if (!payload || String(payload.partnerCode) !== String(partnerCode)) throw new Error('Pay2S: partnerCode không khớp');
    const signed = { ...payload, accessKey: payload.accessKey ?? accessKey };
    if (!safeEqual(sign(fields, signed, secretKey), payload.m2signature)) throw new Error('Pay2S: chữ ký không hợp lệ');
    return {
      orderCode: String(payload.orderId),
      amount: Number(payload.amount),
      paid: String(payload.resultCode) === '0',
      ref: payload.transId ? String(payload.transId) : null,
    };
  }

  return {
    id: 'pay2s',
    name: 'Pay2S (QR ngân hàng / ví)',

    async createPayment({ orderCode, amount, returnUrl, ipnUrl }) {
      const payload = {
        accessKey,
        partnerCode,
        partnerName,
        requestId: String(orderCode),
        amount,
        orderId: String(orderCode),
        // Pay2S requires 10-32 ASCII letters/digits.
        orderInfo: `HTC${orderCode}`.slice(0, 32),
        orderType: 'pay2s',
        redirectUrl: returnUrl,
        ipnUrl,
        requestType: 'pay2s',
        bankAccounts: [],
        extraData: '',
      };
      payload.signature = sign(CREATE_FIELDS, payload, secretKey);
      const res = await fetch(`${base}/v1/gateway/api/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000),
      });
      const json = await res.json().catch(() => null);
      const url = json && (json.payUrl || json.paymentUrl || json.payment_url || json.checkoutUrl);
      if (!res.ok || !url) throw new Error(`Pay2S: ${(json && (json.message || json.msg)) || `HTTP ${res.status}`}`);
      return { checkoutUrl: url, providerRef: json.requestId ? String(json.requestId) : null };
    },

    verifyReturn(query) {
      return verify(RETURN_FIELDS, query);
    },

    verifyWebhook(body) {
      return verify(IPN_FIELDS, { ...body, extraData: body.extraData ?? '', responseTime: body.responseTime ?? '' });
    },
  };
}

module.exports = { createPay2S, sign, canonical, CREATE_FIELDS, RETURN_FIELDS, IPN_FIELDS };
