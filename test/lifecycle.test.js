'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, verifyEmail, APP_URL } = require('./helpers');
const { createMailer } = require('../src/mailer');
const lifecycle = require('../src/lifecycle');

const WELCOME = 'Chào mừng bạn đến với HiTechCloud LandingPage';
const sqlTime = (date) => date.toISOString().replace('T', ' ').slice(0, 19);

async function signup(c, email, name = 'Chủ') {
  const r = await c('POST', '/api/auth/signup', { name, email, password: 'matkhau123' });
  assert.equal(r.status, 201);
  return (await c('GET', '/api/auth/me')).data;
}

const userId = (db, email) => db.prepare('SELECT id FROM users WHERE email = ?').get(email).id;
const unsubToken = (mail) => /\/email\/unsubscribe\?token=([^\s]+)/.exec(mail.text)[1];

test('onboarding checklist: steps, completion and dismissal', async (t) => {
  const { server, base, db } = await startServer();
  t.after(() => server.close());
  const c = client(base);
  const wsId = (await signup(c, 'owner@example.com')).workspaces[0].id;
  const status = async () => (await c('GET', `/api/workspaces/${wsId}/onboarding`)).data;
  const done = (o) => Object.fromEntries(o.steps.map((s) => [s.id, s.done]));

  await t.test('fresh account: nothing done, card visible', async () => {
    const o = await status();
    assert.deepEqual(o.steps.map((s) => s.id), ['verify_email', 'create_site', 'publish_page', 'first_lead', 'lead_notify', 'custom_domain']);
    assert.ok(o.steps.every((s) => !s.done));
    assert.deepEqual([o.completed, o.total, o.allDone, o.visible, o.dismissed], [0, 5, false, true, false]);
    const domain = o.steps.find((s) => s.id === 'custom_domain');
    assert.equal(domain.optional, true);
    assert.equal(domain.available, false); // free plan
  });

  let site;
  await t.test('steps follow real progress', async () => {
    verifyEmail(db, 'owner@example.com');
    site = (await c('POST', `/api/workspaces/${wsId}/sites`, { name: 'Shop', subdomain: 'shop', template: 'leadgen' })).data;
    let o = await status();
    assert.deepEqual(done(o), { verify_email: true, create_site: true, publish_page: false, first_lead: false, lead_notify: false, custom_domain: false });
    assert.equal(o.firstSiteId, site.id);

    const page = (await c('GET', `/api/sites/${site.id}/pages`)).data[0];
    assert.equal((await c('POST', `/api/pages/${page.id}/publish`, {})).status, 200);

    // Spam does not count as the first lead.
    const lead = db.prepare('INSERT INTO leads (site_id, page_slug, data_json, status) VALUES (?, ?, ?, ?)');
    lead.run(site.id, 'index', '{}', 'spam');
    o = await status();
    assert.equal(done(o).publish_page, true);
    assert.equal(done(o).first_lead, false);
    lead.run(site.id, 'index', '{}', 'new');
    assert.equal(done(await status()).first_lead, true);

    // Default owner emails do not count; an explicit channel does.
    assert.equal((await c('PATCH', `/api/sites/${site.id}/settings`, { notifyOwners: true })).status, 200);
    assert.equal(done(await status()).lead_notify, false);
    assert.equal((await c('PATCH', `/api/sites/${site.id}/settings`, { notifyEmails: 'sales@example.com' })).status, 200);
    o = await status();
    assert.equal(done(o).lead_notify, true);

    // All required steps done: the card hides itself; the optional domain stays open.
    assert.deepEqual([o.completed, o.allDone, o.visible], [5, true, false]);
    assert.equal(done(o).custom_domain, false);
    db.prepare("UPDATE sites SET custom_domain = 'shop.example.com', domain_verified_at = datetime('now') WHERE id = ?").run(site.id);
    assert.equal(done(await status()).custom_domain, true);
  });

  await t.test('dismissal is per user and workspace', async () => {
    const ws2 = (await c('POST', '/api/workspaces', { name: 'Khách hàng B' })).data.id;
    const path = `/api/workspaces/${ws2}/onboarding`;
    assert.equal((await c('GET', path)).data.visible, true);
    assert.equal((await c('POST', `${path}/dismiss`, 'x', { raw: true, headers: { 'Content-Type': 'text/plain' } })).status, 415);
    assert.equal((await c('POST', `${path}/dismiss`, {})).status, 200);
    assert.equal((await c('POST', `${path}/dismiss`, {})).status, 200); // idempotent
    const o = (await c('GET', path)).data;
    assert.deepEqual([o.dismissed, o.visible], [true, false]);

    // A teammate still sees it; outsiders get 404.
    db.prepare("UPDATE workspaces SET plan = 'pro' WHERE id = ?").run(ws2);
    const ed = client(base);
    await signup(ed, 'editor@example.com', 'Ed');
    assert.equal((await c('POST', `/api/workspaces/${ws2}/members`, { email: 'editor@example.com' })).data.status, 'added');
    assert.equal((await ed('GET', path)).data.visible, true);
    const stranger = client(base);
    await signup(stranger, 'stranger@example.com', 'Lạ');
    assert.equal((await stranger('GET', path)).status, 404);
    assert.equal((await stranger('POST', `${path}/dismiss`, {})).status, 404);
    assert.equal((await client(base)('GET', path)).status, 401);
  });
});

