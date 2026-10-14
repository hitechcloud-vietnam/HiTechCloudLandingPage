'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStorage, signV4, CACHE_CONTROL } = require('../src/storage');
const { startServer, client } = require('./helpers');

const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082',
  'hex'
);
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');

// Example credentials from the AWS Signature V4 documentation for S3.
const AWS_DOC = {
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  region: 'us-east-1',
  date: new Date('2013-05-24T00:00:00Z'),
};

const S3 = {
  bucket: 'htc-assets',
  endpoint: 'https://s3.example-cloud.vn',
  region: 'hn-1',
  accessKeyId: 'AKTEST',
  secretAccessKey: 'secret-test-key',
  publicUrl: 'https://cdn.example.vn/assets/',
  forcePathStyle: true,
};

// Records requests and answers like S3 (200 for PUT, 204 for DELETE).
function fakeFetch(fail = {}) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body });
    if (fail[init.method]) return new Response('<Error><Code>AccessDenied</Code></Error>', { status: 403 });
    return new Response(null, { status: init.method === 'DELETE' ? 204 : 200 });
  };
  fn.calls = calls;
  return fn;
}

test('SigV4 matches the AWS S3 documentation examples', () => {
  const get = signV4({
    ...AWS_DOC,
    method: 'GET',
    url: 'https://examplebucket.s3.amazonaws.com/test.txt',
    headers: { Range: 'bytes=0-9' },
    payloadHash: sha256(''),
  });
  assert.equal(get.signature, 'f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
  assert.equal(
    get.headers.authorization,
    'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, ' +
      'SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, ' +
      'Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41'
  );
  assert.equal(get.headers['x-amz-date'], '20130524T000000Z');

  const body = 'Welcome to Amazon S3.';
  const put = signV4({
    ...AWS_DOC,
    method: 'PUT',
    url: 'https://examplebucket.s3.amazonaws.com/test%24file.text',
    headers: { Date: 'Fri, 24 May 2013 00:00:00 GMT', 'x-amz-storage-class': 'REDUCED_REDUNDANCY' },
    payloadHash: sha256(body),
  });
  assert.equal(put.signature, '98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd');
  assert.match(put.canonicalRequest, /^PUT\n\/test%24file\.text\n\n/);

  const list = signV4({ ...AWS_DOC, method: 'GET', url: 'https://examplebucket.s3.amazonaws.com/?max-keys=2&prefix=J', payloadHash: sha256('') });
  assert.equal(list.signature, '34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7');
});

test('s3 driver signs PUT and DELETE requests', async () => {
  const fetch = fakeFetch();
  const storage = createStorage({ s3: S3, fetch });
  assert.equal(storage.kind, 's3');
  await storage.put('7/abc.png', PNG, 'image/png');
  await storage.remove('7/abc.png');

  const [put, del] = fetch.calls;
  assert.equal(put.method, 'PUT');
  assert.equal(put.url, 'https://s3.example-cloud.vn/htc-assets/7/abc.png');
  assert.equal(put.body, PNG);
  assert.equal(put.headers['content-type'], 'image/png');
  assert.equal(put.headers['cache-control'], CACHE_CONTROL);
  assert.equal(put.headers['x-amz-content-sha256'], sha256(PNG));
  assert.match(put.headers['x-amz-date'], /^\d{8}T\d{6}Z$/);
  const day = put.headers['x-amz-date'].slice(0, 8);
  assert.match(
    put.headers.authorization,
    new RegExp(
      `^AWS4-HMAC-SHA256 Credential=AKTEST/${day}/hn-1/s3/aws4_request, ` +
        'SignedHeaders=cache-control;content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$'
    )
  );
  // The signature can be reproduced from the same inputs.
  const again = signV4({
    method: 'PUT',
    url: put.url,
    headers: { 'content-type': 'image/png', 'cache-control': CACHE_CONTROL },
    payloadHash: sha256(PNG),
    accessKeyId: 'AKTEST',
    secretAccessKey: 'secret-test-key',
    region: 'hn-1',
    date: new Date(put.headers['x-amz-date'].replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z')),
  });
  assert.equal(put.headers.authorization, again.headers.authorization);

  assert.equal(del.method, 'DELETE');
  assert.equal(del.url, 'https://s3.example-cloud.vn/htc-assets/7/abc.png');
  assert.equal(del.body, undefined);
  assert.equal(del.headers['x-amz-content-sha256'], sha256(''));
  assert.match(del.headers.authorization, /SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);

  assert.equal(storage.urlFor('7/abc.png'), 'https://cdn.example.vn/assets/7/abc.png');
});

test('s3 driver URL styles and errors', async () => {
  const vhost = createStorage({ s3: { ...S3, publicUrl: '', forcePathStyle: false }, fetch: fakeFetch() });
  assert.equal(vhost.urlFor('1/a.png'), 'https://htc-assets.s3.example-cloud.vn/1/a.png');
  const aws = createStorage({ s3: { bucket: 'b', region: 'ap-southeast-1', accessKeyId: 'k', secretAccessKey: 's' } });
  assert.equal(aws.urlFor('1/a.png'), 'https://b.s3.ap-southeast-1.amazonaws.com/1/a.png');
  const minio = createStorage({ s3: { ...S3, endpoint: 'http://127.0.0.1:9000', publicUrl: '' }, fetch: fakeFetch() });
  assert.equal(minio.urlFor('1/a.png'), 'http://127.0.0.1:9000/htc-assets/1/a.png');

  assert.throws(() => createStorage({ s3: { bucket: 'b' } }), /S3_ACCESS_KEY_ID/);
  const failing = createStorage({ s3: S3, fetch: fakeFetch({ PUT: true }) });
  await assert.rejects(failing.put('1/a.png', PNG, 'image/png'), /HTTP 403 .*AccessDenied/);
  await assert.rejects(failing.put('../etc/passwd', PNG, 'image/png'), /Invalid storage key/);
});

test('local driver writes under uploadsDir', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'htc-storage-'));
  const storage = createStorage({ uploadsDir: dir, s3: { bucket: '' } });
  assert.equal(storage.kind, 'local');
  await storage.put('3/x.png', PNG, 'image/png');
  assert.deepEqual(fs.readFileSync(path.join(dir, '3/x.png')), PNG);
  assert.equal(storage.urlFor('3/x.png'), '/uploads/3/x.png');
  await storage.remove('3/x.png');
  assert.equal(fs.existsSync(path.join(dir, '3/x.png')), false);
  await assert.rejects(storage.remove('../x.png'), /Invalid storage key/);
});

