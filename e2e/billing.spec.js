'use strict';

const crypto = require('node:crypto');
const { test, expect, signupAndVerify, loginAsAdmin, createSiteFromTemplate } = require('./helpers');

// Payment gateways are not configured in the e2e server, so checkout itself is
// not exercised here (it is covered by test/billing.test.js with a mock gateway).
// Instead a platform admin grants Pro and the Pro-only features are checked.
test.describe('Gói dịch vụ', () => {
  test('bảng giá → admin cấp gói Pro → tên miền riêng và A/B testing mở khóa', async ({ page, browser, baseURL, extraHTTPHeaders }) => {
    const user = await signupAndVerify(page, { workspaceName: 'Công ty Nâng Cấp' });
    const site = await createSiteFromTemplate(page, { name: 'Website Pro', template: 'leadgen' });
    const domain = `khuyenmai-${crypto.randomBytes(3).toString('hex')}.example.vn`;

    // Free plan: custom domain and A/B testing are refused.
    await page.getByRole('button', { name: 'Cài đặt' }).click();
    await page.getByLabel('Tên miền riêng').fill(domain);
    await page.getByRole('button', { name: 'Lưu cài đặt' }).click();
    await expect(page.locator('#error')).toContainText(/Tên miền riêng.*gói Pro/);
    await page.getByRole('button', { name: 'A/B testing' }).click();
    await page.locator('#ab-form').getByRole('button', { name: 'Bắt đầu' }).click();
    await expect(page.locator('#error')).toContainText(/A\/B testing.*gói Pro/);

    // Billing tab lists the plans; without a gateway there is no checkout button.
    await page.goto('/app/?tab=billing');
    await expect(page.locator('#current-plan')).toHaveText('Miễn phí');
    const plans = page.locator('#plans');
    for (const name of ['Miễn phí', 'Pro', 'Business']) {
      await expect(plans.getByRole('heading', { name, exact: true })).toBeVisible();
    }
    await expect(plans.getByRole('link', { name: 'Liên hệ nâng cấp' }).first()).toBeVisible();
    await expect(page.locator('#pay-options')).toBeHidden();

    // Platform admin grants Pro for one month from the admin console.
    const adminContext = await browser.newContext({ baseURL, extraHTTPHeaders });
    const admin = await adminContext.newPage();
    await loginAsAdmin(admin);
    await admin.goto('/app/admin');
    await admin.getByPlaceholder(/Tìm theo tên hoặc email/).fill(user.email);
    const row = admin.locator('#workspaces tr', { hasText: user.email });
    await expect(row).toHaveCount(1);
    admin.once('dialog', (dialog) => dialog.accept('1'));
    await row.getByRole('combobox', { name: 'Cấp gói' }).selectOption('pro');
    await expect(row.locator('.badge')).toHaveText('Pro');
    await adminContext.close();

    // The customer now sees Pro with an expiry date.
    await page.reload();
    await expect(page.locator('#current-plan')).toHaveText('Pro');
    await expect(page.locator('#plan-expiry')).toContainText('Hết hạn');
    await expect(page.locator('#ws-plan')).toHaveText('Gói Pro');

    // Custom domain can be saved and shows DNS instructions.
    await page.goto(`/app/site?id=${site.id}`);
    await page.getByRole('button', { name: 'Cài đặt' }).click();
    await page.getByLabel('Tên miền riêng').fill(domain);
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Lưu cài đặt' }).click();
    const domainBox = page.locator('#domain-box');
    await expect(domainBox).toBeVisible();
    await expect(domainBox).toContainText('Chưa xác minh');
    await expect(domainBox).toContainText(`_htc-verify.${domain}`);
    await expect(page.locator('#site-url')).toHaveText(domain);

    // A/B testing: publish the home page and a duplicate, then start a test.
    await page.getByRole('button', { name: 'Trang', exact: true }).click();
    const pages = page.locator('#pages');
    await pages.getByRole('button', { name: 'Xuất bản' }).first().click();
    await expect(pages.getByRole('button', { name: 'Gỡ' })).toHaveCount(1);
    await pages.getByRole('button', { name: 'Nhân bản' }).first().click();
    await expect(pages.locator('tr')).toHaveCount(2);
    await pages.getByRole('button', { name: 'Xuất bản' }).first().click();
    await expect(pages.getByRole('button', { name: 'Gỡ' })).toHaveCount(2);

    await page.reload(); // reload the A/B selects with both published pages
    await page.getByRole('button', { name: 'A/B testing' }).click();
    await expect(page.locator('#ab-b option')).toHaveCount(2);
    await page.locator('#ab-form').getByRole('button', { name: 'Bắt đầu' }).click();
    await expect(page.locator('#ab-list')).toContainText('Đang chạy');
    await expect(page.locator('#error')).toBeEmpty();
  });
});
