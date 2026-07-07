import fs from "node:fs";
import { once } from "node:events";
import { finished } from "node:stream/promises";
import { normalizeCrossPlatformFileName } from "../../core/fileNames.js";
import { fileStorage } from "./FileStorage.js";

const ZIP_VERSION = 20;
const ZIP64_VERSION = 45;
const UTF8_FLAG = 0x0800;
const DATA_DESCRIPTOR_FLAG = 0x0008;
const STORE_METHOD = 0;
const MAX_UINT32 = 0xffffffff;
const MAX_UINT16 = 0xffff;
const crcTable = createCrcTable();

export class ZipArchiveService {
  async streamFolderZip(root, rows, writable) {
    const rootRows = rows.filter((row) => !row.deleted_at);
    const paths = this.buildZipPaths(root, rootRows);
    const entries = this.prepareEntries(rootRows, paths);
    await this.writeZipStream(writable, entries);
  }

  buildZipPaths(root, rows) {
    const byId = new Map(rows.map((row) => [row.id, row]));
    const safeSegments = uniqueZipSegments(rows);
    const memo = new Map();

    const resolvePath = (row) => {
      if (memo.has(row.id)) return memo.get(row.id);
      const name = safeSegments.get(row.id) || sanitizeZipPathSegment(row.original_name);
      if (row.id === root.id || !row.parent_id || !byId.has(row.parent_id)) {
        memo.set(row.id, name);
        return name;
      }
      const parentPath = resolvePath(byId.get(row.parent_id));
      const value = `${parentPath}/${name}`;
      memo.set(row.id, value);
      return value;
    };

    for (const row of rows) resolvePath(row);
    return memo;
  }

  prepareEntries(rows, paths) {
    return rows.map((row) => {
      const entryName = row.type === "folder" ? `${paths.get(row.id)}/` : paths.get(row.id);
      const nameBuffer = Buffer.from(entryName, "utf8");
      const absolutePath = row.type === "file" ? fileStorage.getAbsoluteFilePath(row) : "";
      const size = row.type === "file" ? fs.statSync(absolutePath).size : 0;
      return {
        row,
        nameBuffer,
        absolutePath,
        size,
        isDirectory: row.type === "folder",
        dos: toDosDateTime(row.updated_at || row.created_at)
      };
    });
  }

  async writeZipStream(writable, entries) {
    let offset = 0;
    const centralEntries = [];

    const write = async (buffer) => {
      await writeBuffer(writable, buffer);
      offset += buffer.length;
    };

    for (const entry of entries) {
      const localOffset = offset;
      await write(streamingLocalHeader(entry));

      let crcState = 0xffffffff;
      let size = 0;
      if (!entry.isDirectory) {
        for await (const chunk of fs.createReadStream(entry.absolutePath)) {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          crcState = crc32Update(crcState, buffer);
          size += buffer.length;
          await write(buffer);
        }
      }

      const crc = entry.isDirectory ? 0 : (crcState ^ 0xffffffff) >>> 0;
      await write(dataDescriptor(crc, size, entryNeedsZip64({ ...entry, size })));

      centralEntries.push({
        nameBuffer: entry.nameBuffer,
        crc,
        size,
        dosTime: entry.dos.dosTime,
        dosDate: entry.dos.dosDate,
        localOffset,
        isDirectory: entry.isDirectory
      });
    }

    const centralOffset = offset;
    for (const entry of centralEntries) await write(centralHeader(entry));
    const centralSize = offset - centralOffset;
    const needsZip64 = archiveNeedsZip64(centralEntries.length, centralSize, centralOffset);

    if (needsZip64) {
      const zip64EndOffset = offset;
      await write(zip64EndOfCentralDirectory(centralEntries.length, centralSize, centralOffset));
      await write(zip64EndOfCentralDirectoryLocator(zip64EndOffset));
    }

    await write(endOfCentralDirectory(centralEntries.length, centralSize, centralOffset, needsZip64));
    writable.end();
    await finished(writable);
  }
}

