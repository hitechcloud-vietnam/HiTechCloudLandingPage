'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const helpers = require('./helpers');
const guard = require('../src/leadGuard');
const siteSettings = require('../src/siteSettings');
const { leadsThisMonth } = require('../src/usage');

const { startServer, client } = helpers;
const SECRET = 'test-secret';

test('normalizePhone accepts Vietnamese mobile and landline formats', () => {
  const valid = {
    '0901234567': '0901234567',
    '090 123 4567': '0901234567',
    '090.123.4567': '0901234567',
    '090-123-4567': '0901234567',
    ' 0901 234 567 ': '0901234567',
    '+84901234567': '0901234567',
    '+84 90 123 4567': '0901234567',
    '+84 0901234567': '0901234567',
    '84901234567': '0901234567',
    '0381234567': '0381234567',
    '0561234567': '0561234567',
    '0771234567': '0771234567',
    '0812345678': '0812345678',
    '0987654321': '0987654321',
    '02838123456': '02838123456',
    '(028) 3812 3456': '02838123456',
    '024.3812.3456': '02438123456',
    '+842438123456': '02438123456',
    '842838123456': '02838123456',
  };
  for (const [input, expected] of Object.entries(valid)) assert.equal(guard.normalizePhone(input), expected, input);
  const invalid = ['', '0901', '09', '09012345678', '0123456789', '0101234567', '0601234567', '0412345678', '1900123456',
    '901234567', '+1 415 555 1234', 'abc', '0901abc567', '=1+2', '0283812345', null, undefined];
  for (const input of invalid) assert.equal(guard.normalizePhone(input), null, String(input));
});

test('phone and email field detection, email syntax', () => {
  for (const name of ['phone', 'Phone', 'sdt', 'SDT', 'so_dien_thoai', 'so-dien-thoai', 'sodienthoai', 'tel', 'mobile', 'dien_thoai', 'phone_number', 'telephone', 'your-phone']) {
    assert.ok(guard.isPhoneField(name), name);
  }
  for (const name of ['name', 'ho_ten', 'hotel', 'telegram', 'email', 'message']) assert.ok(!guard.isPhoneField(name), name);
  assert.ok(guard.isPhoneField('lien_he', ['lien_he']), 'type=tel names from _tel');

  assert.ok(guard.isEmailField('email') && guard.isEmailField('Email') && guard.isEmailField('e-mail') && guard.isEmailField('your_email'));
  assert.ok(!guard.isEmailField('name'));
  for (const e of ['a@b.vn', 'nguyen.an+tag@cong-ty.com.vn', ' An@Example.COM ', 'x_y@sub.domain.io']) assert.ok(guard.isValidEmail(e), e);
  for (const e of ['', 'a@b', 'a b@c.vn', '@b.vn', 'a@b..vn', 'a@-b.vn', 'a@b.c', 'a@@b.vn', 'a@b.vn<script>', `${'x'.repeat(65)}@b.vn`]) {
    assert.ok(!guard.isValidEmail(e), e);
  }
});

test('signed render timestamp', () => {
  const now = Date.now();
  const token = guard.signTs(7, now - 5000, SECRET);
  assert.deepEqual(guard.checkTs(token, 7, now, SECRET), { ok: true, reason: 'valid' });
  assert.deepEqual(guard.checkTs(guard.signTs(7, now - 500, SECRET), 7, now, SECRET), { ok: false, reason: 'too_fast' });
  assert.deepEqual(guard.checkTs(guard.signTs(7, now - 25 * 3600_000, SECRET), 7, now, SECRET), { ok: false, reason: 'expired' });
  assert.equal(guard.checkTs(token, 8, now, SECRET).reason, 'invalid', 'bound to the site');
  assert.equal(guard.checkTs(token, 7, now, 'other-secret').reason, 'invalid');
  const [ts, mac] = token.split('.');
  assert.equal(guard.checkTs(`${Number(ts) - 60000}.${mac}`, 7, now, SECRET).reason, 'invalid', 'timestamp tampered');
  assert.equal(guard.checkTs(`${ts}.${mac.slice(0, -1)}${mac.endsWith('A') ? 'B' : 'A'}`, 7, now, SECRET).reason, 'invalid');
  assert.equal(guard.checkTs('garbage', 7, now, SECRET).reason, 'invalid');
  assert.deepEqual(guard.checkTs(undefined, 7, now, SECRET), { ok: true, reason: 'missing' });
  assert.deepEqual(guard.checkTs('', 7, now, SECRET), { ok: true, reason: 'missing' });
});

