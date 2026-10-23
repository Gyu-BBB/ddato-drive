export function formatPercent(value) {
  const percent = Number(value);
  return `${(Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0).toFixed(2)}%`;
}
