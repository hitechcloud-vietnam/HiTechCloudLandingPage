'use strict';

const crypto = require('node:crypto');
const config = require('./config');

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

// Keys whose values never reach the logs (matched case-insensitively, ignoring - and _).
const SENSITIVE_KEY = /^pass$|password|passwd|passphrase|token|authorization|cookie|secret|apikey|checksumkey|signature|accesskey|privatekey|smtpurl|credential/;
const REDACTED = '[REDACTED]';

function isSensitiveKey(key) {
  return SENSITIVE_KEY.test(String(key).toLowerCase().replace(/[-_]/g, ''));
}

// Masks credentials that commonly leak inside free text (URLs, auth headers).
function redactString(s) {
  return String(s)
    .replace(/(\/\/)[^/\s:@]+:[^/\s@]+@/g, '$1[REDACTED]@')
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [REDACTED]');
}

function serializeError(err) {
  const out = { type: err.name || 'Error', message: redactString(err.message) };
  if (err.code !== undefined) out.code = err.code;
  if (err.status || err.statusCode) out.status = err.status || err.statusCode;
  if (err.stack) out.stack = redactString(err.stack);
  if (err.cause instanceof Error) out.cause = serializeError(err.cause);
  return out;
}

// Deep copy with sensitive keys replaced; bounded depth, safe on cycles.
function redact(value, depth = 0, seen = new WeakSet()) {
  if (value instanceof Error) return serializeError(value);
  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'bigint') return value.toString();
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  if (depth >= 6) return '[Object]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1, seen));
  if (value instanceof Date) return value.toISOString();
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = isSensitiveKey(k) && v !== undefined && v !== null && v !== '' ? REDACTED : redact(v, depth + 1, seen);
  }
  return out;
}

function formatPretty(rec) {
  const { time, level, msg, ...rest } = rec;
  const extras = Object.entries(rest)
    .filter(([k, v]) => k !== 'err' && v !== undefined)
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join(' ');
  let line = `${time.slice(11, 23)} ${level.toUpperCase().padEnd(5)} ${msg}${extras ? ' ' + extras : ''}`;
  if (rest.err) line += `\n${rest.err.stack || `${rest.err.type}: ${rest.err.message}`}`;
  return line;
}

// Structured logger: one JSON object per line (LOG_FORMAT=json) or readable text (pretty).
// Children share the parent's level/stream and add bound fields.
function createLogger({ level = 'info', format = 'json', stream = process.stdout, fields = {}, now = () => new Date() } = {}) {
  const state = { level: LEVELS[level] !== undefined ? level : 'info', format, stream, now };

  function build(bound) {
    function write(lvl, msg, extra) {
      if (LEVELS[lvl] < LEVELS[state.level]) return;
      if (msg instanceof Error) {
        extra = { ...extra, err: msg };
        msg = msg.message;
      } else if (extra instanceof Error) {
        extra = { err: extra };
      } else if (extra !== undefined && (extra === null || typeof extra !== 'object' || Array.isArray(extra))) {
        extra = { data: extra };
      }
      const rec = { time: state.now().toISOString(), level: lvl, msg: redactString(msg), ...redact({ ...bound, ...extra }) };
      let line;
      try {
        line = state.format === 'pretty' ? formatPretty(rec) : JSON.stringify(rec);
      } catch {
        line = JSON.stringify({ time: rec.time, level: lvl, msg: rec.msg, logError: 'unserializable fields' });
      }
      try {
        state.stream.write(line + '\n');
      } catch {
        // Logging must never break the caller.
      }
    }
    return {
      debug: (msg, extra) => write('debug', msg, extra),
      info: (msg, extra) => write('info', msg, extra),
      warn: (msg, extra) => write('warn', msg, extra),
      error: (msg, extra) => write('error', msg, extra),
      child: (more) => build({ ...bound, ...more }),
      isLevelEnabled: (lvl) => LEVELS[lvl] >= LEVELS[state.level],
      setLevel: (lvl) => {
        if (LEVELS[lvl] !== undefined) state.level = lvl;
      },
      get level() {
        return state.level;
      },
    };
  }
  return build(fields);
}

const logger = createLogger({ level: config.logLevel, format: config.logFormat });

const REQUEST_ID_RE = /^[A-Za-z0-9._:-]{8,128}$/;
const QUIET_PATHS = /^\/(healthz|readyz|metrics)$|^\/(vendor|uploads)\/|\.(css|js|mjs|map|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|eot)$/i;
// Opaque token-like path segments (e.g. base64url invitation tokens) are not logged.
const TOKENISH = /^(?=.*\d)(?=.*[A-Za-z])[A-Za-z0-9_-]{32,}$/;

// Path without query string; values of sensitive route params (e.g. :token) and
// token-like segments are masked.
function safePath(req) {
  const raw = (req.originalUrl || req.url || '/').split('?')[0];
  const secrets = req.sensitiveParams || [];
  return raw
    .split('/')
    .map((seg) => {
      let decoded = seg;
      try {
        decoded = decodeURIComponent(seg);
      } catch {
        // keep raw segment
      }
      return secrets.includes(decoded) || TOKENISH.test(decoded) ? ':redacted' : seg;
    })
    .join('/')
    .slice(0, 300);
}

// Assigns a request id (honours a well-formed X-Request-Id), attaches req.log and
// writes one access-log line per request. Health/metrics/static requests log at debug.
function requestLogger({ log = logger } = {}) {
  return (req, res, next) => {
    const incoming = req.get('x-request-id');
    const id = incoming && REQUEST_ID_RE.test(incoming) ? incoming : crypto.randomUUID();
    req.id = id;
    res.setHeader('X-Request-Id', id);
    req.log = log.child({ reqId: id });
    const start = process.hrtime.bigint();

    res.once('close', () => {
      const status = res.statusCode;
      const path = safePath(req);
      const level = status >= 500 ? 'warn' : QUIET_PATHS.test(path) ? 'debug' : 'info';
      if (!log.isLevelEnabled(level)) return;
      const fields = {
        method: req.method,
        path,
        route: req.routePattern,
        status,
        durationMs: Math.round(Number(process.hrtime.bigint() - start) / 1e4) / 100,
        host: req.hostname,
        ip: req.ip,
      };
      if (req.user) fields.userId = req.user.id;
      const length = res.getHeader('content-length');
      if (length !== undefined) fields.bytes = Number(length);
      if (!res.writableFinished) fields.aborted = true;
      req.log[level]('request', fields);
    });
    next();
  };
}

module.exports = { LEVELS, createLogger, logger, redact, redactString, isSensitiveKey, serializeError, requestLogger, safePath };
