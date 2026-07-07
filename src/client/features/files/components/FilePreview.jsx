import { File, FileAudio, FileText, FileVideo, Image } from "lucide-react";
import { useEffect, useState } from "react";
import { FolderGlyph } from "./FolderGlyph.jsx";

const TEXT_EXTENSIONS = new Set([
  ".txt", ".text", ".md", ".markdown", ".mdown",
  ".adoc", ".asciidoc", ".org", ".rst",
  ".json", ".jsonl", ".ndjson", ".ipynb",
  ".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx",
  ".css", ".scss", ".sass", ".less",
  ".html", ".htm", ".xhtml", ".csv", ".tsv", ".log",
  ".xml", ".plist", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf", ".env", ".properties",
  ".sql", ".graphql", ".gql",
  ".sh", ".bash", ".zsh", ".fish", ".bat", ".cmd", ".ps1",
  ".py", ".pyw", ".rb", ".php", ".java", ".kt", ".kts", ".swift", ".go", ".rs",
  ".c", ".h", ".cpp", ".cc", ".cxx", ".hpp", ".cs", ".scala", ".dart", ".lua", ".r", ".pl", ".pm",
  ".vue", ".svelte", ".astro", ".tex", ".diff", ".patch", ".srt", ".vtt", ".ics", ".vcf"
]);
const DOCUMENT_TEXT_EXTENSIONS = new Set([
  ".doc", ".dot",
  ".docx", ".docm", ".dotx", ".dotm",
  ".xls", ".xlt",
  ".xlsx", ".xlsm", ".xltx", ".xltm",
  ".ppt", ".pps", ".pot",
  ".pptx", ".pptm", ".ppsx", ".ppsm", ".potx", ".potm",
  ".odt", ".ott", ".ods", ".ots", ".odp", ".otp",
  ".fodt", ".fods", ".fodp",
  ".hwpx", ".epub", ".rtf"
]);
const SPREADSHEET_EXTENSIONS = new Set([".xlsx", ".xlsm", ".xltx", ".xltm", ".ods", ".ots", ".fods"]);
const TEXT_FILE_NAMES = new Set([
  ".babelrc", ".dockerignore", ".editorconfig", ".env", ".env.local", ".env.example",
  ".eslintrc", ".gitattributes", ".gitignore", ".npmrc", ".prettierrc",
  "dockerfile", "makefile", "readme", "license"
]);
const IMAGE_EXTENSIONS = new Set([".apng", ".avif", ".bmp", ".gif", ".heic", ".heif", ".ico", ".jpg", ".jpeg", ".png", ".webp"]);
const VIDEO_EXTENSIONS = new Set([".3g2", ".3gp", ".avi", ".m4v", ".mkv", ".mov", ".mp4", ".mpeg", ".mpg", ".ogv", ".webm"]);
const AUDIO_EXTENSIONS = new Set([".aac", ".aif", ".aiff", ".flac", ".m4a", ".mp3", ".oga", ".ogg", ".opus", ".wav", ".weba"]);

