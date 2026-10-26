import { isDocumentFile, isPdfFile, isSpreadsheetFile } from './components/FilePreview.jsx';
import { filesApi } from './filesApi.js';

let pdfLibrary;
async function pdfModule() {
  pdfLibrary ||= Promise.all([
    import('pdfjs-dist/build/pdf.mjs'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  ]).then(([pdf, worker]) => {
    pdf.GlobalWorkerOptions.workerSrc = worker.default;
    return pdf;
  });
  return pdfLibrary;
}

async function pdfThumbnail(url, signal) {
  const pdf = await pdfModule();
  signal.throwIfAborted();
  const task = pdf.getDocument({ url, withCredentials: true, disableAutoFetch: true, disableStream: true,
    isEvalSupported: false, disableFontFace: true, useSystemFonts: true, maxImageSize: 8_000_000 });
  const abort = () => { task.destroy().catch(() => {}); };
  task.onPassword = abort;
  signal.addEventListener('abort', abort, { once: true });
  try {
    const document = await task.promise;
    signal.throwIfAborted();
    const page = await document.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(240 / base.width, 300 / base.height) });
    const canvas = window.document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(viewport.width));
    canvas.height = Math.max(1, Math.ceil(viewport.height));
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    signal.throwIfAborted();
    return canvas.toDataURL('image/png');
  } finally {
    signal.removeEventListener('abort', abort);
    await task.destroy();
  }
}

async function readText(url, signal, maxBytes) {
  const response = await fetch(url, { signal });
  if (!response.ok || response.status === 202) throw new Error('Preview unavailable');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  try {
    while (bytes < maxBytes) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = value.subarray(0, maxBytes - bytes);
      bytes += chunk.length;
      text += decoder.decode(chunk, { stream: true });
    }
    return text + decoder.decode();
  } finally { await reader.cancel().catch(() => {}); }
}

function textThumbnail(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 180; canvas.height = 240;
  const context = canvas.getContext('2d');
  context.fillStyle = '#fff'; context.fillRect(0, 0, 180, 240);
  context.fillStyle = '#303036'; context.font = '9px sans-serif';
  let y = 18;
  for (const line of text.slice(0, 4000).replaceAll('\t', '  ').split(/\r?\n/)) {
    let wrapped = '';
    for (const character of line) {
      if (context.measureText(wrapped + character).width > 156) {
        context.fillText(wrapped, 12, y); y += 12; wrapped = '';
      }
      if (y > 230) break;
      wrapped += character;
    }
    if (y > 230) break;
    context.fillText(wrapped, 12, y); y += 12;
  }
  return canvas.toDataURL('image/png');
}

function spreadsheetThumbnail(data) {
  const sheet = data.sheets?.[0];
  if (!sheet) throw new Error('No sheet');
  const canvas = document.createElement('canvas');
  canvas.width = 240; canvas.height = 180;
  const context = canvas.getContext('2d');
  context.fillStyle = '#fff'; context.fillRect(0, 0, 240, 180);
  context.fillStyle = '#e8f3ec'; context.fillRect(0, 0, 240, 20);
  context.fillStyle = '#245439'; context.font = 'bold 10px sans-serif';
  context.fillText(String(sheet.name || 'Sheet 1').slice(0, 30), 6, 14);
  context.font = '9px sans-serif';
  for (let row = 0; row < 8; row++) for (let column = 0; column < 4; column++) {
    const x = column * 60; const y = 20 + row * 20;
    context.strokeStyle = '#d9dde1'; context.strokeRect(x, y, 60, 20);
    context.save(); context.beginPath(); context.rect(x + 3, y + 1, 54, 18); context.clip();
    context.fillStyle = '#303036';
    context.fillText(String(sheet.rows?.[row]?.[column] ?? '').slice(0, 80), x + 4, y + 13);
    context.restore();
  }
  return canvas.toDataURL('image/png');
}

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}

export async function renderDocumentThumbnail(file, signal) {
  const url = filesApi.previewUrl(file.id);
  if (isPdfFile(file)) return pdfThumbnail(url, signal);
  if (isSpreadsheetFile(file)) return spreadsheetThumbnail(JSON.parse(await readText(url, signal, 2_000_000)));
  if (isDocumentFile(file)) {
    for (let attempt = 0; attempt < 20; attempt++) {
      const response = await fetch(`/api/files/${encodeURIComponent(file.id)}/preview-status`, { signal });
      if (!response.ok) throw new Error('Document preview unavailable');
      const { preview } = await response.json();
      if (preview?.status === 'ready') return pdfThumbnail(url, signal);
      if (preview?.status === 'fallback') return textThumbnail(await readText(url, signal, 256_000));
      await delay(Math.max(1200, Math.min(3000, preview?.retryAfterMs || 1200)), signal);
    }
    throw new Error('Document preview not ready');
  }
  return textThumbnail(await readText(url, signal, 256_000));
}
