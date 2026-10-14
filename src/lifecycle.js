'use strict';

const crypto = require('node:crypto');
const { leadSecret } = require('./leadGuard');
const { parse, hasNotifyChannel } = require('./siteSettings');
const { workspacePlan } = require('./plans');
const { ownHosts, sourceLabel, rate } = require('./routes/analytics');

// Customer lifecycle: onboarding checklist, welcome / activation / weekly digest
// emails and signed unsubscribe links. Every job takes { db, mailer, config, now }
// and claims its work with a conditional UPDATE, so hourly runs never send twice.

const DAY_MS = 86400_000;
const ICT_MS = 7 * 3600_000; // Asia/Ho_Chi_Minh is UTC+7 all year (no DST)
const DIGEST_HOUR = 8; // local time on Monday
const NUDGE_AFTER_DAYS = 3;
const NUDGE_WINDOW_DAYS = 7; // older accounts (e.g. at first deploy) are never nudged
const WELCOME_CATCHUP_DAYS = 2;
const TOP_SOURCES = 3;

// Marketing email kinds -> users column holding the opt-in flag.
const PREFS = { digest: 'email_digest', tips: 'email_tips' };
const PREF_LABEL = { digest: 'Tóm tắt lead hằng tuần', tips: 'Mẹo & nhắc nhở' };

const sqlTime = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const dmy = (day) => `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;
const fmtRate = (r) => (r === null ? '—' : `${String(r).replace('.', ',')}%`);

// ---------- Unsubscribe tokens ----------

// LEAD_SECRET (or the key leadGuard derives/persists without it), domain-separated.
function unsubscribeKey(config) {
  const base = (config && config.leadSecret) || leadSecret();
  return crypto.createHmac('sha256', String(base)).update('htc-email-unsubscribe').digest();
}

function tokenMac(config, userId, kind) {
  return crypto.createHmac('sha256', unsubscribeKey(config)).update(`unsub:${userId}:${kind}`).digest('base64url').slice(0, 32);
}

function unsubscribeToken(config, userId, kind) {
  if (!PREFS[kind]) throw new Error(`Unknown email kind: ${kind}`);
  return `${userId}.${kind}.${tokenMac(config, userId, kind)}`;
}

// Returns { userId, kind } for a genuine token, otherwise null.
function verifyUnsubscribeToken(config, token) {
  const m = /^(\d{1,12})\.(digest|tips)\.([A-Za-z0-9_-]{32})$/.exec(String(token || ''));
  if (!m) return null;
  const expected = Buffer.from(tokenMac(config, Number(m[1]), m[2]));
  if (!crypto.timingSafeEqual(expected, Buffer.from(m[3]))) return null;
  return { userId: Number(m[1]), kind: m[2] };
}

function unsubscribeUrl(config, userId, kind) {
  return `${config.appUrl}/email/unsubscribe?token=${unsubscribeToken(config, userId, kind)}`;
}

// Turns one marketing email kind off. Returns false for unknown/deleted users.
function unsubscribe(db, userId, kind) {
  return db.prepare(`UPDATE users SET ${PREFS[kind]} = 0 WHERE id = ?`).run(userId).changes === 1;
}

function emailPreferences(db, userId) {
  const row = db.prepare('SELECT email_digest, email_tips FROM users WHERE id = ?').get(userId);
  return { digest: !!row.email_digest, tips: !!row.email_tips };
}

// Marketing mail: footer + List-Unsubscribe (RFC 8058 one-click) for this kind.
function sendMarketing({ mailer, config }, user, kind, { subject, text }) {
  const url = unsubscribeUrl(config, user.id, kind);
  return mailer.send({
    to: user.email,
    subject,
    text: `${text}\n\n—\nBạn nhận email này vì đang bật "${PREF_LABEL[kind]}" trong Cài đặt tài khoản HiTechCloud.\nHủy nhận loại email này: ${url}`,
    headers: { 'List-Unsubscribe': `<${url}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
  });
}

// ---------- Welcome (transactional) ----------

