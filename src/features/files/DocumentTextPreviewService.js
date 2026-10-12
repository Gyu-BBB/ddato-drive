import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const MAX_DOCUMENT_PREVIEW_BYTES = 80 * 1024 * 1024;
const MAX_PREVIEW_CHARS = 260_000;
const MAX_SHEET_ROWS = 300;
const MAX_SHEET_COLUMNS = 80;

const WORD_EXTENSIONS = new Set([".docx", ".docm", ".dotx", ".dotm"]);
const SPREADSHEET_EXTENSIONS = new Set([".xlsx", ".xlsm", ".xltx", ".xltm"]);
const PRESENTATION_EXTENSIONS = new Set([".pptx", ".pptm", ".ppsx", ".ppsm", ".potx", ".potm"]);
const OPEN_DOCUMENT_EXTENSIONS = new Set([".odt", ".ott", ".ods", ".ots", ".odp", ".otp"]);
const FLAT_OPEN_DOCUMENT_EXTENSIONS = new Set([".fodt", ".fods", ".fodp"]);
const HWPX_EXTENSIONS = new Set([".hwpx"]);
const EPUB_EXTENSIONS = new Set([".epub"]);
const RTF_EXTENSIONS = new Set([".rtf"]);

export class DocumentTextPreviewService {
  extractText(file, absolutePath) {
    const extension = path.extname(String(file.original_name || "")).toLowerCase();
    this.assertPreviewableSize(absolutePath);

    if (WORD_EXTENSIONS.has(extension)) return this.extractWordText(absolutePath);
    if (SPREADSHEET_EXTENSIONS.has(extension)) return this.extractSpreadsheetText(absolutePath);
    if (PRESENTATION_EXTENSIONS.has(extension)) return this.extractPresentationText(absolutePath);
    if (OPEN_DOCUMENT_EXTENSIONS.has(extension)) return this.extractOpenDocumentText(absolutePath);
    if (FLAT_OPEN_DOCUMENT_EXTENSIONS.has(extension)) return this.extractFlatXmlText(absolutePath);
    if (HWPX_EXTENSIONS.has(extension)) return this.extractHwpxText(absolutePath);
    if (EPUB_EXTENSIONS.has(extension)) return this.extractEpubText(absolutePath);
    if (RTF_EXTENSIONS.has(extension)) return stripRtf(fs.readFileSync(absolutePath, "utf8"));
    throw previewError("Document preview is not supported for this file.");
  }

  extractSpreadsheetPreview(file, absolutePath) {
    const extension = path.extname(String(file.original_name || "")).toLowerCase();
    this.assertPreviewableSize(absolutePath);

    if (SPREADSHEET_EXTENSIONS.has(extension)) return this.extractOfficeSpreadsheetPreview(absolutePath);
    if (extension === ".ods" || extension === ".ots") return this.extractOpenDocumentSpreadsheetPreview(absolutePath);
    if (extension === ".fods") return this.extractFlatOpenDocumentSpreadsheetPreview(absolutePath);
    throw previewError("Spreadsheet preview is not supported for this file.");
  }

  assertPreviewableSize(absolutePath) {
    const stat = fs.statSync(absolutePath);
    if (stat.size > MAX_DOCUMENT_PREVIEW_BYTES) {
      throw previewError("Document is too large to preview.", 413);
    }
  }

  extractWordText(absolutePath) {
    const archive = readZipEntries(absolutePath);
    const parts = [
      "word/document.xml",
      ...archive.names.filter((name) => /^word\/(header|footer|footnotes|endnotes|comments)\d*\.xml$/i.test(name)).sort(compareNatural)
    ];
    return joinPreviewText(parts.map((name) => xmlToText(archive.text(name))).filter(Boolean));
  }

