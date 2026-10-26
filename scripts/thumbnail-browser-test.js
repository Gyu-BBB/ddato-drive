import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { documentZip, thumbnailPdf } from './fixtures/thumbnailDocuments.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ddato-thumbnails-'));
const port = 49200 + Math.floor(Math.random() * 500);
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
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const api = context.request;
  const headers = { Origin: base };
  assert((await api.post(`${base}/api/auth/login`, { data: { id: 'admin', password: '123456' }, headers })).ok());
  const page = await context.newPage();
  const errors = [];
  const previewRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.url().includes('/preview')) previewRequests.push(request.url()); });
  await page.goto(base);
  const videoBytes = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 160; canvas.height = 90;
    const context = canvas.getContext('2d');
    const stream = canvas.captureStream(10);
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
    const chunks = [];
    recorder.ondataavailable = event => chunks.push(event.data);
    const done = new Promise(resolve => { recorder.onstop = resolve; });
    recorder.start();
    for (let i = 0; i < 6; i++) {
      context.fillStyle = '#34c759'; context.fillRect(0, 0, 160, 90);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    recorder.stop(); await done;
    stream.getTracks().forEach(track => track.stop());
    return [...new Uint8Array(await new Blob(chunks).arrayBuffer())];
  });
  async function upload(name, mimeType, buffer) {
    const response = await api.post(`${base}/api/files/upload`, { headers, multipart: { file: { name, mimeType, buffer } } });
    assert(response.ok(), await response.text());
    return (await response.json()).file;
  }
  const image = new PNG({ width: 120, height: 80 });
  for (let i = 0; i < image.data.length; i += 4) image.data.set([240, 60, 60, 255], i);
  const photo = await upload('photo.png', 'image/png', PNG.sync.write(image));
  const movie = await upload('movie.webm', 'video/webm', Buffer.from(videoBytes));
  const locked = await upload('locked.png', 'image/png', PNG.sync.write(image));
  const broken = await upload('broken.png', 'image/png', Buffer.from('invalid image'));
  const pdf = await upload('page.pdf', 'application/pdf', thumbnailPdf());
  const text = await upload('notes.txt', 'text/plain', Buffer.from('Document thumbnail\nActual document contents\nLine three'));
  const sheet = await upload('budget.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', documentZip([
    ['xl/workbook.xml', '<workbook><sheets><sheet name="Budget" /></sheets></workbook>'],
    ['xl/worksheets/sheet1.xml', '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Revenue</t></is></c><c r="B1"><v>1234</v></c></row></sheetData></worksheet>']
  ]));
  const document = await upload('document.hwpx', 'application/hwp+zip', documentZip([
    ['Contents/section0.xml', '<section><p><t>Actual document text for thumbnail</t></p></section>']
  ]));
  const word = await upload('word.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', documentZip([
    ['[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'],
    ['_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'],
    ['word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:rPr><w:sz w:val="48"/><w:color w:val="245AD0"/></w:rPr><w:t>Actual Word document</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/></w:sectPr></w:body></w:document>']
  ]));
  const protectedPdf = await upload('protected.pdf', 'application/pdf', thumbnailPdf());
  assert((await api.put(`${base}/api/files/${protectedPdf.id}/password`, { headers, data: { password: 'test-only' } })).ok());
  assert((await api.put(`${base}/api/files/${locked.id}/password`, { headers, data: { password: 'test-only' } })).ok());
  const shots = path.resolve('.tmp/thumbnail-screenshots');
  fs.mkdirSync(shots, { recursive: true });
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    await page.setViewportSize({ width, height });
    for (const mode of ['아이콘 보기', '목록 보기', '컬럼 보기', '갤러리 보기']) {
      await page.goto(base);
      await page.getByRole('button', { name: mode, exact: true }).click();
      for (const file of [photo, movie, pdf, text, sheet, document, word]) {
        await page.locator(`[data-file-id="${file.id}"]`).first().scrollIntoViewIfNeeded();
        const thumb = page.locator(`[data-file-id="${file.id}"] .media-thumbnail img`).first();
        await thumb.scrollIntoViewIfNeeded();
        await thumb.evaluate(img => img.complete && img.naturalWidth ? undefined : new Promise((resolve, reject) => {
          img.onload = resolve; img.onerror = reject;
        }));
        assert(await thumb.evaluate(img => img.naturalWidth > 0));
        const pixel = await thumb.evaluate(img => {
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = 1;
          const context = canvas.getContext('2d');
          context.drawImage(img, 0, 0, 1, 1);
          return [...context.getImageData(0, 0, 1, 1).data];
        });
        if (file.id === movie.id) assert(pixel[1] > 150 && pixel[0] < 100 && pixel[3] === 255, 'video thumbnail must show the recorded green frame');
        else if (file.id === photo.id) assert(pixel[0] > 200 && pixel[1] < 100 && pixel[3] === 255, 'image thumbnail must show actual red source pixels');
        else if (file.id === pdf.id) assert(pixel[2] > 200 && pixel[0] < 20, 'PDF thumbnail must render the actual blue page');
        else {
          assert(await thumb.evaluate(img => {
            const canvas = window.document.createElement('canvas');
            canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
            const context = canvas.getContext('2d'); context.drawImage(img, 0, 0);
            const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
            return pixels.some((value, index) => index % 4 < 3 && value < 150);
          }), 'document thumbnail must contain real text or table content');
        }
      }
      assert.equal(await page.locator(`[data-file-id="${locked.id}"] .media-thumbnail`).count(), 0);
      assert.equal(await page.locator(`[data-file-id="${protectedPdf.id}"] .media-thumbnail`).count(), 0);
      await page.locator(`[data-file-id="${broken.id}"] .media-thumbnail svg`).first().waitFor();
      await page.screenshot({ path: path.join(shots, `${width}-${mode}.png`) });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
    await page.goto(`${base}/media`);
    const movieCard = page.locator('.media-card').filter({ hasText: 'movie.webm' });
    await movieCard.locator('.media-thumbnail img').waitFor();
    assert.equal(await movieCard.locator('video').count(), 0, 'thumbnail decoder should be released after capture');
    await page.screenshot({ path: path.join(shots, `${width}-media.png`) });
  }
  assert(!previewRequests.some(url => url.includes(locked.id)), 'locked thumbnails must never request protected content');
  assert(!previewRequests.some(url => url.includes(protectedPdf.id)), 'locked documents must never request protected content');
  assert.deepEqual(errors, []);
  console.log('Thumbnail browser tests passed: image/video/PDF/text/spreadsheet/office-text in all four views, desktop/mobile, locked privacy, actual rendered pixels, corrupt-file fallback, released video decoders and no horizontal overflow.');
} finally {
  await browser?.close();
  server.kill('SIGTERM');
  await new Promise(resolve => server.exitCode !== null ? resolve() : server.once('exit', resolve));
  fs.rmSync(root, { recursive: true, force: true });
}
