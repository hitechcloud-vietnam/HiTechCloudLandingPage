'use strict';

const path = require('node:path');
const { test, expect, PASSWORD, uniqueEmail, uniqueSub, signupAndVerify, createSiteFromTemplate } = require('./helpers');

const PNG = path.join(__dirname, 'fixtures', 'pixel.png');

test.describe('Trình thiết kế', () => {
  test('tạo website từ mẫu → sửa tiêu đề → lưu → tải ảnh → xuất bản', async ({ page, context }) => {
    await signupAndVerify(page);
    const site = await createSiteFromTemplate(page, { name: 'Website Thiết Kế', template: 'saas' });

    await page.getByRole('link', { name: 'Thiết kế' }).first().click();
    await expect(page).toHaveURL(/\/editor\?page=\d+/);
    await expect(page.locator('#title')).toContainText('Website Thiết Kế');

    const canvas = page.frameLocator('#gjs iframe.gjs-frame');
    const heading = canvas.locator('h1').first();
    await expect(heading).toBeVisible();

    // Edit the hero heading with the rich text editor.
    const newTitle = 'Tiêu đề kiểm thử E2E';
    await heading.dblclick();
    await expect(heading).toHaveAttribute('contenteditable', 'true');
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type(newTitle);
    await canvas.locator('section p').first().click(); // leaves the RTE, committing the text
    await expect(heading).toHaveText(newTitle);

    // Insert an image and pick its source by uploading through the asset manager.
    // (GrapesJS' own block drag-and-drop is too timing-sensitive for CI, so the
    // empty image component is added through its API; the rest is plain UI.)
    await page.evaluate(() => {
      const editor = window.grapesjs.editors[window.grapesjs.editors.length - 1];
      editor.getWrapper().append({ type: 'image', attributes: { id: 'e2e-image' } }, { at: 0 });
    });
    await canvas.locator('#e2e-image').dblclick();
    const modal = page.locator('.gjs-mdl-container');
    await expect(modal).toBeVisible();
    await modal.locator('input[type="file"]').setInputFiles(PNG);
    await expect(page.locator('#status')).toHaveText('Đã tải ảnh lên');
    const asset = modal.locator('.gjs-am-asset').first();
    await expect(asset).toBeVisible();
    await asset.dblclick(); // select + close
    await expect(modal).toBeHidden();
    const image = canvas.locator('#e2e-image');
    await expect(image).toHaveAttribute('src', /^\/uploads\/.+\.png$/);
    const src = await image.getAttribute('src');
    const served = await page.request.get(src);
    expect(served.status()).toBe(200);
    expect(served.headers()['content-type']).toContain('image/png');

    // Save with Ctrl/Cmd+S (focus back on the editor chrome first).
    await page.locator('#title').click();
    await page.keyboard.press('ControlOrMeta+s');
    await expect(page.locator('#status')).toHaveText('Đã lưu');

    // Publish; the success confirm() offers to open the page — decline it.
    page.once('dialog', (dialog) => dialog.dismiss());
    await page.getByRole('button', { name: 'Xuất bản' }).click();
    await expect(page.locator('#status')).toHaveText('Đã xuất bản');

    const live = await context.newPage();
    const res = await live.goto(`/p/${site.subdomain}/`);
    expect(res.status()).toBe(200);
    await expect(live.locator('h1').first()).toHaveText(newTitle);
    await expect(live.locator(`img[src="${src}"]`)).toHaveCount(1);
    await live.close();

    // The dashboard shows the page as published.
    await page.goto(`/app/site?id=${site.id}`);
    await expect(page.locator('#pages')).toContainText('Đã xuất bản');
  });

  test('chưa xác minh email thì không xuất bản được', async ({ page }) => {
    const email = uniqueEmail('unverified');
    const signup = await page.request.post('/api/auth/signup', { data: { name: 'Chưa Xác Minh', email, password: PASSWORD } });
    expect(signup.status()).toBe(201);
    await page.goto('/app/');
    await expect(page.locator('#verify-banner')).toBeVisible();

    await createSiteFromTemplate(page, { subdomain: uniqueSub('unverified') });
    await page.locator('#pages').getByRole('button', { name: 'Xuất bản' }).first().click();
    await expect(page.locator('#error')).toContainText('xác minh email');
    await expect(page.locator('#pages')).toContainText('Bản nháp');
  });
});
