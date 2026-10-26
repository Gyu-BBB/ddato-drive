import { createTransferSlots } from '../../shared/lib/transferSlots.js';

export const MAX_HEIC_PREVIEW_BYTES = 32 * 1024 * 1024;
const acquire = createTransferSlots(1);
const acquireFetch = createTransferSlots(2);
export const isHeicName = name => /\.(heic|heif)$/i.test(name || '');

export async function convertHeicPreview(blob, signal = new AbortController().signal) {
  if (blob.size > MAX_HEIC_PREVIEW_BYTES) throw new Error('HEIC 미리보기는 32MB 이하에서 지원합니다. 원본은 다운로드할 수 있습니다.');
  const release = await acquire(signal);
  try {
    if (signal.aborted) throw new DOMException('Canceled', 'AbortError');
    const [{ heicTo }, exifr] = await Promise.all([import('heic-to/csp'), import('exifr')]);
    const tags = await exifr.parse(blob, { pick: ['ImageWidth', 'ImageHeight', 'ExifImageWidth', 'ExifImageHeight'] }).catch(() => null);
    const width = tags?.ImageWidth || tags?.ExifImageWidth;
    const height = tags?.ImageHeight || tags?.ExifImageHeight;
    if (width && height && width * height > 40_000_000) throw new Error('이 사진은 미리보기 해상도 한도를 초과합니다. 원본을 다운로드해 주세요.');
    return await heicTo({ blob, type: 'image/jpeg', quality: 0.9 });
  } finally { release(); }
}

export async function fetchHeicPreview(src, signal) {
  const release = await acquireFetch(signal);
  try { return await loadHeicPreview(src, signal); }
  finally { release(); }
}

async function loadHeicPreview(src, signal) {
  const response = await fetch(src, { signal, credentials: 'same-origin' });
  if (!response.ok) throw new Error(response.status === 423 ? '암호가 필요한 사진입니다.' : '사진을 불러오지 못했습니다.');
  const reader = response.body.getReader(); const chunks = []; let size = 0;
  try {
    if (Number(response.headers.get('Content-Length')) > MAX_HEIC_PREVIEW_BYTES) throw new Error('HEIC 미리보기는 32MB 이하에서 지원합니다. 원본을 다운로드해 주세요.');
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > MAX_HEIC_PREVIEW_BYTES) throw new Error('HEIC 미리보기 크기 한도를 초과했습니다.');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  return convertHeicPreview(new Blob(chunks, { type: 'image/heic' }), signal);
}
