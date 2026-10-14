'use strict';

const { escapeHtml } = require('./render');
const { logger } = require('./logger');

// Sends transactional email over SMTP (SMTP_URL). Without SMTP it logs the
// message, which keeps local development and tests working. Sending never
// throws: a mail outage must not break signup, billing or lead capture.
function createMailer(config) {
  const outbox = [];
  let transport = null;
  if (config.smtpUrl) {
    const nodemailer = require('nodemailer');
    transport = nodemailer.createTransport(config.smtpUrl);
  }

  async function send({ to, subject, text, html, headers }) {
    const msg = { from: config.mailFrom, to, subject, text, html: html || layout(subject, text), ...(headers && { headers }) };
    outbox.push(msg);
    if (outbox.length > 100) outbox.shift();
    if (!transport) {
      if (!config.quietMail) console.log(`[mail] to=${to} subject="${subject}"\n${text}\n`);
      return false;
    }
    try {
      await transport.sendMail(msg);
      return true;
    } catch (err) {
      (config.logger || logger).error(`[mail] gửi tới ${to} thất bại: ${err.message}`, { component: 'mail' });
      return false;
    }
  }

  return { send, outbox };
}

// Minimal responsive HTML wrapper; URLs in the text become links.
function layout(title, text) {
  const body = escapeHtml(text)
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#2563eb">$1</a>')
    .replace(/\n/g, '<br>');
  return `<!doctype html><html><body style="margin:0;background:#f8fafc;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a">
<div style="max-width:560px;margin:0 auto;padding:24px">
<div style="font-weight:800;font-size:20px;color:#2563eb;margin-bottom:16px">HiTech<span style="color:#0f172a">Cloud</span></div>
<div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:24px">
<h2 style="margin:0 0 12px;font-size:18px">${escapeHtml(title)}</h2><div style="line-height:1.6">${body}</div></div>
<p style="color:#64748b;font-size:12px;margin-top:16px">HiTechCloud LandingPage · Pho Tue SoftWare Solutions JSC</p>
</div></body></html>`;
}

module.exports = { createMailer };