  extractSpreadsheetText(absolutePath) {
    const archive = readZipEntries(absolutePath);
    const sharedStrings = parseSharedStrings(archive.text("xl/sharedStrings.xml"));
    const sheets = archive.names.filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name)).sort(compareNatural);
    const sections = sheets.map((name, index) => {
      const rows = parseWorksheetRows(archive.text(name), sharedStrings);
      if (!rows) return "";
      return [`Sheet ${index + 1}`, rows].join("\n");
    });
    return joinPreviewText(sections.filter(Boolean), "\n\n");
  }

  extractOfficeSpreadsheetPreview(absolutePath) {
    const archive = readZipEntries(absolutePath);
    const sharedStrings = parseSharedStrings(archive.text("xl/sharedStrings.xml"));
    const sheetNames = parseWorkbookSheetNames(archive.text("xl/workbook.xml"));
    const sheets = archive.names.filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name)).sort(compareNatural);

    return {
      type: "spreadsheet",
      sheets: sheets.map((name, index) => ({
        name: sheetNames[index] || `Sheet ${index + 1}`,
        rows: parseWorksheetRowArrays(archive.text(name), sharedStrings),
        truncated: countWorksheetRows(archive.text(name)) > MAX_SHEET_ROWS
      })).filter((sheet) => sheet.rows.length)
    };
  }

  extractOpenDocumentSpreadsheetPreview(absolutePath) {
    const archive = readZipEntries(absolutePath);
    return this.extractFlatOpenDocumentSpreadsheetPreviewText(archive.text("content.xml"));
  }

  extractFlatOpenDocumentSpreadsheetPreview(absolutePath) {
    return this.extractFlatOpenDocumentSpreadsheetPreviewText(fs.readFileSync(absolutePath, "utf8"));
  }

  extractFlatOpenDocumentSpreadsheetPreviewText(xml) {
    const tables = [...String(xml || "").matchAll(/<table:table\b([^>]*)>[\s\S]*?<\/table:table>/gi)];
    return {
      type: "spreadsheet",
      sheets: tables.map((match, index) => ({
        name: decodeXmlEntities(match[1]?.match(/table:name="([^"]+)"/i)?.[1] || `Sheet ${index + 1}`),
        rows: parseOpenDocumentRows(match[0]),
        truncated: false
      })).filter((sheet) => sheet.rows.length)
    };
  }

  extractPresentationText(absolutePath) {
    const archive = readZipEntries(absolutePath);
    const slides = archive.names.filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name)).sort(compareNatural);
    const sections = slides.map((name, index) => {
      const text = xmlToText(archive.text(name));
      return text ? `Slide ${index + 1}\n${text}` : "";
    });
    return joinPreviewText(sections.filter(Boolean), "\n\n");
  }

  extractOpenDocumentText(absolutePath) {
    const archive = readZipEntries(absolutePath);
    return xmlToText(archive.text("content.xml"));
  }

  extractFlatXmlText(absolutePath) {
    return xmlToText(fs.readFileSync(absolutePath, "utf8"));
  }

  extractHwpxText(absolutePath) {
    const archive = readZipEntries(absolutePath);
    const sections = archive.names
      .filter((name) => /(^|\/)(section\d+|Section\d+)\.xml$/i.test(name))
      .sort(compareNatural)
      .map((name) => xmlToText(archive.text(name)))
      .filter(Boolean);
    return joinPreviewText(sections, "\n\n");
  }

  extractEpubText(absolutePath) {
    const archive = readZipEntries(absolutePath);
    const documents = archive.names
      .filter((name) => /\.(xhtml|html|htm)$/i.test(name))
      .filter((name) => !/(^|\/)(nav|toc)\.(xhtml|html|htm)$/i.test(name))
      .sort(compareNatural)
      .slice(0, 80)
      .map((name) => xmlToText(archive.text(name)))
      .filter(Boolean);
    return joinPreviewText(documents, "\n\n");
  }
}

