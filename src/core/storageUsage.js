import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

export function getProjectStorageUsage() {
  const storageBytes = directorySize(config.storageDir);
  const trashBytes = directorySize(config.trashDir);
  const previewCacheBytes = directorySize(config.previewCacheDir);
  const tempBytes = directorySize(config.tempDir);
  const dbBytes = fileSize(config.dbFile);

  return {
    storageBytes,
    trashBytes,
    previewCacheBytes,
    tempBytes,
    dbBytes,
    usedBytes: storageBytes + trashBytes + previewCacheBytes + tempBytes + dbBytes
  };
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
