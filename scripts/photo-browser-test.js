import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
const fixturePath = '.tmp/photo-fixtures/heic-single.heic';
fs.mkdirSync(path.dirname(fixturePath), { recursive: true });
if (!fs.existsSync(fixturePath)) {
  const response = await fetch('https://raw.githubusercontent.com/MikeKovarik/exifr/master/test/fixtures/heic-single.heic');
  assert(response.ok); fs.writeFileSync(fixturePath, Buffer.from(await response.arrayBuffer()));
}
const bytes = fs.readFileSync(fixturePath);
assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), '00d9e0636b645036f77b3809fcd26a29df71b9ee66f2865fd8729b894aeabf59');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'drive-photo-ui-'));
const port = 45000 + Math.floor(Math.random() * 1000); const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/server.js'], { env: { ...process.env, DDATO_DRIVE_DATA_DIR: root,
  DDATO_DRIVE_DB_FILE: path.join(root, 'drive.sqlite'), DDATO_DRIVE_HOST: '127.0.0.1', DDATO_DRIVE_PORT: String(port), DDATO_DRIVE_ADMIN_PASSWORD: '123456',
  DDATO_DRIVE_GOOGLE_CLIENT_ID: '', DDATO_DRIVE_GOOGLE_CLIENT_SECRET: '', DDATO_DRIVE_TRUST_PROXY: '0' }, stdio: 'ignore' });
let browser;
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {} await new Promise(resolve => setTimeout(resolve, 50)); }
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ hasTouch: true }); const api = context.request; const headers = { Origin: base };
  assert((await api.post(`${base}/api/auth/login`, { headers, data: { id: 'admin', password: '123456' } })).ok());
  let file;
  for (let index = 0; index < 2; index++) {
    const response = await api.post(`${base}/api/files/upload`, { headers, multipart: { file: { name: `photo-${index}.heic`, mimeType: 'image/heic', buffer: bytes } } });
    assert(response.ok()); file = (await response.json()).file;
  }
  assert.equal(file.duplicatePhotoCount, 1);
  assert.deepEqual(await (await api.get(`${base}/api/files/${file.id}/download`)).body(), bytes, 'HEIC original must be unchanged');
  const page = await context.newPage(); const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/media`);
  await page.getByRole('button', { name: 'photo-1.heic', exact: true }).click();
  await page.waitForFunction(() => { const image = document.querySelector('.media-preview-stage img'); return image?.complete && image.naturalWidth > 0; }, { timeout: 60000 });
  await page.waitForFunction(() => Array.from(document.querySelectorAll('.media-thumbnail img')).some(image => image.complete && image.naturalWidth > 0), { timeout: 60000 });
  for (const width of [1440, 390, 360]) {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
    await page.screenshot({ path: `.tmp/photo-heic-${width}.png`, fullPage: true });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  await page.goto(base);
  await page.getByRole('button', { name: '사진 촬영', exact: true }).waitFor();
  assert.equal(await page.locator('input[capture="environment"]').getAttribute('accept'), 'image/*');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.deepEqual(errors, []);
  console.log('Photos browser: HEIC previews/thumbnails under strict CSP, unchanged original download, duplicate metadata, camera input and desktop/mobile bounds passed.');
} finally {
  await browser?.close(); server.kill('SIGTERM');
  await new Promise(resolve => server.exitCode !== null ? resolve() : server.once('exit', resolve));
  fs.rmSync(root, { recursive: true, force: true });
}
