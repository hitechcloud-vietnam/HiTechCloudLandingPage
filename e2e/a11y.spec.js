'use strict';

const { test, expect, signupAndVerify } = require('./helpers');

// Lightweight accessibility / responsiveness smoke checks (no external engine):
// no console errors, no horizontal scrolling at 375px, every visible form
// control has an accessible label, and the document declares its language.

function watchConsole(page) {
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  return errors;
}

async function auditPage(page) {
  // Let late layout shifts (fonts, async data) settle before measuring.
  await page.waitForLoadState('networkidle');
  return page.evaluate(() => {
    const visible = (el) =>
      !el.closest('[hidden], dialog:not([open])') &&
      el.getClientRects().length > 0 &&
      getComputedStyle(el).visibility !== 'hidden' &&
      el.getAttribute('aria-hidden') !== 'true';
    const hasName = (el) => {
      if ((el.getAttribute('aria-label') || '').trim()) return true;
      const ids = (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
      if (ids.some((id) => (document.getElementById(id)?.textContent || '').trim())) return true;
      if (el.labels && [...el.labels].some((l) => l.textContent.trim())) return true;
      return !!(el.getAttribute('title') || '').trim();
    };
    const unlabeled = [...document.querySelectorAll('input, select, textarea')]
      .filter((el) => !['hidden', 'submit', 'button', 'reset', 'image'].includes(el.type) && visible(el) && !hasName(el))
      .map((el) => el.outerHTML.slice(0, 160));
    const wideElements = [...document.body.querySelectorAll('*')]
      .filter((el) => visible(el) && el.getBoundingClientRect().right > document.documentElement.clientWidth + 1)
      .slice(0, 5)
      .map((el) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${el.className && typeof el.className === 'string' ? `.${el.className.trim().split(/\s+/).join('.')}` : ''}`);
    return {
      lang: document.documentElement.lang,
      title: document.title,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      wideElements,
      unlabeled,
    };
  });
}

async function expectAccessible(page, errors) {
  const audit = await auditPage(page);
  expect(audit.lang, 'html[lang]').toBe('vi');
  expect(audit.title, 'document title').not.toBe('');
  expect(audit.scrollWidth, `horizontal overflow at ${audit.clientWidth}px: ${audit.wideElements.join(', ')}`).toBeLessThanOrEqual(audit.clientWidth);
  expect(audit.unlabeled, 'form controls without a label / aria-label').toEqual([]);
  expect(errors, 'console errors').toEqual([]);
}

test.describe('Khả năng truy cập & hiển thị di động', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  for (const [name, path] of [
    ['trang chủ', '/'],
    ['đăng nhập', '/app/login'],
    ['đăng ký', '/app/signup'],
    ['quên mật khẩu', '/app/forgot'],
  ]) {
    test(`${name} @mobile`, async ({ page }) => {
      const errors = watchConsole(page);
      await page.goto(path);
      await expect(page.locator('h1').first()).toBeVisible();
      await expectAccessible(page, errors);
    });
  }

  test('bảng điều khiển @mobile', async ({ page }) => {
    const errors = watchConsole(page);
    await signupAndVerify(page);
    await expect(page.locator('#ws-name')).not.toHaveText('…');
    await expect(page.locator('#sites .card').first()).toBeVisible();
    await expectAccessible(page, errors);

    // The create-site dialog fits the screen and labels its fields too.
    await page.getByRole('button', { name: /Tạo website/ }).first().click();
    await expect(page.locator('#site-dialog')).toBeVisible();
    await expect(page.locator('#templates input[type="radio"]').first()).toBeVisible();
    await expectAccessible(page, errors);
  });
});
