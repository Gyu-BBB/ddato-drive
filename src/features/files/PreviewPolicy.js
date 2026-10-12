import path from "node:path";
import { isArchiveName } from '../../shared/archiveFormats.js';

const TEXT_EXTENSIONS = new Set([
  ".txt",
  ".text",
  ".md",
  ".markdown",
  ".mdown",
  ".adoc",
  ".asciidoc",
  ".org",
  ".rst",
  ".json",
  ".jsonl",
  ".ndjson",
  ".ipynb",
  ".js",
  ".mjs",
  ".cjs",
  ".jsx",
  ".ts",
  ".tsx",
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".html",
  ".htm",
  ".xhtml",
  ".csv",
  ".tsv",
  ".log",
  ".xml",
  ".plist",
  ".yaml",
  ".yml",
  ".toml",
  ".ini",
  ".cfg",
  ".conf",
  ".env",
  ".properties",
  ".sql",
  ".graphql",
  ".gql",
  ".sh",
  ".bash",
  ".zsh",
  ".fish",
  ".bat",
  ".cmd",
  ".ps1",
  ".py",
  ".pyw",
  ".rb",
  ".php",
  ".java",
  ".kt",
  ".kts",
  ".swift",
  ".go",
  ".rs",
  ".c",
  ".h",
  ".cpp",
  ".cc",
  ".cxx",
  ".hpp",
  ".cs",
  ".scala",
  ".dart",
  ".lua",
  ".r",
  ".pl",
  ".pm",
  ".vue",
  ".svelte",
  ".astro",
  ".rtf",
  ".tex",
  ".diff",
  ".patch",
  ".srt",
  ".vtt",
  ".ics",
  ".vcf"
]);
const TEXT_FILE_NAMES = new Set([
  ".babelrc",
  ".dockerignore",
  ".editorconfig",
  ".env",
  ".env.local",
  ".env.example",
  ".eslintrc",
  ".gitattributes",
  ".gitignore",
  ".npmrc",
  ".prettierrc",
  "dockerfile",
  "makefile",
  "readme",
  "license"
]);
const PDF_EXTENSIONS = new Set([".pdf"]);
const DOCUMENT_TEXT_EXTENSIONS = new Set([
  ".doc",
  ".docx",
  ".docm",
  ".dot",
  ".dotx",
  ".dotm",
  ".xls",
  ".xlsx",
  ".xlsm",
  ".xlt",
  ".xltx",
  ".xltm",
  ".ppt",
  ".pptx",
  ".pptm",
  ".pps",
  ".ppsx",
  ".ppsm",
  ".pot",
  ".potx",
  ".potm",
  ".odt",
  ".ott",
  ".ods",
  ".ots",
  ".odp",
  ".otp",
  ".fodt",
  ".fods",
  ".fodp",
  ".hwpx",
  ".epub",
  ".rtf"
]);
const SPREADSHEET_PREVIEW_EXTENSIONS = new Set([
  ".xlsx",
  ".xlsm",
  ".xltx",
  ".xltm",
  ".ods",
  ".ots",
  ".fods"
]);
const IMAGE_CONTENT_TYPES = new Map([
  [".apng", "image/apng"],
  [".avif", "image/avif"],
  [".bmp", "image/bmp"],
  [".gif", "image/gif"],
  [".heic", "image/heic"],
  [".heif", "image/heif"],
  [".ico", "image/x-icon"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"]
]);
const VIDEO_CONTENT_TYPES = new Map([
  [".3g2", "video/3gpp2"],
  [".3gp", "video/3gpp"],
  [".avi", "video/x-msvideo"],
  [".m4v", "video/mp4"],
  [".mkv", "video/x-matroska"],
  [".mov", "video/quicktime"],
  [".mp4", "video/mp4"],
  [".mpeg", "video/mpeg"],
  [".mpg", "video/mpeg"],
  [".ogv", "video/ogg"],
  [".webm", "video/webm"]
]);
const AUDIO_CONTENT_TYPES = new Map([
  [".aac", "audio/aac"],
  [".aif", "audio/aiff"],
  [".aiff", "audio/aiff"],
  [".flac", "audio/flac"],
  [".m4a", "audio/mp4"],
  [".mp3", "audio/mpeg"],
  [".oga", "audio/ogg"],
  [".ogg", "audio/ogg"],
  [".opus", "audio/opus"],
  [".wav", "audio/wav"],
  [".weba", "audio/webm"]
]);

export class PreviewPolicy {
  getPreviewMode(file) {
    if (file.type !== "file") return null;
    const mime = String(file.mime_type || "").toLowerCase();
    const name = String(file.original_name || "").toLowerCase();
    const extension = path.extname(name).toLowerCase();

    if (mime.split(";")[0] === "image/svg+xml" || extension === ".svg") return { supported: false };
    if (mime.startsWith("image/") || IMAGE_CONTENT_TYPES.has(extension)) {
      return { supported: true, contentType: previewContentType(mime, extension, IMAGE_CONTENT_TYPES), disposition: "inline" };
    }
    if (mime === "application/pdf" || PDF_EXTENSIONS.has(extension)) return { supported: true, contentType: "application/pdf", disposition: "inline" };
    if (mime.startsWith("video/") || VIDEO_CONTENT_TYPES.has(extension)) {
      return { supported: true, contentType: previewContentType(mime, extension, VIDEO_CONTENT_TYPES), disposition: "inline" };
    }
    if (mime.startsWith("audio/") || AUDIO_CONTENT_TYPES.has(extension)) {
      return { supported: true, contentType: previewContentType(mime, extension, AUDIO_CONTENT_TYPES), disposition: "inline" };
    }
    if (isSpreadsheetPreviewMime(mime) || SPREADSHEET_PREVIEW_EXTENSIONS.has(extension)) {
      return { supported: true, mode: "spreadsheet", contentType: "application/json; charset=utf-8", disposition: "inline" };
    }
    if (isArchiveName(name, mime)) {
      return { supported: true, mode: 'archive', contentType: 'application/json; charset=utf-8', disposition: 'inline' };
    }
    if (isDocumentTextMime(mime) || DOCUMENT_TEXT_EXTENSIONS.has(extension)) {
      return { supported: true, mode: "document", contentType: "text/plain; charset=utf-8", disposition: "inline" };
    }
    if (isTextMime(mime) || TEXT_EXTENSIONS.has(extension) || TEXT_FILE_NAMES.has(name)) {
      return { supported: true, mode: "text", contentType: "text/plain; charset=utf-8", disposition: "inline" };
    }
    return { supported: false };
  }
}

function previewContentType(mime, extension, extensionMap) {
  if (mime && mime !== "application/octet-stream") return mime;
  return extensionMap.get(extension) || "application/octet-stream";
}

function isTextMime(mime) {
  const normalized = mime.split(";")[0].trim();
  return normalized.startsWith("text/") || [
    "application/json",
    "application/ld+json",
    "application/xml",
    "application/xhtml+xml",
    "application/javascript",
    "application/x-javascript",
    "application/typescript",
    "application/x-sh",
    "application/sql",
    "application/rtf"
  ].includes(normalized);
}

function isDocumentTextMime(mime) {
  const normalized = mime.split(";")[0].trim();
  return [
    "application/epub+zip",
    "application/rtf",
    "application/vnd.hancom.hwpx",
    "application/vnd.oasis.opendocument.presentation",
    "application/vnd.oasis.opendocument.spreadsheet",
    "application/vnd.oasis.opendocument.text",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.openxmlformats-officedocument.presentationml.slideshow",
    "application/vnd.openxmlformats-officedocument.presentationml.template",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.template",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.template"
  ].includes(normalized);
}

function isSpreadsheetPreviewMime(mime) {
  const normalized = mime.split(";")[0].trim();
  return [
    "application/vnd.oasis.opendocument.spreadsheet",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.template"
  ].includes(normalized);
}

export const previewPolicy = new PreviewPolicy();
