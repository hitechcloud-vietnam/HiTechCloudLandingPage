'use strict';

const { test, expect, PASSWORD, uniqueEmail, mailLink, mailsTo } = require('./helpers');

test.describe('Tài khoản', () => {
  test('đăng ký → xác minh email → đăng xuất → đăng nhập @mobile', async ({ page }) => {
    const email = uniqueEmail('signup');

    await page.goto('/app/signup');
    await page.getByLabel('Họ và tên').fill('Nguyễn Văn E2E');
    await page.getByLabel('Tên doanh nghiệp / workspace').fill('Công ty E2E');
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Mật khẩu', { exact: true }).fill(PASSWORD);
    await page.locator('#agree').check();
    await page.getByRole('button', { name: 'Đăng ký' }).click();

    // Fresh account: dashboard asks to verify the email address.
    await expect(page).toHaveURL(/\/app\/$/);
    await expect(page.locator('#ws-name')).toHaveText('Công ty E2E');
    const banner = page.locator('#verify-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(email);

    // A forged link is rejected and the account stays unverified.
    await page.goto('/api/auth/verify?token=khong-hop-le');
    await expect(page.locator('#error')).toContainText('không hợp lệ');
    await expect(banner).toBeVisible();

    // Follow the link from the (logged) verification email.
    const link = await mailLink(email, /\/api\/auth\/verify\?token=/);
    expect(mailsTo(email).at(-1).subject).toMatch(/xác minh/i);
    await page.goto(link);
    await expect(page).toHaveURL(/\/app\/$/);
    await expect(page.locator('#verify-notice')).toContainText('Đã xác minh email');
    await expect(banner).toBeHidden();

    // Logout, then protected pages bounce to the login page.
    await page.getByRole('button', { name: 'Đăng xuất' }).click();
    await expect(page).toHaveURL(/\/app\/login/);
    await page.goto('/app/');
    await expect(page).toHaveURL(/\/app\/login/);

    // Wrong password shows an error and stays on the login page.
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Mật khẩu', { exact: true }).fill('sai-mat-khau');
    await page.getByRole('button', { name: 'Đăng nhập' }).click();
    await expect(page.locator('#error')).toContainText('không đúng');

    await page.getByLabel('Mật khẩu', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Đăng nhập' }).click();
    await expect(page).toHaveURL(/\/app\/$/);
    await expect(page.locator('#ws-name')).toHaveText('Công ty E2E');
    await expect(page.locator('#verify-banner')).toBeHidden();
  });

  test('quên mật khẩu gửi email và đặt lại được mật khẩu @mobile', async ({ page }) => {
    const email = uniqueEmail('forgot');
    const signup = await page.request.post('/api/auth/signup', { data: { name: 'Quên Mật Khẩu', email, password: PASSWORD, acceptTerms: true } });
    expect(signup.status()).toBe(201);
    await page.context().clearCookies();

    await page.goto('/app/login');
    await page.getByRole('link', { name: 'Quên mật khẩu?' }).click();
    await expect(page).toHaveURL(/\/app\/forgot/);
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByRole('button', { name: 'Gửi liên kết' }).click();
    await expect(page.locator('#done')).toContainText('liên kết đặt lại mật khẩu đã được gửi');

    const link = await mailLink(email, /\/app\/reset\?token=/);
    const newPassword = 'Mat-khau-moi-456';
    await page.goto(link);
    await page.getByLabel('Mật khẩu mới', { exact: true }).fill(newPassword);
    await page.getByLabel('Nhập lại mật khẩu', { exact: true }).fill(newPassword);
    await page.getByRole('button', { name: 'Cập nhật mật khẩu' }).click();
    // A successful reset signs the user in and opens the dashboard.
    await expect(page).toHaveURL(/\/app\/$/);
    await expect(page.locator('#user-name')).toHaveText('Quên Mật Khẩu');

    // The new password works for a fresh login.
    await page.context().clearCookies();
    await page.goto('/app/login');
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Mật khẩu', { exact: true }).fill(newPassword);
    await page.getByRole('button', { name: 'Đăng nhập' }).click();
    await expect(page).toHaveURL(/\/app\/$/);
    await expect(page.locator('#user-name')).toHaveText('Quên Mật Khẩu');
  });
});