test('welcome email is sent right after signup, once', async (t) => {
  const { server, base, db, outbox, config } = await startServer();
  t.after(() => server.close());
  const c = client(base);
  await signup(c, 'new@example.com', 'Lan');

  const mails = outbox.filter((m) => m.to === 'new@example.com');
  assert.deepEqual(mails.map((m) => m.subject), [WELCOME, 'Xác minh địa chỉ email HiTechCloud']);
  const welcome = mails[0];
  assert.match(welcome.text, /^Chào Lan,/);
  assert.match(welcome.text, /\n1\. .+\n2\. .+\n3\. /);
  assert.ok(welcome.text.includes(`${APP_URL}/app/`));
  assert.doesNotMatch(welcome.text, /unsubscribe/); // transactional
  assert.ok(db.prepare('SELECT welcome_sent_at FROM users WHERE email = ?').get('new@example.com').welcome_sent_at);

  // The hourly sweep does not resend, but catches recent accounts that missed it.
  const mailer = createMailer({ quietMail: true });
  assert.equal(lifecycle.sendWelcomeEmails({ db, mailer, config }), 0);
  await signup(client(base), 'missed@example.com');
  await signup(client(base), 'old@example.com');
  await signup(client(base), 'banned@example.com');
  db.prepare("UPDATE users SET welcome_sent_at = NULL WHERE email IN ('missed@example.com', 'old@example.com', 'banned@example.com')").run();
  db.prepare("UPDATE users SET created_at = datetime('now', '-5 days') WHERE email = 'old@example.com'").run();
  db.prepare("UPDATE users SET suspended_at = datetime('now') WHERE email = 'banned@example.com'").run();
  assert.equal(lifecycle.sendWelcomeEmails({ db, mailer, config }), 1);
  assert.deepEqual(mailer.outbox.map((m) => m.to), ['missed@example.com']);
  assert.equal(lifecycle.sendWelcomeEmails({ db, mailer, config }), 0);
});

