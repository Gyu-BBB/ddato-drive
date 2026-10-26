export function parseByteRange(header, total) {
  if (!header || !header.startsWith('bytes=')) return null;
  // Multipart ranges are unsupported; ignore them and send the full representation.
  if (header.includes(',')) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2]) || !total) return { invalid: true };
  const start = match[1] ? Number(match[1]) : Math.max(0, total - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(Number(match[2]), total - 1) : total - 1;
  if ((match[1] && !Number.isSafeInteger(Number(match[1]))) || (match[2] && !Number.isSafeInteger(Number(match[2])))
    || start >= total || start > end || (!match[1] && Number(match[2]) === 0)) return { invalid: true };
  return { start, end };
}
