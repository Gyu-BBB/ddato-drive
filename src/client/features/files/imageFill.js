export function fillImageRegion(image, operation, { signal } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('채우기가 취소되었습니다.', 'AbortError')); return; }
    let worker;
    let timer;
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (worker) worker.onmessage = worker.onerror = worker.onmessageerror = null;
      worker?.terminate();
      if (error) reject(error); else resolve(result);
    };
    const abort = () => finish(new DOMException('채우기가 취소되었습니다.', 'AbortError'));
    signal?.addEventListener('abort', abort, { once: true });
    try {
      worker = new Worker(new URL('./imageFill.worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = ({ data }) => {
        if (data.type !== 'result') finish(new Error(data.message || '영역을 채우지 못했습니다.'));
        else finish(null, data.patch ? { type: 'fill', patch: data.patch, x: data.x, y: data.y } : null);
      };
      worker.onerror = event => { event.preventDefault(); finish(new Error('채우기를 실행하지 못했습니다. 다시 시도해 주세요.')); };
      worker.onmessageerror = () => finish(new Error('채우기 결과를 읽지 못했습니다.'));
      timer = setTimeout(() => finish(new Error('채우기가 너무 오래 걸려 중단했습니다.')), 30000);
      worker.postMessage({ pixels: image.data.buffer, width: image.width, height: image.height, operation }, [image.data.buffer]);
    } catch (error) { finish(error); }
  });
}

export function pixelHex(pixel) {
  return `#${[...pixel].slice(0, 3).map(channel => channel.toString(16).padStart(2, '0')).join('')}`;
}

export function colorWithOpacity(hex, opacity) {
  if (opacity === 100) return hex;
  const channels = [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16));
  return `rgba(${channels.join(',')},${opacity / 100})`;
}
