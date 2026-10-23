import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
let browser;
try {
  const { UploadQueue } = await vite.ssrLoadModule('/src/client/features/files/components/UploadQueue.jsx');
  const css = ['src/client/app/app.css', 'src/client/app/apple-platform.css'].map(file => fs.readFileSync(file, 'utf8')).join('\n');
  const shots = path.resolve('.tmp/transfer-eta-screenshots');
  fs.mkdirSync(shots, { recursive: true });
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
  const page = await browser.newPage();
  const unit = 1024 ** 2;
  for (const direction of ['upload', 'download']) {
    for (const [width, height] of [[1920, 1080], [390, 844], [360, 640]]) {
      await page.setViewportSize({ width, height });
      const uploads = [
        { id: 'active', name: '긴 이름 파일.pdf', status: 'uploading', sizeBytes: 100 * unit, uploadedBytes: 25 * unit, speedBytes: 5 * unit, progress: 25.12345 },
        { id: 'queued', name: '대기 중.pdf', status: 'queued', sizeBytes: 50 * unit, uploadedBytes: 0 },
        { id: 'paused', name: '일시정지.pdf', status: 'paused', sizeBytes: 1000 * unit, uploadedBytes: 0 }
      ];
      const markup = renderToStaticMarkup(React.createElement(UploadQueue, { uploads, direction }));
      await page.setContent(`<html lang="ko"><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body>${markup}</body></html>`);
      await page.getByText('전체 약 25초 남음', { exact: true }).waitFor();
      await page.getByText('약 15초 남음', { exact: true }).waitFor();
      assert.equal(await page.locator('.transfer-eta').count(), 2, 'paused transfers must not show an ETA');
      assert((await page.locator('.upload-item').first().innerText()).includes('25.12%'));
      await page.screenshot({ path: path.join(shots, `${direction}-${width}x${height}.png`), animations: 'disabled' });
      for (const label of await page.locator('.transfer-eta').all()) {
        assert(await label.evaluate(element => {
          const rect = element.getBoundingClientRect();
          return element.scrollHeight <= element.clientHeight + 1 && element.scrollWidth <= element.clientWidth + 1
            && rect.x >= 0 && rect.right <= innerWidth && rect.y >= 0 && rect.bottom <= innerHeight;
        }), `${direction} ${width}x${height}: ETA must be fully visible: ${JSON.stringify(await label.boundingBox())}`);
      }
      console.log(`${direction} ${width}x${height}: file/total ETA and two-decimal progress visible without clipping.`);
    }
  }
} finally {
  await browser?.close();
  await vite.close();
}