function streamingLocalHeader(entry) {
  const needsZip64 = entryNeedsZip64(entry);
  const extraBuffer = needsZip64 ? zip64LocalExtra(entry.size, entry.size) : Buffer.alloc(0);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(needsZip64 ? ZIP64_VERSION : ZIP_VERSION, 4);
  header.writeUInt16LE(UTF8_FLAG | DATA_DESCRIPTOR_FLAG, 6);
  header.writeUInt16LE(STORE_METHOD, 8);
  header.writeUInt16LE(entry.dos.dosTime, 10);
  header.writeUInt16LE(entry.dos.dosDate, 12);
  header.writeUInt32LE(0, 14);
  header.writeUInt32LE(needsZip64 ? MAX_UINT32 : 0, 18);
  header.writeUInt32LE(needsZip64 ? MAX_UINT32 : 0, 22);
  header.writeUInt16LE(entry.nameBuffer.length, 26);
  header.writeUInt16LE(extraBuffer.length, 28);
  return Buffer.concat([header, entry.nameBuffer, extraBuffer]);
}

function centralHeader(entry) {
  const extraBuffer = zip64CentralExtra(entry);
  const needsZip64 = extraBuffer.length > 0;
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(needsZip64 ? ZIP64_VERSION : ZIP_VERSION, 4);
  header.writeUInt16LE(needsZip64 ? ZIP64_VERSION : ZIP_VERSION, 6);
  header.writeUInt16LE(UTF8_FLAG | DATA_DESCRIPTOR_FLAG, 8);
  header.writeUInt16LE(STORE_METHOD, 10);
  header.writeUInt16LE(entry.dosTime, 12);
  header.writeUInt16LE(entry.dosDate, 14);
  header.writeUInt32LE(entry.crc, 16);
  header.writeUInt32LE(entry.size > MAX_UINT32 ? MAX_UINT32 : entry.size, 20);
  header.writeUInt32LE(entry.size > MAX_UINT32 ? MAX_UINT32 : entry.size, 24);
  header.writeUInt16LE(entry.nameBuffer.length, 28);
  header.writeUInt16LE(extraBuffer.length, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(entry.isDirectory ? 0x10 : 0, 38);
  header.writeUInt32LE(entry.localOffset > MAX_UINT32 ? MAX_UINT32 : entry.localOffset, 42);
  return Buffer.concat([header, entry.nameBuffer, extraBuffer]);
}

function dataDescriptor(crc, size, zip64 = false) {
  const descriptor = Buffer.alloc(zip64 ? 24 : 16);
  descriptor.writeUInt32LE(0x08074b50, 0);
  descriptor.writeUInt32LE(crc, 4);
  if (zip64) {
    descriptor.writeBigUInt64LE(BigInt(size), 8);
    descriptor.writeBigUInt64LE(BigInt(size), 16);
    return descriptor;
  }
  descriptor.writeUInt32LE(size, 8);
  descriptor.writeUInt32LE(size, 12);
  return descriptor;
}

function endOfCentralDirectory(entryCount, centralSize, centralOffset, zip64 = false) {
  const header = Buffer.alloc(22);
  header.writeUInt32LE(0x06054b50, 0);
  header.writeUInt16LE(0, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(zip64 ? MAX_UINT16 : Math.min(entryCount, MAX_UINT16), 8);
  header.writeUInt16LE(zip64 ? MAX_UINT16 : Math.min(entryCount, MAX_UINT16), 10);
  header.writeUInt32LE(zip64 ? MAX_UINT32 : Math.min(centralSize, MAX_UINT32), 12);
  header.writeUInt32LE(zip64 ? MAX_UINT32 : Math.min(centralOffset, MAX_UINT32), 16);
  header.writeUInt16LE(0, 20);
  return header;
}

function zip64EndOfCentralDirectory(entryCount, centralSize, centralOffset) {
  const header = Buffer.alloc(56);
  header.writeUInt32LE(0x06064b50, 0);
  header.writeBigUInt64LE(44n, 4);
  header.writeUInt16LE(ZIP64_VERSION, 12);
  header.writeUInt16LE(ZIP64_VERSION, 14);
  header.writeUInt32LE(0, 16);
  header.writeUInt32LE(0, 20);
  header.writeBigUInt64LE(BigInt(entryCount), 24);
  header.writeBigUInt64LE(BigInt(entryCount), 32);
  header.writeBigUInt64LE(BigInt(centralSize), 40);
  header.writeBigUInt64LE(BigInt(centralOffset), 48);
  return header;
}

function zip64EndOfCentralDirectoryLocator(zip64EndOffset) {
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x07064b50, 0);
  header.writeUInt32LE(0, 4);
  header.writeBigUInt64LE(BigInt(zip64EndOffset), 8);
  header.writeUInt32LE(1, 16);
  return header;
}

function zip64LocalExtra(uncompressedSize, compressedSize) {
  const data = Buffer.alloc(16);
  data.writeBigUInt64LE(BigInt(uncompressedSize), 0);
  data.writeBigUInt64LE(BigInt(compressedSize), 8);
  return zip64Extra(data);
}

function zip64CentralExtra(entry) {
  const chunks = [];
  if (entry.size > MAX_UINT32) {
    const sizes = Buffer.alloc(16);
    sizes.writeBigUInt64LE(BigInt(entry.size), 0);
    sizes.writeBigUInt64LE(BigInt(entry.size), 8);
    chunks.push(sizes);
  }
  if (entry.localOffset > MAX_UINT32) {
    const offset = Buffer.alloc(8);
    offset.writeBigUInt64LE(BigInt(entry.localOffset), 0);
    chunks.push(offset);
  }
  return chunks.length ? zip64Extra(Buffer.concat(chunks)) : Buffer.alloc(0);
}

function zip64Extra(data) {
  const header = Buffer.alloc(4);
  header.writeUInt16LE(0x0001, 0);
  header.writeUInt16LE(data.length, 2);
  return Buffer.concat([header, data]);
}

function entryNeedsZip64(entry) {
  return Number(entry.size || 0) > MAX_UINT32;
}

function archiveNeedsZip64(entryCount, centralSize, centralOffset) {
  return entryCount > MAX_UINT16 || centralSize > MAX_UINT32 || centralOffset > MAX_UINT32;
}

function sanitizeZipPathSegment(value) {
  return normalizeCrossPlatformFileName(value, "untitled");
}

function uniqueZipSegments(rows) {
  const byParent = new Map();
  for (const row of rows) {
    const key = row.parent_id || "";
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(row);
  }

  const segments = new Map();
  for (const siblings of byParent.values()) {
    const used = new Set();
    for (const row of siblings) {
      const preferred = sanitizeZipPathSegment(row.original_name);
      const segment = nextZipSegment(preferred, used, row.type === "file");
      segments.set(row.id, segment);
    }
  }
  return segments;
}

function nextZipSegment(preferred, used, isFile) {
  let candidate = preferred;
  for (let index = 1; used.has(zipSegmentKey(candidate)); index += 1) {
    candidate = zipSegmentWithSuffix(preferred, index, isFile);
  }
  used.add(zipSegmentKey(candidate));
  return candidate;
}

function zipSegmentWithSuffix(name, index, isFile) {
  const suffix = ` (${index})`;
  const extensionIndex = isFile ? name.lastIndexOf(".") : -1;
  const hasExtension = extensionIndex > 0 && extensionIndex < name.length - 1;
  const base = hasExtension ? name.slice(0, extensionIndex) : name;
  const extension = hasExtension ? name.slice(extensionIndex) : "";
  const maxBaseLength = Math.max(1, 180 - Array.from(suffix).length - Array.from(extension).length);
  const safeBase = Array.from(base).slice(0, maxBaseLength).join("").replace(/[. ]+$/g, "") || "file";
  return normalizeCrossPlatformFileName(`${safeBase}${suffix}${extension}`, "untitled");
}

function zipSegmentKey(value) {
  return String(value || "").normalize("NFKC").toLocaleLowerCase("en-US");
}

function toDosDateTime(value) {
  const date = new Date(Number(value) || Date.now());
  const year = Math.min(2107, Math.max(1980, date.getFullYear()));
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosTime, dosDate };
}

function createCrcTable() {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
}

function crc32Update(crc, buffer) {
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return crc;
}

async function writeBuffer(writable, buffer) {
  if (writable.destroyed) return;
  if (!writable.write(buffer)) {
    await once(writable, "drain");
  }
}

export const zipArchiveService = new ZipArchiveService();
