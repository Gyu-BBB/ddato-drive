import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ddato-navigation-'));
const port = 46600 + Math.floor(Math.random() * 1000);
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/server.js'], {
  cwd: process.cwd(), env: { ...process.env, DDATO_DRIVE_HOST: '127.0.0.1', DDATO_DRIVE_PORT: String(port),
    DDATO_DRIVE_DATA_DIR: dataDir, DDATO_DRIVE_DB_FILE: path.join(dataDir, 'app-data', 'drive.sqlite'),
    DDATO_DRIVE_TRUST_PROXY: '0', DDATO_DRIVE_GOOGLE_CLIENT_ID: '', DDATO_DRIVE_GOOGLE_CLIENT_SECRET: '' },
  stdio: 'ignore'
});
let browser;
try {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const api = context.request;
  async function post(url, data) {
    const response = await api.post(`${base}${url}`, { data, headers: { Origin: base } });
    assert(response.ok(), `${url}: ${await response.text()}`);
    return response.json();
  }
  await post('/api/auth/login', { id: 'admin', password: '123456' });
  const alpha = (await post('/api/folders', { name: 'Alpha' })).file;
  const beta = (await post('/api/folders', { name: 'Beta', parentId: alpha.id })).file;
  async function upload(name, parentId, bytes, mimeType = 'text/plain') {
    const multipart = { file: { name, mimeType, buffer: bytes } };
    if (parentId) multipart.parentId = parentId;
    const response = await api.post(`${base}/api/files/upload`, { multipart, headers: { Origin: base } });
    assert(response.ok(), await response.text());
    return (await response.json()).file;
  }
  const leaf = await upload('nested.txt', beta.id, Buffer.from('nested contents'));
  const rootFile = await upload('root-preview.txt', null, Buffer.from('root preview contents'));
  await upload('image.png', beta.id, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9sAAAAASUVORK5CYII=', 'base64'), 'image/png');
  await post('/api/admin/users', { id: 'navigation-user', password: 'test-only', quotaMb: 1024 });
  const other = (await post('/api/folders', { ownerId: 'navigation-user', name: 'Other owner' })).file;
  const share = (await post(`/api/files/${leaf.id}/share`, { mode: 'permanent' })).share;
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.setDefaultTimeout(10000);
  async function expectPath(expected) {
    await page.waitForURL(url => `${url.pathname}${url.search}` === expected);
  }
  const item = file => page.locator(`[data-file-item][data-file-id="${file.id}"]`).first();
  async function sidebar(section, expected) {
    await page.locator(`.nav-item[data-section="${section}"]`).click();
    await expectPath(expected);
    await page.locator(`.nav-item.active[data-section="${section}"]`).waitFor();
  }

  await page.goto(base);
  async function stableBounds(before, locator) {
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const after = await locator.boundingBox();
    for (const property of ['x', 'y', 'width', 'height']) {
      assert(Math.abs(after[property] - before[property]) < 1, `folder ${property} changed after focus`);
    }
  }
  for (const label of ['아이콘 보기', '목록 보기', '컬럼 보기', '갤러리 보기']) {
    await page.goto(base);
    await page.getByRole('button', { name: label, exact: true }).click();
    await item(alpha).waitFor();
    const before = await item(alpha).boundingBox();
    await item(alpha).click();
    assert.equal(await page.locator('.side-panel').count(), 0, `${label}: folder focus must not open the sidebar`);
    assert(!(await page.getByRole('checkbox', { name: 'Alpha 선택', exact: true }).isChecked()));
    await stableBounds(before, item(alpha));
    await page.mouse.dblclick(before.x + before.width / 2, before.y + before.height / 2);
    await expectPath(`/folders/${alpha.id}`);
    await sidebar('drive', '/'); await item(alpha).waitFor();
    await item(alpha).click({ button: 'right' });
    assert.equal(await page.locator('.side-panel').count(), 0, `${label}: context menu alone must not open the sidebar`);
    await page.getByRole('menuitem', { name: '파일 정보', exact: true }).click();
    await page.locator('.side-panel .panel-title').getByText('파일 정보', { exact: true }).waitFor();
    assert.equal(await page.locator('.side-panel .metadata-card > strong').innerText(), 'Alpha');
    await page.locator('.side-panel').getByRole('button', { name: '닫기', exact: true }).click();
    await item(rootFile).click();
    await page.locator('.side-panel').waitFor();
    if (label === '아이콘 보기' || label === '목록 보기') {
      await page.locator('.side-panel .preview-frame').waitFor();
    }
    const expanded = await item(alpha).boundingBox();
    await item(alpha).click();
    await page.locator('.side-panel').waitFor();
    await stableBounds(expanded, item(alpha));
    await page.locator('.side-panel').getByRole('button', { name: '닫기', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Alpha 선택', exact: true }).check();
    assert.equal(await page.locator('.side-panel').count(), 0, 'checkboxes must not open the sidebar');
    await item(alpha).click({ button: 'right' });
    await page.getByRole('menuitem', { name: '파일 정보', exact: true }).click();
    assert(await page.getByRole('checkbox', { name: 'Alpha 선택', exact: true }).isChecked(), 'file info must not change checkbox selection');
    console.log(`${label}: stable folder click/double-click, explicit info, file preview and independent checkboxes passed.`);
  }
  await page.goto(base);
  await page.getByRole('button', { name: '아이콘 보기', exact: true }).click();
  await item(rootFile).locator('.document-thumbnail img').waitFor();
  const previewRequests = [];
  const countPreview = request => { if (new URL(request.url()).pathname.endsWith('/preview')) previewRequests.push(request.url()); };
  page.on('request', countPreview);
  await item(rootFile).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '파일 정보', exact: true }).click();
  await page.locator('.side-panel .panel-title').getByText('파일 정보', { exact: true }).waitFor();
  assert.equal(previewRequests.length, 0, 'file info should not fetch file contents');
  page.off('request', countPreview);
  await item(rootFile).click();
  await page.locator('.side-panel .preview-frame').waitFor();
  await page.goto(base);
  await item(alpha).waitFor();
  await page.locator('.drive-content').press('ArrowDown');
  assert.equal(await page.locator('.side-panel').count(), 0, 'keyboard folder focus must not open the sidebar');
  await page.locator('.drive-content').press('Space');
  await page.locator('.side-panel .panel-title').getByText('파일 정보', { exact: true }).waitFor();
  await page.locator('.side-panel').getByRole('button', { name: '닫기', exact: true }).click();
  await page.goto(base);
  await sidebar('media', '/media');
  const length = await page.evaluate(() => history.length);
  await sidebar('media', '/media');
  assert.equal(await page.evaluate(() => history.length), length, 'active tabs must not add duplicate history');
  await sidebar('notes', '/notes');
  await sidebar('trash', '/trash');
  await page.goBack(); await expectPath('/notes');
  await page.locator('.nav-item.active[data-section="notes"]').waitFor();
  await page.goBack(); await expectPath('/media');
  await page.goForward(); await expectPath('/notes');
  await page.reload(); await expectPath('/notes');
  await page.locator('.nav-item.active[data-section="notes"]').waitFor();
  console.log('Sidebar: URL changes, back/forward, refresh and duplicate-entry prevention passed.');

  await sidebar('drive', '/');
  await item(alpha).dblclick(); await expectPath(`/folders/${alpha.id}`);
  await item(beta).dblclick(); await expectPath(`/folders/${beta.id}`);
  await item(leaf).waitFor();
  await page.goBack(); await expectPath(`/folders/${alpha.id}`); await item(beta).waitFor();
  await page.goForward(); await expectPath(`/folders/${beta.id}`); await item(leaf).waitFor();
  await page.reload(); await item(leaf).waitFor();
  assert((await page.locator('.breadcrumb-trail').innerText()).includes('Alpha'));
  assert((await page.locator('.breadcrumb-trail').innerText()).includes('Beta'));
  await page.locator('.breadcrumb-button').first().click(); await expectPath('/'); await item(alpha).waitFor();
  await page.goBack(); await expectPath(`/folders/${beta.id}`); await item(leaf).waitFor();
  console.log('Folders: nested history, reload restoration, breadcrumbs and home/back passed.');

  await sidebar('drive', '/'); await item(alpha).waitFor();
  let releaseListing;
  let listingStarted;
  const listingGate = new Promise(resolve => { releaseListing = resolve; });
  const listingSeen = new Promise(resolve => { listingStarted = resolve; });
  await page.route('**/api/files?*', async route => {
    if (new URL(route.request().url()).searchParams.get('parentId') === alpha.id) {
      listingStarted(); await listingGate;
    }
    await route.continue();
  });
  await item(alpha).dblclick(); await listingSeen;
  await sidebar('drive', '/'); await item(alpha).waitFor();
  const staleResponse = page.waitForResponse(response => new URL(response.url()).searchParams.get('parentId') === alpha.id);
  releaseListing(); await staleResponse;
  await page.unroute('**/api/files?*');
  await item(alpha).waitFor();
  assert.equal(await item(beta).count(), 0, 'late folder responses must not overwrite the current home listing');
  console.log('Rapid navigation ignores stale folder responses.');

  await sidebar('media', '/media');
  await page.locator('.media-card').filter({ hasText: 'image.png' }).click();
  await page.locator('.media-location-link').click();
  await expectPath(`/folders/${beta.id}`); await item(leaf).waitFor();
  await page.goBack(); await expectPath('/media');
  console.log('Media folder links preserve browser history.');

  await sidebar('admin', '/admin');
  await page.getByRole('button', { name: '사용자 관리', exact: true }).click();
  await page.waitForURL(url => url.pathname === '/admin/users');
  await page.getByRole('button', { name: '감사 로그', exact: true }).click(); await expectPath('/admin/audit');
  await page.goBack(); await page.waitForURL(url => url.pathname === '/admin/users');
  await page.locator('.admin-content-header h1').filter({ hasText: '사용자 관리' }).waitFor();
  await page.getByRole('button', { name: '파일 열람', exact: true }).click();
  await page.locator('.admin-user-select select').selectOption('navigation-user');
  await expectPath('/admin/files?owner=navigation-user');
  await item(other).dblclick(); await expectPath(`/admin/files?owner=navigation-user&folder=${other.id}`);
  await page.reload();
  await page.locator('.breadcrumb-trail').getByRole('button', { name: 'Other owner', exact: true }).waitFor();
  await page.getByRole('group', { name: '파일 열람 범위' }).getByRole('button', { name: '휴지통', exact: true }).click();
  await page.waitForURL(url => url.pathname === '/admin/files' && url.searchParams.get('mode') === 'trash');
  await page.goBack(); await expectPath(`/admin/files?owner=navigation-user&folder=${other.id}`);
  await page.locator('.breadcrumb-trail').getByRole('button', { name: 'Other owner', exact: true }).waitFor();
  console.log('Admin: subtab history, selected owner, folder refresh and files/trash history passed.');

  await page.goto(`${base}/folders/missing-folder`);
  await page.locator('.page-error').filter({ hasText: /not found|찾을|열지/ }).waitFor();
  await sidebar('drive', '/'); await item(alpha).waitFor();
  const privateContext = await browser.newContext();
  const privatePage = await privateContext.newPage();
  await privatePage.goto(`${base}/admin-login`);
  await privatePage.getByRole('heading', { name: '관리자 로그인', exact: true }).waitFor();
  await privateContext.request.post(`${base}/api/auth/login`, { data: { id: 'navigation-user', password: 'test-only' }, headers: { Origin: base } });
  await privatePage.goto(`${base}/admin/users`);
  await privatePage.waitForURL(`${base}/`);
  assert.equal(await privatePage.locator('[data-section="admin"]').count(), 0);
  await privatePage.goto(`${base}/share/${share.token}`);
  await privatePage.getByText('nested.txt', { exact: true }).first().waitFor();
  await privateContext.close();
  await page.goto(`${base}/admin/login`);
  await page.waitForURL(`${base}/`);
  console.log('Invalid folder recovery, admin-login alias, admin access restrictions and public share route passed.');

  await sidebar('drive', '/'); await item(alpha).waitFor();
  let releaseUpload;
  let uploadStarted;
  const started = new Promise(resolve => { uploadStarted = resolve; });
  const gate = new Promise(resolve => { releaseUpload = resolve; });
  let intercepted = 0;
  await page.route('**/api/files/upload-sessions/*/chunk', async route => {
    intercepted++; uploadStarted(); await gate; await route.continue();
  });
  await page.locator('input[type="file"]').first().setInputFiles({ name: 'while-navigating.txt', mimeType: 'text/plain', buffer: Buffer.from('upload must continue') });
  await started;
  await item(alpha).dblclick(); await expectPath(`/folders/${alpha.id}`);
  releaseUpload();
  await page.locator('.upload-item').filter({ hasText: 'while-navigating.txt' }).filter({ hasText: '업로드됨' }).waitFor();
  assert.equal(intercepted, 1, 'folder navigation must not abort/restart the upload');
  const homeFiles = await (await api.get(`${base}/api/files`)).json();
  assert(homeFiles.files.some(file => file.name === 'while-navigating.txt'), 'upload destination must remain the original folder');
  await page.unroute('**/api/files/upload-sessions/*/chunk');
  console.log('Folder navigation preserves active upload and original upload destination.');

  await page.setViewportSize({ width: 390, height: 844 });
  await sidebar('media', '/media');
  await sidebar('notes', '/notes');
  await page.goBack(); await expectPath('/media');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  const screenshotDir = path.join(process.cwd(), '.tmp', 'navigation-screenshots');
  fs.mkdirSync(screenshotDir, { recursive: true });
  await page.screenshot({ path: path.join(screenshotDir, 'mobile.png') });
  await page.setViewportSize({ width: 1440, height: 900 });
  await sidebar('drive', '/'); await item(alpha).dblclick(); await item(beta).waitFor();
  await page.screenshot({ path: path.join(screenshotDir, 'desktop.png') });
  assert.deepEqual(errors, []);
  console.log('Navigation browser tests passed on desktop/mobile with zero runtime errors.');
} finally {
  await browser?.close();
  if (server.exitCode === null) {
    const exited = new Promise(resolve => server.once('exit', resolve));
    server.kill('SIGTERM'); await exited;
  }
  fs.rmSync(dataDir, { recursive: true, force: true });
}
