const EXTENSIONS = ['.zip', '.tar', '.tar.gz', '.tgz', '.tar.bz2', '.tbz', '.tbz2', '.tar.xz', '.txz', '.tar.zst', '.tzst', '.tar.lz4', '.tar.lz', '.tar.lzma', '.7z', '.rar', '.cpio', '.ar', '.a', '.deb', '.cab', '.iso', '.gz', '.bz2', '.xz', '.zst', '.lz4', '.lz', '.lzma'];
const MIME_TYPES = new Set(['application/zip', 'application/x-zip-compressed', 'application/x-tar', 'application/x-gtar', 'application/gzip', 'application/x-gzip', 'application/x-bzip2', 'application/x-xz', 'application/zstd', 'application/x-7z-compressed', 'application/vnd.rar', 'application/x-rar-compressed', 'application/x-cpio', 'application/x-archive', 'application/vnd.ms-cab-compressed', 'application/x-iso9660-image']);
const DOCUMENT_EXTENSIONS = /\.(docx|docm|dotx|dotm|xlsx|xlsm|xltx|xltm|pptx|pptm|ppsx|ppsm|potx|potm|odt|ott|ods|ots|odp|otp|hwpx|epub)$/i;

export function isArchiveName(name = '', mime = '') {
  const normalized = String(name).toLowerCase();
  if (DOCUMENT_EXTENSIONS.test(normalized)) return false;
  return EXTENSIONS.some(extension => normalized.endsWith(extension)) || MIME_TYPES.has(String(mime).split(';')[0].trim().toLowerCase());
}
