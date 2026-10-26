import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'drive-management-ui-'));
const port = 44000 + Math.floor(Math.random() * 1000); const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/server.js'], { env: { ...process.env, DDATO_DRIVE_DATA_DIR: root,
  DDATO_DRIVE_DB_FILE: path.join(root, 'drive.sqlite'), DDATO_DRIVE_HOST: '127.0.0.1', DDATO_DRIVE_PORT: String(port),
  DDATO_DRIVE_ADMIN_PASSWORD: '123456', DDATO_DRIVE_GOOGLE_CLIENT_ID: '', DDATO_DRIVE_GOOGLE_CLIENT_SECRET: '', DDATO_DRIVE_TRUST_PROXY: '0' }, stdio: 'ignore' });
let browser;
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {} await new Promise(resolve => setTimeout(resolve, 50)); }
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext(); const headers = { Origin: base }; const api = context.request;
  assert((await api.post(`${base}/api/auth/login`, { headers, data: { id: 'admin', password: '123456' } })).ok());
  const upload = await api.post(`${base}/api/files/upload`, { headers, multipart: { file: { name: '공유할 긴 이름의 문서.txt', mimeType: 'text/plain', buffer: Buffer.from('test') } } });
  assert(upload.ok()); const file = (await upload.json()).file;
  assert((await api.post(`${base}/api/files/${file.id}/share`, { headers, data: { mode: 'permanent' } })).ok());
  const page = await context.newPage(); const errors = []; page.on('pageerror', error => errors.push(error.message));
  fs.mkdirSync('.tmp', { recursive: true });
  for (const width of [1440, 390, 360]) {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
    for (const route of ['/shared', '/admin', '/storage']) {
      await page.goto(`${base}${route}`);
      if (route === '/shared') await page.getByText(file.name, { exact: true }).waitFor();
      else if (route === '/admin') await page.getByRole('button', { name: '읽기 전용 점검', exact: true }).waitFor();
      else await page.getByRole('heading', { name: '파일 종류별 사용량' }).waitFor();
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${route} overflow at ${width}`);
      await page.screenshot({ path: `.tmp/management-${route.slice(1)}-${width}.png`, fullPage: true });
    }
  }
  await page.goto(`${base}/shared`);
  await page.getByRole('checkbox', { name: '현재 페이지 전체 선택' }).check();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '선택 해제', exact: true }).click();
  await page.getByText('해제됨', { exact: true }).last().waitFor();
  await page.goto(`${base}/admin`);
  await page.getByRole('button', { name: '읽기 전용 점검', exact: true }).click();
  await page.getByText(/확인 1개 · 이상 0개 · 완료/).waitFor();
  assert.deepEqual(errors, []);
  console.log('Management UI: desktop/mobile bounds, shared-link batch revocation and read-only integrity scan passed.');
} finally {
  await browser?.close(); server.kill('SIGTERM');
  await new Promise(resolve => server.exitCode !== null ? resolve() : server.once('exit', resolve));
  fs.rmSync(root, { recursive: true, force: true });
}
