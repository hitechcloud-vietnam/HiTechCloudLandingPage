'use strict';

const { trackingHead, leadEvents } = require('./siteSettings');

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[c]);
}

// Points every <form> on a published page at the platform lead endpoint so
// submissions are captured without the customer writing any backend code.
function rewriteForms(html, siteId, pageSlug, extraParams = '') {
  const action = `/_htc/lead?site=${siteId}&amp;page=${encodeURIComponent(pageSlug)}${extraParams ? `&amp;${escapeHtml(extraParams)}` : ''}`;
  return html.replace(/<form\b([^>]*)>/gi, (_m, attrs) => {
    const kept = attrs.replace(/\s(action|method)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
    return `<form${kept} action="${action}" method="post">` +
      '<input type="text" name="_hp" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px">';
  });
}

// Tiny runtime for countdown blocks (data-htc-countdown="<ISO deadline>").
const COUNTDOWN_JS = `<script>(function(){var els=document.querySelectorAll('[data-htc-countdown]');if(!els.length)return;function pad(n){return(n<10?'0':'')+n}function tick(){var now=Date.now();els.forEach(function(el){var t=Date.parse(el.getAttribute('data-htc-countdown'));var d=Math.max(0,Math.floor(((isNaN(t)?now:t)-now)/1000));var v={d:Math.floor(d/86400),h:Math.floor(d%86400/3600),m:Math.floor(d%3600/60),s:d%60};Object.keys(v).forEach(function(k){var b=el.querySelector('[data-unit="'+k+'"]');if(b)b.textContent=pad(v[k])})})}tick();setInterval(tick,1000)})();</script>`;

// Adds attribution (UTM parameters + referrer) to form submissions as _-prefixed
// hidden fields, which the lead endpoint stores separately from the form data.
const ATTRIBUTION_JS = `<script>(function(){var q=new URLSearchParams(location.search),f={};['utm_source','utm_medium','utm_campaign','utm_term','utm_content'].forEach(function(k){if(q.get(k))f['_'+k]=q.get(k)});if(document.referrer)f._ref=document.referrer;document.addEventListener('submit',function(e){var form=e.target;Object.keys(f).forEach(function(k){if(form.querySelector('input[name="'+k+'"]'))return;var i=document.createElement('input');i.type='hidden';i.name=k;i.value=f[k];form.appendChild(i)})},true)})();</script>`;

// ---------- Conversion widget runtimes (ES5, no dependencies) ----------
// Written as functions for readability and serialised into the page. Pages
// served from the dashboard origin run in an opaque-origin sandbox where Web
// Storage throws, so htcStore falls back to an in-memory map.
function storeRuntime() {
  var mem = {};
  function area(session) {
    try { return session ? window.sessionStorage : window.localStorage; } catch (e) { return null; }
  }
  window.htcStore = {
    get: function (k, session) {
      try { var a = area(session); if (a) return a.getItem(k); } catch (e) {}
      return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null;
    },
    set: function (k, v, session) {
      mem[k] = String(v);
      try { var a = area(session); if (a) a.setItem(k, String(v)); } catch (e) {}
    }
  };
}

// Popup: data-htc-popup="exit|delay|scroll", data-htc-delay (s), data-htc-scroll (%),
// data-htc-frequency="session|always|once-per-day".
function popupRuntime() {
  var store = window.htcStore, root = document.documentElement;
  var FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]';
  var current = null, lastFocus = null;
  var skip = /[?&]submitted=1(&|$)/.test(location.search);
  function num(el, name, def) { var n = parseFloat(el.getAttribute(name)); return isNaN(n) || n < 0 ? def : n; }
  function box(el) { return el.querySelector('[role=dialog]') || el; }
  function focusables(el) {
    return Array.prototype.filter.call(el.querySelectorAll(FOCUSABLE), function (n) { return n.tabIndex >= 0 && n.offsetWidth + n.offsetHeight > 0; });
  }
  function show(el) {
    if (current) return false;
    current = el;
    lastFocus = document.activeElement;
    el.classList.add('htc-open');
    root.classList.add('htc-locked');
    box(el).focus();
    return true;
  }
  function hide() {
    if (!current) return;
    current.classList.remove('htc-open');
    root.classList.remove('htc-locked');
    current = null;
    if (lastFocus && lastFocus.focus) try { lastFocus.focus(); } catch (e) {}
  }
  document.addEventListener('keydown', function (e) {
    if (!current) return;
    if (e.key === 'Escape' || e.key === 'Esc') { e.preventDefault(); hide(); return; }
    if (e.key !== 'Tab') return;
    var f = focusables(current), first = f[0], last = f[f.length - 1];
    if (!f.length) { e.preventDefault(); return; }
    if (e.shiftKey && (document.activeElement === first || !current.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (document.activeElement === last || !current.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
  });
  Array.prototype.forEach.call(document.querySelectorAll('[data-htc-popup]'), function (el, i) {
    var dlg = box(el), h = dlg.querySelector('h1,h2,h3');
    if (h) { h.id = h.id || 'htc-popup-title-' + i; dlg.setAttribute('aria-labelledby', h.id); }
    el.addEventListener('click', function (e) {
      if (e.target === el || (e.target.closest && e.target.closest('[data-htc-close]'))) hide();
    });
    var key = 'htc-popup:' + location.pathname + ':' + i;
    var freq = el.getAttribute('data-htc-frequency') || 'session';
    var day = freq === 'once-per-day';
    if (skip || (freq !== 'always' && store.get(key, !day) && (!day || Date.now() - Number(store.get(key)) < 864e5))) return;
    var done = false;
    function fire() {
      if (done || !show(el)) return;
      done = true;
      if (freq !== 'always') store.set(key, day ? Date.now() : '1', !day);
    }
    var mode = el.getAttribute('data-htc-popup');
    var desktop = window.matchMedia && matchMedia('(hover: hover) and (pointer: fine)').matches;
    if (mode === 'exit' && desktop) {
      document.addEventListener('mouseout', function (e) { if (!e.relatedTarget && e.clientY <= 0) fire(); });
    } else if (mode === 'scroll') {
      var onScroll = function () {
        var max = root.scrollHeight - window.innerHeight;
        if (max <= 0 || window.pageYOffset / max * 100 >= num(el, 'data-htc-scroll', 50)) { window.removeEventListener('scroll', onScroll); fire(); }
      };
      window.addEventListener('scroll', onScroll, { passive: true });
      setTimeout(onScroll, 500);
    } else {
      setTimeout(fire, num(el, 'data-htc-delay', 8) * 1000);
    }
  });
}

// Sticky bar: data-htc-sticky="top|bottom"; dismissal remembered for the session.
function stickyRuntime() {
  var store = window.htcStore, root = document.documentElement;
  Array.prototype.forEach.call(document.querySelectorAll('[data-htc-sticky]'), function (el, i) {
    var key = 'htc-sticky:' + location.pathname + ':' + i;
    var top = el.getAttribute('data-htc-sticky') === 'top';
    function pad() {
      var h = el.classList.contains('htc-hidden') ? 0 : el.offsetHeight;
      document.body.style[top ? 'paddingTop' : 'paddingBottom'] = h ? h + 'px' : '';
      if (!top) {
        root.style.setProperty('--htc-sb-h', h + 'px');
        root.classList[h ? 'add' : 'remove']('htc-has-sb-bottom');
      }
    }
    if (store.get(key, true)) el.classList.add('htc-hidden');
    pad();
    window.addEventListener('resize', pad);
    el.addEventListener('click', function (e) {
      if (!(e.target.closest && e.target.closest('[data-htc-close]'))) return;
      el.classList.add('htc-hidden');
      store.set(key, '1', true);
      pad();
    });
  });
}

// Social-proof toast: data-htc-items (JSON array or "a|b|c"), data-htc-interval (s).
function proofRuntime() {
  var store = window.htcStore;
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  function parse(raw) {
    raw = String(raw || '').trim();
    var list;
    if (raw.charAt(0) === '[') try { list = JSON.parse(raw); } catch (e) {}
    if (!list || !list.length) list = raw.split(/\s*[|\n]\s*/);
    return list.map(function (it) {
      return typeof it === 'string' ? it : it && (it.text || [it.name, it.city ? 'ở ' + it.city : '', it.action || 'vừa đăng ký'].join(' ').replace(/\s+/g, ' '));
    }).filter(function (s) { return s && String(s).trim(); });
  }
  Array.prototype.forEach.call(document.querySelectorAll('[data-htc-proof]'), function (el, i) {
    var key = 'htc-proof:' + location.pathname + ':' + i;
    var items = parse(el.getAttribute('data-htc-items'));
    var text = el.querySelector('.htc-proof-text');
    if (!items.length || !text || store.get(key, true)) return;
    var every = Math.max(3, parseFloat(el.getAttribute('data-htc-interval')) || 8) * 1000;
    var n = 0, timer, stopped = false;
    if (document.querySelector('a[href="https://hitechcloud.vn"]') && el.getAttribute('data-htc-proof') !== 'right') el.style.marginBottom = '40px';
    function next() {
      if (stopped) return;
      text.textContent = items[n++ % items.length];
      el.classList.add('htc-show');
      timer = setTimeout(function () {
        el.classList.remove('htc-show');
        timer = setTimeout(next, every);
      }, reduce ? 7000 : 5000);
    }
    timer = setTimeout(next, 3000);
    el.addEventListener('click', function (e) {
      if (!(e.target.closest && e.target.closest('[data-htc-close]'))) return;
      stopped = true;
      clearTimeout(timer);
      el.classList.remove('htc-show');
      store.set(key, '1', true);
    });
  });
}

const inlineScript = (fn) => `<script>(${String(fn).replace(/\n\s+/g, '\n')})();</script>`;
const STORE_JS = inlineScript(storeRuntime);
const POPUP_JS = inlineScript(popupRuntime);
const STICKY_JS = inlineScript(stickyRuntime);
const PROOF_JS = inlineScript(proofRuntime);

// Runtimes needed by the widgets present in the page body.
function widgetScripts(body) {
  const out = [];
  if (body.includes('data-htc-popup')) out.push(POPUP_JS);
  if (body.includes('data-htc-sticky')) out.push(STICKY_JS);
  if (body.includes('data-htc-proof')) out.push(PROOF_JS);
  return out.length ? STORE_JS + out.join('') : '';
}

const BRANDING = `<a href="https://hitechcloud.vn" target="_blank" rel="noopener" style="position:fixed;left:12px;bottom:12px;z-index:2147483647;background:#0f172a;color:#fff;font:12px/1 system-ui,sans-serif;padding:8px 12px;border-radius:999px;text-decoration:none;opacity:.85">Tạo bởi HiTechCloud</a>`;

// formSlug: slug the visitor requested (an A/B variant is served at the original
// URL, so thank-you redirects return there); formParams: extra lead attribution.
function renderPage({ page, site, html, css, showBranding, notice, settings = {}, canonicalUrl = '', formSlug, formParams = '' }) {
  const safeCss = String(css || '').replace(/<\/style/gi, '<\\/style');
  const body = rewriteForms(String(html || ''), site.id, formSlug || page.slug, formParams);
  const head = [
    settings.faviconUrl ? `<link rel="icon" href="${escapeHtml(settings.faviconUrl)}">` : '',
    page.og_image ? `<meta property="og:image" content="${escapeHtml(page.og_image)}">` : '',
    canonicalUrl ? `<link rel="canonical" href="${escapeHtml(canonicalUrl)}"><meta property="og:url" content="${escapeHtml(canonicalUrl)}">` : '',
    trackingHead(settings),
    settings.customHead || '',
  ].filter(Boolean).join('\n');
  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(page.title)}</title>
<meta name="description" content="${escapeHtml(page.meta_description)}">
<meta property="og:title" content="${escapeHtml(page.title)}">
<meta property="og:description" content="${escapeHtml(page.meta_description)}">
<meta property="og:type" content="website">
<meta name="generator" content="HiTechCloud LandingPage">
${head}
<style>${safeCss}</style>
</head>
<body>
${notice ? `<div style="background:#16a34a;color:#fff;text-align:center;padding:12px;font-family:system-ui,sans-serif">${escapeHtml(notice)}</div>` : ''}
${body}
${showBranding ? BRANDING : ''}
${body.includes('data-htc-countdown') ? COUNTDOWN_JS : ''}
${widgetScripts(body)}
${/<form\b/i.test(body) ? ATTRIBUTION_JS : ''}
${notice ? leadEvents(settings) : ''}
${settings.customBody || ''}
</body>
</html>`;
}

function renderMessage(title, message, status = 404) {
  return {
    status,
    html: `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title>
<style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#f8fafc;color:#0f172a}div{text-align:center;padding:20px}</style></head>
<body><div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></div></body></html>`,
  };
}

module.exports = { escapeHtml, rewriteForms, renderPage, renderMessage, widgetScripts };
