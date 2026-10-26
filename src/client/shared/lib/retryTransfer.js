export async function retryTransfer(operation, { signal, retries = 3, delayMs = 500, onRetry } = {}) {
  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted();
    try { return await operation(attempt); }
    catch (error) {
      const status = error.status || error.statusCode || 0;
      const retryable = error.name === 'TimeoutError' || (!status && error.name !== 'AbortError')
        || [408, 425, 429, 500, 502, 503, 504].includes(status);
      if (signal?.aborted || !retryable || attempt >= retries) throw error;
      onRetry?.(attempt + 1);
      await new Promise((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(new DOMException('전송이 취소되었습니다.', 'AbortError')); };
        const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, delayMs * 2 ** attempt);
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
      });
    }
  }
}
