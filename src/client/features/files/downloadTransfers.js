import { formatApiErrorMessage } from '../../shared/api/apiClient.js';
import { createSpeedMeter } from '../../shared/lib/transferProgress.js';

let transfers = [];
const listeners = new Set();
const controllers = new Map();
export const subscribeDownloads = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };
export const getDownloads = () => transfers;
function update(id, patch) {
  transfers = transfers.map(item => item.id === id ? { ...item, ...patch } : item);
  listeners.forEach(listener => listener());
}
export function clearDownloads() {
  transfers = transfers.filter(item => item.status === 'uploading');
  listeners.forEach(listener => listener());
}
export function cancelDownload(id) { controllers.get(id)?.abort(); }

export async function startDownload(url, name, { method = 'GET', body } = {}) {
  const id = crypto.randomUUID();
  const controller = new AbortController();
  controllers.set(id, controller);
  transfers = [...transfers, { id, name, status: 'uploading', uploadedBytes: 0, sizeBytes: null, speedBytes: 0, progress: 0 }];
  listeners.forEach(listener => listener());
  const meter = createSpeedMeter();
  let writer;
  let reader;
  let speedTimer;
  try {
    // Supported browsers can stream large downloads directly to disk.
    if (typeof window.showSaveFilePicker === 'function') {
      try {
        const handle = await window.showSaveFilePicker({ suggestedName: name });
        writer = await handle.createWritable();
      } catch (error) {
        if (error.name !== 'SecurityError') throw error;
      }
    }
    const response = await fetch(url, { method, body: body ? JSON.stringify(body) : undefined,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      credentials: 'include', signal: controller.signal });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(formatApiErrorMessage(error.error || '다운로드하지 못했습니다.', error.details));
    }
    const length = response.headers.get('Content-Length');
    const total = length == null ? null : Number(length);
    update(id, { sizeBytes: total });
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
      const now = performance.now();
      if (now - lastProgressAt >= 200) { reportProgress(); lastProgressAt = now; }
      if (writer && (pendingBytes >= 1024 * 1024 || now - lastWriteAt >= 100)) await flush();
    }
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
  }
}
