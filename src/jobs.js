'use strict';

const { PLANS } = require('./plans');

const REMINDER_DAYS = [7, 1];

// Emails workspace owners/admins 7 days and 1 day before a paid plan expires.
// workspaces.expiry_notice remembers "<expiry>:<stage>" so each stage is sent once
// per subscription period, even though the job runs hourly.
function sendExpiryReminders({ db, mailer, config, now = new Date() }) {
  const horizon = new Date(now.getTime() + Math.max(...REMINDER_DAYS) * 86400_000).toISOString();
  const due = db
    .prepare("SELECT * FROM workspaces WHERE plan != 'free' AND plan_expires_at IS NOT NULL AND plan_expires_at > ? AND plan_expires_at <= ?")
    .all(now.toISOString(), horizon);

  let sent = 0;
  for (const ws of due) {
    const daysLeft = (new Date(ws.plan_expires_at) - now) / 86400_000;
    const stage = Math.min(...REMINDER_DAYS.filter((d) => daysLeft <= d));
    const key = `${ws.plan_expires_at}:${stage}`;
    if (ws.expiry_notice === key) continue;
    // A later stage already sent for this period (e.g. job was down): skip earlier ones.
    if (ws.expiry_notice && ws.expiry_notice.startsWith(`${ws.plan_expires_at}:`) && Number(ws.expiry_notice.split(':').pop()) <= stage) continue;

    const recipients = db
      .prepare("SELECT u.email, u.name FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? AND m.role IN ('owner', 'admin')")
      .all(ws.id);
    const date = new Date(ws.plan_expires_at).toLocaleDateString('vi-VN');
    for (const r of recipients) {
      mailer.send({
        to: r.email,
        subject: `Gói ${PLANS[ws.plan].name} của "${ws.name}" sắp hết hạn`,
        text: `Chào ${r.name},\n\nGói ${PLANS[ws.plan].name} của workspace "${ws.name}" sẽ hết hạn vào ${date} (còn ${Math.ceil(daysLeft)} ngày).\nSau thời điểm này workspace sẽ chuyển về gói Miễn phí: nhãn HiTechCloud xuất hiện lại, tên miền riêng và các giới hạn của gói trả phí không còn.\n\nGia hạn ngay: ${config.appUrl}/app/?tab=billing`,
      });
    }
    db.prepare('UPDATE workspaces SET expiry_notice = ? WHERE id = ?').run(key, ws.id);
    sent++;
  }
  return sent;
}

function purgeExpired(db) {
  const now = new Date().toISOString();
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
  db.prepare('DELETE FROM password_resets WHERE expires_at < ?').run(now);
  db.prepare('DELETE FROM email_verifications WHERE expires_at < ?').run(now);
  db.prepare("UPDATE orders SET status = 'cancelled' WHERE status = 'pending' AND created_at < datetime('now', '-1 day')").run();
}

function startJobs({ db, mailer, config }) {
  const run = () => {
    try {
      purgeExpired(db);
      sendExpiryReminders({ db, mailer, config });
    } catch (err) {
      console.error('[jobs]', err);
    }
  };
  run();
  return setInterval(run, 3600_000).unref();
}

module.exports = { sendExpiryReminders, purgeExpired, startJobs };
