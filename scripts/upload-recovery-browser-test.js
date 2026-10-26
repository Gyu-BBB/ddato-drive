import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ddato-upload-recovery-'));
const port = 43000 + Math.floor(Math.random() * 1000);
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/server.js'], {
  env: { ...process.env, DDATO_DRIVE_DATA_DIR: root, DDATO_DRIVE_DB_FILE: path.join(root, 'app-data', 'drive.sqlite'),
    DDATO_DRIVE_HOST: '127.0.0.1', DDATO_DRIVE_PORT: String(port), DDATO_DRIVE_ADMIN_PASSWORD: '123456',
    DDATO_DRIVE_TRUST_PROXY: '0', DDATO_DRIVE_GOOGLE_CLIENT_ID: '', DDATO_DRIVE_GOOGLE_CLIENT_SECRET: '' }, stdio: 'ignore'
});
let browser;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label) {
  for (let i = 0; i < 200; i++) { if (await check()) return; await pause(50); }
  throw new Error(`Timed out: ${label}`);
}
try {
  await until(async () => { try { return (await fetch(`${base}/api/health`)).ok; } catch { return false; } }, 'server');
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const api = context.request;
  const headers = { Origin: base };
  assert((await api.post(`${base}/api/auth/login`, { data: { id: 'admin', password: '123456' }, headers })).ok());
  const page = await context.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const inputs = () => page.locator('input[type="file"]').first();
  const listing = async () => (await (await api.get(`${base}/api/files`)).json()).files;
  await page.goto(base);
  const completed = [];
  let releaseCompletion;
  const heldCompletion = new Promise(resolve => { releaseCompletion = resolve; });
  await page.route('**/upload-sessions/*/complete', async route => {
    const response = await route.fetch(); completed.push((await response.json()).file.id);
    await heldCompletion; await route.abort().catch(() => {});
  }, { times: 1 });
  const contents = Buffer.alloc(8 * 1024 * 1024 + 123, 67);
  await inputs().setInputFiles({ name: 'reload.bin', mimeType: 'application/octet-stream', buffer: contents });
  await until(() => completed.length === 1, 'server committed upload');
  await page.reload(); releaseCompletion();
  await page.getByText('1개 완료', { exact: true }).waitFor();
  await until(async () => (await listing()).filter(file => file.name.startsWith('reload')).length === 1, 'one committed file');
  await pause(300);
  const recovered = (await listing()).filter(file => file.name.startsWith('reload'));
  assert.equal(recovered.length, 1); assert.equal(recovered[0].id, completed[0]);
  const output = await (await api.get(`${base}/api/files/${recovered[0].id}/download`)).body();
  assert.equal(createHash('sha256').update(output).digest('hex'), createHash('sha256').update(contents).digest('hex'));
  console.log('Reload after lost completion response: exactly one file, matching SHA-256.');

  let releaseCreate;
  const heldCreate = new Promise(resolve => { releaseCreate = resolve; });
  let canceledSession;
  await page.route('**/api/files/upload-sessions', async route => {
    if (route.request().method() !== 'POST') { await route.continue(); return; }
    const response = await route.fetch(); canceledSession = (await response.json()).session;
    await heldCreate; await route.fulfill({ response }).catch(() => {});
  }, { times: 1 });
  await inputs().setInputFiles({ name: 'canceled-before-id.bin', mimeType: 'application/octet-stream', buffer: Buffer.alloc(32768) });
  await until(() => Boolean(canceledSession), 'session created');
  await page.getByRole('button', { name: 'canceled-before-id.bin 업로드 취소', exact: true }).click();
  releaseCreate();
  await until(async () => (await api.get(`${base}/api/files/upload-sessions/${canceledSession.id}`)).status() === 404, 'orphan reservation canceled');
  await page.reload();
  assert(!(await listing()).some(file => file.name.startsWith('canceled-before-id')));
  console.log('Cancel before session response: no orphan reservation or restored upload.');

  let lostChunkOffset;
  let lostCompletionId;
  await page.route('**/upload-sessions/*/chunk', async route => {
    const response = await route.fetch(); assert(response.ok());
    lostChunkOffset = Number(route.request().headers()['x-upload-offset']);
    await route.abort();
  }, { times: 1 });
  await page.route('**/upload-sessions/*/complete', async route => {
    const response = await route.fetch(); lostCompletionId = (await response.json()).file.id;
    await route.abort();
  }, { times: 1 });
  await inputs().setInputFiles({ name: 'retry-network.bin', mimeType: 'application/octet-stream', buffer: contents });
  await page.getByText('1개 완료', { exact: true }).waitFor();
  const networkRecovered = (await listing()).filter(file => file.name.startsWith('retry-network'));
  assert.equal(networkRecovered.length, 1); assert.equal(networkRecovered[0].id, lostCompletionId); assert.equal(lostChunkOffset, 0);
  const retryBytes = await (await api.get(`${base}/api/files/${networkRecovered[0].id}/download`)).body();
  assert.equal(createHash('sha256').update(retryBytes).digest('hex'), createHash('sha256').update(contents).digest('hex'));
  console.log('Lost chunk/completion responses: automatic recovery from confirmed offset, one file and matching SHA-256.');

  let releaseChunks;
  const heldChunks = new Promise(resolve => { releaseChunks = resolve; });
  let started = 0;
  await page.route('**/upload-sessions/*/chunk', async route => {
    started++; await heldChunks; await route.continue().catch(() => {});
  });
  await inputs().setInputFiles(Array.from({ length: 11 }, (_, index) => ({ name: `concurrent-${index}.bin`, mimeType: 'application/octet-stream', buffer: Buffer.alloc(32768, index) })));
  await until(() => started === 10, 'ten simultaneous uploads');
  await pause(100); assert.equal(started, 10, 'eleventh upload must stay queued');
  await page.getByRole('button', { name: '전체 업로드 일시정지', exact: true }).click();
  await page.getByText('11개 일시정지됨', { exact: true }).waitFor();
  releaseChunks(); await page.unroute('**/upload-sessions/*/chunk');
  await page.reload();
  await page.getByText('11개 일시정지됨', { exact: true }).waitFor();
  await page.getByRole('button', { name: '전체 업로드 재개', exact: true }).click();
  await until(async () => (await listing()).filter(file => file.name.startsWith('concurrent-')).length === 11, 'all resumed files');
  for (const file of (await listing()).filter(file => file.name.startsWith('concurrent-'))) {
    const bytes = await (await api.get(`${base}/api/files/${file.id}/download`)).body();
    const index = Number(file.name.match(/concurrent-(\d+)/)[1]);
    assert.equal(bytes.length, 32768); assert(bytes.every(value => value === index));
  }
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined });
    const original = window.fetch;
    window.fetch = async (url, options) => {
      const response = await original(url, options);
      if (String(url).endsWith('/api/files/download') && options?.method === 'POST' && response.ok) {
        const headers = new Headers(response.headers); headers.set('Content-Length', String(129 * 1024 * 1024));
        return new Response(response.body, { status: response.status, headers });
      }
      return response;
    };
  });
  await page.reload();
  await page.getByRole('checkbox', { name: 'concurrent-0.bin 선택', exact: true }).check();
  await page.getByRole('checkbox', { name: 'concurrent-1.bin 선택', exact: true }).check();
  const nativeDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '다운로드', exact: true }).click();
  const download = await nativeDownload;
  assert.equal(await download.failure(), null);
  const zip = fs.readFileSync(await download.path());
  assert.equal(zip.readUInt32LE(), 0x04034b50);
  assert(zip.includes(Buffer.from('concurrent-0.bin')) && zip.includes(Buffer.from('concurrent-1.bin')));
  await page.getByText('1개 브라우저로 전달됨', { exact: true }).waitFor();
  assert.equal(await page.locator('.download-queue-card .upload-progress').count(), 0, 'native downloads must not claim fake progress/completion');
  assert.equal((await listing()).filter(file => file.name.startsWith('reload')).length, 1);
  assert.deepEqual(errors, []);
  console.log('Browser transfers passed: ten concurrent + one queued, pause/reload/resume, cancellation, byte-perfect contents and real native multi-file ZIP downloads.');

  assert((await api.post(`${base}/api/admin/users`, { data: { id: 'preflight-user', password: 'test-only', quotaBytes: 10 * 1024 ** 3 }, headers })).ok());
  const quotaContext = await browser.newContext();
  assert((await quotaContext.request.post(`${base}/api/auth/login`, { data: { id: 'preflight-user', password: 'test-only' }, headers })).ok());
  await quotaContext.addInitScript(() => {
    const size = Object.getOwnPropertyDescriptor(Blob.prototype, 'size').get;
    // Exercise a 20 GiB request without allocating a 20 GiB test fixture.
    Object.defineProperty(File.prototype, 'size', { get() { return this.name === 'oversized.bin' ? 20 * 1024 ** 3 : size.call(this); } });
    window.fileWrites = 0;
    window.failFileStorage = false;
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'uploadFiles') {
        window.fileWrites++;
        if (window.failFileStorage) throw new DOMException('Test browser storage full', 'QuotaExceededError');
      }
      return put.apply(this, args);
    };
  });
  const quotaPage = await quotaContext.newPage();
  let chunkRequests = 0;
  quotaPage.on('request', request => { if (request.url().endsWith('/chunk')) chunkRequests++; });
  await quotaPage.goto(base);
  const rejected = quotaPage.waitForResponse(response => response.url().endsWith('/upload-sessions') && response.status() === 413);
  await quotaPage.locator('input[type="file"]').first().setInputFiles({ name: 'oversized.bin', mimeType: 'application/octet-stream', buffer: Buffer.alloc(32) });
  assert.equal((await rejected).status(), 413);
  await quotaPage.getByText('1개 확인 필요', { exact: true }).waitFor();
  assert.equal(await quotaPage.evaluate(() => window.fileWrites), 0, 'quota rejection must happen before IndexedDB file writes');
  assert.equal(chunkRequests, 0, 'quota rejection must not transfer file chunks');
  assert.equal((await (await quotaContext.request.get(`${base}/api/files`)).json()).files.length, 0);

  await quotaPage.evaluate(() => { window.failFileStorage = true; });
  const reserved = quotaPage.waitForResponse(response => response.url().endsWith('/upload-sessions') && response.status() === 201);
  await quotaPage.locator('input[type="file"]').first().setInputFiles({ name: 'storage-failed.bin', mimeType: 'application/octet-stream', buffer: Buffer.alloc(1024) });
  const reservedId = (await (await reserved).json()).session.id;
  await until(async () => (await quotaContext.request.get(`${base}/api/files/upload-sessions/${reservedId}`)).status() === 404, 'local storage failure releases server reservation');
  assert.equal(chunkRequests, 0);
  await quotaPage.evaluate(() => { window.failFileStorage = false; });
  await quotaPage.locator('input[type="file"]').first().setInputFiles({ name: 'accepted.bin', mimeType: 'application/octet-stream', buffer: Buffer.alloc(1024) });
  await until(async () => (await (await quotaContext.request.get(`${base}/api/files`)).json()).files.some(file => file.name === 'accepted.bin'), 'valid upload after admission failures');
  await quotaContext.close();
  console.log('Quota preflight passed: 10 GiB quota rejects 20 GiB metadata before any local file write or chunk; storage failures release reservations; valid files still upload.');

  const sourceContext = await browser.newContext();
  assert((await sourceContext.request.post(`${base}/api/auth/login`, { data: { id: 'admin', password: '123456' }, headers })).ok());
  await sourceContext.addInitScript(() => {
    navigator.storage.estimate = async () => ({ quota: 1024, usage: 0 });
  });
  const sourcePage = await sourceContext.newPage();
  const sourcePath = path.join(root, 'reselect.bin'); fs.writeFileSync(sourcePath, contents);
  let waitingForSource = false;
  await sourcePage.route('**/upload-sessions/*/chunk', async route => {
    if (Number(route.request().headers()['x-upload-offset']) > 0) { waitingForSource = true; await route.abort(); }
    else await route.continue();
  });
  await sourcePage.goto(base);
  await sourcePage.locator('input[type="file"]').first().setInputFiles(sourcePath);
  await until(() => waitingForSource, 'first chunk committed before source reselection');
  await sourcePage.getByRole('button', { name: 'reselect.bin 업로드 일시정지', exact: true }).click();
  await sourcePage.getByText('1개 일시정지됨', { exact: true }).waitFor();
  await sourcePage.reload();
  await sourcePage.getByText('원본 파일 다시 선택', { exact: true }).waitFor();
  await sourcePage.unroute('**/upload-sessions/*/chunk');
  const resumedOffsets = [];
  sourcePage.on('request', request => { if (request.url().endsWith('/chunk')) resumedOffsets.push(Number(request.headers()['x-upload-offset'])); });
  const chooserEvent = sourcePage.waitForEvent('filechooser');
  await sourcePage.getByRole('button', { name: 'reselect.bin 업로드 재개', exact: true }).click();
  await (await chooserEvent).setFiles(sourcePath);
  await sourcePage.getByText('1개 완료', { exact: true }).waitFor();
  assert.equal(resumedOffsets[0], 8 * 1024 * 1024);
  const reselected = (await listing()).find(file => file.name === 'reselect.bin');
  assert.deepEqual(await (await api.get(`${base}/api/files/${reselected.id}/download`)).body(), contents);
  await sourceContext.close();
  console.log('Metadata-only recovery: pause, reload, reselect original, resume from 8 MiB and byte-exact download.');
} finally {
  await browser?.close(); server.kill('SIGTERM');
  await new Promise(resolve => server.exitCode !== null ? resolve() : server.once('exit', resolve));
  fs.rmSync(root, { recursive: true, force: true });
}
