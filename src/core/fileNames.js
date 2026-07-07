const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const MAX_FILE_NAME_LENGTH = 180;

export function normalizeCrossPlatformFileName(value, fallback = "untitled", options = {}) {
  const maxLength = Math.max(1, Number(options.maxLength || MAX_FILE_NAME_LENGTH));
  let cleaned = cleanFileName(value);
  if (!cleaned) cleaned = cleanFileName(fallback) || "untitled";

  cleaned = protectWindowsReservedName(cleaned);
  cleaned = truncateFileName(cleaned, maxLength);
  cleaned = protectWindowsReservedName(cleaned).replace(/[. ]+$/g, "");

  return cleaned || "untitled";
}

export function repairLatin1Utf8Name(value) {
  const name = String(value || "");
  if (!/[\u00a0-\u00ff]/.test(name)) return name;

  const repaired = Buffer.from(name, "latin1").toString("utf8");
  if (!repaired || repaired.includes("\uFFFD") || repaired === name) return name;
  return repaired;
}

function cleanFileName(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[\/\\?%*:|"<>]/g, "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");
}

function protectWindowsReservedName(name) {
  const extensionIndex = name.lastIndexOf(".");
  const hasExtension = extensionIndex > 0 && extensionIndex < name.length - 1;
  const base = hasExtension ? name.slice(0, extensionIndex).replace(/[. ]+$/g, "") : name;
  const extension = hasExtension ? name.slice(extensionIndex) : "";

  if (!WINDOWS_RESERVED_NAMES.test(base)) return `${base}${extension}`;
  return `${base}_${extension}`;
}

function truncateFileName(name, maxLength) {
  if (Array.from(name).length <= maxLength) return name;

  const extensionIndex = name.lastIndexOf(".");
  const hasExtension = extensionIndex > 0 && extensionIndex < name.length - 1;
  if (!hasExtension) return Array.from(name).slice(0, maxLength).join("").replace(/[. ]+$/g, "");

  const base = name.slice(0, extensionIndex);
  const extension = name.slice(extensionIndex);
  const extensionLength = Array.from(extension).length;
  if (extensionLength >= maxLength - 1) {
    return Array.from(name).slice(0, maxLength).join("").replace(/[. ]+$/g, "");
  }

  const baseLength = maxLength - extensionLength;
  const truncatedBase = Array.from(base).slice(0, baseLength).join("").replace(/[. ]+$/g, "");
  return `${truncatedBase || "file"}${extension}`;
}