// Sends the welcome email to new accounts that have not had one: a single user
// right after signup (userId), or a catch-up sweep of the last few days.
function sendWelcomeEmails({ db, mailer, config, now = new Date(), userId = null }) {
  const users = userId
    ? db.prepare('SELECT id, email, name FROM users WHERE id = ? AND welcome_sent_at IS NULL AND suspended_at IS NULL').all(userId)
    : db
      .prepare('SELECT id, email, name FROM users WHERE welcome_sent_at IS NULL AND suspended_at IS NULL AND created_at >= ?')
      .all(sqlTime(now.getTime() - WELCOME_CATCHUP_DAYS * DAY_MS));
  const claim = db.prepare('UPDATE users SET welcome_sent_at = ? WHERE id = ? AND welcome_sent_at IS NULL');
  let sent = 0;
  for (const u of users) {
    if (claim.run(sqlTime(now.getTime()), u.id).changes !== 1) continue;
    mailer.send({
      to: u.email,
      subject: 'Chào mừng bạn đến với HiTechCloud LandingPage',
      text:
        `Chào ${u.name},\n\nCảm ơn bạn đã đăng ký HiTechCloud LandingPage! 3 mẹo để có landing page đầu tiên trong vài phút:\n\n` +
        '1. Bắt đầu từ mẫu có sẵn: khi tạo website, chọn "Thu lead nhanh", "Bán sản phẩm"… rồi kéo thả để chỉnh sửa, không cần biết code.\n' +
        '2. Xác minh email rồi bấm "Xuất bản": trang lên mạng ngay tại tên miền phụ miễn phí để bạn chia sẻ với khách hàng.\n' +
        '3. Bật thông báo lead qua email, Telegram, Slack hoặc Google Sheets trong Cài đặt của website để không bỏ lỡ khách hàng nào.\n\n' +
        `Bắt đầu ngay: ${config.appUrl}/app/`,
    });
    sent++;
  }
  return sent;
}

// ---------- Activation nudge (marketing, once ever) ----------

// 3 days after signup, owners whose workspaces have no published page yet.
function sendActivationNudges({ db, mailer, config, now = new Date() }) {
  const users = db
    .prepare(
      `SELECT u.id, u.email, u.name, u.email_verified_at,
              EXISTS (SELECT 1 FROM memberships m JOIN sites s ON s.workspace_id = m.workspace_id
                      WHERE m.user_id = u.id AND m.role = 'owner') AS has_site
       FROM users u
       WHERE u.nudge_sent_at IS NULL AND u.suspended_at IS NULL AND u.email_tips = 1
         AND u.created_at <= ? AND u.created_at > ?
         AND EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = u.id AND m.role = 'owner')
         AND NOT EXISTS (SELECT 1 FROM memberships m JOIN sites s ON s.workspace_id = m.workspace_id
                         JOIN pages p ON p.site_id = s.id
                         WHERE m.user_id = u.id AND m.role = 'owner' AND p.published_at IS NOT NULL)`
    )
    .all(sqlTime(now.getTime() - NUDGE_AFTER_DAYS * DAY_MS), sqlTime(now.getTime() - (NUDGE_AFTER_DAYS + NUDGE_WINDOW_DAYS) * DAY_MS));
  const claim = db.prepare('UPDATE users SET nudge_sent_at = ? WHERE id = ? AND nudge_sent_at IS NULL');
  let sent = 0;
  for (const u of users) {
    if (claim.run(sqlTime(now.getTime()), u.id).changes !== 1) continue;
    const steps = [];
    if (!u.email_verified_at) steps.push('Xác minh email: bấm liên kết trong email xác minh, hoặc "Gửi lại email xác minh" trên bảng điều khiển.');
    if (!u.has_site) steps.push('Tạo website từ một mẫu có sẵn (Thu lead nhanh, Bán sản phẩm, Sự kiện…).');
    steps.push('Thay tiêu đề, hình ảnh và số điện thoại bằng thông tin của bạn.');
    steps.push('Bấm "Xuất bản" và chia sẻ đường dẫn với khách hàng.');
    sendMarketing({ mailer, config }, u, 'tips', {
      subject: 'Landing page đầu tiên của bạn chỉ còn vài bước nữa',
      text:
        `Chào ${u.name},\n\nBạn đã tạo tài khoản HiTechCloud được vài ngày nhưng chưa xuất bản trang nào. Chỉ mất khoảng 10 phút:\n\n` +
        `${steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\nTiếp tục: ${config.appUrl}/app/`,
    });
    sent++;
  }
  return sent;
}

// ---------- Weekly lead digest (marketing, once per week per workspace) ----------