export function useFilePreview(file, loadBlob, getPreviewUrl = null, loadPreviewStatus = null) {
  const [state, setState] = useState({ loading: false, url: "", text: "", spreadsheet: null, error: "", message: "", requiresPassword: false });

  useEffect(() => {
    let active = true;
    let objectUrl = "";
    let pollTimer = 0;
    setState({ loading: false, url: "", text: "", spreadsheet: null, error: "", message: "", requiresPassword: false });

    if (!file || file.type !== "file" || !canInlinePreview(file)) return undefined;
    if (file.passwordProtected && !file.passwordUnlocked) {
      setState({ loading: false, url: "", text: "", spreadsheet: null, error: "암호가 필요합니다.", message: "", requiresPassword: true });
      return undefined;
    }

    if (shouldPollDocumentPreview(file) && loadPreviewStatus && getPreviewUrl) {
      const poll = async () => {
        try {
          setState((current) => ({
            ...current,
            loading: true,
            error: "",
            message: current.message || "문서 미리보기를 생성하는 중입니다."
          }));
          const result = await loadPreviewStatus(file);
          if (!active) return;
          const status = result.preview?.status || "pending";
          if (status === "ready") {
            setState({ loading: false, url: getPreviewUrl(file), text: "", spreadsheet: null, error: "", message: "", requiresPassword: false });
            return;
          }
          if (status === "fallback") {
            const blob = await loadBlob(file);
            if (!active) return;
            setState({ loading: false, url: "", text: await blob.text(), spreadsheet: null, error: "", message: "", requiresPassword: false });
            return;
          }
          setState({
            loading: true,
            url: "",
            text: "",
            spreadsheet: null,
            error: "",
            message: result.preview?.message || "문서 미리보기를 생성하는 중입니다.",
            requiresPassword: false
          });
          pollTimer = window.setTimeout(poll, 1200);
        } catch (nextError) {
          if (active) {
            setState({ loading: false, url: "", text: "", spreadsheet: null, error: nextError.message || "미리보기를 열 수 없습니다.", message: "", requiresPassword: nextError.details?.code === "password_required" });
          }
        }
      };
      poll();
      return () => {
        active = false;
        window.clearTimeout(pollTimer);
      };
    }

    if (!isTextFile(file) && !isSpreadsheetFile(file) && getPreviewUrl) {
      setState({ loading: false, url: getPreviewUrl(file), text: "", spreadsheet: null, error: "", message: "", requiresPassword: false });
      return () => {
        active = false;
      };
    }

    setState({ loading: true, url: "", text: "", spreadsheet: null, error: "", message: "", requiresPassword: false });
    loadBlob(file)
      .then(async (blob) => {
        if (!active) return;
        if (isSpreadsheetFile(file)) {
          setState({ loading: false, url: "", text: "", spreadsheet: JSON.parse(await blob.text()), error: "", message: "", requiresPassword: false });
          return;
        }
        if (isTextFile(file)) {
          setState({ loading: false, url: "", text: await blob.text(), spreadsheet: null, error: "", message: "", requiresPassword: false });
          return;
        }
        objectUrl = URL.createObjectURL(blob);
        setState({ loading: false, url: objectUrl, text: "", spreadsheet: null, error: "", message: "", requiresPassword: false });
      })
      .catch((nextError) => {
        if (active) setState({ loading: false, url: "", text: "", spreadsheet: null, error: nextError.message || "미리보기를 열 수 없습니다.", message: "", requiresPassword: nextError.details?.code === "password_required" });
      });

    return () => {
      active = false;
      window.clearTimeout(pollTimer);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file?.id, file?.passwordProtected, file?.passwordUnlocked]);

  return state;
}

export function FilePreviewContent({ file, preview, onUnlock = null }) {
  if (!file) return <span className="muted">항목을 선택하세요</span>;
  if (file.type === "folder" || !canInlinePreview(file)) {
    return <PreviewIcon file={file} size={84} />;
  }
  if (preview.error) {
    return (
      <div className="gallery-preview-message">
        <PreviewIcon file={file} size={64} />
        <span>{preview.error}</span>
        {preview.requiresPassword && onUnlock ? <button className="button primary compact-action" type="button" onClick={() => onUnlock(file)}>암호 입력</button> : null}
      </div>
    );
  }
  if (preview.loading) return <span className="muted">{preview.message || "불러오는 중"}</span>;
  if (isSpreadsheetFile(file)) return <SpreadsheetPreview preview={preview.spreadsheet} />;
  if (preview.text) return <pre className="gallery-text-preview">{preview.text}</pre>;
  if (isTextFile(file)) return <pre className="gallery-text-preview">{preview.text || ""}</pre>;
  if (!preview.url) return <PreviewIcon file={file} size={84} />;
  if (isImageFile(file)) return <img src={preview.url} alt={file.name} />;
  if (isVideoFile(file)) return <video src={preview.url} controls />;
  if (isAudioFile(file)) return <audio src={preview.url} controls />;
  if (isPdfFile(file) || isDocumentFile(file)) return <iframe src={preview.url} title={file.name} />;
  return <PreviewIcon file={file} size={84} />;
}

export function canInlinePreview(file) {
  return isTextFile(file) || isSpreadsheetFile(file) || isImageFile(file) || isVideoFile(file) || isAudioFile(file) || isPdfFile(file) || isDocumentFile(file);
}

export function isTextFile(file) {
  const mime = normalizedMime(file);
  const name = normalizedName(file);
  const extension = fileExtension(file);
  return isTextMime(mime) || TEXT_EXTENSIONS.has(extension) || TEXT_FILE_NAMES.has(name);
}

export function isDocumentFile(file) {
  const mime = normalizedMime(file);
  return !isSpreadsheetFile(file) && (isDocumentTextMime(mime) || DOCUMENT_TEXT_EXTENSIONS.has(fileExtension(file)));
}

export function isSpreadsheetFile(file) {
  const mime = normalizedMime(file);
  return isSpreadsheetMime(mime) || SPREADSHEET_EXTENSIONS.has(fileExtension(file));
}

export function isImageFile(file) {
  const mime = normalizedMime(file).split(";")[0];
  const extension = fileExtension(file);
  if (mime === "image/svg+xml" || extension === ".svg") return false;
  return mime.startsWith("image/") || IMAGE_EXTENSIONS.has(extension);
}

export function isVideoFile(file) {
  return normalizedMime(file).startsWith("video/") || VIDEO_EXTENSIONS.has(fileExtension(file));
}

export function isAudioFile(file) {
  return normalizedMime(file).startsWith("audio/") || AUDIO_EXTENSIONS.has(fileExtension(file));
}

export function isPdfFile(file) {
  return normalizedMime(file).includes("pdf") || fileExtension(file) === ".pdf";
}

function shouldPollDocumentPreview(file) {
  return isDocumentFile(file) && !isPdfFile(file) && !isSpreadsheetFile(file);
}

function PreviewIcon({ file, size = 20 }) {
  if (file?.type === "folder") return <FolderGlyph color={file.folderColor} size={size} />;
  if (isImageFile(file)) return <Image size={size} />;
  if (isVideoFile(file)) return <FileVideo size={size} />;
  if (isAudioFile(file)) return <FileAudio size={size} />;
  if (isTextFile(file) || isSpreadsheetFile(file) || isPdfFile(file) || isDocumentFile(file)) return <FileText size={size} />;
  return <File size={size} />;
}

function normalizedMime(file) {
  return String(file?.mimeType || "").toLowerCase();
}

function normalizedName(file) {
  return String(file?.name || "").toLowerCase();
}

function fileExtension(file) {
  const name = normalizedName(file);
  const index = name.lastIndexOf(".");
  return index > 0 ? name.slice(index) : "";
}

function isTextMime(mime) {
  return mime.startsWith("text/") || [
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
  ].includes(mime.split(";")[0]);
}

function isDocumentTextMime(mime) {
  return [
    "application/epub+zip",
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
  ].includes(mime.split(";")[0]);
}

function isSpreadsheetMime(mime) {
  return [
    "application/vnd.oasis.opendocument.spreadsheet",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.template"
  ].includes(mime.split(";")[0]);
}

function SpreadsheetPreview({ preview }) {
  const sheets = Array.isArray(preview?.sheets) ? preview.sheets : [];
  if (!sheets.length) return <span className="muted">표시할 시트 데이터가 없습니다.</span>;

  return (
    <div className="spreadsheet-preview">
      {sheets.slice(0, 3).map((sheet, sheetIndex) => {
        const rows = Array.isArray(sheet.rows) ? sheet.rows : [];
        const columnCount = rows.reduce((count, row) => Math.max(count, Array.isArray(row) ? row.length : 0), 0);
        return (
          <section className="spreadsheet-sheet" key={`${sheet.name || "sheet"}-${sheetIndex}`}>
            <header>{sheet.name || `Sheet ${sheetIndex + 1}`}</header>
            <div className="spreadsheet-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th aria-label="행 번호" />
                    {Array.from({ length: columnCount }).map((_, index) => <th key={index}>{columnName(index)}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      <th>{rowIndex + 1}</th>
                      {Array.from({ length: columnCount }).map((_, cellIndex) => (
                        <td key={cellIndex}>{row?.[cellIndex] || ""}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {sheet.truncated ? <footer>일부 행만 표시 중</footer> : null}
          </section>
        );
      })}
    </div>
  );
}

function columnName(index) {
  let value = "";
  let cursor = index + 1;
  while (cursor > 0) {
    const remainder = (cursor - 1) % 26;
    value = String.fromCharCode(65 + remainder) + value;
    cursor = Math.floor((cursor - 1) / 26);
  }
  return value;
}
