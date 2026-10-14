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
function rewriteForms(html, siteId, pageSlug) {
  const action = `/_htc/lead?site=${siteId}&amp;page=${encodeURIComponent(pageSlug)}`;
  return html.replace(/<form\b([^>]*)>/gi, (_m, attrs) => {
    const kept = attrs.replace(/\s(action|method)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
    return `<form${kept} action="${action}" method="post">` +
      '<input type="text" name="_hp" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px">';
  });
}

const BRANDING = `<a href="https://hitechcloud.vn" target="_blank" rel="noopener" style="position:fixed;right:12px;bottom:12px;z-index:2147483647;background:#0f172a;color:#fff;font:12px/1 system-ui,sans-serif;padding:8px 12px;border-radius:999px;text-decoration:none;opacity:.85">Tạo bởi HiTechCloud</a>`;

function renderPage({ page, site, html, css, showBranding, notice, settings = {}, canonicalUrl = '' }) {
  const safeCss = String(css || '').replace(/<\/style/gi, '<\\/style');
  const body = rewriteForms(String(html || ''), site.id, page.slug);
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
