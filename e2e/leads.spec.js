'use strict';

const { test, expect, signupAndVerify, createSiteFromTemplate } = require('./helpers');

test.describe('Thu lead', () => {
  test('gửi form trên trang đã xuất bản kèm UTM → lead hiện trong dashboard @mobile', async ({ page, context }) => {
    await signupAndVerify(page);
    const site = await createSiteFromTemplate(page, { name: 'Website Thu Lead', template: 'leadgen' });

    // Publish the home page from the pages table.
    await page.locator('#pages').getByRole('button', { name: 'Xuất bản' }).first().click();
    await expect(page.locator('#pages')).toContainText('Đã xuất bản');

    // A visitor arrives from an ad campaign and fills in the form.
    const visitor = await context.newPage();
    await visitor.goto(`/p/${site.subdomain}/?utm_source=facebook&utm_medium=cpc&utm_campaign=tet2026`);
    const form = visitor.locator('form').first();
    await form.locator('input[name="name"]').fill('Trần Thị Khách');
    await form.locator('input[name="phone"]').fill('0901234567');
    await form.locator('input[name="email"]').fill('khach@e2e.test');
    await form.locator('[type="submit"]').click();
    await expect(visitor).toHaveURL(/submitted=1/);
    await expect(visitor.getByText('Cảm ơn bạn! Thông tin đã được gửi thành công.')).toBeVisible();
    await visitor.close();

    // The lead shows up in the site's leads tab with its attribution.
    await page.reload();
    await page.getByRole('button', { name: 'Khách hàng tiềm năng' }).click();
    const row = page.locator('#leads tr', { hasText: 'Trần Thị Khách' });
    await expect(row).toBeVisible();
    await expect(row).toContainText('0901234567');
    await expect(row).toContainText('facebook / cpc / tet2026');

    // Move it through the pipeline; the change persists.
    const status = row.locator('select[data-status]');
    await expect(status).toHaveValue('new');
    const saved = page.waitForResponse((r) => /\/api\/leads\/\d+$/.test(r.url()) && r.request().method() === 'PATCH');
    await status.selectOption('contacted');
    expect((await saved).ok()).toBeTruthy();
    await page.reload();
    await page.getByRole('button', { name: 'Khách hàng tiềm năng' }).click();
    await expect(page.locator('#leads tr', { hasText: 'Trần Thị Khách' }).locator('select[data-status]')).toHaveValue('contacted');

    // Filtering by status finds it.
    await page.locator('#lead-filters select[name="status"]').selectOption('contacted');
    await page.locator('#lead-filters').getByRole('button', { name: 'Lọc' }).click();
    await expect(page.locator('#lead-count')).toHaveText('1 khách hàng');
  });
});
