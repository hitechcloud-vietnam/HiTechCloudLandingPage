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

// Free-plan badge, with a link to the abuse report form for this page.
function branding(siteId, slug) {
  const link = 'color:#fff;text-decoration:none';
  return `<div style="position:fixed;left:12px;bottom:12px;z-index:2147483647;background:#0f172a;color:#fff;font:12px/1 system-ui,sans-serif;padding:8px 12px;border-radius:999px;opacity:.85"><a href="https://hitechcloud.vn" target="_blank" rel="noopener" style="${link}">Tạo bởi HiTechCloud</a> · <a href="/_htc/report?site=${Number(siteId)}&amp;page=${encodeURIComponent(slug || 'index')}" target="_blank" rel="noopener nofollow" style="${link};opacity:.7">Báo cáo vi phạm</a></div>`;
}

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
${showBranding ? branding(site.id, formSlug || page.slug) : ''}
${body.includes('data-htc-countdown') ? COUNTDOWN_JS : ''}
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

module.exports = { escapeHtml, rewriteForms, renderPage, renderMessage };
