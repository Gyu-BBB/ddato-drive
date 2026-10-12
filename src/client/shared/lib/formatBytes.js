export function formatBytes(bytes = 0) {
  const size = Number(bytes || 0);
  if (size >= 1024 ** 4) return `${(size / 1024 ** 4).toFixed(size >= 10 * 1024 ** 4 ? 0 : 1)}TB`;
  if (size >= 1024 ** 3) return `${(size / 1024 ** 3).toFixed(size >= 10 * 1024 ** 3 ? 0 : 1)}GB`;
  if (size >= 1024 ** 2) return `${(size / 1024 ** 2).toFixed(size >= 10 * 1024 ** 2 ? 0 : 1)}MB`;
  if (size >= 1024) return `${Math.ceil(size / 1024)}KB`;
  return `${size}B`;
}

export function quotaPercent(usedBytes = 0, quotaBytes = null) {
  if (quotaBytes == null || quotaBytes <= 0) return 0;
  return Math.min(100, Math.round((usedBytes / quotaBytes) * 1000) / 10);
}