test('inspectLead: validation, normalisation and spam score', () => {
  const now = Date.now();
  const ts = guard.signTs(1, now - 10000, SECRET);
  const opts = { siteId: 1, ts, now, secret: SECRET };

  const ok = guard.inspectLead({ name: 'An', phone: '+84 90 123 4567', email: ' An@Example.com ' }, opts);
  assert.equal(ok.error, null);
  assert.deepEqual(ok.data, { name: 'An', phone: '0901234567', email: 'an@example.com' });
  assert.deepEqual(ok.contacts, { phones: ['0901234567'], emails: ['an@example.com'] });
  assert.equal(ok.score, 0);
  assert.equal(ok.spam, false);

  assert.equal(guard.inspectLead({ phone: '0901' }, opts).error, 'phone');
  assert.equal(guard.inspectLead({ email: 'abc' }, opts).error, 'email');
  assert.equal(guard.inspectLead({ phone: '' , name: 'An' }, opts).error, null, 'empty optional field');
  const lax = guard.inspectLead({ phone: '0901', name: 'An' }, { ...opts, settings: { requireValidPhone: false } });
  assert.equal(lax.error, null);
  assert.equal(lax.data.phone, '0901');
  assert.deepEqual(lax.flags, ['invalid_phone']);

  const noTs = guard.inspectLead({ name: 'An' }, { ...opts, ts: undefined });
  assert.deepEqual(noTs.flags, ['no_ts']);
  assert.equal(noTs.spam, false, 'old cached pages are still accepted');
  assert.equal(guard.inspectLead({ name: 'An' }, { ...opts, ts: guard.signTs(1, now - 100, SECRET) }).spam, true);
  assert.equal(guard.inspectLead({ name: 'An' }, { ...opts, ts: 'x.y' }).spam, true);
  assert.equal(guard.inspectLead({ name: 'An' }, { ...opts, ts: guard.signTs(1, now - 30 * 3600_000, SECRET) }).error, 'expired');

  const links = guard.inspectLead({ name: 'Bot', message: 'http://a.test http://b.test www.c.test http://d.test' }, opts);
  assert.ok(links.spam && links.flags.includes('links'));
  const words = guard.inspectLead({ name: 'X', message: 'Nhà cái uy tín, cá cược bóng đá' }, opts);
  assert.ok(words.spam && words.flags.includes('keywords'));
  const same = guard.inspectLead({ name: 'asdf', message: 'asdf', city: 'ASDF' }, { ...opts, ts: undefined });
  assert.ok(same.spam && same.flags.includes('identical'));
  const pair = guard.inspectLead({ name: 'Tư vấn', message: 'tư vấn' }, opts);
  assert.deepEqual([pair.spam, pair.flags], [false, ['identical']]);
  const oneLink = guard.inspectLead({ name: 'An', message: 'Xem giúp https://shop.vn/sp/1' }, opts);
  assert.equal(oneLink.spam, false);
  const twoLinks = guard.inspectLead({ name: 'An', message: 'https://shop.vn/sp/1 và https://shop.vn/sp/2' }, opts);
  assert.deepEqual([twoLinks.spam, twoLinks.flags], [false, ['links']]);
  const oneWord = guard.inspectLead({ name: 'An', message: 'Tôi muốn hỏi về casino resort' }, opts);
  assert.deepEqual([oneWord.spam, oneWord.flags], [false, ['keywords']]);
});

