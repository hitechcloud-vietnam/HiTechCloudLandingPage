'use strict';

const crypto = require('node:crypto');
const { HttpError } = require('./access');
const { renderMessage } = require('./render');

// Trust & safety: phishing heuristics on publish, site/user suspension, owner emails.

const REPORT_REASONS = {
  phishing: 'Lừa đảo / giả mạo',
  malware: 'Nội dung độc hại',
  copyright: 'Vi phạm bản quyền',
  spam: 'Spam',
  other: 'Khác',
};

// Score at which a published page enters the admin review queue.
const FLAG_THRESHOLD = 45;
// Score at which a page with a password field AND a bank/e-wallet brand is auto-suspended.
const AUTO_SUSPEND_THRESHOLD = 60;
const AUTO_REASON = 'Tự động: trang có dấu hiệu lừa đảo/giả mạo ngân hàng, đang chờ quản trị viên xem xét';
// Set on the sites of a suspended account, so unsuspending the account restores exactly those.
const OWNER_REASON = 'Tài khoản chủ sở hữu đã bị tạm ngưng do vi phạm điều khoản sử dụng';
const OWNED_SITES = "workspace_id IN (SELECT workspace_id FROM memberships WHERE user_id = ? AND role = 'owner')";

// Banks, e-wallets and payment brands commonly impersonated in Vietnam (ASCII, lowercase).
const BRANDS = [
  'vietcombank', 'vietinbank', 'bidv', 'agribank', 'techcombank', 'mbbank', 'mb bank', 'acb', 'vpbank', 'tpbank',
  'sacombank', 'vib', 'shb', 'hdbank', 'ocb', 'msb', 'seabank', 'eximbank', 'lienvietpostbank', 'lpbank', 'scb',
  'abbank', 'namabank', 'nam a bank', 'pvcombank', 'bac a bank', 'vietbank', 'kienlongbank', 'baoviet bank',
  'momo', 'zalopay', 'vnpay', 'shopeepay', 'viettel money', 'viettelpay', 'paypal', 'napas',
];
const BRAND_RE = new RegExp(`\\b(${BRANDS.map((b) => b.replace(/ /g, '\\s*')).join('|')})\\b`, 'i');

const PHRASES = [
  /dang nhap ngan hang/,
  /dang nhap (vao )?(tai khoan )?(internet|mobile|e-?)\s*banking/,
  /xac (minh|thuc) tai khoan/,
  /tai khoan (cua (ban|quy khach) )?(da )?(bi|se bi) (tam )?(khoa|dong bang|vo hieu)/,
  /cap nhat thong tin (the|tai khoan ngan hang)/,
  /nhap (ma )?otp/,
  /verify your (account|identity)/,
  /your account (has been|will be) (suspended|locked|limited)/,
];

