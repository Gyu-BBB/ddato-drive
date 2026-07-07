import path from "node:path";

const MIME_BY_EXTENSION = new Map([
  [".pdf", "application/pdf"],
  [".txt", "text/plain; charset=utf-8"],
  [".text", "text/plain; charset=utf-8"],
  [".md", "text/markdown; charset=utf-8"],
  [".markdown", "text/markdown; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".jsonl", "application/jsonl; charset=utf-8"],
  [".ndjson", "application/x-ndjson; charset=utf-8"],
  [".ipynb", "application/json; charset=utf-8"],
  [".xml", "application/xml; charset=utf-8"],
  [".yaml", "application/yaml; charset=utf-8"],
  [".yml", "application/yaml; charset=utf-8"],
  [".toml", "application/toml; charset=utf-8"],
  [".csv", "text/csv; charset=utf-8"],
  [".tsv", "text/tab-separated-values; charset=utf-8"],
  [".log", "text/plain; charset=utf-8"],
  [".rtf", "application/rtf"],
  [".js", "application/javascript; charset=utf-8"],
  [".mjs", "application/javascript; charset=utf-8"],
  [".cjs", "application/javascript; charset=utf-8"],
  [".jsx", "text/jsx; charset=utf-8"],
  [".ts", "application/typescript; charset=utf-8"],
  [".tsx", "text/tsx; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".scss", "text/x-scss; charset=utf-8"],
  [".sass", "text/x-sass; charset=utf-8"],
  [".less", "text/less; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".htm", "text/html; charset=utf-8"],
  [".xhtml", "application/xhtml+xml; charset=utf-8"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".apng", "image/apng"],
  [".avif", "image/avif"],
  [".bmp", "image/bmp"],
  [".heic", "image/heic"],
  [".heif", "image/heif"],
  [".ico", "image/x-icon"],
  [".svg", "image/svg+xml"],
  [".mp4", "video/mp4"],
  [".m4v", "video/mp4"],
  [".mov", "video/quicktime"],
  [".webm", "video/webm"],
  [".ogv", "video/ogg"],
  [".mpeg", "video/mpeg"],
  [".mpg", "video/mpeg"],
  [".mkv", "video/x-matroska"],
  [".avi", "video/x-msvideo"],
  [".3gp", "video/3gpp"],
  [".3g2", "video/3gpp2"],
  [".mp3", "audio/mpeg"],
  [".wav", "audio/wav"],
  [".m4a", "audio/mp4"],
  [".aac", "audio/aac"],
  [".flac", "audio/flac"],
  [".ogg", "audio/ogg"],
  [".oga", "audio/ogg"],
  [".opus", "audio/opus"],
  [".weba", "audio/webm"],
  [".aif", "audio/aiff"],
  [".aiff", "audio/aiff"]
]);

export class MimeTypePolicy {
  normalize(mimeType, fileName) {
    const raw = String(mimeType || "").toLowerCase().trim();
    if (raw && raw !== "application/octet-stream") return raw;
    return MIME_BY_EXTENSION.get(path.extname(fileName || "").toLowerCase()) || "application/octet-stream";
  }
}

export const mimeTypePolicy = new MimeTypePolicy();