test('guard settings and siteSettings validation', () => {
  assert.deepEqual(guard.guardSettings({}), { requireValidPhone: true, dedupeHours: 24, turnstile: false });
  assert.deepEqual(guard.guardSettings({ requireValidPhone: false, dedupeHours: 0, turnstileSiteKey: 'k', turnstileSecret: 's' }), {
    requireValidPhone: false, dedupeHours: 0, turnstile: true,
  });

  const plan = { customCode: false };
  let s = siteSettings.applyUpdate({}, { requireValidPhone: false, dedupeHours: '48' }, plan);
  assert.equal(s.requireValidPhone, false);
  assert.equal(s.dedupeHours, 48);
  assert.equal(siteSettings.applyUpdate(s, { requireValidPhone: 'on' }, plan).requireValidPhone, true);
  assert.equal(siteSettings.applyUpdate(s, { dedupeHours: '' }, plan).dedupeHours, undefined);
  assert.equal(siteSettings.applyUpdate(s, { dedupeHours: 0 }, plan).dedupeHours, 0);
  for (const bad of ['-1', '169', 'abc', '1.5']) {
    assert.throws(() => siteSettings.applyUpdate(s, { dedupeHours: bad }, plan), (e) => e.status === 400, bad);
  }
  assert.throws(() => siteSettings.applyUpdate(s, { turnstileSiteKey: '"><script>' }, plan), (e) => e.status === 400);

  s = siteSettings.applyUpdate(s, { turnstileSiteKey: '1x00000000000000000000AA', turnstileSecret: '1x0000000000000000000000000000000AA' }, plan);
  const pub = siteSettings.publicSettings(s);
  assert.equal(pub.turnstileSecret, undefined);
  assert.equal(pub.hasTurnstileSecret, true);
  assert.equal(pub.turnstileSiteKey, '1x00000000000000000000AA');
  assert.equal(siteSettings.applyUpdate(s, { turnstileSecret: '' }, plan).turnstileSecret, s.turnstileSecret, 'blank keeps');
  assert.equal(siteSettings.applyUpdate(s, { turnstileSecret: '-' }, plan).turnstileSecret, undefined, '"-" clears');
});