test('activation nudge: 3 days after signup, unpublished owners only, once ever', async (t) => {
  const { server, base, db, config } = await startServer();
  t.after(() => server.close());
  const now = new Date('2026-10-14T03:00:00Z');
  const age = (email, days) => db.prepare('UPDATE users SET created_at = ? WHERE email = ?').run(sqlTime(new Date(now - days * 86400_000)), email);

  const owner = client(base);
  await signup(owner, 'idle@example.com', 'Minh');
  const publisher = client(base);
  const wsP = (await signup(publisher, 'active@example.com')).workspaces[0].id;
  verifyEmail(db, 'active@example.com');
  const site = (await publisher('POST', `/api/workspaces/${wsP}/sites`, { name: 'Live', subdomain: 'live', template: 'leadgen' })).data;
  const page = (await publisher('GET', `/api/sites/${site.id}/pages`)).data[0];
  assert.equal((await publisher('POST', `/api/pages/${page.id}/publish`, {})).status, 200);
  for (const email of ['optout@example.com', 'banned@example.com', 'ancient@example.com']) await signup(client(base), email);
  db.prepare("UPDATE users SET email_tips = 0 WHERE email = 'optout@example.com'").run();
  db.prepare("UPDATE users SET suspended_at = datetime('now') WHERE email = 'banned@example.com'").run();

  const mailer = createMailer({ quietMail: true });
  const run = () => lifecycle.sendActivationNudges({ db, mailer, config, now });

  for (const email of ['idle@example.com', 'active@example.com', 'optout@example.com', 'banned@example.com']) age(email, 2);
  age('ancient@example.com', 30);
  assert.equal(run(), 0, 'too early');

  for (const email of ['idle@example.com', 'active@example.com', 'optout@example.com', 'banned@example.com']) age(email, 3.1);
  assert.equal(run(), 1);
  assert.deepEqual(mailer.outbox.map((m) => m.to), ['idle@example.com']);
  const mail = mailer.outbox[0];
  assert.match(mail.text, /^Chào Minh,/);
  assert.match(mail.text, /Xác minh email/); // still unverified
  assert.match(mail.text, /Tạo website/); // no site yet
  assert.ok(mail.text.includes(`${APP_URL}/app/`));
  assert.match(mail.headers['List-Unsubscribe'], /^<http:\/\/localhost:3999\/email\/unsubscribe\?token=\d+\.tips\./);
  assert.equal(lifecycle.verifyUnsubscribeToken(config, unsubToken(mail)).kind, 'tips');

  // Once ever, even days later or after re-opting in.
  age('idle@example.com', 5);
  assert.equal(run(), 0);
  db.prepare("UPDATE users SET email_tips = 1 WHERE email = 'optout@example.com'").run();
  assert.equal(run(), 1);
  assert.equal(run(), 0);
  assert.deepEqual(mailer.outbox.map((m) => m.to), ['idle@example.com', 'optout@example.com']);
});

