'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { renderPage, widgetScripts } = require('../src/render');
const { listBlocks, renderTemplate, BASE_CSS } = require('../src/templates');
const { startServer, client } = require('./helpers');

const render = (html) => renderPage({ page: { slug: 'index', title: 'T' }, site: { id: 1 }, html, css: '', showBranding: false });
const scripts = (html) => (html.match(/<script>[\s\S]*?<\/script>/g) || []);

test('widget runtimes are injected only when their attribute is present', () => {
  const plain = render('<section><h1>Xin chào</h1></section>');
  assert.doesNotMatch(plain, /htcStore|htc-popup|htc-sticky|htc-proof/);
  assert.equal(widgetScripts('<p>no widgets</p>'), '');

  const cases = { 'data-htc-popup': /htc-popup:/, 'data-htc-sticky': /htc-sticky:/, 'data-htc-proof': /htc-proof:/ };
  for (const [attr, marker] of Object.entries(cases)) {
    const html = render(`<div ${attr}="x"></div>`);
    assert.match(html, /window\.htcStore/, `${attr}: storage helper`);
    assert.match(html, marker, `${attr}: own runtime`);
    for (const [other, otherMarker] of Object.entries(cases)) {
      if (other !== attr) assert.doesNotMatch(html, otherMarker, `${attr} must not pull in ${other}`);
    }
    // Storage helper is shared, never duplicated.
    assert.equal(html.split('window.htcStore =').length - 1, 1);
  }
  const all = render('<div data-htc-popup="delay"></div><div data-htc-sticky="top"></div><div data-htc-proof="left"></div>');
  assert.equal(all.split('window.htcStore =').length - 1, 1);
});

test('widget runtimes are valid scripts without inline handlers', () => {
  const html = render('<div data-htc-popup="delay"></div><div data-htc-sticky="top"></div><div data-htc-proof="left"></div>');
  for (const s of scripts(html)) new vm.Script(s.slice(8, -9)); // throws on syntax errors
  assert.doesNotMatch(widgetScripts('data-htc-popup data-htc-sticky data-htc-proof'), /\bon[a-z]+=|=>|\blet\b|\bconst\b|`/);
});

test('storage helper falls back to memory when storage is blocked (sandbox)', () => {
  const js = scripts(widgetScripts('data-htc-proof'))[0].slice(8, -9);
  const blocked = {};
  Object.defineProperty(blocked, 'localStorage', { get() { throw new Error('SecurityError'); } });
  Object.defineProperty(blocked, 'sessionStorage', { get() { throw new Error('SecurityError'); } });
  const ctx = vm.createContext({ window: blocked });
  vm.runInContext(js, ctx);
  assert.equal(blocked.htcStore.get('k', true), null);
  blocked.htcStore.set('k', '1', true);
  assert.equal(blocked.htcStore.get('k', true), '1');
});

test('blocks list exposes the conversion widgets with their config attributes', () => {
  const blocks = Object.fromEntries(listBlocks().map((b) => [b.id, b]));
  const popup = blocks.popup;
  assert.ok(popup && blocks.stickyBar && blocks.socialProof);
  assert.equal(popup.label, 'Popup thu lead');
  assert.match(popup.html, /^<div class="htc-popup" data-htc-popup="delay" data-htc-delay="8" data-htc-scroll="50" data-htc-frequency="session">/);
  assert.match(popup.html, /role="dialog" aria-modal="true"/);
  assert.match(popup.html, /<button class="htc-popup-close" type="button" aria-label="Đóng" data-htc-close>/);
  assert.match(popup.html, /<form class="htc-form">[\s\S]*name="name"[\s\S]*name="phone"[\s\S]*<\/form>/);
  assert.match(blocks.stickyBar.html, /data-htc-sticky="bottom"/);
  assert.match(blocks.stickyBar.html, /data-htc-close/);
  assert.match(blocks.socialProof.html, /data-htc-proof="left" data-htc-items="Nguyễn A ở Hà Nội vừa đăng ký\|[^"]+" data-htc-interval="8"/);
  for (const id of ['popup', 'stickyBar', 'socialProof']) {
    const { html, css } = blocks[id];
    assert.ok(css && css.includes('.htc-popup-box'), `${id} carries widget css`);
    assert.doesNotMatch(html, /<script|\son[a-z]+=/i);
    // Balanced tags (rough well-formedness check).
    for (const tag of ['div', 'form', 'button', 'span']) {
      const open = (html.match(new RegExp(`<${tag}\\b`, 'g')) || []).length;
      const close = (html.match(new RegExp(`</${tag}>`, 'g')) || []).length;
      assert.equal(open, close, `${id}: <${tag}> balanced`);
    }
  }
  assert.equal(blocks.hero.css, undefined);
  // Popup is hidden by default and only shown when the runtime opens it.
  assert.match(BASE_CSS, /\.htc-popup\{display:none;/);
  assert.match(BASE_CSS, /\.htc-popup\.htc-open\{display:flex\}/);
  assert.match(BASE_CSS, /prefers-reduced-motion:reduce\)\{\.htc-proof/);
});

test('templates use widgets sparingly', () => {
  assert.match(renderTemplate('product').html, /data-htc-popup="exit"/);
  assert.match(renderTemplate('leadgen').html, /data-htc-sticky="top"/);
  assert.doesNotMatch(renderTemplate('saas').html, /data-htc-(popup|sticky|proof)/);
  assert.match(renderTemplate('spa').css, /\.htc-popup-box/);
});

test('published popup forms post leads to the platform endpoint', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());
  const c = client(base);
  await c('POST', '/api/auth/signup', { name: 'Chủ', email: 'owner@example.com', password: 'matkhau123' });
  const wsId = (await c('GET', '/api/auth/me')).data.workspaces[0].id;
  const site = (await c('POST', `/api/workspaces/${wsId}/sites`, { name: 'Shop', subdomain: 'shop', template: 'blank' })).data;
  const page = (await c('GET', `/api/sites/${site.id}/pages`)).data[0];
  const blocks = (await c('GET', '/api/blocks')).data;
  const popup = blocks.blocks.find((b) => b.id === 'popup');
  assert.ok(popup.css);

  const saved = await c('PUT', `/api/pages/${page.id}/project`, { project: { pages: [] }, html: popup.html, css: blocks.css });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  assert.equal((await c('POST', `/api/pages/${page.id}/publish`, {})).status, 200);

  const html = await (await fetch(`${base}/p/shop`)).text();
  assert.match(html, new RegExp(`<form class="htc-form" action="/_htc/lead\\?site=${site.id}&amp;page=index&amp;pid=${page.id}" method="post">`));
  assert.match(html, /name="_hp"/);
  assert.match(html, /htc-popup:/);
  assert.doesNotMatch(html, /htc-sticky:|htc-proof:/);

  const res = await fetch(`${base}/_htc/lead?site=${site.id}&page=index`, {
    method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'name=An&phone=0909',
  });
  assert.equal(res.status, 303);
  const leads = (await c('GET', `/api/sites/${site.id}/leads`)).data;
  assert.deepEqual(leads.map((l) => l.data), [{ name: 'An', phone: '0909' }]);
});
