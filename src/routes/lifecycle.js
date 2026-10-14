'use strict';

const express = require('express');
const { handler } = require('../http');
const { HttpError } = require('../access');
const { requireUser } = require('../auth');
const { escapeHtml } = require('../render');
const lifecycle = require('../lifecycle');
const { createRateLimiter } = require('../ratelimit');

// Dashboard API: onboarding checklist and per-user email preferences (mounted at /api).
function createLifecycleRouter({ db, access }) {
  const r = express.Router();

  r.get('/workspaces/:wid/onboarding', requireUser, handler((req) => {
    const { ws } = access.workspace(req.user, req.params.wid);
    return lifecycle.onboardingStatus(db, { userId: req.user.id, workspace: ws });
  }));

  r.post('/workspaces/:wid/onboarding/dismiss', requireUser, handler((req) => {
    const { ws } = access.workspace(req.user, req.params.wid);
    lifecycle.dismissOnboarding(db, req.user.id, ws.id);
    return { ok: true };
  }));

  r.get('/auth/email-preferences', requireUser, handler((req) => lifecycle.emailPreferences(db, req.user.id)));

  r.put('/auth/email-preferences', requireUser, handler((req) => {
    const sets = [];
    const args = [];
    for (const [key, column] of Object.entries(lifecycle.PREFS)) {
      if (req.body[key] === undefined) continue;
      if (typeof req.body[key] !== 'boolean') throw new HttpError(400, 'Giá trị tùy chọn email không hợp lệ');
      sets.push(`${column} = ?`);
      args.push(req.body[key] ? 1 : 0);
    }
    if (sets.length) db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...args, req.user.id);
    return lifecycle.emailPreferences(db, req.user.id);
  }));

  return r;
}

function page(title, message, appUrl, status) {
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · HiTechCloud</title><link rel="stylesheet" href="/assets/app.css"></head>
<body><main class="auth-wrap"><div class="card auth-card stack">
<a class="brand" href="/">HiTech<span>Cloud</span></a><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>
<p><a class="btn" href="${escapeHtml(appUrl)}/app/?tab=settings">${status === 200 ? 'Quản lý tùy chọn email' : 'Đăng nhập để quản lý email'}</a></p>
</div></main></body></html>`;
}

// One-click unsubscribe from marketing emails (no login; HMAC-signed token).
// GET is the link in the email body; POST is RFC 8058 List-Unsubscribe-Post.
function createUnsubscribeRouter({ db, config }) {
  const r = express.Router();
  const limiter = createRateLimiter({ windowMs: 60_000, max: 20 });
  const unsubscribe = (req, res) => {
    if (!limiter(req.ip)) return res.status(429).type('text/plain').send('Bạn thao tác quá nhanh, vui lòng thử lại sau');
    const t = lifecycle.verifyUnsubscribeToken(config, req.query.token);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex');
    if (!t || !lifecycle.unsubscribe(db, t.userId, t.kind)) {
      return res
        .status(400)
        .type('html')
        .send(page('Liên kết không hợp lệ', 'Liên kết hủy nhận email không hợp lệ hoặc tài khoản không còn tồn tại. Bạn có thể tắt email trong Cài đặt tài khoản.', config.appUrl, 400));
    }
    if (req.method === 'POST') return res.status(200).type('text/plain').send('OK');
    res
      .type('html')
      .send(page('Đã hủy nhận email', `Bạn sẽ không nhận "${lifecycle.PREF_LABEL[t.kind]}" nữa. Email giao dịch (xác minh, mật khẩu, thanh toán) vẫn được gửi khi cần.`, config.appUrl, 200));
  };
  r.get('/email/unsubscribe', unsubscribe);
  r.post('/email/unsubscribe', unsubscribe);
  return r;
}

module.exports = { createLifecycleRouter, createUnsubscribeRouter };
