'use strict';

const path = require('node:path');
const { test, expect, signupAndVerify, loginAsAdmin, uniqueEmail, mailsTo } = require('./helpers');

// No payment gateway runs in the e2e server, so the paid order is written
// straight into its SQLite database (WAL mode allows a second connection).
function insertPaidOrder(workspaceId) {
  const { DatabaseSync } = require('node:sqlite'); // loaded lazily: only workers that run the test need it
  const db = new DatabaseSync(path.join(process.env.E2E_TMP_DIR, 'e2e.db'));
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    const code = String(Date.now() * 1000 + Math.floor(Math.random() * 1000));
    const info = db
      .prepare(
        `INSERT INTO orders (workspace_id, plan, months, amount, provider, order_code, status, paid_at)
         VALUES (?, 'pro', 12, 1990000, 'payos', ?, 'paid', datetime('now'))`
      )
      .run(workspaceId, code);
    return Number(info.lastInsertRowid);
  } finally {
    db.close();
  }
}

test.describe('Hóa đơn VAT', () => {
  test('khách lưu thông tin xuất hóa đơn → gửi yêu cầu → admin ghi số hóa đơn @mobile', async ({ page, browser, baseURL, extraHTTPHeaders }) => {
    await signupAndVerify(page, { workspaceName: 'Công ty Hóa Đơn' });
    const wsId = (await (await page.request.get('/api/auth/me')).json()).workspaces[0].id;
    const orderId = insertPaidOrder(wsId);
    const company = `Công ty TNHH E2E ${orderId}`;
    const invoiceEmail = uniqueEmail('ketoan');

    await page.goto('/app/?tab=billing');
    const form = page.locator('#invoice-profile-form');
    await expect(form).toBeVisible();
    await form.getByLabel('Loại người mua').selectOption('company');
    await form.getByLabel('Tên đơn vị').fill(company);
    await form.getByLabel('Mã số thuế').fill('0312345678-001');
    await form.getByLabel(/^Địa chỉ/).fill('12 Nguyễn Huệ, Quận 1, TP.HCM');
    await form.getByLabel('Email nhận hóa đơn').fill(invoiceEmail);
    await form.getByRole('button', { name: 'Lưu thông tin' }).click();
    await expect(page.locator('#bp-msg')).toHaveText('Đã lưu thông tin xuất hóa đơn.');

    const row = page.locator('#orders tr', { hasText: `#${orderId}` });
    page.once('dialog', (dialog) => dialog.accept());
    await row.getByRole('button', { name: 'Yêu cầu hóa đơn' }).click();
    await expect(row).toContainText('Đang xử lý');
    await expect(page.locator('#error')).toBeEmpty();

    // Accounting records the invoice issued in their e-invoice software.
    const adminContext = await browser.newContext({ baseURL, extraHTTPHeaders });
    const admin = await adminContext.newPage();
    await loginAsAdmin(admin);
    await admin.goto('/app/admin');
    await admin.getByRole('button', { name: /Hóa đơn VAT/ }).click();
    const req = admin.locator('#invoices tr', { hasText: company });
    await expect(req).toContainText('0312345678-001');
    const answers = ['0000123', 'ABC123XYZ', 'https://tracuu.example.vn/?ma=ABC123XYZ'];
    const answer = (dialog) => dialog.accept(answers.shift());
    admin.on('dialog', answer);
    await req.getByRole('button', { name: 'Đã xuất' }).click();
    await expect(req).toHaveCount(0); // gone from the pending list
    admin.off('dialog', answer);
    await admin.getByLabel('Lọc yêu cầu hóa đơn').selectOption('issued');
    await expect(admin.locator('#invoices tr', { hasText: company })).toContainText('Số 0000123');
    await adminContext.close();

    await expect.poll(() => mailsTo(invoiceEmail).map((m) => m.subject).join('|')).toContain('0000123');

    await page.reload();
    await expect(row).toContainText('Đã xuất – số 0000123');
    await expect(row.getByRole('link', { name: 'Tra cứu hóa đơn' })).toHaveAttribute('href', 'https://tracuu.example.vn/?ma=ABC123XYZ');
  });
});
