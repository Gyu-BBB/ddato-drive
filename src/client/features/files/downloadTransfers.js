import { formatApiErrorMessage } from '../../shared/api/apiClient.js';
import { createSpeedMeter } from '../../shared/lib/transferProgress.js';
import { downloadPickerOptions } from './downloadFilename.js';
import { createTransferSlots } from '../../shared/lib/transferSlots.js';

let transfers = [];
const listeners = new Set();
const controllers = new Map();
const MAX_BUFFERED_BYTES = 128 * 1024 * 1024;
const acquireDownloadSlot = createTransferSlots(10);
export const subscribeDownloads = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };
export const getDownloads = () => transfers;
function update(id, patch) {
  transfers = transfers.map(item => item.id === id ? { ...item, ...patch } : item);
  listeners.forEach(listener => listener());
}
export function clearDownloads() {
  transfers = transfers.filter(item => item.status === 'uploading' || item.status === 'queued');
  listeners.forEach(listener => listener());
}
export function cancelDownload(id) { controllers.get(id)?.abort(); }

export async function startDownload(url, name, { method = 'GET', body } = {}) {
  // This local progress ID must also work on LAN HTTP, where randomUUID is unavailable.
  const id = typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `download-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const controller = new AbortController();
  controllers.set(id, controller);
  transfers = [...transfers, { id, name, status: 'queued', uploadedBytes: 0, sizeBytes: null, speedBytes: 0, progress: 0 }];
  listeners.forEach(listener => listener());
  const meter = createSpeedMeter();
  let writer;
  let reader;
  let speedTimer;
  let releaseSlot;
  try {
    // Supported browsers can stream large downloads directly to disk.
    if (typeof window.showSaveFilePicker === 'function') {
      try {
        const handle = await window.showSaveFilePicker(downloadPickerOptions(name));
        controller.signal.throwIfAborted();
        writer = await handle.createWritable();
      } catch (error) {
        if (error.name !== 'SecurityError') throw error;
      }
    }
    releaseSlot = await acquireDownloadSlot(controller.signal);
    update(id, { status: 'uploading' });
    const response = await fetch(url, { method, body: body ? JSON.stringify(body) : undefined,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      credentials: 'include', signal: controller.signal });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(formatApiErrorMessage(error.error || '다운로드하지 못했습니다.', error.details));
    }
    const length = response.headers.get('Content-Length');
    const parsedLength = length == null ? null : Number(length);
    const encoding = response.headers.get('Content-Encoding');
    const total = (!encoding || encoding === 'identity') && parsedLength != null && Number.isSafeInteger(parsedLength) && parsedLength >= 0 ? parsedLength : null;
    update(id, { sizeBytes: total });
    const handOff = async () => {
      controller.abort();
      await reader?.cancel().catch(() => {});
      if (!reader) await response.body?.cancel().catch(() => {});
      browserDownload(url, name, method, body, id);
      update(id, { status: 'browser', uploadedBytes: 0, speedBytes: 0, progress: 0 });
    };
    if (!writer && total > MAX_BUFFERED_BYTES) { await handOff(); return; }
    reader = response.body.getReader();
    const chunks = [];
    let loaded = 0;
    let lastProgressAt = 0;
    let pending = [];
    let pendingBytes = 0;
    let lastWriteAt = performance.now();
    const reportProgress = () => update(id, { uploadedBytes: loaded, speedBytes: meter(loaded), progress: total ? Math.min(99, loaded / total * 100) : 0 });
    const flush = async () => {
      if (!pendingBytes) return;
      const batch = new Uint8Array(pendingBytes);
      let offset = 0;
      for (const chunk of pending) { batch.set(chunk, offset); offset += chunk.byteLength; }
      pending = [];
      pendingBytes = 0;
      await writer.write(batch);
      lastWriteAt = performance.now();
    };
    speedTimer = setInterval(reportProgress, 500);
    while (true) {
      const { done, value } = await reader.read();
      controller.signal.throwIfAborted();
      if (done) break;
      if (writer) {
        pending.push(value);
        pendingBytes += value.byteLength;
      }
      else chunks.push(value);
      loaded += value.byteLength;
      if (!writer && loaded > MAX_BUFFERED_BYTES) { await handOff(); return; }
      const now = performance.now();
      if (now - lastProgressAt >= 200) { reportProgress(); lastProgressAt = now; }
      if (writer && (pendingBytes >= 1024 * 1024 || now - lastWriteAt >= 100)) await flush();
    }
    if (total != null && loaded !== total) throw new Error('파일을 끝까지 받지 못했습니다. 다시 다운로드해 주세요.');
    reportProgress();
    if (writer) { await flush(); controller.signal.throwIfAborted(); await writer.close(); }
    else {
      const blobUrl = URL.createObjectURL(new Blob(chunks, { type: response.headers.get('Content-Type') || 'application/octet-stream' }));
      const anchor = document.createElement('a');
      anchor.href = blobUrl;
      anchor.download = name;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
    }
    update(id, { status: 'done', uploadedBytes: loaded, sizeBytes: loaded, progress: 100, speedBytes: 0 });
  } catch (error) {
    controller.abort();
    await reader?.cancel().catch(() => {});
    await writer?.abort().catch(() => {});
    update(id, { status: 'failed', speedBytes: 0, error: error.name === 'AbortError' ? '다운로드가 취소되었습니다.' : error.message });
  } finally {
    clearInterval(speedTimer);
    reader?.releaseLock();
    controllers.delete(id);
    releaseSlot?.();
  }
}

function browserDownload(url, name, method, body, id) {
  if (method === 'GET') {
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = name;
    document.body.append(anchor); anchor.click(); anchor.remove();
    return;
  }
  if (method !== 'POST' || !Array.isArray(body?.ids)) throw new Error('이 브라우저에서 대용량 다운로드를 시작하지 못했습니다.');
  const frame = document.createElement('iframe');
  frame.name = id; frame.hidden = true; frame.title = '브라우저 다운로드';
  const form = document.createElement('form');
  form.method = 'POST'; form.action = url; form.target = id; form.hidden = true;
  for (const value of body.ids) {
    const input = document.createElement('input');
    input.type = 'hidden'; input.name = 'ids'; input.value = value; form.append(input);
  }
  frame.onload = () => {
    // Attachment downloads do not load a document; JSON error responses do.
    try {
      const error = JSON.parse(frame.contentDocument.body.textContent);
      if (error.ok === false) update(id, { status: 'failed', error: formatApiErrorMessage(error.error, error.details) });
    } catch {}
  };
  document.body.append(frame, form); form.submit(); form.remove();
}
