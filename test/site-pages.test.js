'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers');

const PAGES = ['/', '/terms', '/privacy', '/refund', '/contact', '/404', '/app/signup'];
const LEGAL = ['/terms', '/privacy', '/refund'];
const DRAFT_NOTICE = 'Bản mẫu — cần được luật sư rà soát trước khi công bố';

test('marketing site and legal pages', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());

  const html = {};
  for (const path of PAGES) {
    const res = await fetch(base + path);
    html[path] = { status: res.status, type: res.headers.get('content-type'), text: await res.text() };
  }

  await t.test('every page returns Vietnamese HTML with a title', () => {
    for (const path of PAGES) {
      const page = html[path];
      assert.equal(page.status, 200, path);
      assert.match(page.type, /text\/html/, path);
      assert.match(page.text, /<html lang="vi">/, path);
      assert.match(page.text, /<title>[^<]{5,}<\/title>/, path);
      assert.match(page.text, /<meta name="viewport"/, path);
    }
  });

  await t.test('legal pages carry the draft notice and link to each other', () => {
    for (const path of LEGAL) {
      assert.ok(html[path].text.includes(DRAFT_NOTICE), `${path} draft notice`);
      for (const link of ['/terms', '/privacy', '/refund', '/contact']) {
        assert.ok(html[path].text.includes(`href="${link}"`), `${path} links ${link}`);
      }
    }
    assert.match(html['/privacy'].text, /Nghị định 13\/2023\/NĐ-CP/);
    assert.match(html['/privacy'].text, /rút lại sự đồng ý/i);
    assert.match(html['/refund'].text, /Không tự động gia hạn, không tự động trừ tiền/);
  });

  await t.test('homepage has SEO metadata and valid JSON-LD', () => {
    const text = html['/'].text;
    assert.match(text, /<meta name="description" content="[^"]{50,}">/);
    assert.match(text, /<link rel="canonical" href="https:\/\/[^"]+">/);
    for (const prop of ['og:title', 'og:description', 'og:type', 'og:url', 'og:locale']) {
      assert.match(text, new RegExp(`<meta property="${prop}" content="[^"]+">`), prop);
    }
    const blocks = [...text.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
    assert.equal(blocks.length, 1);
    const data = JSON.parse(blocks[0][1]);
    const types = data['@graph'].map((n) => n['@type']);
    assert.ok(types.includes('SoftwareApplication'));
    assert.ok(types.includes('Organization'));
    assert.equal((text.match(/<h1[\s>]/g) || []).length, 1, 'exactly one h1');
    assert.match(text, /id="pricing"/);
    assert.match(text, /fetch\('\/api\/plans'\)/);
    assert.match(text, /<details>/);
    for (const link of ['/terms', '/privacy', '/refund', '/contact']) assert.ok(text.includes(`href="${link}"`), link);
  });

  await t.test('signup requires consent with links to terms and privacy', () => {
    const text = html['/app/signup'].text;
    const checkbox = text.match(/<input[^>]*id="agree"[^>]*>/);
    assert.ok(checkbox, 'consent checkbox present');
    assert.match(checkbox[0], /type="checkbox"/);
    assert.match(checkbox[0], /\brequired\b/);
    // Sent to the API as acceptTerms, which the server requires and records.
    assert.match(checkbox[0], /\bname="acceptTerms"/);
    const label = text.match(/<label class="consent"[\s\S]*?<\/label>/)[0];
    assert.match(label, /Tôi đồng ý với/);
    assert.match(label, /href="\/terms"[^>]*>Điều khoản sử dụng</);
    assert.match(label, /href="\/privacy"[^>]*>Chính sách bảo mật</);
  });

  await t.test('no page loads external scripts or stylesheets', () => {
    for (const path of PAGES) {
      const text = html[path].text;
      for (const [, src] of text.matchAll(/<script[^>]*\ssrc="([^"]*)"/g)) {
        assert.match(src, /^\/(?!\/)/, `${path}: external script ${src}`);
      }
      for (const [tag] of text.matchAll(/<link[^>]*rel="stylesheet"[^>]*>/g)) {
        assert.match(tag, /href="\/(?!\/)/, `${path}: external stylesheet ${tag}`);
      }
    }
  });

  await t.test('robots.txt and sitemap.xml describe the marketing site', async () => {
    const robots = await fetch(`${base}/robots.txt`);
    assert.equal(robots.status, 200);
    const robotsText = await robots.text();
    assert.match(robotsText, /Disallow: \/app\//);
    assert.match(robotsText, /Sitemap: https:\/\/\S+\/sitemap\.xml/);

    const sitemap = await fetch(`${base}/sitemap.xml`);
    assert.equal(sitemap.status, 200);
    assert.match(sitemap.headers.get('content-type'), /xml/);
    const xml = await sitemap.text();
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
    for (const path of ['/', '/terms', '/privacy', '/refund', '/contact']) assert.ok(locs.includes(path), path);
  });
});

test('unknown dashboard URLs get the branded 404 page', async () => {
  const { startServer: start } = require('./helpers');
  const { server, base } = await start();
  try {
    const res = await fetch(`${base}/khong-ton-tai`, { headers: { Accept: 'text/html' } });
    assert.equal(res.status, 404);
    assert.match(await res.text(), /<html lang="vi"/);
    const asset = await fetch(`${base}/khong-ton-tai.js`, { headers: { Accept: '*/*' } });
    assert.equal(asset.status, 404);
  } finally {
    server.close();
  }
});
