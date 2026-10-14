'use strict';

const crypto = require('node:crypto');
const https = require('node:https');
const os = require('node:os');
const { logger, redactString } = require('./logger');

// POSTs JSON over https with a hard timeout; resolves with the HTTP status.
function httpsPost(url, body, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'User-Agent': 'HiTechCloud-Alerts/1.0' }, timeout: timeoutMs },
      (res) => {
        res.resume();
        resolve(res.statusCode);
      }
    );
    req.on('timeout', () => req.destroy(new Error('Error webhook timed out')));
    req.on('error', reject);
    req.end(body);
  });
}

// Groups errors of the same kind: type + message (numbers/ids normalised) + top stack frame.
function fingerprint(err) {
  const e = err instanceof Error ? err : new Error(String(err));
  const message = String(e.message || '').replace(/\d+/g, '#').slice(0, 200);
  const frame = (String(e.stack || '').split('\n').find((l) => /^\s+at /.test(l)) || '').trim().replace(/:\d+:\d+\)?$/, '');
  return crypto.createHash('sha1').update(`${e.name}|${message}|${frame}`).digest('hex').slice(0, 12);
}

// Sends throttled alerts (max one per fingerprint per throttleMs) to a Slack/Discord-
// compatible webhook. report() never throws and resolves true when an alert was sent.
function createErrorReporter({ url = '', log = logger, transport, throttleMs = 60_000, now = () => Date.now(), service = 'HiTechCloud LandingPage' } = {}) {
  const seen = new Map(); // fingerprint -> { last, suppressed }
  let enabled = !!url;
  if (enabled && !transport) {
    try {
      if (new URL(url).protocol !== 'https:') throw new Error('not https');
    } catch {
      log.warn('ERROR_WEBHOOK_URL must be an https URL; error alerts disabled');
      enabled = false;
    }
  }
  const send = transport || ((body) => httpsPost(url, body));

  async function report(err, context = {}) {
    if (!enabled) return false;
    try {
      const e = err instanceof Error ? err : new Error(typeof err === 'string' ? err : JSON.stringify(err));
      const fp = fingerprint(e);
      const t = now();
      const entry = seen.get(fp);
      if (entry && t - entry.last < throttleMs) {
        entry.suppressed++;
        return false;
      }
      const suppressed = entry ? entry.suppressed : 0;
      seen.set(fp, { last: t, suppressed: 0 });
      if (seen.size > 500) {
        for (const [k, v] of seen) if (t - v.last >= throttleMs) seen.delete(k);
      }

      const kind = context.kind || 'error';
      const where = [context.method, context.route].filter(Boolean).join(' ');
      const lines = [
        `:rotating_light: [${service}] ${kind}: ${e.name}: ${e.message}`,
        where && `Route: ${where}${context.host ? ` (host ${context.host})` : ''}`,
        context.requestId && `Request ID: ${context.requestId}`,
        `Host: ${os.hostname()} · fingerprint ${fp}${suppressed ? ` · ${suppressed} repeats suppressed` : ''}`,
        e.stack && '```\n' + String(e.stack).split('\n').slice(0, 8).join('\n') + '\n```',
      ].filter(Boolean);
      const text = redactString(lines.join('\n')).slice(0, 1900);
      const body = JSON.stringify({
        text, // Slack
        content: text, // Discord
        fingerprint: fp,
        kind,
        requestId: context.requestId,
      });
      const status = await send(body);
      if (typeof status === 'number' && (status < 200 || status >= 300)) {
        log.warn('Error webhook rejected alert', { status });
        return false;
      }
      return true;
    } catch (sendErr) {
      try {
        log.warn('Error webhook failed', { error: sendErr && sendErr.message });
      } catch {
        // never throw from reporting
      }
      return false;
    }
  }

  return {
    report,
    fingerprint,
    get enabled() {
      return enabled;
    },
  };
}

module.exports = { createErrorReporter, fingerprint, httpsPost };
