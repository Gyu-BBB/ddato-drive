import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

let cachedUsage = null;
let measuredAt = 0;

export function getProjectStorageUsage({ maxAgeMs = 0 } = {}) {
  if (cachedUsage && maxAgeMs > 0 && Date.now() - measuredAt < maxAgeMs) return { ...cachedUsage };
  const storageBytes = directorySize(config.storageDir);
  const trashBytes = directorySize(config.trashDir);
  const previewCacheBytes = directorySize(config.previewCacheDir);
  const tempBytes = directorySize(config.tempDir);
  const dbBytes = fileSize(config.dbFile);

  cachedUsage = {
    storageBytes,
    trashBytes,
    previewCacheBytes,
    tempBytes,
    dbBytes,
    usedBytes: storageBytes + trashBytes + previewCacheBytes + tempBytes + dbBytes
  };
  measuredAt = Date.now();
  return { ...cachedUsage };
}

export function recordProjectTempGrowth(bytes) {
  if (!cachedUsage) return;
  const growth = Math.max(0, Number(bytes) || 0);
  cachedUsage.tempBytes += growth;
  cachedUsage.usedBytes += growth;
}

export function fileSize(filePath) {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

export function directorySize(dirPath) {
  let total = 0;
  try {
    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) total += directorySize(fullPath);
      else if (entry.isFile()) total += fileSize(fullPath);
    }
  } catch {
    return total;
  }
  return total;
}
