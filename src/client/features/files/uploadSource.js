export const MAX_PERSISTED_FILE_BYTES = 128 * 1024 * 1024;

export async function chooseUploadPersistence(file) {
  if (file.size > MAX_PERSISTED_FILE_BYTES) return 'reselect';
  try {
    const estimate = await navigator.storage?.estimate?.();
    if (estimate?.quota && file.size > Math.max(0, estimate.quota - (estimate.usage || 0)) / 2) return 'reselect';
  } catch { /* Storage estimates are optional. */ }
  return 'copy';
}

export async function sourceFingerprint(file) {
  if (!globalThis.crypto?.subtle) return '';
  const edge = 1024 * 1024;
  const bytes = await new Blob([file.slice(0, edge), file.slice(Math.max(edge, file.size - edge))]).arrayBuffer();
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function verifyUploadSource(item, file) {
  if (file.name !== item.fileName || file.size !== item.sizeBytes || file.lastModified !== item.lastModified) {
    throw new Error('처음 선택한 원본 파일과 이름·크기·수정일이 다릅니다. 원본을 선택해 주세요.');
  }
  if (item.sourceFingerprint && await sourceFingerprint(file) !== item.sourceFingerprint) {
    throw new Error('원본 파일의 내용이 변경되었습니다. 새 업로드로 등록해 주세요.');
  }
}

export function selectUploadSource() {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file'; input.hidden = true;
    const finish = file => { input.remove(); resolve(file || null); };
    input.addEventListener('change', () => finish(input.files[0]), { once: true });
    input.addEventListener('cancel', () => finish(null), { once: true });
    document.body.append(input); input.click();
  });
}
