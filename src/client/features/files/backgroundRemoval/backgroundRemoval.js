export function removeImageBackground(blob, { signal, onProgress, createWorker = () => new Worker(new URL('./backgroundRemoval.worker.js', import.meta.url), { type: 'module' }) } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('배경 제거가 취소되었습니다.', 'AbortError')); return; }
    let worker;
    let timeout;
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      if (worker) worker.onmessage = worker.onerror = worker.onmessageerror = null;
      worker?.terminate();
      if (error) reject(error);
      else resolve(result);
    };
    const abort = () => finish(new DOMException('배경 제거가 취소되었습니다.', 'AbortError'));
    signal?.addEventListener('abort', abort, { once: true });
    try {
      worker = createWorker();
      worker.onmessage = ({ data }) => {
        if (settled) return;
        if (data.type === 'progress') onProgress?.(data.stage);
        else if (data.type === 'result' && data.blob instanceof Blob) finish(null, data.blob);
        else finish(new Error(data.message || '배경 제거 결과를 읽지 못했습니다.'));
      };
      worker.onerror = event => {
        event.preventDefault?.();
        finish(new Error('배경 제거를 실행하지 못했습니다. 최신 브라우저에서 다시 시도해 주세요.'));
      };
      worker.onmessageerror = () => finish(new Error('배경 제거 결과를 읽지 못했습니다.'));
      timeout = setTimeout(() => finish(new Error('배경 제거가 너무 오래 걸려 중단했습니다. 다시 시도해 주세요.')), 180000);
      worker.postMessage({ blob });
    } catch (error) { finish(error); }
  });
}
