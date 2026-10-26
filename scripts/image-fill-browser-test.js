import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ddato-fill-'));
const port = 49800 + Math.floor(Math.random() * 500);
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/server.js'], {
  env: { ...process.env, DDATO_DRIVE_HOST: '127.0.0.1', DDATO_DRIVE_PORT: String(port),
    DDATO_DRIVE_DATA_DIR: root, DDATO_DRIVE_DB_FILE: path.join(root, 'app-data', 'drive.sqlite'),
    DDATO_DRIVE_ADMIN_PASSWORD: '123456', DDATO_DRIVE_TRUST_PROXY: '0',
    DDATO_DRIVE_GOOGLE_CLIENT_ID: '', DDATO_DRIVE_GOOGLE_CLIENT_SECRET: '' }, stdio: 'ignore'
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
  const input = new PNG({ width: 120, height: 80 });
  for (let y = 0; y < 80; y++) for (let x = 0; x < 120; x++) {
    const color = x === 59 ? [0, 0, 0, 255] : x >= 90 && y < 20 ? [40, 120, 245, 255] : [255, 255, 255, 255];
    input.data.set(color, (y * 120 + x) * 4);
  }
  const fixture = PNG.sync.write(input);
  const upload = await api.post(`${base}/api/files/upload`, { headers, multipart: { file: { name: 'fill-source.png', mimeType: 'image/png', buffer: fixture } } });
  assert(upload.ok()); const file = (await upload.json()).file;
  const page = await context.newPage();
  const errors = [];
  const workers = new Set();
  page.on('pageerror', error => errors.push(error.message));
  page.on('worker', worker => { workers.add(worker); worker.on('close', () => workers.delete(worker)); });
  const shots = path.resolve('.tmp/image-fill-screenshots'); fs.mkdirSync(shots, { recursive: true });
  for (const [width, height] of [[1440, 900], [390, 844], [360, 640], [667, 375]]) {
    await page.setViewportSize({ width, height }); await page.goto(`${base}/media`);
    await page.locator('.media-card').filter({ hasText: 'fill-source.png' }).click();
    await page.getByRole('button', { name: '이미지 편집', exact: true }).click();
    const editor = page.getByRole('dialog', { name: '이미지 편집', exact: true });
    const canvas = editor.locator('canvas');
    await page.waitForFunction(() => document.querySelector('.image-editor canvas')?.width === 120);
    const read = (x, y) => canvas.evaluate((canvas, { x, y }) => [...canvas.getContext('2d').getImageData(x, y, 1, 1).data], { x, y });
    const tap = async (x, y) => {
      const size = await canvas.evaluate(canvas => ({ width: canvas.width, height: canvas.height }));
      const rect = await canvas.boundingBox();
      await page.touchscreen.tap(rect.x + x / size.width * rect.width, rect.y + y / size.height * rect.height);
    };
    await editor.getByRole('button', { name: '스포이드', exact: true }).click();
    await editor.getByRole('button', { name: '확대', exact: true }).click();
    await tap(100, 10);
    assert.equal(await editor.getByLabel('사용자 색상').inputValue(), '#2878f5');
    assert(await editor.getByRole('button', { name: '되돌리기', exact: true }).isDisabled(), 'sampling must not change pixels/history');
    await editor.getByRole('button', { name: '채우기', exact: true }).click();
    if (width === 1440) {
      await page.route('**/assets/imageFill.worker-*.js', route => route.fulfill({ contentType: 'application/javascript', headers: { 'Cache-Control': 'no-store' }, body: 'self.onmessage = () => {};' }), { times: 1 });
      await tap(20, 50);
      await editor.getByRole('button', { name: '채우기 취소', exact: true }).click();
      await editor.getByRole('button', { name: '채우기', exact: true }).waitFor({ state: 'visible' });
      assert.deepEqual(await read(20, 50), [255, 255, 255, 255]);
      assert(await editor.getByRole('button', { name: '되돌리기', exact: true }).isDisabled());
      await page.unroute('**/assets/imageFill.worker-*.js');
      const view = await editor.locator('.image-zoom-viewport').boundingBox();
      const client = await context.newCDPSession(page);
      const center = { x: view.x + view.width / 2, y: view.y + view.height / 2 };
      await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: center.x - 10, y: center.y, id: 1 }] });
      await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: center.x - 10, y: center.y, id: 1 }, { x: center.x + 10, y: center.y, id: 2 }] });
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: center.x - 30, y: center.y, id: 1 }, { x: center.x + 30, y: center.y, id: 2 }] });
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await client.detach();
      assert(await editor.getByRole('button', { name: '되돌리기', exact: true }).isDisabled(), 'pinch while fill is selected must not apply a fill');
      await editor.getByRole('button', { name: '화면에 맞추기', exact: true }).click();
      await editor.getByRole('button', { name: '확대', exact: true }).click();
    }
    await tap(20, 50);
    await page.waitForFunction(() => document.querySelector('.image-editor canvas').getContext('2d').getImageData(20, 50, 1, 1).data[0] === 40);
    assert.deepEqual(await read(20, 50), [40, 120, 245, 255]);
    assert.deepEqual(await read(70, 50), [255, 255, 255, 255], 'fill must not cross the black barrier');
    await editor.getByRole('button', { name: '되돌리기', exact: true }).click();
    assert.deepEqual(await read(20, 50), [255, 255, 255, 255]);
    await editor.getByRole('button', { name: '다시 실행', exact: true }).click();
    assert.deepEqual(await read(20, 50), [40, 120, 245, 255]);
    await editor.getByRole('button', { name: '오른쪽으로 회전', exact: true }).click();
    await editor.getByRole('button', { name: '자르기', exact: true }).click();
    await editor.getByRole('button', { name: '자르기 적용', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.image-editor canvas').width === 64);
    await editor.getByRole('button', { name: '채우기', exact: true }).click();
    await editor.getByRole('button', { name: '색상 #ffcc00', exact: true }).click();
    await editor.getByLabel('채우기 허용 범위').fill('0');
    await tap(10, 10);
    await page.waitForFunction(() => document.querySelector('.image-editor canvas').getContext('2d').getImageData(10, 10, 1, 1).data[0] === 255);
    assert.deepEqual(await read(10, 10), [255, 204, 0, 255], 'fill after rotation/crop must use current coordinates');
    await editor.getByRole('button', { name: '되돌리기', exact: true }).click();
    assert.deepEqual(await read(10, 10), [40, 120, 245, 255]);
    await editor.getByRole('button', { name: '다시 실행', exact: true }).click();
    await editor.getByLabel('사용자 색상').fill('#123456');
    await editor.getByLabel('색상 불투명도').fill('50');
    await tap(10, 10);
    await page.waitForFunction(() => document.querySelector('.image-editor canvas').getContext('2d').getImageData(10, 10, 1, 1).data[3] === 128);
    const translucent = await read(10, 10);
    await editor.getByRole('button', { name: '스포이드', exact: true }).click();
    await tap(10, 10);
    assert.equal(await editor.getByLabel('사용자 색상').inputValue(), `#${translucent.slice(0, 3).map(value => value.toString(16).padStart(2, '0')).join('')}`);
    await editor.getByRole('button', { name: '되돌리기', exact: true }).click();
    assert.deepEqual(await read(10, 10), [255, 204, 0, 255], 'picker must not add an undo operation');
    await editor.getByRole('button', { name: '다시 실행', exact: true }).click();
    assert.deepEqual(await read(10, 10), translucent, 'transparent fill must replay exactly');
    await editor.getByRole('button', { name: '되돌리기', exact: true }).click();
    await editor.getByRole('button', { name: '채우기', exact: true }).click();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.screenshot({ path: path.join(shots, `${width}x${height}.png`) });
    const bounds = await editor.boundingBox();
    assert(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= width + 1 && bounds.y + bounds.height <= height + 1);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await editor.getByLabel('편집 파일 이름').fill(`filled-${width}.png`);
    await editor.getByRole('button', { name: '새 파일로 저장', exact: true }).click();
    await editor.waitFor({ state: 'detached' });
    const files = (await (await api.get(`${base}/api/files`)).json()).files;
    const saved = files.find(file => file.name === `filled-${width}.png`);
    assert(saved);
    const output = PNG.sync.read(await (await api.get(`${base}/api/files/${saved.id}/download`)).body());
    assert.deepEqual([...output.data.slice((10 * output.width + 10) * 4, (10 * output.width + 10) * 4 + 4)], [255, 204, 0, 255]);
  }
  assert.deepEqual(await (await api.get(`${base}/api/files/${file.id}/download`)).body(), fixture, 'original file must remain unchanged');
  await page.waitForTimeout(100);
  assert.equal(workers.size, 0, 'fill workers must release memory');
  assert.deepEqual(errors, []);
  console.log('Fill/picker browser tests passed: desktop/mobile/landscape, sampled colors, zoomed coordinates, connected fill, cancel, undo/redo, rotation/crop, saved PNG and unchanged original.');
} finally {
  await browser?.close(); server.kill('SIGTERM');
  await new Promise(resolve => server.exitCode !== null ? resolve() : server.once('exit', resolve));
  fs.rmSync(root, { recursive: true, force: true });
}