function normalize(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function attr(tag, name) {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return m ? (m[2] ?? m[3] ?? m[4] ?? '') : '';
}

function visibleText(html) {
  return String(html || '')
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ');
}

// Conservative phishing heuristics over the page HTML. Returns
// { score, reasons[], flag, autoSuspend }; reasons are Vietnamese, for admins only.
function scanPage({ title = '', html = '' }) {
  const src = String(html || '');
  const reasons = [];
  let score = 0;
  const hit = (points, reason) => {
    score += points;
    reasons.push(reason);
  };

  const inputs = src.match(/<(input|select|textarea)\b[^>]*>/gi) || [];
  const fieldTokens = (tag) => normalize([attr(tag, 'name'), attr(tag, 'id'), attr(tag, 'placeholder'), attr(tag, 'autocomplete')].join(' '));
  const has = { password: false, card: false, cvv: false, otp: false, pin: false };
  for (const tag of inputs) {
    const type = attr(tag, 'type').toLowerCase();
    const t = fieldTokens(tag);
    if (type === 'password' || /\b(current|new)-password\b/.test(t)) has.password = true;
    if (/card.?(number|no|num)\b|\bcc.?(number|num)\b|\bso the\b|\bsothe\b|\bso_the\b|cc-number/.test(t)) has.card = true;
    if (/\b(cvv|cvc|cvv2|cc-csc)\b/.test(t)) has.cvv = true;
    if (/\botp\b|\bma.?otp\b|one-time-code/.test(t)) has.otp = true;
    if (/\bpin\b|\bma.?pin\b/.test(t)) has.pin = true;
  }
  if (has.password) hit(30, 'Có ô nhập mật khẩu');
  if (has.card) hit(30, 'Có ô nhập số thẻ thanh toán');
  if (has.cvv) hit(30, 'Có ô nhập mã CVV/CVC');
  if (has.otp) hit(25, 'Có ô nhập mã OTP');
  if (has.pin) hit(20, 'Có ô nhập mã PIN');

  const text = normalize(`${title} ${visibleText(src)}`);
  const phrases = PHRASES.filter((re) => re.test(text)).length;
  if (phrases) hit(Math.min(30, phrases * 15), 'Có cụm từ thường gặp ở trang lừa đảo (đăng nhập ngân hàng, xác minh tài khoản, OTP…)');

  const titleBrand = BRAND_RE.exec(normalize(title));
  const bodyBrand = !titleBrand && BRAND_RE.exec(text);
  if (titleBrand) hit(20, `Tiêu đề nhắc tới thương hiệu ngân hàng/ví điện tử (${titleBrand[1]})`);
  else if (bodyBrand) hit(10, `Nội dung nhắc tới thương hiệu ngân hàng/ví điện tử (${bodyBrand[1]})`);

  const offsite = (src.match(/<form\b[^>]*>/gi) || [])
    .map((tag) => attr(tag, 'action'))
    .filter((a) => /^\s*(https?:)?\/\//i.test(a));
  if (offsite.length) hit(20, 'Biểu mẫu gửi dữ liệu tới máy chủ bên ngoài');
  if (src.toLowerCase().includes('api.telegram.org/bot')) hit(40, 'Mã gửi dữ liệu tới Telegram bot');

  const brand = !!(titleBrand || bodyBrand);
  return {
    score,
    reasons,
    flag: score >= FLAG_THRESHOLD,
    autoSuspend: score >= AUTO_SUSPEND_THRESHOLD && has.password && brand,
  };
}

// 451 page served for every URL of a suspended site.
function suspendedPage() {
  return renderMessage(
    'Trang đã bị tạm ngưng do vi phạm điều khoản',
    'Website này đã bị tạm ngưng do vi phạm điều khoản sử dụng của HiTechCloud. Nếu bạn là chủ sở hữu, vui lòng liên hệ bộ phận hỗ trợ.',
    451
  );
}

// Rejects publishing on a suspended site.
function assertSiteActive(db, siteId) {
  const site = db.prepare('SELECT suspended_at FROM sites WHERE id = ?').get(siteId);
  if (site && site.suspended_at) {
    throw new HttpError(403, 'Website đang bị tạm ngưng do vi phạm điều khoản nên không thể xuất bản. Vui lòng liên hệ hỗ trợ.');
  }
}

function createSafety({ db, config = {}, mailer }) {
  const send = (to, subject, text) => (mailer && to ? mailer.send({ to, subject, text }) : Promise.resolve(false));
  const support = config.appUrl ? `${config.appUrl}/app/` : '';

  function ownerEmails(workspaceId) {
    return db
      .prepare("SELECT u.email FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? AND m.role = 'owner'")
      .all(workspaceId)
      .map((r) => r.email);
  }

  function notifyOwners(site, subject, text) {
    for (const to of ownerEmails(site.workspace_id)) send(to, subject, text);
  }

  function suspendSite(siteId, reason, { notify = true } = {}) {
    const site = db.prepare('SELECT * FROM sites WHERE id = ?').get(siteId);
    if (!site) throw new HttpError(404, 'Không tìm thấy website');
    db.prepare("UPDATE sites SET suspended_at = datetime('now'), suspended_reason = ? WHERE id = ?").run(reason, site.id);
    if (notify) {
      notifyOwners(
        site,
        `Website "${site.name}" đã bị tạm ngưng`,
        `Website "${site.name}" (${site.subdomain}) đã bị tạm ngưng do vi phạm điều khoản sử dụng.\n\nLý do: ${reason}\n\n` +
          'Trong thời gian tạm ngưng, các trang của website không thể truy cập, không nhận form và không thể xuất bản. ' +
          `Nếu bạn cho rằng đây là nhầm lẫn, vui lòng trả lời email này hoặc liên hệ bộ phận hỗ trợ.${support ? `\n\n${support}` : ''}`
      );
    }
    return db.prepare('SELECT * FROM sites WHERE id = ?').get(site.id);
  }

  function unsuspendSite(siteId) {
    const site = db.prepare('SELECT * FROM sites WHERE id = ?').get(siteId);
    if (!site) throw new HttpError(404, 'Không tìm thấy website');
    if (!site.suspended_at) return site;
    db.prepare('UPDATE sites SET suspended_at = NULL, suspended_reason = NULL WHERE id = ?').run(site.id);
    notifyOwners(site, `Website "${site.name}" đã được khôi phục`, `Website "${site.name}" (${site.subdomain}) đã được gỡ tạm ngưng và hoạt động trở lại.`);
    return db.prepare('SELECT * FROM sites WHERE id = ?').get(site.id);
  }

  function suspendUser(userId, reason) {
    const user = db.prepare('SELECT id, email FROM users WHERE id = ?').get(userId);
    if (!user) throw new HttpError(404, 'Không tìm thấy người dùng');
    if ((config.superAdmins || []).includes(user.email.toLowerCase())) throw new HttpError(400, 'Không thể tạm ngưng tài khoản quản trị nền tảng');
    db.prepare("UPDATE users SET suspended_at = datetime('now'), suspended_reason = ? WHERE id = ?").run(reason, user.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
    // The account's own sites go offline too; sites already suspended keep their reason.
    db.prepare(`UPDATE sites SET suspended_at = datetime('now'), suspended_reason = ? WHERE suspended_at IS NULL AND ${OWNED_SITES}`).run(OWNER_REASON, user.id);
    send(
      user.email,
      'Tài khoản HiTechCloud của bạn đã bị tạm ngưng',
      `Tài khoản ${user.email} đã bị tạm ngưng do vi phạm điều khoản sử dụng.\n\nLý do: ${reason}\n\nNếu bạn cho rằng đây là nhầm lẫn, vui lòng trả lời email này để được hỗ trợ.`
    );
  }

  function unsuspendUser(userId) {
    const user = db.prepare('SELECT id, email, suspended_at FROM users WHERE id = ?').get(userId);
    if (!user) throw new HttpError(404, 'Không tìm thấy người dùng');
    if (!user.suspended_at) return;
    db.prepare('UPDATE users SET suspended_at = NULL, suspended_reason = NULL WHERE id = ?').run(user.id);
    db.prepare(`UPDATE sites SET suspended_at = NULL, suspended_reason = NULL WHERE suspended_reason = ? AND ${OWNED_SITES}`).run(OWNER_REASON, user.id);
    send(user.email, 'Tài khoản HiTechCloud của bạn đã được khôi phục', `Tài khoản ${user.email} đã được gỡ tạm ngưng. Bạn có thể đăng nhập lại.`);
  }

  // Scans a just-published page; queues it for review and may auto-suspend the site.
  // Returns { flagged, suspended } (scores and reasons stay admin-only).
  function onPublish(pageId) {
    const page = db.prepare('SELECT id, site_id, title, published_html FROM pages WHERE id = ?').get(pageId);
    if (!page) return { flagged: false, suspended: false };
    const result = scanPage({ title: page.title, html: page.published_html });
    if (!result.flag) return { flagged: false, suspended: false };
    const hash = crypto.createHash('sha256').update(`${page.title}\n${page.published_html}`).digest('hex');
    // An admin already cleared this exact content: do not re-queue it.
    if (db.prepare("SELECT 1 FROM safety_flags WHERE page_id = ? AND content_hash = ? AND status = 'dismissed'").get(page.id, hash)) {
      return { flagged: false, suspended: false };
    }
    const site = db.prepare('SELECT * FROM sites WHERE id = ?').get(page.site_id);
    const auto = result.autoSuspend && config.safetyAutoSuspend !== false && !site.suspended_at;
    const open = db.prepare("SELECT id, auto_suspended FROM safety_flags WHERE page_id = ? AND status = 'open'").get(page.id);
    const reasons = JSON.stringify(result.reasons);
    if (open) {
      db.prepare("UPDATE safety_flags SET score = ?, reasons_json = ?, content_hash = ?, auto_suspended = ?, updated_at = datetime('now') WHERE id = ?")
        .run(result.score, reasons, hash, open.auto_suspended || (auto ? 1 : 0), open.id);
    } else {
      db.prepare('INSERT INTO safety_flags (site_id, page_id, score, reasons_json, content_hash, auto_suspended) VALUES (?, ?, ?, ?, ?, ?)')
        .run(site.id, page.id, result.score, reasons, hash, auto ? 1 : 0);
    }
    if (auto) {
      suspendSite(site.id, AUTO_REASON);
      for (const to of config.superAdmins || []) {
        send(to, `[An toàn nội dung] Tự động tạm ngưng website "${site.name}"`, `Trang "${page.title}" (website #${site.id}, ${site.subdomain}) có điểm rủi ro ${result.score}:\n- ${result.reasons.join('\n- ')}\n\nXem xét tại ${config.appUrl || ''}/app/admin`);
      }
    }
    return { flagged: true, suspended: auto };
  }

  return { ownerEmails, suspendSite, unsuspendSite, suspendUser, unsuspendUser, onPublish };
}

module.exports = {
  REPORT_REASONS,
  FLAG_THRESHOLD,
  AUTO_SUSPEND_THRESHOLD,
  AUTO_REASON,
  OWNER_REASON,
  scanPage,
  suspendedPage,
  assertSiteActive,
  createSafety,
};