// On Monday from 08:00 Asia/Ho_Chi_Minh: the week key (that Monday) and the
// previous Monday–Sunday plus the week before it. null at any other time.
// Leads are bounded in local time; page views are stored per UTC day.
function digestPeriod(now) {
  const local = now.getTime() + ICT_MS;
  const d = new Date(local);
  if (d.getUTCDay() !== 1 || d.getUTCHours() < DIGEST_HOUR) return null;
  const monday = Math.floor(local / DAY_MS) * DAY_MS;
  const span = (weeksBack) => {
    const start = monday - weeksBack * 7 * DAY_MS;
    const end = start + 7 * DAY_MS;
    return { from: isoDay(start), to: isoDay(end - DAY_MS), start: sqlTime(start - ICT_MS), end: sqlTime(end - ICT_MS) };
  };
  return { week: isoDay(monday), current: span(1), previous: span(2) };
}

// Leads (spam excluded), views and conversion per site, plus top lead sources.
function workspaceDigest(db, config, workspaceId, period) {
  const views = db.prepare(
    `SELECT COALESCE(SUM(v.views), 0) AS n FROM pages p JOIN page_views v ON v.page_id = p.id
     WHERE p.site_id = ? AND v.day BETWEEN ? AND ?`
  );
  const leads = db.prepare("SELECT COUNT(*) AS n FROM leads WHERE site_id = ? AND created_at >= ? AND created_at < ? AND status != 'spam'");
  const sources = db.prepare(
    `SELECT CASE WHEN json_valid(source_json) THEN json_extract(source_json, '$.utm_source') END AS utm,
            CASE WHEN json_valid(source_json) THEN json_extract(source_json, '$.ref') END AS ref,
            COUNT(*) AS n
     FROM leads WHERE site_id = ? AND created_at >= ? AND created_at < ? AND status != 'spam' GROUP BY utm, ref`
  );
  const { current: cur, previous: prev } = period;
  const totals = { views: 0, leads: 0, previous: { views: 0, leads: 0 } };
  const bySource = new Map();
  const sites = db.prepare('SELECT * FROM sites WHERE workspace_id = ? ORDER BY id').all(workspaceId).map((site) => {
    const row = {
      siteId: site.id,
      name: site.name,
      views: views.get(site.id, cur.from, cur.to).n,
      leads: leads.get(site.id, cur.start, cur.end).n,
    };
    totals.views += row.views;
    totals.leads += row.leads;
    totals.previous.views += views.get(site.id, prev.from, prev.to).n;
    totals.previous.leads += leads.get(site.id, prev.start, prev.end).n;
    const own = ownHosts(site, config);
    for (const s of sources.all(site.id, cur.start, cur.end)) {
      const label = sourceLabel(s.utm, s.ref, own);
      bySource.set(label, (bySource.get(label) || 0) + s.n);
    }
    return { ...row, rate: rate(row.leads, row.views) };
  });
  totals.rate = rate(totals.leads, totals.views);
  totals.previous.rate = rate(totals.previous.leads, totals.previous.views);
  const topSources = [...bySource]
    .map(([source, n]) => ({ source, leads: n }))
    .sort((a, b) => b.leads - a.leads || a.source.localeCompare(b.source))
    .slice(0, TOP_SOURCES);
  return { sites, totals, topSources };
}

function digestText(ws, digest, period, recipient, config) {
  const { totals } = digest;
  const { from, to } = period.current;
  let rateLine = `• Tỷ lệ chuyển đổi: ${fmtRate(totals.rate)} (tuần trước: ${fmtRate(totals.previous.rate)}`;
  if (totals.rate !== null && totals.previous.rate !== null) {
    const diff = Math.round((totals.rate - totals.previous.rate) * 100) / 100;
    rateLine += `, ${diff >= 0 ? '+' : ''}${String(diff).replace('.', ',')} điểm %`;
  }
  rateLine += ')';
  const lines = [
    `Chào ${recipient.name},`,
    '',
    `Tuần qua (${dmy(from)} – ${dmy(to)}), workspace "${ws.name}" có:`,
    `• ${totals.leads} lead mới (tuần trước: ${totals.previous.leads})`,
    `• ${totals.views} lượt xem trang (tuần trước: ${totals.previous.views})`,
    rateLine,
    '',
    'Theo website:',
    ...digest.sites.map((s) => `• ${s.name}: ${s.leads} lead · ${s.views} lượt xem · tỷ lệ ${fmtRate(s.rate)}`),
  ];
  if (digest.topSources.length) {
    lines.push('', 'Nguồn lead hàng đầu (utm_source hoặc trang giới thiệu):');
    for (const s of digest.topSources) lines.push(`• ${s.source}: ${s.leads} lead`);
  }
  lines.push('', `Xem chi tiết và xử lý lead: ${config.appUrl}/app/`);
  return lines.join('\n');
}

