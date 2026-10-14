'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

// Object storage for uploaded images. `local` writes under config.uploadsDir
// (served at /uploads by app.js); `s3` talks to any S3-compatible service
// (AWS S3, Cloudflare R2, MinIO, Viettel/VNPT/FPT object storage) using
// AWS Signature V4, without the AWS SDK.

const CACHE_CONTROL = 'public, max-age=31536000, immutable';
const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const TIMEOUT_MS = 30000;

const sha256Hex = (data) => crypto.createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

// RFC 3986 encoding as required by SigV4 (encodeURIComponent leaves !'()* alone).
function uriEncode(str) {
  return encodeURIComponent(str).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

// Object keys keep "/" as path separators.
function encodeKey(key) {
  return String(key).split('/').map(uriEncode).join('/');
}

function checkKey(key) {
  const k = String(key || '');
  if (!k || k.startsWith('/') || k.split('/').some((s) => !s || s === '.' || s === '..')) {
    throw new Error(`Invalid storage key: ${k}`);
  }
  return k;
}

// AWS Signature V4 for a single request. `url` must already be encoded the way
// it is sent; every header in `headers` is signed, plus `host` from the URL.
// Returns the header set to send, including x-amz-date and authorization.
function signV4({ method, url, headers = {}, payloadHash, accessKeyId, secretAccessKey, region, service = 's3', date = new Date() }) {
  const u = new URL(url);
  const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const all = { ...headers, host: u.host, 'x-amz-date': amzDate, 'x-amz-content-sha256': payloadHash };
  const canon = {};
  for (const [k, v] of Object.entries(all)) canon[k.toLowerCase()] = String(v).trim().replace(/\s+/g, ' ');
  const names = Object.keys(canon).sort();
  const signedHeaders = names.join(';');
  const query = [...u.searchParams]
    .map(([k, v]) => [uriEncode(k), uriEncode(v)])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const canonicalRequest = [
    method,
    u.pathname || '/',
    query,
    names.map((n) => `${n}:${canon[n]}\n`).join(''),
    signedHeaders,
    payloadHash,
  ].join('\n');
  const scope = `${day}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, day), region), service), 'aws4_request');
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  const out = { ...headers, 'x-amz-date': amzDate, 'x-amz-content-sha256': payloadHash };
  out.authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { headers: out, canonicalRequest, stringToSign, signature };
}

function createLocalStorage(config) {
  const root = path.resolve(config.uploadsDir);
  fs.mkdirSync(root, { recursive: true });
  const fileFor = (key) => {
    const file = path.resolve(root, checkKey(key));
    if (!file.startsWith(root + path.sep)) throw new Error(`Invalid storage key: ${key}`);
    return file;
  };
  return {
    kind: 'local',
    async put(key, buffer) {
      const file = fileFor(key);
      await fs.promises.mkdir(path.dirname(file), { recursive: true });
      await fs.promises.writeFile(file, buffer);
    },
    async remove(key) {
      await fs.promises.rm(fileFor(key), { force: true });
    },
    urlFor: (key) => `/uploads/${encodeKey(key)}`,
  };
}

function createS3Storage(config) {
  const s3 = config.s3;
  if (!s3.accessKeyId || !s3.secretAccessKey) throw new Error('S3_BUCKET is set but S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY are missing');
  const region = s3.region || 'us-east-1';
  const endpoint = new URL(s3.endpoint || `https://s3.${region}.amazonaws.com`);
  const base = endpoint.origin + endpoint.pathname.replace(/\/+$/, '');
  const pathStyle = Boolean(s3.forcePathStyle);
  const bucketBase = pathStyle ? `${base}/${uriEncode(s3.bucket)}` : `${endpoint.protocol}//${s3.bucket}.${endpoint.host}${endpoint.pathname.replace(/\/+$/, '')}`;
  const publicBase = s3.publicUrl ? String(s3.publicUrl).replace(/\/+$/, '') : bucketBase;
  const doFetch = config.fetch || globalThis.fetch;
  const objectUrl = (key) => `${bucketBase}/${encodeKey(checkKey(key))}`;

  async function send(method, key, { body, headers = {} } = {}) {
    const url = objectUrl(key);
    const payloadHash = body ? sha256Hex(body) : EMPTY_SHA256;
    const signed = signV4({ method, url, headers, payloadHash, accessKeyId: s3.accessKeyId, secretAccessKey: s3.secretAccessKey, region });
    const res = await doFetch(url, { method, headers: signed.headers, body, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`S3 ${method} ${key} failed: HTTP ${res.status} ${text.slice(0, 300)}`);
    }
    return res;
  }

  return {
    kind: 's3',
    async put(key, buffer, contentType) {
      await send('PUT', key, {
        body: buffer,
        headers: { 'content-type': contentType || 'application/octet-stream', 'cache-control': CACHE_CONTROL },
      });
    },
    async remove(key) {
      await send('DELETE', key);
    },
    urlFor: (key) => `${publicBase}/${encodeKey(key)}`,
  };
}

function createStorage(config) {
  if (config.s3 && config.s3.bucket) return createS3Storage(config);
  return createLocalStorage(config);
}

// Asset keys of the given workspaces; read before deleting the rows, which cascade.
function workspaceAssetKeys(db, workspaceIds) {
  const q = db.prepare('SELECT path FROM assets WHERE workspace_id = ?');
  return workspaceIds.flatMap((id) => q.all(id).map((a) => a.path));
}

// Best-effort removal after the database rows are gone: a failure is logged, never thrown.
async function removeObjects(storage, keys, log) {
  for (const key of keys) {
    try {
      await storage.remove(key);
    } catch (err) {
      log.warn('Asset removal failed', { key, err });
    }
  }
}

module.exports = { createStorage, signV4, CACHE_CONTROL, workspaceAssetKeys, removeObjects };
