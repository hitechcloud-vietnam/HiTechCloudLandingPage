'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const payosLib = require('../src/payments/payos');
const { startServer, client, verifyEmail } = require('./helpers');

const PAYOS = { clientId: 'cid', apiKey: 'key', checksumKey: 'payos-checksum' };
const signup = (c, email, extra = {}) => c('POST', '/api/auth/signup', { name: 'Người dùng', email, password: 'matkhau123', ...extra });

const COMPANY = {
  buyerType: 'company',
  companyName: 'Công ty TNHH Phố Tuệ',
  taxCode: '0312345678',
  address: '12 Nguyễn Huệ, Quận 1, TP.HCM',
  email: 'ketoan@photue.vn',
  buyerName: 'Nguyễn Văn A',
};

test('VAT invoice requests', async (t) => {
  const { server, base, db, outbox } = await startServer({ payments: { payos: PAYOS } });
  t.after(() => server.close());

  const owner = client(base);
  await signup(owner, 'owner@example.com');
  verifyEmail(db, 'owner@example.com');
  const wsId = (await owner('GET', '/api/auth/me')).data.workspaces[0].id;
  db.prepare("UPDATE workspaces SET plan = 'pro' WHERE id = ?").run(wsId); // room for an editor

  const editor = client(base);
  await signup(editor, 'editor@example.com');
  assert.equal((await owner('POST', `/api/workspaces/${wsId}/members`, { email: 'editor@example.com', role: 'editor' })).status, 201);
  const other = client(base);
  await signup(other, 'other@example.com');

  let seq = 0;
  const insertOrder = ({ workspaceId = wsId, status = 'paid', amount = 199000, plan = 'pro', months = 1 } = {}) => {
    const code = String(Date.now() * 1000 + ++seq);
    const info = db
      .prepare(
        `INSERT INTO orders (workspace_id, plan, months, amount, provider, order_code, status, paid_at)
         VALUES (?, ?, ?, ?, 'payos', ?, ?, CASE WHEN ? = 'paid' THEN datetime('now') END)`
      )
      .run(workspaceId, plan, months, amount, code, status, status);
    return { id: Number(info.lastInsertRowid), code, amount };
  };
  const request = (c, orderId) => c('POST', `/api/orders/${orderId}/invoice-request`, {});
  const invoiceRow = (orderId) => db.prepare('SELECT * FROM invoice_requests WHERE order_id = ?').get(orderId);

  await t.test('billing profile validation', async () => {
    assert.deepEqual((await owner('GET', `/api/workspaces/${wsId}/billing-profile`)).data, { profile: null });
    const put = (body) => owner('PUT', `/api/workspaces/${wsId}/billing-profile`, body);
    for (const taxCode of ['', '012345678', '01234567890', '0123456789-01', '0123456789-0011', '0123456789001', 'abcdefghij', '0123456789-abc']) {
      const r = await put({ ...COMPANY, taxCode });
      assert.equal(r.status, 400, `MST "${taxCode}" must be rejected`);
      assert.match(r.data.error, /Mã số thuế/);
    }
    assert.equal((await put({ ...COMPANY, buyerType: 'vip' })).status, 400);
    assert.equal((await put({ ...COMPANY, companyName: '' })).status, 400);
    assert.equal((await put({ ...COMPANY, address: '  ' })).status, 400);
    assert.equal((await put({ ...COMPANY, email: 'khong-phai-email' })).status, 400);
    assert.equal((await put({ ...COMPANY, companyName: 'x'.repeat(301) })).status, 400);

    // Individuals: name required, tax code optional (10-digit MST or 12-digit personal ID).
    assert.equal((await put({ buyerType: 'individual', email: 'a@example.com' })).status, 400);
    assert.equal((await put({ buyerType: 'individual', buyerName: 'Trần B', email: 'a@example.com', taxCode: '12345678901' })).status, 400);
    const ind = await put({ buyerType: 'individual', buyerName: 'Trần B', email: 'A@Example.com', taxCode: '001099012345', companyName: 'bỏ qua' });
    assert.equal(ind.status, 200, JSON.stringify(ind.data));
    assert.equal(ind.data.profile.companyName, '');
    assert.equal(ind.data.profile.email, 'a@example.com');

    const branch = await put({ ...COMPANY, taxCode: ' 0312345678-001 ' });
    assert.equal(branch.status, 200);
    assert.equal(branch.data.profile.taxCode, '0312345678-001');
    const saved = await put(COMPANY);
    assert.equal(saved.status, 200);
    assert.deepEqual(
      (await owner('GET', `/api/workspaces/${wsId}/billing-profile`)).data.profile,
      { ...COMPANY, autoInvoice: false, updatedAt: saved.data.profile.updatedAt }
    );
  });

  await t.test('permissions: owner/admin only, tenants isolated', async () => {
    const paid = insertOrder();
    assert.equal((await editor('GET', `/api/workspaces/${wsId}/billing-profile`)).status, 403);
    assert.equal((await editor('PUT', `/api/workspaces/${wsId}/billing-profile`, COMPANY)).status, 403);
    assert.equal((await other('GET', `/api/workspaces/${wsId}/billing-profile`)).status, 404);
    assert.equal((await other('PUT', `/api/workspaces/${wsId}/billing-profile`, COMPANY)).status, 404);
    assert.equal((await request(editor, paid.id)).status, 403);
    assert.equal((await request(other, paid.id)).status, 404);
    assert.equal((await request(owner, 999999)).status, 404);
    assert.equal((await request(client(base), paid.id)).status, 401);
    assert.equal(invoiceRow(paid.id), undefined);
    // Editors still see the status in the order history.
    assert.equal((await editor('GET', `/api/workspaces/${wsId}/orders`)).data.find((o) => o.id === paid.id).invoice, null);
  });

  await t.test('only paid, non-zero orders with a billing profile', async () => {
    for (const status of ['pending', 'cancelled', 'failed']) {
      const r = await request(owner, insertOrder({ status }).id);
      assert.equal(r.status, 400, status);
      assert.match(r.data.error, /đã thanh toán/);
    }
    assert.equal((await request(owner, insertOrder({ amount: 0 }).id)).status, 400);
    const ws2 = (await owner('POST', '/api/workspaces', { name: 'Chưa có hồ sơ' })).data.id;
    const r = await request(owner, insertOrder({ workspaceId: ws2 }).id);
    assert.equal(r.status, 400);
    assert.match(r.data.error, /thông tin xuất hóa đơn/);
  });

  let first;
  await t.test('one request per order, snapshotting the profile', async () => {
    first = insertOrder();
    const r = await request(owner, first.id);
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(r.data.status, 'pending');
    assert.equal(r.data.taxCode, COMPANY.taxCode);
    assert.equal(r.data.companyName, COMPANY.companyName);
    assert.equal(r.data.auto, false);
    assert.equal((await request(owner, first.id)).status, 409);

    // Later profile edits do not change the submitted request.
    await owner('PUT', `/api/workspaces/${wsId}/billing-profile`, { ...COMPANY, companyName: 'Công ty Mới', taxCode: '0399999999' });
    assert.equal(invoiceRow(first.id).company_name, COMPANY.companyName);
    assert.equal(invoiceRow(first.id).tax_code, COMPANY.taxCode);
    const o = (await owner('GET', `/api/workspaces/${wsId}/orders`)).data.find((x) => x.id === first.id);
    assert.deepEqual(o.invoice, { status: 'pending', invoiceNo: null, lookupCode: null, lookupUrl: null, cancelReason: null });
    await owner('PUT', `/api/workspaces/${wsId}/billing-profile`, COMPANY);
  });

  const root = client(base);
  await t.test('platform admin issues or cancels requests', async () => {
    assert.equal((await owner('GET', '/api/admin/invoices')).status, 403);
    await signup(root, 'root@hitechcloud.vn');
    const id = invoiceRow(first.id).id;
    assert.equal((await owner('POST', `/api/admin/invoices/${id}/issue`, { invoiceNo: '1' })).status, 403);

    const pending = await root('GET', '/api/admin/invoices?status=pending');
    assert.equal(pending.status, 200);
    const row = pending.data.find((x) => x.id === id);
    assert.equal(row.order_id, first.id);
    assert.equal(row.amount, 199000);
    assert.equal(row.tax_code, COMPANY.taxCode);
    assert.equal(row.requested_by_email, 'owner@example.com');
    assert.equal((await root('GET', '/api/admin/invoices?status=issued')).data.length, 0);

    assert.equal((await root('POST', `/api/admin/invoices/${id}/issue`, {})).status, 400);
    assert.equal((await root('POST', `/api/admin/invoices/${id}/issue`, { invoiceNo: '123', lookupUrl: 'javascript:alert(1)' })).status, 400);
    assert.equal((await root('POST', '/api/admin/invoices/999999/issue', { invoiceNo: '123' })).status, 404);
    const sent = outbox.length;
    const issued = await root('POST', `/api/admin/invoices/${id}/issue`, {
      invoiceNo: '0000123', lookupCode: 'ABC123XYZ', lookupUrl: 'https://tracuu.example.vn/?ma=ABC123XYZ',
    });
    assert.equal(issued.status, 200, JSON.stringify(issued.data));
    assert.equal(issued.data.status, 'issued');
    assert.equal(outbox.length, sent + 1);
    const mail = outbox.at(-1);
    assert.equal(mail.to, COMPANY.email);
    assert.match(mail.subject, /0000123/);
    assert.match(mail.text, /ABC123XYZ/);
    assert.match(mail.text, /https:\/\/tracuu\.example\.vn/);
    assert.match(mail.text, new RegExp(`#${first.id}`));
    assert.equal((await root('POST', `/api/admin/invoices/${id}/issue`, { invoiceNo: '999' })).status, 409);
    assert.equal((await root('POST', `/api/admin/invoices/${id}/cancel`, { reason: 'Nhầm' })).status, 409);
    assert.equal((await request(owner, first.id)).status, 409, 'issued request cannot be re-sent');

    const o = (await owner('GET', `/api/workspaces/${wsId}/orders`)).data.find((x) => x.id === first.id);
    assert.equal(o.invoice.status, 'issued');
    assert.equal(o.invoice.invoiceNo, '0000123');
    assert.equal(o.invoice.lookupUrl, 'https://tracuu.example.vn/?ma=ABC123XYZ');

    // Cancel with a reason; the customer is told and can send it again.
    const second = insertOrder({ plan: 'business', months: 12, amount: 5990000 });
    await request(owner, second.id);
    const id2 = invoiceRow(second.id).id;
    assert.equal((await root('POST', `/api/admin/invoices/${id2}/cancel`, { reason: ' ' })).status, 400);
    const cancelled = await root('POST', `/api/admin/invoices/${id2}/cancel`, { reason: 'Mã số thuế không khớp tên đơn vị' });
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.data.status, 'cancelled');
    assert.equal(outbox.at(-1).to, COMPANY.email);
    assert.match(outbox.at(-1).text, /Mã số thuế không khớp/);
    assert.equal((await root('POST', `/api/admin/invoices/${id2}/issue`, { invoiceNo: '1' })).status, 409);
    const ord = (await owner('GET', `/api/workspaces/${wsId}/orders`)).data.find((x) => x.id === second.id);
    assert.equal(ord.invoice.cancelReason, 'Mã số thuế không khớp tên đơn vị');

    await owner('PUT', `/api/workspaces/${wsId}/billing-profile`, { ...COMPANY, taxCode: '0312345679' });
    const again = await request(owner, second.id);
    assert.equal(again.status, 201);
    assert.equal(again.data.status, 'pending');
    assert.equal(again.data.taxCode, '0312345679');
    assert.equal(again.data.cancelReason, null);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM invoice_requests WHERE order_id = ?').get(second.id).n, 1);
    await owner('PUT', `/api/workspaces/${wsId}/billing-profile`, COMPANY);
  });

  await t.test('CSV export for accounting', async () => {
    // Spreadsheet formulas in customer input are neutralised.
    await owner('PUT', `/api/workspaces/${wsId}/billing-profile`, { ...COMPANY, companyName: '=HYPERLINK("http://x")' });
    const order = insertOrder({ months: 12, amount: 1990000 });
    await request(owner, order.id);
    await owner('PUT', `/api/workspaces/${wsId}/billing-profile`, COMPANY);

    assert.equal((await owner('GET', '/api/admin/invoices?format=csv')).status, 403);
    const res = await root('GET', '/api/admin/invoices?status=pending&format=csv');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/csv/);
    assert.match(res.headers.get('content-disposition'), /hoa-don-vat-pending-\d{4}-\d{2}-\d{2}\.csv/);
    const lines = res.data.replace(/^﻿/, '').split('\r\n');
    assert.match(lines[0], /"Mã đơn"/);
    assert.match(lines[0], /"Mã số thuế"/);
    assert.match(lines[0], /"Ngày thanh toán \(giờ VN\)"/);
    const row = lines.find((l) => l.includes(`"${order.code}"`));
    assert.ok(row, 'order row present');
    assert.match(row, new RegExp(`^"\\d+","${order.id}","${order.code}","payos","\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}","1990000","Pro","12"`));
    assert.match(row, /"'=HYPERLINK\(""http:\/\/x""\)"/);
    assert.match(row, /"Doanh nghiệp"/);
    assert.match(row, /"Đang xử lý"/);
    // Only pending rows in a pending export.
    assert.ok(!res.data.includes('"Đã xuất"'));
    assert.ok((await root('GET', '/api/admin/invoices?format=csv')).data.includes('"Đã xuất"'));
  });

  await t.test('auto-request on payment snapshots the profile once', async () => {
    const webhook = (order) => {
      const data = { orderCode: Number(order.code), amount: order.amount, description: 'HTC', reference: `REF${order.code}`, code: '00', desc: 'success' };
      return fetch(`${base}/api/billing/webhooks/payos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: '00', desc: 'success', success: true, data, signature: payosLib.signData(data, PAYOS.checksumKey) }),
      });
    };
    // Off by default: paying does not create a request.
    const manual = insertOrder({ status: 'pending' });
    assert.equal((await webhook(manual)).status, 200);
    assert.equal(db.prepare('SELECT status FROM orders WHERE id = ?').get(manual.id).status, 'paid');
    assert.equal(invoiceRow(manual.id), undefined);

    const r = await owner('PUT', `/api/workspaces/${wsId}/billing-profile`, { ...COMPANY, autoInvoice: true });
    assert.equal(r.data.profile.autoInvoice, true);
    const order = insertOrder({ status: 'pending' });
    assert.equal(invoiceRow(order.id), undefined);
    await webhook(order);
    const row = invoiceRow(order.id);
    assert.equal(row.status, 'pending');
    assert.equal(row.auto, 1);
    assert.equal(row.requested_by, null);
    assert.equal(row.tax_code, COMPANY.taxCode);
    // Duplicate delivery keeps fulfil idempotent: still a single request.
    await webhook(order);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM invoice_requests WHERE order_id = ?').get(order.id).n, 1);
    assert.equal((await request(owner, order.id)).status, 409);

    // Fully discounted orders are not invoiced.
    const free = insertOrder({ status: 'pending', amount: 0 });
    await webhook(free);
    assert.equal(db.prepare('SELECT status FROM orders WHERE id = ?').get(free.id).status, 'paid');
    assert.equal(invoiceRow(free.id), undefined);
    await owner('PUT', `/api/workspaces/${wsId}/billing-profile`, COMPANY);
  });

  await t.test('personal data export and workspace deletion', async () => {
    const data = (await owner('GET', '/api/auth/export')).data;
    const ws = data.ownedWorkspaces.find((w) => w.id === wsId);
    assert.equal(ws.billingProfile.tax_code, COMPANY.taxCode);
    assert.ok(ws.invoiceRequests.some((x) => x.order_id === first.id && x.invoice_no === '0000123'));
    assert.ok(data.ownedWorkspaces.some((w) => w.billingProfile === null));

    // Editors do not get the workspace's billing data in their own export.
    const ed = (await editor('GET', '/api/auth/export')).data;
    assert.ok(!JSON.stringify(ed).includes(COMPANY.taxCode));

    assert.equal((await owner('DELETE', `/api/workspaces/${wsId}`)).status, 200);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM billing_profiles WHERE workspace_id = ?').get(wsId).n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM invoice_requests WHERE workspace_id = ?').get(wsId).n, 0);
  });
});
