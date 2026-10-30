import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { Transform } from 'node:stream';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import yauzl from 'yauzl';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'drive-download-refresh-'));
const port = 46000 + Math.floor(Math.random() * 1000);
const backend = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/server.js'], { env: { ...process.env,
  DDATO_DRIVE_DATA_DIR: root, DDATO_DRIVE_DB_FILE: path.join(root, 'drive.sqlite'), DDATO_DRIVE_HOST: '127.0.0.1',
  DDATO_DRIVE_PORT: String(port), DDATO_DRIVE_ADMIN_PASSWORD: '123456', DDATO_DRIVE_GOOGLE_CLIENT_ID: '',
  DDATO_DRIVE_GOOGLE_CLIENT_SECRET: '', DDATO_DRIVE_TRUST_PROXY: '0' }, stdio: 'ignore' });
const streams = [];
const proxy = http.createServer((req, res) => {
  const upstream = http.request(`${backend}${req.url}`, { method: req.method, headers: req.headers }, response => {
    res.writeHead(response.statusCode, response.headers);
    if (String(response.headers['content-disposition']).startsWith('attachment') && response.statusCode === 200) {
      const transfer = { bytes: 0, finished: false, disconnected: false }; streams.push(transfer);
      const slow = new Transform({ transform(chunk, _encoding, done) {
        setTimeout(() => { transfer.bytes += chunk.length; done(null, chunk); }, 15);
      } });
      res.on('finish', () => { transfer.finished = true; });
      res.on('close', () => { if (!transfer.finished) transfer.disconnected = true; slow.destroy(); response.destroy(); });
      response.pipe(slow).pipe(res);
    } else response.pipe(res);
  });
  upstream.on('error', () => res.destroy()); req.pipe(upstream);
});
let browser;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function zipContents(bytes) {
  return new Promise((resolve, reject) => yauzl.fromBuffer(bytes, { lazyEntries: true }, (error, zip) => {
    if (error) return reject(error); const contents = new Map();
    zip.on('error', reject); zip.on('end', () => resolve(contents));
    zip.on('entry', entry => {
      if (entry.fileName.endsWith('/')) { zip.readEntry(); return; }
      zip.openReadStream(entry, (error, stream) => {
        if (error) return reject(error); const chunks = [];
        stream.on('error', reject); stream.on('data', chunk => chunks.push(chunk));
        stream.on('end', () => { contents.set(entry.fileName, Buffer.concat(chunks)); zip.readEntry(); });
      });
    }); zip.readEntry();
  }));
}
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`${backend}/api/health`)).ok) break; } catch {} await pause(50); }
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${proxy.address().port}`;
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ acceptDownloads: true }); const api = context.request;
  const headers = { Origin: base };
  assert((await api.post(`${base}/api/auth/login`, { headers, data: { id: 'admin', password: '123456' } })).ok());
  const expected = Buffer.alloc(8 * 1024 * 1024, 79);
  const files = [];
  for (const name of ['첫 번째.bin', 'second.bin']) {
    const response = await api.post(`${base}/api/files/upload`, { headers, multipart: { file: { name, mimeType: 'application/octet-stream', buffer: expected } } });
    assert(response.ok()); files.push((await response.json()).file);
  }
  const page = await context.newPage(); const errors = []; page.on('pageerror', error => errors.push(error.message));
  for (const selection of [[files[0]], files]) {
    await page.goto(base);
    for (const file of selection) await page.getByRole('checkbox', { name: `${file.name} 선택`, exact: true }).check();
    const previous = streams.length;
    const event = page.waitForEvent('download');
    await page.getByRole('button', { name: '다운로드', exact: true }).click();
    const download = await event;
    assert.equal(streams.length, previous + 1);
    const active = streams.at(-1); assert(active.bytes > 0 && !active.finished, 'refresh must occur while response is in flight');
    await page.reload();
    assert.equal(await download.failure(), null);
    assert.equal(active.disconnected, false);
    const result = fs.readFileSync(await download.path());
    if (selection.length === 1) assert.equal(hash(result), hash(expected));
    else {
      const zipped = await zipContents(result); assert.equal(zipped.size, 2);
      for (const file of files) assert.equal(hash(zipped.get(file.name)), hash(expected));
    }
    assert.equal(streams.length, previous + 1, 'reload must not start a second request');
    console.log(`${selection.length === 1 ? 'Single file' : 'Multi-file ZIP'}: refresh during throttled download, uninterrupted response, exact SHA-256 and no duplicate request.`);
  }
  const folder = (await (await api.post(`${base}/api/folders`, { headers, data: { name: 'shared-folder' } })).json()).file;
  for (const file of files) assert((await api.patch(`${base}/api/files/${file.id}/move`, { headers, data: { parentId: folder.id } })).ok());
  const share = (await (await api.post(`${base}/api/files/${folder.id}/share`, { headers, data: { mode: 'permanent' } })).json()).share;
  await page.goto(`${base}/share/${share.token}`);
  const sharedEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '다운로드', exact: true }).click();
  const sharedDownload = await sharedEvent; const sharedStream = streams.at(-1);
  assert(!sharedStream.finished); await page.reload();
  assert.equal(await sharedDownload.failure(), null); assert(!sharedStream.disconnected);
  const sharedFiles = await zipContents(fs.readFileSync(await sharedDownload.path()));
  assert.equal(sharedFiles.size, 2); for (const bytes of sharedFiles.values()) assert.equal(hash(bytes), hash(expected));
  console.log('Public shared-folder ZIP: reload preserves the active download and both file contents.');
  // Errors stay inside the hidden request frame rather than replacing the app.
  assert((await api.put(`${base}/api/files/${files[0].id}/password`, { headers, data: { password: 'locked-test' } })).ok());
  await page.goto(base);
  await page.evaluate(id => {
    const frame = document.createElement('iframe'); frame.hidden = true; frame.src = `/api/files/${id}/download`; document.body.append(frame);
  }, files[0].id);
  await pause(100); assert.equal(new URL(page.url()).pathname, '/');
  assert.deepEqual(errors, []);
} finally {
  await browser?.close(); proxy.closeAllConnections(); await new Promise(resolve => proxy.close(resolve));
  server.kill('SIGTERM'); await new Promise(resolve => server.exitCode !== null ? resolve() : server.once('exit', resolve));
  fs.rmSync(root, { recursive: true, force: true });
}