function readZipEntries(absolutePath) {
  const buffer = fs.readFileSync(absolutePath);
  const entries = parseZipEntries(buffer);
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  const texts = new Map();
  let extractedBytes = 0;

  return {
    names: entries.map((entry) => entry.name),
    text(name) {
      if (texts.has(name)) return texts.get(name);
      const entry = byName.get(name);
      if (!entry) return "";
      const remaining = MAX_DOCUMENT_PREVIEW_BYTES - extractedBytes;
      if (entry.sizeBytes > remaining) throw previewError("Document preview content is too large.", 413);
      const data = readZipEntryData(buffer, entry.localHeaderOffset, entry.compressedSize, entry.method, remaining);
      extractedBytes += data.length;
      if (extractedBytes > MAX_DOCUMENT_PREVIEW_BYTES) throw previewError("Document preview content is too large.", 413);
      const text = data.toString("utf8");
      texts.set(name, text);
      return text;
    }
  };
}

function parseZipEntries(buffer) {
  const endOffset = findEndOfCentralDirectory(buffer);
  if (endOffset < 0) throw previewError("Document archive could not be read.");

  const entryCount = buffer.readUInt16LE(endOffset + 10);
  const centralDirectoryOffset = buffer.readUInt32LE(endOffset + 16);
  const entries = [];
  let offset = centralDirectoryOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break;

    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const sizeBytes = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");

    if (!name.endsWith("/") && !(flags & 1)) {
      entries.push({
        name,
        localHeaderOffset, compressedSize, sizeBytes, method
      });
    }

    offset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

function findEndOfCentralDirectory(buffer) {
  const start = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= start; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  return -1;
}

function readZipEntryData(buffer, localHeaderOffset, compressedSize, method, maxOutputLength) {
  if (buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) return Buffer.alloc(0);

  const nameLength = buffer.readUInt16LE(localHeaderOffset + 26);
  const extraLength = buffer.readUInt16LE(localHeaderOffset + 28);
  const start = localHeaderOffset + 30 + nameLength + extraLength;
  const compressed = buffer.subarray(start, start + compressedSize);

  if (method === 0) return compressed;
  if (method === 8) {
    if (maxOutputLength <= 0) throw previewError("Document preview content is too large.", 413);
    return zlib.inflateRawSync(compressed, { maxOutputLength });
  }
  return Buffer.alloc(0);
}

function parseSharedStrings(xml) {
  if (!xml) return [];
  return [...xml.matchAll(/<si\b[\s\S]*?<\/si>/gi)].map((match) => xmlToText(match[0]).replace(/\n+/g, " ").trim());
}

function parseWorkbookSheetNames(xml) {
  if (!xml) return [];
  return [...xml.matchAll(/<sheet\b[^>]*\bname="([^"]+)"/gi)].map((match) => decodeXmlEntities(match[1]));
}

function parseWorksheetRows(xml, sharedStrings) {
  if (!xml) return "";
  return parseWorksheetRowArrays(xml, sharedStrings).map((row) => row.join("\t").replace(/\t+$/g, "")).join("\n");
}

function parseWorksheetRowArrays(xml, sharedStrings) {
  if (!xml) return [];
  const rows = [];

  for (const rowMatch of xml.matchAll(/<row\b[\s\S]*?<\/row>/gi)) {
    const cells = [];
    for (const cellMatch of rowMatch[0].matchAll(/<c\b([^>]*)>[\s\S]*?<\/c>/gi)) {
      const cellXml = cellMatch[0];
      const attributes = cellMatch[1] || "";
      const type = attributes.match(/\bt="([^"]+)"/i)?.[1] || "";
      const value = cellXml.match(/<v>([\s\S]*?)<\/v>/i)?.[1] || "";

      if (type === "s") {
        cells.push(sharedStrings[Number(value)] || "");
      } else if (type === "inlineStr") {
        cells.push(xmlToText(cellXml).replace(/\n+/g, " ").trim());
      } else {
        cells.push(decodeXmlEntities(value).trim());
      }
    }
    if (cells.some(Boolean)) rows.push(trimTrailingEmptyCells(cells));
    if (rows.length >= MAX_SHEET_ROWS) break;
  }

  return normalizeSheetRows(rows);
}

