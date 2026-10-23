import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ddato-media-layout-'));
const port = 47700 + Math.floor(Math.random() * 1000);
const base = `http://127.0.0.1:${port}`;
const beforeFix = process.argv.includes('--expect-broken');
const shots = path.join(process.cwd(), '.tmp', 'media-layout-screenshots');
fs.mkdirSync(shots, { recursive: true });
const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/server.js'], {
  cwd: process.cwd(), env: { ...process.env, DDATO_DRIVE_HOST: '127.0.0.1', DDATO_DRIVE_PORT: String(port),
    DDATO_DRIVE_DATA_DIR: root, DDATO_DRIVE_DB_FILE: path.join(root, 'app-data', 'drive.sqlite'),
    DDATO_DRIVE_TRUST_PROXY: '0', DDATO_DRIVE_GOOGLE_CLIENT_ID: '', DDATO_DRIVE_GOOGLE_CLIENT_SECRET: '' }, stdio: 'ignore'
});
let browser;
const colors = [[244, 60, 60], [50, 210, 90], [40, 120, 245], [245, 205, 40]];
function fixture(width, height) {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const edgeX = x < width * 0.18 ? 0 : x >= width * 0.82 ? 1 : -1;
    const edgeY = y < height * 0.18 ? 0 : y >= height * 0.82 ? 1 : -1;
    const color = edgeX >= 0 && edgeY >= 0 ? colors[edgeY * 2 + edgeX] : [200, 200, 200];
    const offset = (y * width + x) * 4;
    png.data[offset] = color[0]; png.data[offset + 1] = color[1]; png.data[offset + 2] = color[2]; png.data[offset + 3] = 255;
  }
  return PNG.sync.write(png);
}
try {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, hasTouch: true });
  const api = context.request;
  const headers = { Origin: base };
  assert((await api.post(`${base}/api/auth/login`, { data: { id: 'admin', password: '123456' }, headers })).ok());
  let parentId = null;
  for (let i = 0; i < 5; i++) {
    const response = await api.post(`${base}/api/folders`, { data: { name: `Folder-${i}-${'long-path-'.repeat(4)}`, parentId }, headers });
    assert(response.ok()); parentId = (await response.json()).file.id;
  }
  const files = [];
  for (const [name, width, height] of [['wide.png', 3200, 400], [`portrait-${'LongName'.repeat(12)}.png`, 500, 3000], ['square.png', 1400, 1400]]) {
    const response = await api.post(`${base}/api/files/upload`, { multipart: { parentId, file: { name, mimeType: 'image/png', buffer: fixture(width, height) } }, headers });
    assert(response.ok(), await response.text()); files.push((await response.json()).file);
  }
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/media`);
  await page.locator('.media-card').first().waitFor();
  const sizes = beforeFix ? [[1920, 1080], [390, 844]] : [[1920, 1080], [1440, 900], [1280, 720], [1024, 768], [390, 844], [360, 640], [844, 390]];
  let clipped = 0;
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height });
    for (const file of files) {
      await page.locator('.media-card').filter({ hasText: file.name }).click();
      await page.locator('.media-preview-stage > img').waitFor();
      await page.waitForFunction(() => {
        const img = document.querySelector('.media-preview-stage > img');
        return img.complete && img.naturalWidth > 0;
      });
      const bounds = await page.evaluate(() => {
        const img = document.querySelector('.media-preview-stage > img');
        const stage = document.querySelector('.media-preview-stage');
        const rect = element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
        const style = getComputedStyle(img);
        return { image: rect(img), stage: rect(stage), naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight,
          fit: style.objectFit, pageOverflow: document.documentElement.scrollWidth > innerWidth,
          workspace: rect(document.querySelector('.workspace')), panel: rect(document.querySelector('.media-preview-panel')) };
      });
      const { image, stage } = bounds;
      const fits = image.x >= stage.x - 1 && image.y >= stage.y - 1 && image.x + image.width <= stage.x + stage.width + 1
        && image.y + image.height <= stage.y + stage.height + 1;
      if (!fits) clipped++;
      const key = `${width}x${height}-${file.name.startsWith('portrait') ? 'portrait' : file.name.replace('.png', '')}`;
      const screenshot = await page.screenshot({ path: path.join(shots, `${beforeFix ? 'before-' : ''}${key}.png`) });
      if (beforeFix) { console.log('Before:', key, JSON.stringify(bounds)); continue; }
      assert(fits, `${key}: image extends outside the preview stage: ${JSON.stringify(bounds)}`);
      assert(stage.height >= 48 && stage.width >= 120, `${key}: preview must retain usable space`);
      assert(!bounds.pageOverflow, `${key}: page overflows horizontally`);
      assert(bounds.panel.y + bounds.panel.height <= bounds.workspace.y + bounds.workspace.height + 1);
      assert.equal(bounds.fit, 'contain');
      const scale = Math.min(image.width / bounds.naturalWidth, image.height / bounds.naturalHeight);
      const painted = { width: bounds.naturalWidth * scale, height: bounds.naturalHeight * scale };
      const left = image.x + (image.width - painted.width) / 2;
      const top = image.y + (image.height - painted.height) / 2;
      const png = PNG.sync.read(screenshot);
      for (let corner = 0; corner < 4; corner++) {
        const x = Math.round(left + painted.width * (corner % 2 ? 0.94 : 0.06));
        const y = Math.round(top + painted.height * (corner >= 2 ? 0.94 : 0.06));
        const offset = (y * png.width + x) * 4;
        for (let channel = 0; channel < 3; channel++) {
          assert(Math.abs(png.data[offset + channel] - colors[corner][channel]) < 35, `${key}: corner ${corner} is cropped or obscured`);
        }
      }
    }
    if (!beforeFix) console.log(`${width}x${height}: wide, portrait and square images fit; all four image corners visible.`);
  }
  if (beforeFix) console.log(`Original clipped images: ${clipped}`);
  else {
    await page.getByRole('button', { name: '전체 화면', exact: true }).click();
    await page.locator('.media-fullscreen-shell img').waitFor();
    await page.keyboard.press('f');
    await page.locator('.media-fullscreen-shell').waitFor({ state: 'detached' });
    for (const [width, height] of [[1440, 900], [390, 844], [360, 640], [844, 390], [667, 375]]) {
      await page.setViewportSize({ width, height });
      await page.locator('.media-card').filter({ hasText: 'wide.png' }).click();
      await page.getByRole('button', { name: '이미지 편집', exact: true }).click();
      const editor = page.getByRole('dialog', { name: '이미지 편집', exact: true });
      await editor.getByRole('button', { name: '오른쪽으로 회전', exact: true }).waitFor();
      await page.waitForFunction(() => document.querySelector('.image-editor canvas')?.width === 3200);
      await editor.getByRole('button', { name: '오른쪽으로 회전', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('.image-editor canvas').height === 3200);
      await editor.getByRole('button', { name: '되돌리기', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('.image-editor canvas').width === 3200);
      await editor.getByRole('button', { name: '다시 실행', exact: true }).click();
      await editor.getByRole('button', { name: '자르기', exact: true }).click();
      await editor.getByRole('button', { name: '자르기 적용', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('.image-editor canvas').width === 320 && document.querySelector('.image-editor canvas').height === 2560);
      const canvas = editor.locator('canvas');
      const rect = await canvas.boundingBox();
      assert(rect.width > 1 && rect.height > 20);
      assert(rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= width && rect.y + rect.height <= height);
      await page.touchscreen.tap(rect.x + rect.width / 2, rect.y + rect.height / 2);
      await page.waitForFunction(() => {
        const canvas = document.querySelector('.image-editor canvas');
        const pixel = canvas.getContext('2d').getImageData(160, 1280, 1, 1).data;
        return pixel[0] === 255 && pixel[1] === 59 && pixel[2] === 48;
      });
      await editor.getByRole('button', { name: '되돌리기', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('.image-editor canvas').getContext('2d').getImageData(160, 1280, 1, 1).data[0] === 200);
      await editor.getByRole('button', { name: '다시 실행', exact: true }).click();
      await editor.getByLabel('펜 굵기').fill('12');
      await editor.getByRole('button', { name: '펜 색상 #007aff', exact: true }).click();
      await page.mouse.move(rect.x + rect.width * 0.25, rect.y + rect.height * 0.25);
      await page.mouse.down();
      await page.mouse.move(rect.x + rect.width * 0.75, rect.y + rect.height * 0.3, { steps: 12 });
      await page.mouse.up();
      await editor.getByLabel('편집 파일 이름').fill(width === 844 ? `edited-${width}` : `edited-${width}.png`);
      await page.screenshot({ path: path.join(shots, `editor-${width}x${height}.png`) });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      if (width === 1440) {
        await page.route('**/api/files/upload', route => route.fulfill({ status: 413, contentType: 'application/json', body: JSON.stringify({ error: '사용 가능한 저장 공간이 부족합니다.' }) }), { times: 1 });
        await editor.getByRole('button', { name: '새 파일로 저장', exact: true }).click();
        await editor.getByRole('alert').filter({ hasText: '저장 공간' }).waitFor();
        assert(await editor.getByRole('button', { name: '새 파일로 저장', exact: true }).isEnabled());
      }
      await editor.getByRole('button', { name: '새 파일로 저장', exact: true }).click();
      await editor.waitFor({ state: 'detached' });
      const listing = await (await api.get(`${base}/api/files?parentId=${parentId}`)).json();
      const edited = listing.files.find(file => file.name === `edited-${width}.png`);
      assert(edited, 'edited image must be saved beside its original');
      const saved = PNG.sync.read(await (await api.get(`${base}/api/files/${edited.id}/download`)).body());
      assert.equal(saved.width, 320); assert.equal(saved.height, 2560);
      const center = (1280 * saved.width + 160) * 4;
      assert.deepEqual([...saved.data.subarray(center, center + 3)], [255, 59, 48], 'saved PNG retains pen edits');
      for (const [corner, sourceCorner] of [2, 0, 3, 1].entries()) {
        const x = Math.floor(saved.width * (corner % 2 ? 0.98 : 0.02));
        const y = Math.floor(saved.height * (corner >= 2 ? 0.98 : 0.02));
        const offset = (y * saved.width + x) * 4;
        assert.deepEqual([...saved.data.subarray(offset, offset + 3)], colors[sourceCorner], 'crop and clockwise rotation preserve the correct image corners');
      }
      const original = await (await api.get(`${base}/api/files/${files[0].id}/download`)).body();
      assert.deepEqual(original, fixture(3200, 400), 'editing must not modify the original');
      console.log(`${width}x${height}: rotate, crop, touch/mouse pen, undo/redo and new PNG save passed; original unchanged.`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('.media-card').filter({ hasText: 'wide.png' }).click();
    await page.getByRole('button', { name: '이미지 편집', exact: true }).click();
    await page.getByRole('dialog', { name: '이미지 편집', exact: true }).getByRole('button', { name: '오른쪽으로 회전', exact: true }).click();
    page.once('dialog', dialog => dialog.dismiss());
    await page.getByRole('button', { name: '편집 닫기', exact: true }).click();
    assert(await page.getByRole('dialog', { name: '이미지 편집', exact: true }).isVisible());
    page.once('dialog', dialog => dialog.accept());
    await page.keyboard.press('Escape');
    await page.getByRole('dialog', { name: '이미지 편집', exact: true }).waitFor({ state: 'detached' });
    assert((await api.put(`${base}/api/files/${files[0].id}/password`, { data: { password: 'test-lock' }, headers })).ok());
    await page.reload();
    await page.locator('.media-card').filter({ hasText: 'wide.png' }).click();
    assert(await page.getByRole('button', { name: '이미지 편집', exact: true }).isDisabled());
    assert.deepEqual(errors, []);
    console.log('Media layout/editor browser tests passed, including quota failure/retry, discard confirmation, locked images, fullscreen exit and zero runtime errors.');
  }
} finally {
  await browser?.close();
  if (server.exitCode === null) {
    const exited = new Promise(resolve => server.once('exit', resolve));
    server.kill('SIGTERM'); await exited;
  }
  fs.rmSync(root, { recursive: true, force: true });
}