test('weekly lead digest', async (t) => {
  const { server, base, db, config } = await startServer();
  t.after(() => server.close());

  const c = client(base);
  const wsId = (await signup(c, 'owner@example.com', 'Chủ')).workspaces[0].id;
  db.prepare("UPDATE workspaces SET plan = 'pro' WHERE id = ?").run(wsId);
  const add = async (email, name, role) => {
    await signup(client(base), email, name);
    assert.equal((await c('POST', `/api/workspaces/${wsId}/members`, { email, role })).data.status, 'added');
  };
  await add('admin@example.com', 'Quản trị', 'admin');
  await add('quiet@example.com', 'Im lặng', 'admin');
  await add('banned@example.com', 'Bị khóa', 'admin');
  await add('editor@example.com', 'Biên tập', 'editor');
  db.prepare("UPDATE users SET email_digest = 0 WHERE email = 'quiet@example.com'").run();
  db.prepare("UPDATE users SET suspended_at = datetime('now') WHERE email = 'banned@example.com'").run();

  const shop = (await c('POST', `/api/workspaces/${wsId}/sites`, { name: 'Shop', subdomain: 'shop', template: 'blank' })).data;
  const blog = (await c('POST', `/api/workspaces/${wsId}/sites`, { name: 'Blog', subdomain: 'blog', template: 'blank' })).data;
  const pageOf = async (s) => (await c('GET', `/api/sites/${s.id}/pages`)).data[0].id;
  const views = db.prepare('INSERT INTO page_views (page_id, day, views) VALUES (?, ?, ?)');
  views.run(await pageOf(shop), '2026-10-05', 150);
  views.run(await pageOf(shop), '2026-10-11', 50);
  views.run(await pageOf(blog), '2026-10-08', 100);
  views.run(await pageOf(shop), '2026-10-01', 100); // previous week
  views.run(await pageOf(shop), '2026-10-12', 999); // this week, not reported yet

  const lead = db.prepare('INSERT INTO leads (site_id, page_slug, data_json, source_json, status, created_at) VALUES (?, ?, ?, ?, ?, ?)');
  const src = (o) => JSON.stringify(o);
  // Week of Mon 05/10 – Sun 11/10 in Asia/Ho_Chi_Minh = 2026-10-04 17:00 UTC … 2026-10-11 17:00 UTC.
  lead.run(shop.id, 'index', '{}', src({ utm_source: 'Facebook' }), 'new', '2026-10-04 17:00:00'); // Mon 00:00 local
  lead.run(shop.id, 'index', '{}', src({ utm_source: 'facebook' }), 'won', '2026-10-08 09:00:00');
  lead.run(shop.id, 'index', '{}', src({ utm_source: 'zalo' }), 'contacted', '2026-10-09 09:00:00');
  lead.run(shop.id, 'index', '{}', src({ ref: 'https://www.google.com/search?q=x' }), 'new', '2026-10-10 09:00:00');
  lead.run(blog.id, 'index', '{}', '{}', 'new', '2026-10-11 16:59:59'); // Sun 23:59:59 local
  lead.run(shop.id, 'index', '{}', src({ utm_source: 'spamsrc' }), 'spam', '2026-10-09 10:00:00');
  lead.run(shop.id, 'index', '{}', src({ utm_source: 'spamsrc' }), 'spam', '2026-10-09 11:00:00');
  lead.run(shop.id, 'index', '{}', '{}', 'new', '2026-10-04 16:59:59'); // previous week (Sun 23:59:59 local)
  lead.run(shop.id, 'index', '{}', '{}', 'new', '2026-10-11 17:00:00'); // Mon 00:00 local: next week

  // A workspace without views or leads gets nothing.
  const other = client(base);
  const ws2 = (await signup(other, 'empty@example.com')).workspaces[0].id;
  await other('POST', `/api/workspaces/${ws2}/sites`, { name: 'Trống', subdomain: 'trong', template: 'blank' });

  const mailer = createMailer({ quietMail: true });
  const run = (iso) => lifecycle.sendWeeklyDigests({ db, mailer, config, now: new Date(iso) });

  await t.test('only on Monday morning, Vietnam time', () => {
    assert.equal(lifecycle.digestPeriod(new Date('2026-10-12T00:59:00Z')), null); // Mon 07:59 local
    assert.equal(lifecycle.digestPeriod(new Date('2026-10-11T18:00:00Z')), null); // Mon 01:00 local
    assert.equal(lifecycle.digestPeriod(new Date('2026-10-13T02:00:00Z')), null); // Tuesday
    assert.equal(lifecycle.digestPeriod(new Date('2026-10-12T17:30:00Z')), null); // Tue 00:30 local
    const p = lifecycle.digestPeriod(new Date('2026-10-12T16:59:00Z')); // Mon 23:59 local
    assert.equal(p.week, '2026-10-12');
    assert.deepEqual(p.current, { from: '2026-10-05', to: '2026-10-11', start: '2026-10-04 17:00:00', end: '2026-10-11 17:00:00' });
    assert.deepEqual([p.previous.from, p.previous.to], ['2026-09-28', '2026-10-04']);
    assert.equal(run('2026-10-12T00:30:00Z'), 0);
    assert.equal(mailer.outbox.length, 0);
  });

  await t.test('content, recipients and spam exclusion', () => {
    assert.equal(run('2026-10-12T02:00:00Z'), 2);
    assert.deepEqual(mailer.outbox.map((m) => m.to).sort(), ['admin@example.com', 'owner@example.com']);
    const mail = mailer.outbox.find((m) => m.to === 'owner@example.com');
    assert.match(mail.subject, /^Tóm tắt tuần 05\/10–11\/10\/2026: 5 lead mới/);
    const text = mail.text;
    assert.match(text, /^Chào Chủ,/);
    assert.match(text, /05\/10\/2026 – 11\/10\/2026/);
    assert.match(text, /• 5 lead mới \(tuần trước: 1\)/);
    assert.match(text, /• 300 lượt xem trang \(tuần trước: 100\)/);
    assert.match(text, /Tỷ lệ chuyển đổi: 1,67% \(tuần trước: 1%, \+0,67 điểm %\)/);
    assert.match(text, /• Shop: 4 lead · 200 lượt xem · tỷ lệ 2%/);
    assert.match(text, /• Blog: 1 lead · 100 lượt xem · tỷ lệ 1%/);
    assert.match(text, /• facebook: 2 lead\n• google\.com: 1 lead\n• Trực tiếp: 1 lead/);
    assert.doesNotMatch(text, /spamsrc|zalo/); // spam excluded; top 3 only
    assert.ok(text.includes(`${APP_URL}/app/`));
    assert.match(text, /Hủy nhận loại email này: http:\/\/localhost:3999\/email\/unsubscribe\?token=\d+\.digest\./);
    assert.ok(!mailer.outbox.some((m) => m.to === 'empty@example.com'));
  });

  await t.test('never twice for the same week', () => {
    assert.equal(run('2026-10-12T05:00:00Z'), 0);
    assert.equal(run('2026-10-12T16:00:00Z'), 0);
    assert.equal(mailer.outbox.length, 2);
    assert.equal(db.prepare('SELECT digest_week FROM workspaces WHERE id = ?').get(wsId).digest_week, '2026-10-12');
  });

  await t.test('next week: opt-out honoured', () => {
    db.prepare("UPDATE users SET email_digest = 0 WHERE email = 'admin@example.com'").run();
    assert.equal(run('2026-10-19T01:00:00Z'), 1); // the Mon 00:00 local lead
    assert.equal(mailer.outbox.at(-1).to, 'owner@example.com');
    assert.match(mailer.outbox.at(-1).text, /• 1 lead mới \(tuần trước: 5\)/);
    assert.equal(run('2026-10-26T01:00:00Z'), 0); // nothing at all that week
  });
});