function sendWeeklyDigests({ db, mailer, config, now = new Date() }) {
  const period = digestPeriod(now);
  if (!period) return 0;
  const workspaces = db
    .prepare('SELECT id, name FROM workspaces WHERE (digest_week IS NULL OR digest_week != ?) AND EXISTS (SELECT 1 FROM sites s WHERE s.workspace_id = workspaces.id)')
    .all(period.week);
  const claim = db.prepare('UPDATE workspaces SET digest_week = ? WHERE id = ? AND (digest_week IS NULL OR digest_week != ?)');
  const recipients = db.prepare(
    `SELECT u.id, u.email, u.name FROM memberships m JOIN users u ON u.id = m.user_id
     WHERE m.workspace_id = ? AND m.role IN ('owner', 'admin') AND u.suspended_at IS NULL AND u.email_digest = 1 ORDER BY u.id`
  );
  let sent = 0;
  for (const ws of workspaces) {
    // Claimed even when nothing is sent: the report covers a closed week.
    if (claim.run(period.week, ws.id, period.week).changes !== 1) continue;
    const digest = workspaceDigest(db, config, ws.id, period);
    if (!digest.totals.views && !digest.totals.leads) continue;
    for (const r of recipients.all(ws.id)) {
      sendMarketing({ mailer, config }, r, 'digest', {
        subject: `Tóm tắt tuần ${dmy(period.current.from).slice(0, 5)}–${dmy(period.current.to)}: ${digest.totals.leads} lead mới · ${ws.name}`,
        text: digestText(ws, digest, period, r, config),
      });
      sent++;
    }
  }
  return sent;
}

// ---------- Onboarding checklist ----------

function onboardingStatus(db, { userId, workspace }) {
  const has = (sql, ...args) => !!db.prepare(sql).get(...args);
  const sites = db.prepare('SELECT id, settings_json, custom_domain, domain_verified_at FROM sites WHERE workspace_id = ? ORDER BY id').all(workspace.id);
  const plan = workspacePlan(workspace);
  const steps = [
    { id: 'verify_email', done: has('SELECT 1 FROM users WHERE id = ? AND email_verified_at IS NOT NULL', userId) },
    { id: 'create_site', done: sites.length > 0 },
    {
      id: 'publish_page',
      done: has('SELECT 1 FROM pages p JOIN sites s ON s.id = p.site_id WHERE s.workspace_id = ? AND p.published_at IS NOT NULL LIMIT 1', workspace.id),
    },
    {
      id: 'first_lead',
      done: has("SELECT 1 FROM leads l JOIN sites s ON s.id = l.site_id WHERE s.workspace_id = ? AND l.status != 'spam' LIMIT 1", workspace.id),
    },
    { id: 'lead_notify', done: sites.some((s) => hasNotifyChannel(parse(s))) },
    { id: 'custom_domain', done: sites.some((s) => s.custom_domain && s.domain_verified_at), optional: true, available: !!plan.customDomain },
  ].map((s) => ({ optional: false, ...s }));
  const required = steps.filter((s) => !s.optional);
  const completed = required.filter((s) => s.done).length;
  const dismissed = has('SELECT 1 FROM onboarding_dismissals WHERE user_id = ? AND workspace_id = ?', userId, workspace.id);
  const allDone = completed === required.length;
  return { steps, completed, total: required.length, allDone, dismissed, visible: !allDone && !dismissed, firstSiteId: sites.length ? sites[0].id : null };
}

function dismissOnboarding(db, userId, workspaceId) {
  db.prepare('INSERT OR IGNORE INTO onboarding_dismissals (user_id, workspace_id) VALUES (?, ?)').run(userId, workspaceId);
}

module.exports = {
  PREFS,
  PREF_LABEL,
  sendWelcomeEmails,
  sendActivationNudges,
  sendWeeklyDigests,
  digestPeriod,
  workspaceDigest,
  unsubscribeToken,
  unsubscribeUrl,
  verifyUnsubscribeToken,
  unsubscribe,
  emailPreferences,
  onboardingStatus,
  dismissOnboarding,
};
