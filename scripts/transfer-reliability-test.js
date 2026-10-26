import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ddato-transfer-reliability-'));
const port = 44000 + Math.floor(Math.random() * 1000);
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env, DDATO_DRIVE_DATA_DIR: root, DDATO_DRIVE_DB_FILE: path.join(root, 'app-data', 'drive.sqlite'),
  DDATO_DRIVE_HOST: '127.0.0.1', DDATO_DRIVE_PORT: String(port), DDATO_DRIVE_ADMIN_PASSWORD: '123456',
  DDATO_DRIVE_TRUST_PROXY: '0', DDATO_DRIVE_GOOGLE_CLIENT_ID: '', DDATO_DRIVE_GOOGLE_CLIENT_SECRET: '' };
let server;
let cookie = '';
const failures = [];
async function start() {
  server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/server.js'], { env, stdio: 'ignore' });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${base}/api/health`)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('Test server did not start');
}
async function stop() {
  server?.kill('SIGTERM');
  if (server && server.exitCode === null) await new Promise(resolve => server.once('exit', resolve));
}
async function request(url, { method = 'GET', body, headers = {}, authenticated = true } = {}) {
  const json = body !== undefined && !(body instanceof FormData) && !Buffer.isBuffer(body);
  return fetch(`${base}${url}`, { method, headers: { Origin: base, ...(authenticated ? { Cookie: cookie } : {}),
    ...(json ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: json ? JSON.stringify(body) : body });
}
async function post(url, body) {
  const response = await request(url, { method: 'POST', body });
  if (!response.ok) throw new Error(`${url}: ${response.status} ${await response.text()}`);
  return response.json();
}
async function check(name, callback) {
  try { await callback(); console.log(`PASS ${name}`); }
  catch (error) { failures.push(name); console.error(`FAIL ${name}: ${error.message}`); }
}
async function upload(name, contents, parentId) {
  const form = new FormData(); form.set('file', new Blob([contents]), name);
  if (parentId) form.set('parentId', parentId);
  return (await post('/api/files/upload', form)).file;
}
try {
  await start();
  const login = await request('/api/auth/login', { method: 'POST', body: { id: 'admin', password: '123456' } });
  assert(login.ok); cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  const original = await upload('range.txt', '0123456789');
  await check('suffix byte range', async () => {
    const response = await request(`/api/files/${original.id}/download`, { headers: { Range: 'bytes=-3' } });
    assert.equal(response.status, 206); assert.equal(await response.text(), '789');
  });
  await check('oversized range end is clamped', async () => {
    const response = await request(`/api/files/${original.id}/download`, { headers: { Range: 'bytes=7-999' } });
    assert.equal(response.status, 206); assert.equal(await response.text(), '789');
  });
  await check('invalid and unsatisfiable ranges', async () => {
    for (const range of ['bytes=10-', 'bytes=-0', 'bytes=1.5-3', 'bytes=bad-4']) {
      const response = await request(`/api/files/${original.id}/download`, { headers: { Range: range } });
      assert.equal(response.status, 416, range); await response.arrayBuffer();
    }
  });
  await check('HEAD and zero-byte downloads', async () => {
    const head = await request(`/api/files/${original.id}/download`, { method: 'HEAD' });
    assert.equal(head.headers.get('content-length'), '10'); assert.equal((await head.arrayBuffer()).byteLength, 0);
    const headRange = await request(`/api/files/${original.id}/download`, { method: 'HEAD', headers: { Range: 'bytes=2-3' } });
    assert.equal(headRange.status, 200); assert.equal(headRange.headers.get('content-length'), '10');
    const conditional = await request(`/api/files/${original.id}/download`, { headers: { Range: 'bytes=2-3', 'If-Range': '"unknown-version"' } });
    assert.equal(conditional.status, 200); assert.equal(await conditional.text(), '0123456789');
    const empty = await upload('empty.bin', '');
    const response = await request(`/api/files/${empty.id}/download`);
    assert.equal(response.status, 200); assert.equal((await response.arrayBuffer()).byteLength, 0);
  });
  await check('upload sizes must be whole bytes', async () => {
    const response = await request('/api/files/upload-sessions', { method: 'POST', body: { name: 'fraction.bin', sizeBytes: 0.5 } });
    assert.equal(response.status, 400); await response.arrayBuffer();
  });
  const session = (await post('/api/files/upload-sessions', { name: 'resumable.bin', sizeBytes: 6, clientUploadId: 'reliability-resumable' })).session;
  const chunk = (offset, value) => request(`/api/files/upload-sessions/${session.id}/chunk`, {
    method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Upload-Offset': String(offset) }, body: Buffer.from(value)
  });
  assert((await chunk(0, 'abc')).ok);
  await check('conflicting retried chunks are rejected', async () => { const response = await chunk(0, 'XYZ'); assert.equal(response.status, 409); await response.arrayBuffer(); });
  await check('identical chunk retries are idempotent', async () => { const response = await chunk(0, 'abc'); assert(response.ok); await response.arrayBuffer(); });
  assert((await chunk(3, 'def')).ok);
  const finished = await post(`/api/files/upload-sessions/${session.id}/complete`);
  await check('completed uploads are idempotent', async () => {
    const response = await request(`/api/files/upload-sessions/${session.id}/complete`, { method: 'POST' });
    assert.equal(response.status, 201); assert.equal((await response.json()).file.id, finished.file.id);
  });
  await check('completed status survives restart', async () => {
    await stop(); await start();
    const response = await request(`/api/files/upload-sessions/${session.id}`);
    assert.equal(response.status, 200); const { session: status } = await response.json();
    assert.equal(status.uploadedBytes, 6); assert.equal(status.fileId, finished.file.id);
  });
  await check('session creation retries reuse reservations', async () => {
    const payload = { name: 'create-retry.bin', sizeBytes: 10, clientUploadId: 'create-retry' };
    const first = (await post('/api/files/upload-sessions', payload)).session;
    const second = (await post('/api/files/upload-sessions', payload)).session;
    assert.equal(first.id, second.id);
    await request(`/api/files/upload-sessions/${first.id}`, { method: 'DELETE' });
  });
  const folder = (await post('/api/folders', { name: 'Download folder' })).file;
  const child = await upload('private.txt', 'private contents', folder.id);
  const shared = await post(`/api/files/${folder.id}/share`, { mode: 'hour' });
  assert((await request(`/api/files/${child.id}/password`, { method: 'PUT', body: { password: 'test-only' } })).ok);
  await check('folder ZIP checks descendant locks', async () => {
    const response = await request(`/api/files/${folder.id}/download`); assert.equal(response.status, 423); await response.arrayBuffer();
  });
  await check('shared folder ZIP checks descendant locks', async () => {
    const response = await request(`/api/shares/${shared.share.token}/download`, { authenticated: false });
    assert([404, 423].includes(response.status), `expected lock/revocation, got ${response.status}`); await response.arrayBuffer();
  });
  await check('upload bytes remain exact', async () => {
    const response = await request(`/api/files/${finished.file.id}/download`); assert.equal(await response.text(), 'abcdef');
  });
  await check('native browser ZIP form download', async () => {
    const response = await request('/api/files/download', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: Buffer.from(new URLSearchParams([['ids', original.id], ['ids', finished.file.id]]).toString()) });
    assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'application/zip');
    const bytes = Buffer.from(await response.arrayBuffer()); assert.equal(bytes.readUInt32LE(), 0x04034b50);
  });
  await check('deleted completion does not silently re-upload', async () => {
    assert((await request(`/api/files/${finished.file.id}`, { method: 'DELETE' })).ok);
    const response = await request(`/api/files/upload-sessions/${session.id}`); assert.equal(response.status, 410); await response.arrayBuffer();
    assert((await request(`/api/trash/${finished.file.id}/restore`, { method: 'POST' })).ok);
    const completedAgain = await post(`/api/files/upload-sessions/${session.id}/complete`); assert.equal(completedAgain.file.id, finished.file.id);
  });
  await check('multipart quota boundary and temp cleanup', async () => {
    await post('/api/admin/users', { id: 'quota-transfer-test', password: 'test-only', quotaBytes: 1024 });
    const adminCookie = cookie;
    try {
      const login = await request('/api/auth/login', { method: 'POST', body: { id: 'quota-transfer-test', password: 'test-only' } });
      assert(login.ok); cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
      const form = new FormData(); form.set('file', new Blob([Buffer.alloc(2048)]), 'oversized.bin');
      const blocked = await request('/api/files/upload', { method: 'POST', body: form });
      assert.equal(blocked.status, 413); assert.equal((await blocked.json()).details.code, 'user_quota_exceeded');
      const exact = await upload('exact.bin', Buffer.alloc(1024));
      const bytes = await request(`/api/files/${exact.id}/download`); assert.equal((await bytes.arrayBuffer()).byteLength, 1024);
      const entries = fs.readdirSync(path.join(root, 'temp'), { withFileTypes: true });
      assert(!entries.some(entry => entry.isFile()), 'rejected multipart uploads must remove temporary files');
    } finally { cookie = adminCookie; }
  });
  await check('new locks revoke older password-protected share links', async () => {
    const parent = (await post('/api/folders', { name: 'Share lock change' })).file;
    const item = await upload('child.txt', 'secret', parent.id);
    const share = await post(`/api/files/${parent.id}/share`, { mode: 'permanent', password: 'link-password' });
    assert((await request(`/api/files/${item.id}/password`, { method: 'PUT', body: { password: 'new-file-password' } })).ok);
    const response = await request(`/api/shares/${share.share.token}/download`, { authenticated: false });
    assert.equal(response.status, 404); await response.arrayBuffer();
    const childShare = await post(`/api/files/${original.id}/share`, { mode: 'hour', password: 'link-password' });
    const target = (await post('/api/folders', { name: 'Inherited protection' })).file;
    assert((await request(`/api/files/${original.id}/move`, { method: 'PATCH', body: { parentId: target.id } })).ok);
    assert((await request(`/api/files/${target.id}/password`, { method: 'PUT', body: { password: 'folder-lock' } })).ok);
    const descendant = await request(`/api/shares/${childShare.share.token}/download`, { authenticated: false });
    assert.equal(descendant.status, 404); await descendant.arrayBuffer();
  });
  await check('malformed multipart/compressed requests do not crash the server', async () => {
    const form = new FormData(); form.set('array[4294967295]', 'x');
    const multipart = await request('/api/files/upload', { method: 'POST', body: form }); await multipart.arrayBuffer();
    const encoded = Buffer.concat([gzipSync(Buffer.from('{"id":"admin","password":"123456"}')), Buffer.from('invalid trailer')]);
    const response = await request('/api/auth/login', { method: 'POST', body: encoded, headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' } });
    await response.arrayBuffer();
    await new Promise(resolve => setTimeout(resolve, 50));
    assert((await request('/api/health')).ok);
  });
  await check('legacy links cannot bypass newer locks', async () => {
    const file = await upload('legacy-share.txt', 'legacy protection');
    const share = await post(`/api/files/${file.id}/share`, { mode: 'hour', password: 'link-password' });
    const { DatabaseSync } = await import('node:sqlite');
    const database = new DatabaseSync(path.join(root, 'app-data', 'drive.sqlite'));
    try {
      database.prepare('UPDATE files SET access_password_hash = ?, access_password_set_at = ? WHERE id = ?')
        .run('legacy-protected', Date.now() + 1000, file.id);
    } finally { database.close(); }
    const response = await request(`/api/shares/${share.share.token}/download`, { authenticated: false });
    assert.equal(response.status, 404); await response.arrayBuffer();
  });
  assert.deepEqual(failures, [], `Failed reliability checks: ${failures.join(', ')}`);
  console.log('Transfer reliability integration tests passed.');
} finally { await stop(); fs.rmSync(root, { recursive: true, force: true }); }
