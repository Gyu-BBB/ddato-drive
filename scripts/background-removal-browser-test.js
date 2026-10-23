import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { BACKGROUND_ASSET_PATH } from '../src/client/features/files/backgroundRemoval/config.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ddato-background-'));
const port = 48700 + Math.floor(Math.random() * 1000);
const base = `http://127.0.0.1:${port}`;
const shots = path.resolve('.tmp/background-removal-screenshots');
fs.mkdirSync(shots, { recursive: true });
const fixturePath = path.resolve('.tmp/u2net-test-girl.png');
if (!fs.existsSync(fixturePath)) {
  const response = await fetch('https://raw.githubusercontent.com/xuebinqin/U-2-Net/master/test_data/test_images/girl.png');
  assert(response.ok); fs.writeFileSync(fixturePath, Buffer.from(await response.arrayBuffer()));
}
const fixture = fs.readFileSync(fixturePath);
const originalImage = PNG.sync.read(fixture);
const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/server.js'], {
  env: { ...process.env, DDATO_DRIVE_HOST: '127.0.0.1', DDATO_DRIVE_PORT: String(port),
    DDATO_DRIVE_DATA_DIR: root, DDATO_DRIVE_DB_FILE: path.join(root, 'app-data', 'drive.sqlite'),
    DDATO_DRIVE_TRUST_PROXY: '0', DDATO_DRIVE_GOOGLE_CLIENT_ID: '', DDATO_DRIVE_GOOGLE_CLIENT_SECRET: '' }, stdio: 'ignore'
});
let browser;
try {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, hasTouch: true });
  const api = context.request;
  const headers = { Origin: base };
  assert((await api.post(`${base}/api/auth/login`, { data: { id: 'admin', password: '123456' }, headers })).ok());
  const upload = await api.post(`${base}/api/files/upload`, { multipart: { file: { name: 'subject.png', mimeType: 'image/png', buffer: fixture } }, headers });
  assert(upload.ok());
  const file = (await upload.json()).file;
  const external = [];
  const requests = [];
  await context.route('**/*', route => {
    const request = route.request();
    if (!request.url().startsWith(base)) { external.push(request.url()); return route.abort(); }
    requests.push({ url: request.url(), method: request.method() });
    return route.continue();
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') console.log('Browser:', message.text()); });
  const activeWorkers = new Set();
  page.on('worker', worker => { activeWorkers.add(worker); worker.on('close', () => activeWorkers.delete(worker)); });
  await page.goto(`${base}/media`);
  await page.getByRole('button', { name: '이미지 편집', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '이미지 편집', exact: true });
  const remove = editor.getByRole('button', { name: '배경 제거', exact: true });
  await page.waitForFunction(() => document.querySelector('.image-editor canvas')?.width > 1);
  assert(!requests.some(request => request.url.endsWith('.onnx')), 'model must not load until requested');
  const before = await editor.locator('canvas').evaluate(canvas => canvas.toDataURL());
  let release;
  await context.route(`**${BACKGROUND_ASSET_PATH}u2netp.onnx`, async route => {
    await new Promise(resolve => { release = resolve; });
    await route.continue().catch(() => {});
  }, { times: 1 });
  await remove.click();
  await editor.getByRole('button', { name: '배경 제거 취소', exact: true }).waitFor();
  assert(await editor.getByRole('button', { name: '새 파일로 저장', exact: true }).isDisabled());
  await editor.getByRole('button', { name: '배경 제거 취소', exact: true }).click();
  release?.();
  await editor.getByRole('button', { name: '배경 제거 취소', exact: true }).waitFor({ state: 'detached' });
  assert.equal(await editor.locator('canvas').evaluate(canvas => canvas.toDataURL()), before);
  await context.unroute(`**${BACKGROUND_ASSET_PATH}u2netp.onnx`);
  await context.route(`**${BACKGROUND_ASSET_PATH}u2netp.onnx`, route => route.fulfill({ status: 503, body: 'unavailable' }), { times: 1 });
  await remove.click();
  await editor.getByRole('alert').waitFor();
  assert.equal(await editor.locator('canvas').evaluate(canvas => canvas.toDataURL()), before);
  assert(await remove.isEnabled());
  await context.unroute(`**${BACKGROUND_ASSET_PATH}u2netp.onnx`);

  const start = Date.now();
  await remove.click();
  await editor.getByRole('button', { name: '배경 제거 취소', exact: true }).waitFor({ state: 'detached', timeout: 120000 });
  assert.equal(await editor.getByRole('alert').count(), 0, await editor.getByRole('alert').allTextContents());
  const after = await editor.locator('canvas').evaluate(canvas => canvas.toDataURL());
  assert.notEqual(after, before);
  const output = PNG.sync.read(Buffer.from(after.split(',')[1], 'base64'));
  let transparent = 0;
  let opaque = 0;
  for (let i = 3; i < output.data.length; i += 4) {
    if (output.data[i] < 20) transparent++;
    if (output.data[i] > 235) opaque++;
  }
  const pixels = output.width * output.height;
  assert(transparent > pixels * 0.1, 'background should become transparent');
  assert(opaque > pixels * 0.05, 'foreground should remain visible');
  assert.equal(output.width, originalImage.width); assert.equal(output.height, originalImage.height);
  await editor.getByRole('button', { name: '되돌리기', exact: true }).click();
  assert.equal(await editor.locator('canvas').evaluate(canvas => canvas.toDataURL()), before);
  await editor.getByRole('button', { name: '다시 실행', exact: true }).click();
  assert.equal(await editor.locator('canvas').evaluate(canvas => canvas.toDataURL()), after);
  await editor.getByRole('button', { name: '되돌리기', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  const removeBounds = await remove.boundingBox();
  await page.touchscreen.tap(removeBounds.x + removeBounds.width / 2, removeBounds.y + removeBounds.height / 2);
  await editor.getByRole('button', { name: '배경 제거 취소', exact: true }).waitFor();
  await editor.getByRole('button', { name: '배경 제거 취소', exact: true }).waitFor({ state: 'detached', timeout: 120000 });
  assert.equal(await editor.getByRole('alert').count(), 0);
  assert.equal(await editor.locator('canvas').evaluate(canvas => canvas.toDataURL()), after, 'mobile touch starts real local inference with the same result');
  for (const [width, height] of [[1440, 900], [390, 844], [360, 640], [667, 375]]) {
    await page.setViewportSize({ width, height });
    await page.screenshot({ path: path.join(shots, `${width}x${height}.png`), animations: 'disabled' });
    const bounds = await editor.boundingBox();
    assert(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= width + 1 && bounds.y + bounds.height <= height + 1);
    const canvas = await editor.locator('canvas').boundingBox();
    assert(canvas.height > 16 && canvas.width > 16 && canvas.y + canvas.height < height);
  }
  await editor.getByLabel('편집 파일 이름').fill('transparent-result.png');
  await editor.getByRole('button', { name: '새 파일로 저장', exact: true }).click();
  await editor.waitFor({ state: 'detached' });
  const listing = await (await api.get(`${base}/api/files`)).json();
  const saved = listing.files.find(item => item.name === 'transparent-result.png');
  assert(saved);
  const savedImage = PNG.sync.read(await (await api.get(`${base}/api/files/${saved.id}/download`)).body());
  assert.deepEqual(savedImage.data, output.data);
  assert.deepEqual(await (await api.get(`${base}/api/files/${file.id}/download`)).body(), fixture);
  await page.locator('.media-card').filter({ hasText: 'subject.png' }).click();
  await page.getByRole('button', { name: '이미지 편집', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.image-editor canvas')?.width > 1);
  await page.evaluate(() => { window.OffscreenCanvas = undefined; });
  await page.getByRole('dialog', { name: '이미지 편집', exact: true }).getByRole('button', { name: '배경 제거', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '지원하지 않습니다' }).waitFor();
  await page.getByRole('button', { name: '편집 닫기', exact: true }).click();
  assert.deepEqual(external, [], 'images and model requests must stay same-origin');
  assert(!requests.filter(request => request.method === 'POST').some(request => !request.url.endsWith('/api/files/upload')), 'no image inference upload');
  assert.equal(activeWorkers.size, 0, 'workers must release model memory');
  assert.deepEqual(errors, []);
  console.log(`Real browser model inference passed (${Date.now() - start}ms), ${Math.round(transparent / pixels * 100)}% transparent, foreground retained.`);
  console.log('Background removal: cancel, model failure/retry, undo/redo, transparent PNG save, original preservation, mobile layout and same-origin privacy passed.');
} finally {
  await browser?.close();
  if (server.exitCode === null) {
    const exited = new Promise(resolve => server.once('exit', resolve));
    server.kill('SIGTERM'); await exited;
  }
  fs.rmSync(root, { recursive: true, force: true });
}