test('asset upload and delete through the s3 driver', async (t) => {
  const fetch = fakeFetch();
  const { server, base } = await startServer({ s3: S3, fetch });
  t.after(() => server.close());

  const c = client(base);
  await c('POST', '/api/auth/signup', { name: 'Chủ', email: 's3@example.com', password: 'matkhau123' });
  const wsId = (await c('GET', '/api/auth/me')).data.workspaces[0].id;
  const upload = () =>
    c('POST', `/api/workspaces/${wsId}/assets`, PNG, { raw: true, headers: { 'Content-Type': 'image/png', 'X-File-Name': encodeURIComponent('Ảnh.png') } });

  const r = await upload();
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const m = r.data.src.match(new RegExp(`^https://cdn\\.example\\.vn/assets/(${wsId}/[0-9a-f]{24}\\.png)$`));
  assert.ok(m, r.data.src);
  assert.equal(r.data.name, 'Ảnh.png');
  assert.equal(fetch.calls.length, 1);
  assert.equal(fetch.calls[0].method, 'PUT');
  assert.equal(fetch.calls[0].url, `https://s3.example-cloud.vn/htc-assets/${m[1]}`);
  assert.deepEqual(Buffer.from(fetch.calls[0].body), PNG);
  assert.equal(fetch.calls[0].headers['content-type'], 'image/png');

  const list = await c('GET', `/api/workspaces/${wsId}/assets`);
  assert.equal(list.data.assets[0].src, r.data.src);

  // Invalid content never reaches the bucket.
  assert.equal((await c('POST', `/api/workspaces/${wsId}/assets`, Buffer.from('not an image'), { raw: true, headers: { 'Content-Type': 'image/png' } })).status, 415);
  assert.equal(fetch.calls.length, 1);

  assert.equal((await c('DELETE', `/api/assets/${r.data.id}`)).status, 200);
  assert.equal(fetch.calls[1].method, 'DELETE');
  assert.equal(fetch.calls[1].url, fetch.calls[0].url);
  assert.equal((await c('GET', `/api/workspaces/${wsId}/assets`)).data.assets.length, 0);
});

test('storage failures surface as 502 and keep the database consistent', async (t) => {
  const fail = { PUT: true };
  const fetch = fakeFetch(fail);
  const { server, base, db } = await startServer({ s3: S3, fetch });
  t.after(() => server.close());

  const c = client(base);
  await c('POST', '/api/auth/signup', { name: 'Chủ', email: 's3fail@example.com', password: 'matkhau123' });
  const wsId = (await c('GET', '/api/auth/me')).data.workspaces[0].id;
  const r = await c('POST', `/api/workspaces/${wsId}/assets`, PNG, { raw: true, headers: { 'Content-Type': 'image/png' } });
  assert.equal(r.status, 502);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM assets').get().n, 0);

  // A failed delete keeps the asset so the user can retry.
  db.prepare('INSERT INTO assets (workspace_id, path, name, mime, size) VALUES (?, ?, ?, ?, ?)').run(wsId, `${wsId}/old.png`, 'old.png', 'image/png', 10);
  const id = db.prepare('SELECT id FROM assets').get().id;
  fail.DELETE = true;
  assert.equal((await c('DELETE', `/api/assets/${id}`)).status, 502);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM assets').get().n, 1);
  fail.DELETE = false;
  assert.equal((await c('DELETE', `/api/assets/${id}`)).status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM assets').get().n, 0);
});
