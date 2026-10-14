'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const { test: base, expect } = require('@playwright/test');

const PASSWORD = 'e2e-Password-123';
const ADMIN_EMAIL = 'root@e2e.test';

// The app trusts X-Forwarded-For from loopback proxies, so giving every test its
// own client IP keeps the per-IP rate limiters (e.g. 10 signups/hour) from
// leaking between tests, projects and retries.
const test = base.extend({
  extraHTTPHeaders: async ({ extraHTTPHeaders }, use) => {
    const ip = `10.${crypto.randomInt(1, 255)}.${crypto.randomInt(1, 255)}.${crypto.randomInt(1, 255)}`;
    await use({ ...extraHTTPHeaders, 'X-Forwarded-For': ip });
  },
});

function uniqueEmail(prefix = 'user') {
  return `${prefix}-${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}@e2e.test`;
}

function uniqueSub(prefix = 'site') {
  return `${prefix}-${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`;
}

// Emails logged by the mailer (no SMTP configured): `[mail] to=<addr> subject="…"\n<text>`.
function mailsTo(email) {
  let log = '';
  try {
    log = fs.readFileSync(process.env.E2E_LOG_FILE, 'utf8');
  } catch {
    return [];
  }
  return log
    .split('[mail] to=')
    .slice(1)
    .filter((block) => block.startsWith(`${email} `))
    .map((block) => {
      const subject = (/subject="([^"]*)"/.exec(block) || [])[1] || '';
      return { subject, text: block.slice(block.indexOf('\n') + 1) };
    });
}

// Waits for an email to `email` containing a URL matching `pathRe` and returns the newest such URL.
async function mailLink(email, pathRe) {
  const re = new RegExp(`https?://[^\\s]+${pathRe.source}[^\\s]*`);
  let link;
  await expect
    .poll(() => {
      const hits = mailsTo(email)
        .map((m) => re.exec(m.text))
        .filter(Boolean);
      link = hits.length ? hits[hits.length - 1][0] : undefined;
      return link;
    }, { message: `email to ${email} with ${pathRe}` })
    .toBeTruthy();
  return link;
}

// Signs up through the JSON API (sharing cookies with `page`), then follows the
// verification link from the logged email. Leaves the browser on the dashboard.
async function signupAndVerify(page, { email = uniqueEmail(), name = 'Người Dùng E2E', workspaceName = 'Workspace E2E' } = {}) {
  const res = await page.request.post('/api/auth/signup', { data: { name, email, password: PASSWORD, workspaceName } });
  expect(res.status(), await res.text()).toBe(201);
  await page.goto(await mailLink(email, /\/api\/auth\/verify\?token=/));
  await expect(page).toHaveURL(/\/app\/$/);
  await expect(page.locator('#verify-banner')).toBeHidden();
  return { email, name, password: PASSWORD };
}

// Logs in as the platform super-admin (SUPERADMIN_EMAILS), creating it on first use.
async function loginAsAdmin(page) {
  let res = await page.request.post('/api/auth/login', { data: { email: ADMIN_EMAIL, password: PASSWORD } });
  if (res.status() === 401) {
    res = await page.request.post('/api/auth/signup', { data: { name: 'Root', email: ADMIN_EMAIL, password: PASSWORD, workspaceName: 'Platform' } });
    if (res.status() === 409) res = await page.request.post('/api/auth/login', { data: { email: ADMIN_EMAIL, password: PASSWORD } });
  }
  expect(res.ok(), await res.text()).toBeTruthy();
}

// Creates a site from the given template through the dashboard dialog.
// Returns { id, subdomain } and leaves the browser on the site page.
async function createSiteFromTemplate(page, { name = 'Website E2E', subdomain = uniqueSub(), template } = {}) {
  await page.goto('/app/');
  await page.getByRole('button', { name: /Tạo website/ }).first().click();
  const dialog = page.locator('#site-dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('#site-name').fill(name);
  await dialog.locator('#site-sub').fill(subdomain);
  if (template) await dialog.locator(`input[name="template"][value="${template}"]`).check();
  else await expect(dialog.locator('input[name="template"]:checked')).toHaveCount(1);
  await dialog.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/app\/site\?id=\d+/);
  await expect(page.locator('#site-name')).toHaveText(name);
  const id = Number(new URL(page.url()).searchParams.get('id'));
  return { id, subdomain, name };
}

module.exports = { test, expect, PASSWORD, ADMIN_EMAIL, uniqueEmail, uniqueSub, mailsTo, mailLink, signupAndVerify, loginAsAdmin, createSiteFromTemplate };