test('unsubscribe links and email preferences', async (t) => {
  const { server, base, db, config } = await startServer();
  t.after(() => server.close());
  const c = client(base);
  await signup(c, 'owner@example.com');
  const id = userId(db, 'owner@example.com');
  const prefs = async () => (await c('GET', '/api/auth/email-preferences')).data;

  await t.test('preferences API', async () => {
    assert.deepEqual(await prefs(), { digest: true, tips: true });
    assert.deepEqual((await c('PUT', '/api/auth/email-preferences', { tips: false })).data, { digest: true, tips: false });
    assert.equal((await c('PUT', '/api/auth/email-preferences', { digest: 'no' })).status, 400);
    assert.deepEqual((await c('PUT', '/api/auth/email-preferences', { digest: true, tips: true })).data, { digest: true, tips: true });
    assert.equal((await client(base)('GET', '/api/auth/email-preferences')).status, 401);
  });

  await t.test('tampered or malformed tokens are rejected', async () => {
    const token = lifecycle.unsubscribeToken(config, id, 'digest');
    const [, kind, mac] = token.split('.');
    const flip = mac[0] === 'A' ? 'B' : 'A';
    for (const bad of [
      `${id + 1}.${kind}.${mac}`, // other user
      `${id}.tips.${mac}`, // other kind
      `${id}.${kind}.${flip}${mac.slice(1)}`, // forged mac
      `${id}.${kind}.${mac.slice(0, -1)}`,
      `${id}.all.${mac}`,
      '',
    ]) {
      assert.equal(lifecycle.verifyUnsubscribeToken(config, bad), null, bad);
      const r = await fetch(`${base}/email/unsubscribe?token=${encodeURIComponent(bad)}`);
      assert.equal(r.status, 400);
      assert.match(await r.text(), /Liên kết không hợp lệ/);
    }
    // A token signed with another key is worthless.
    assert.equal(lifecycle.verifyUnsubscribeToken({ ...config, leadSecret: 'khac' }, token), null);
    assert.deepEqual(await prefs(), { digest: true, tips: true });
  });

  await t.test('valid links switch off one kind each', async () => {
    const r = await fetch(`${base}/email/unsubscribe?token=${lifecycle.unsubscribeToken(config, id, 'digest')}`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /html/);
    assert.match(await r.text(), /Tóm tắt lead hằng tuần/);
    assert.deepEqual(await prefs(), { digest: false, tips: true });

    // RFC 8058 one-click POST (no session, no Origin).
    const post = await fetch(`${base}/email/unsubscribe?token=${lifecycle.unsubscribeToken(config, id, 'tips')}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'List-Unsubscribe=One-Click',
    });
    assert.equal(post.status, 200);
    assert.deepEqual(await prefs(), { digest: false, tips: false });

    // Deleted accounts: the link no longer works.
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    assert.equal((await fetch(`${base}/email/unsubscribe?token=${lifecycle.unsubscribeToken(config, id, 'tips')}`)).status, 400);
  });
});

test('suspended and deleted users never get lifecycle email', async (t) => {
  const { server, base, db, config } = await startServer();
  t.after(() => server.close());
  const c = client(base);
  const wsId = (await signup(c, 'bad@example.com')).workspaces[0].id;
  const site = (await c('POST', `/api/workspaces/${wsId}/sites`, { name: 'S', subdomain: 'sus', template: 'blank' })).data;
  const page = (await c('GET', `/api/sites/${site.id}/pages`)).data[0];
  db.prepare("INSERT INTO page_views (page_id, day, views) VALUES (?, '2026-10-06', 10)").run(page.id);
  db.prepare("INSERT INTO leads (site_id, page_slug, data_json, created_at) VALUES (?, 'index', '{}', '2026-10-06 03:00:00')").run(site.id);
  db.prepare("UPDATE users SET suspended_at = datetime('now'), welcome_sent_at = NULL, created_at = '2026-10-09 00:00:00' WHERE email = 'bad@example.com'").run();
  await signup(client(base), 'gone@example.com');
  db.prepare("DELETE FROM users WHERE email = 'gone@example.com'").run();

  const mailer = createMailer({ quietMail: true });
  const now = new Date('2026-10-12T02:00:00Z');
  const signupDay = new Date('2026-10-10T00:00:00Z'); // within the welcome catch-up window
  assert.equal(lifecycle.sendWelcomeEmails({ db, mailer, config, now: signupDay }), 0);
  assert.equal(lifecycle.sendActivationNudges({ db, mailer, config, now }), 0);
  assert.equal(lifecycle.sendWeeklyDigests({ db, mailer, config, now }), 0);
  assert.equal(mailer.outbox.length, 0);

  // Lifted suspension: the same jobs pick the account up again.
  db.prepare("UPDATE users SET suspended_at = NULL WHERE email = 'bad@example.com'").run();
  db.prepare('UPDATE workspaces SET digest_week = NULL').run();
  assert.equal(lifecycle.sendWelcomeEmails({ db, mailer, config, now: signupDay }), 1);
  assert.equal(lifecycle.sendActivationNudges({ db, mailer, config, now }), 1);
  assert.equal(lifecycle.sendWeeklyDigests({ db, mailer, config, now }), 1);
  assert.deepEqual(mailer.outbox.map((m) => m.to), ['bad@example.com', 'bad@example.com', 'bad@example.com']);
});

test('unsubscribe endpoint is rate limited per IP', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());
  const statuses = [];
  for (let i = 0; i < 21; i++) statuses.push((await fetch(`${base}/email/unsubscribe?token=sai`)).status);
  assert.deepEqual([...new Set(statuses.slice(0, 20))], [400]);
  assert.equal(statuses[20], 429);
});
