export function currentTransferSpeed(item, now = Date.now()) {
  if (item.status !== 'uploading' || (item.speedUpdatedAt && now - item.speedUpdatedAt > 1500)) return 0;
  const speed = Number(item.speedBytes);
  return Number.isFinite(speed) && speed > 0 ? speed : 0;
}

export function estimateRemainingSeconds(size, loaded, speed) {
  if (size == null || !Number.isFinite(Number(size)) || Number(size) < 0) return null;
  const bytes = Number(loaded);
  const remaining = Math.max(0, Number(size) - (Number.isFinite(bytes) ? Math.max(0, bytes) : 0));
  if (!remaining) return 0;
  return Number.isFinite(speed) && speed > 0 ? remaining / speed : null;
}

export function formatRemainingTime(seconds) {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '남은 시간 계산 중';
  if (seconds === 0) return '마무리 중';
  const value = Math.ceil(seconds);
  const days = Math.floor(value / 86400);
  const hours = Math.floor(value / 3600) % 24;
  const minutes = Math.floor(value / 60) % 60;
  const rest = value % 60;
  const duration = days ? `${days}일${hours ? ` ${hours}시간` : ''}`
    : hours ? `${hours}시간${minutes ? ` ${minutes}분` : ''}`
    : minutes ? `${minutes}분${rest ? ` ${rest}초` : ''}` : `${rest}초`;
  return `약 ${duration} 남음`;
}

export function remainingTransfersLabel(items, now = Date.now()) {
  const active = items.filter(item => item.status === 'uploading' || item.status === 'queued');
  let remaining = 0;
  let speed = 0;
  for (const item of active) {
    const bytes = estimateRemainingSeconds(item.sizeBytes, item.uploadedBytes, 1);
    if (bytes == null) return formatRemainingTime(null);
    remaining += bytes;
    speed += currentTransferSpeed(item, now);
  }
  return formatRemainingTime(estimateRemainingSeconds(remaining, 0, speed));
}