test('lead endpoint: quality checks, duplicates, spam, Turnstile', async (t) => {
  let turnstileReply = { success: true };
  const turnstileCalls = [];
  const fakeFetch = async (url, opts) => {
    if (url === guard.TURNSTILE_VERIFY_URL) {
      turnstileCalls.push(Object.fromEntries(new URLSearchParams(opts.body)));
      if (turnstileReply === 'down') throw new Error('network');
      return { ok: true, status: 200, json: async () => turnstileReply };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };
  const { server, base, db, outbox } = await startServer({ fetch: fakeFetch });
  t.after(() => server.close());

  const c = client(base);
  await c('POST', '/api/auth/signup', { name: 'Chủ', email: 'owner@example.com', password: 'matkhau123' });
  if (helpers.verifyEmail) await helpers.verifyEmail(db, 'owner@example.com');
  const wsId = (await c('GET', '/api/auth/me')).data.workspaces[0].id;
  const site = (await c('POST', `/api/workspaces/${wsId}/sites`, { name: 'Shop', subdomain: 'shop', template: 'blank' })).data;
  const page = (await c('GET', `/api/sites/${site.id}/pages`)).data[0];
  await c('PUT', `/api/pages/${page.id}/project`, {
    project: {}, css: '',
    html: '<h1>Đăng ký</h1><form><input name="name"><input type="tel" name="lien_he"><input name="email"><button>Gửi</button></form>',
  });
  assert.equal((await c('POST', `/api/pages/${page.id}/publish`, {})).status, 200);

  let ip = 1;
  const okTs = () => guard.signTs(site.id, Date.now() - 5000);
  const submit = (body, { ts = okTs(), query = '' } = {}) =>
    fetch(`${base}/_htc/lead?site=${site.id}&page=index${query}`, {
      method: 'POST',
      redirect: 'manual',
      // A fresh client IP per request keeps the per-IP rate limit out of the way.
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Forwarded-For': `10.9.0.${ip++}` },
      body: new URLSearchParams({ ...(ts ? { _ts: ts } : {}), ...body }).toString(),
    });
  const notified = async () => {
    await new Promise((r) => setTimeout(r, 30));
    return outbox.filter((m) => /^Lead mới/.test(m.subject)).length;
  };
  const lastLead = () => db.prepare('SELECT * FROM leads ORDER BY id DESC LIMIT 1').get();
  const leadCount = () => db.prepare('SELECT COUNT(*) AS n FROM leads').get().n;

  await t.test('published form carries signed _ts and type=tel names', async () => {
    const html = await (await fetch(`${base}/p/shop`)).text();
    const ts = /name="_ts" value="([^"]+)"/.exec(html)[1];
    assert.equal(guard.checkTs(ts, site.id, Date.now() + 3000).reason, 'valid');
    assert.match(html, /name="_tel" value="lien_he"/);
    assert.doesNotMatch(html, /cf-turnstile|challenges\.cloudflare\.com/);
  });

  await t.test('valid lead is normalised and notified', async () => {
    const res = await submit({ name: 'An', lien_he: '090 123 4567', email: 'An@Example.com', _tel: 'lien_he' });
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), '/p/shop/?submitted=1');
    const lead = lastLead();
    assert.deepEqual(JSON.parse(lead.data_json), { name: 'An', lien_he: '0901234567', email: 'an@example.com' });
    assert.equal(lead.status, 'new');
    assert.equal(lead.spam_score, 0);
    assert.deepEqual(JSON.parse(lead.flags_json), []);
    assert.equal(lead.duplicate_of, null);
    assert.equal(await notified(), 1);
  });

  await t.test('invalid phone/email redirect back with an error banner', async () => {
    const before = leadCount();
    let res = await submit({ name: 'B', lien_he: '0901', _tel: 'lien_he', _utm_source: 'facebook', _utm_campaign: 'tet' });
    assert.equal(res.status, 303);
    const location = res.headers.get('location');
    assert.equal(location, '/p/shop/?lead_error=phone&utm_source=facebook&utm_campaign=tet');
    res = await submit({ name: 'B', email: 'not-an-email' });
    assert.equal(res.headers.get('location'), '/p/shop/?lead_error=email');
    assert.equal(leadCount(), before);

    const html = await (await fetch(base + location)).text();
    assert.match(html, /data-htc-lead-error[^>]*>Số điện thoại chưa đúng/);
    assert.doesNotMatch(html, /Cảm ơn bạn/);
    const unknown = await (await fetch(`${base}/p/shop?lead_error=%3Cscript%3E`)).text();
    assert.doesNotMatch(unknown, /data-htc-lead-error/);
    const thanks = await (await fetch(`${base}/p/shop?submitted=1&lead_error=phone`)).text();
    assert.doesNotMatch(thanks, /data-htc-lead-error/);
  });

  await t.test('timestamp: too fast / tampered are spam, expired asks to resend, missing allowed', async () => {
    const sent = await notified();
    let res = await submit({ name: 'Nhanh', phone: '0911111111' }, { ts: guard.signTs(site.id, Date.now()) });
    assert.equal(res.headers.get('location'), '/p/shop/?submitted=1', 'bots are not told');
    assert.equal(lastLead().status, 'spam');
    assert.ok(JSON.parse(lastLead().flags_json).includes('too_fast'));

    const [ts, mac] = okTs().split('.');
    await submit({ name: 'Giả', phone: '0922222222' }, { ts: `${Number(ts) - 1000}.${mac}` });
    assert.equal(lastLead().status, 'spam');
    assert.ok(JSON.parse(lastLead().flags_json).includes('bad_ts'));

    const before = leadCount();
    res = await submit({ name: 'Cũ', phone: '0933333333' }, { ts: guard.signTs(site.id, Date.now() - 25 * 3600_000) });
    assert.equal(res.headers.get('location'), '/p/shop/?lead_error=expired');
    assert.equal(leadCount(), before);

    res = await submit({ name: 'Trang cũ', phone: '0944444444' }, { ts: null });
    assert.equal(res.headers.get('location'), '/p/shop/?submitted=1');
    assert.equal(lastLead().status, 'new');
    assert.deepEqual(JSON.parse(lastLead().flags_json), ['no_ts']);
    assert.equal(lastLead().spam_score, 1);
    assert.equal(await notified(), sent + 1);
  });

  await t.test('duplicates within the window are stored, flagged, not notified', async () => {
    const sent = await notified();
    await submit({ name: 'Bình', phone: '0955 555 555' });
    const original = lastLead();
    assert.equal(original.duplicate_of, null);
    await submit({ name: 'Bình lần 2', phone: '+84955555555' });
    let dup = lastLead();
    assert.equal(dup.duplicate_of, original.id);
    assert.ok(JSON.parse(dup.flags_json).includes('duplicate'));
    assert.equal(dup.status, 'new');
    await submit({ name: 'Bình lần 3', email: 'binh@example.com', phone: '0955555555' });
    assert.equal(lastLead().duplicate_of, original.id, 'points at the first lead');
    await submit({ name: 'Bình lần 4', email: 'BINH@example.com' });
    assert.equal(lastLead().duplicate_of, original.id, 'matched by email');
    assert.equal(await notified(), sent + 1);

    // Outside the window: a new lead again.
    db.prepare("UPDATE leads SET created_at = datetime('now', '-30 hours') WHERE data_json LIKE '%0955555555%' OR data_json LIKE '%binh@%'").run();
    await submit({ name: 'Bình tháng sau', phone: '0955555555' });
    assert.equal(lastLead().duplicate_of, null);

    // dedupeHours = 0 disables the check.
    assert.equal((await c('PATCH', `/api/sites/${site.id}/settings`, { dedupeHours: 0 })).status, 200);
    await submit({ name: 'Bình nữa', phone: '0955555555' });
    dup = lastLead();
    assert.equal(dup.duplicate_of, null);
    assert.equal(await notified(), sent + 3);
    await c('PATCH', `/api/sites/${site.id}/settings`, { dedupeHours: '' });
  });

  await t.test('spam is stored as status spam, hidden by default, not notified, not in quota', async () => {
    const sent = await notified();
    const quotaBefore = leadsThisMonth(db, wsId);
    const res = await submit({ name: 'Casino', message: 'Nhà cái casino uy tín http://x.test http://y.test http://z.test' });
    assert.equal(res.headers.get('location'), '/p/shop/?submitted=1');
    const spam = lastLead();
    assert.equal(spam.status, 'spam');
    assert.ok(spam.spam_score >= guard.SPAM_THRESHOLD);
    assert.equal(await notified(), sent);
    assert.equal(leadsThisMonth(db, wsId), quotaBefore);

    const list = (await c('GET', `/api/sites/${site.id}/leads`)).data;
    assert.ok(!list.some((l) => l.status === 'spam'));
    const spamList = (await c('GET', `/api/sites/${site.id}/leads?status=spam`)).data;
    assert.ok(spamList.length >= 3);
    const row = spamList.find((l) => l.id === spam.id);
    assert.ok(row.flags.includes('keywords') && row.flags.includes('links'));
    assert.equal(row.spamScore, spam.spam_score);
    const dupRow = (await c('GET', `/api/sites/${site.id}/leads`)).data.find((l) => l.duplicateOf);
    assert.ok(dupRow, 'duplicates are listed with duplicateOf');

    // Spam can still be stored when the monthly quota is used up; real leads cannot.
    db.prepare('UPDATE leads SET created_at = datetime(\'now\') WHERE site_id = ?').run(site.id);
    const fill = db.prepare("INSERT INTO leads (site_id, page_slug, data_json) VALUES (?, 'index', '{}')");
    while (leadsThisMonth(db, wsId) < 100) fill.run(site.id);
    const spamCount = db.prepare("SELECT COUNT(*) AS n FROM leads WHERE status = 'spam'").get().n;
    assert.equal((await submit({ name: 'Bot', message: 'viagra casino' })).status, 303);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM leads WHERE status = 'spam'").get().n, spamCount + 1);
    assert.equal((await submit({ name: 'Thật', phone: '0966666666' })).status, 503);
    // Marking a lead as spam frees quota.
    assert.equal((await c('PATCH', `/api/leads/${original()}`, { status: 'spam' })).status, 200);
    assert.equal((await submit({ name: 'Thật', phone: '0966666666' })).status, 303);
    db.prepare("DELETE FROM leads WHERE data_json = '{}'").run();

    function original() {
      return db.prepare("SELECT id FROM leads WHERE status = 'new' ORDER BY id LIMIT 1").get().id;
    }
  });

  await t.test('invalid phones allowed when requireValidPhone is off', async () => {
    assert.equal((await c('PATCH', `/api/sites/${site.id}/settings`, { requireValidPhone: false })).status, 200);
    const res = await submit({ name: 'Nước ngoài', phone: '+1 415 555 1234' });
    assert.equal(res.headers.get('location'), '/p/shop/?submitted=1');
    assert.equal(JSON.parse(lastLead().data_json).phone, '+1 415 555 1234');
    assert.ok(JSON.parse(lastLead().flags_json).includes('invalid_phone'));
    await c('PATCH', `/api/sites/${site.id}/settings`, { requireValidPhone: true });
  });

  await t.test('Cloudflare Turnstile: widget injected, token verified, fails closed', async () => {
    const r = await c('PATCH', `/api/sites/${site.id}/settings`, {
      turnstileSiteKey: '1x00000000000000000000AA', turnstileSecret: '1x0000000000000000000000000000000AA',
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.settings.turnstileSecret, undefined);
    assert.equal(r.data.settings.hasTurnstileSecret, true);

    const html = await (await fetch(`${base}/p/shop`)).text();
    assert.match(html, /<div class="cf-turnstile" data-sitekey="1x00000000000000000000AA"[^>]*><\/div><\/form>/);
    assert.match(html, /<script src="https:\/\/challenges\.cloudflare\.com\/turnstile\/v0\/api\.js" async defer><\/script>/);
    assert.doesNotMatch(html, /1x0000000000000000000000000000000AA/, 'secret never rendered');

    const before = leadCount();
    let res = await submit({ name: 'Không token', phone: '0977777777' });
    assert.equal(res.status, 403);
    assert.match(await res.text(), /không phải robot/);
    assert.equal(turnstileCalls.length, 0, 'missing token is rejected locally');

    turnstileReply = { success: false, 'error-codes': ['invalid-input-response'] };
    res = await submit({ name: 'Sai token', phone: '0977777777', 'cf-turnstile-response': 'bad' });
    assert.equal(res.status, 403);

    turnstileReply = 'down';
    res = await submit({ name: 'Mất mạng', phone: '0977777777', 'cf-turnstile-response': 'tok' });
    assert.equal(res.status, 503);
    assert.match(await res.text(), /thử lại/);
    assert.equal(leadCount(), before);

    turnstileReply = { success: true };
    res = await submit({ name: 'Người thật', phone: '0977777777', 'cf-turnstile-response': 'good-token' });
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), '/p/shop/?submitted=1');
    const call = turnstileCalls.at(-1);
    assert.equal(call.secret, '1x0000000000000000000000000000000AA');
    assert.equal(call.response, 'good-token');
    assert.match(call.remoteip, /^10\.9\.0\.\d+$/);
    assert.deepEqual(JSON.parse(lastLead().data_json), { name: 'Người thật', phone: '0977777777' }, 'token not stored');
  });
});