function countWorksheetRows(xml) {
  let count = 0;
  for (const _row of String(xml || "").matchAll(/<row\b/gi)) {
    if (++count > MAX_SHEET_ROWS) break;
  }
  return count;
}

function parseOpenDocumentRows(xml) {
  const rows = [];
  for (const rowMatch of String(xml || "").matchAll(/<table:table-row\b[\s\S]*?<\/table:table-row>/gi)) {
    const cells = [];
    for (const cellMatch of rowMatch[0].matchAll(/<table:table-cell\b([^>]*)>[\s\S]*?<\/table:table-cell>/gi)) {
      const attributes = cellMatch[1] || "";
      const repeated = Math.min(Number(attributes.match(/table:number-columns-repeated="(\d+)"/i)?.[1] || 1), MAX_SHEET_COLUMNS);
      const value = xmlToText(cellMatch[0]).replace(/\n+/g, " ").trim();
      for (let index = 0; index < repeated && cells.length < MAX_SHEET_COLUMNS; index += 1) {
        cells.push(value);
      }
    }
    if (cells.some(Boolean)) rows.push(trimTrailingEmptyCells(cells));
    if (rows.length >= MAX_SHEET_ROWS) break;
  }
  return normalizeSheetRows(rows);
}

function normalizeSheetRows(rows) {
  return rows.map((row) => row.slice(0, MAX_SHEET_COLUMNS));
}

function trimTrailingEmptyCells(cells) {
  const next = [...cells];
  while (next.length && !next[next.length - 1]) next.pop();
  return next;
}

function xmlToText(xml) {
  if (!xml) return "";
  const text = xml
    .replace(/<\?xml[\s\S]*?\?>/gi, "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<(w|a|text|hp|hs|draw|table|office):tab\b[^>]*\/?>/gi, "\t")
    .replace(/<(w|a|text|hp|hs):br\b[^>]*\/?>/gi, "\n")
    .replace(/<\/(w:p|a:p|text:p|text:h|hp:p|hs:p|tr|table:table-row)>/gi, "\n")
    .replace(/<\/(w:tbl|table:table|text:section|office:text)>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ");
  return normalizeText(decodeXmlEntities(text));
}

function stripRtf(value) {
  const withoutControlWords = String(value || "")
    .replace(/\\'[0-9a-fA-F]{2}/g, " ")
    .replace(/\\par[d]?/g, "\n")
    .replace(/\\tab/g, "\t")
    .replace(/\\[a-zA-Z]+-?\d* ?/g, "")
    .replace(/[{}]/g, " ");
  return normalizeText(withoutControlWords);
}

function decodeXmlEntities(value) {
  return String(value || "").replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (entity, code) => {
    if (code.startsWith("#x")) return String.fromCodePoint(Number.parseInt(code.slice(2), 16));
    if (code.startsWith("#")) return String.fromCodePoint(Number.parseInt(code.slice(1), 10));
    return {
      amp: "&",
      apos: "'",
      gt: ">",
      lt: "<",
      nbsp: " ",
      quot: "\""
    }[code] || entity;
  });
}

function normalizeText(value) {
  const text = String(value || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return truncatePreview(text);
}

function joinPreviewText(parts, separator = "\n") {
  return truncatePreview(parts.filter(Boolean).join(separator).trim());
}

function truncatePreview(value) {
  const text = String(value || "");
  if (text.length <= MAX_PREVIEW_CHARS) return text;
  return `${text.slice(0, MAX_PREVIEW_CHARS)}\n\n[Preview truncated]`;
}

function compareNatural(left, right) {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}

function previewError(message, statusCode = 415) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

export const documentTextPreviewService = new DocumentTextPreviewService();
