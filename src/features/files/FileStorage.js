import fs from "node:fs";
import path from "node:path";
import { config } from "../../core/config.js";
import { fail } from "../../core/errors.js";
import { sha256 } from "../../core/passwords.js";

export class FileStorage {
  moveUploadedFile({ tempPath, ownerId, fileId, displayName }) {
    const storagePath = this.makeStoredPath(ownerId, fileId, displayName);
    const absolutePath = this.resolveDataPath(storagePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.renameSync(tempPath, absolutePath);
    return {
      storagePath,
      storedName: path.basename(storagePath),
      absolutePath
    };
  }

  copyStoredFile(file, { ownerId, fileId, displayName }) {
    const source = this.getAbsoluteFilePath(file);
    const storagePath = this.makeStoredPath(ownerId, fileId, displayName);
    const absolutePath = this.resolveDataPath(storagePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.copyFileSync(source, absolutePath);
    return {
      storagePath,
      storedName: path.basename(storagePath),
      absolutePath
    };
  }

  getAbsoluteFilePath(file) {
    if (!file.storage_path) {
      fail(400, "This record does not have a stored file.");
    }

    const absolutePath = this.resolveDataPath(file.storage_path);
    if (!fs.existsSync(absolutePath)) {
      fail(404, "Stored file was not found on disk.");
    }

    return absolutePath;
  }

  moveToTrash(file) {
    try {
      const source = this.resolveDataPath(file.storage_path);
      if (!fs.existsSync(source)) return;

      const target = path.join(config.trashDir, `${Date.now()}-${file.id}-${path.basename(source)}`);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.renameSync(source, target);
    } catch {
      // The DB delete has already succeeded. Trash cleanup can be retried manually.
    }
  }

  deleteStoredFile(file) {
    if (!file.storage_path) return;
    try {
      fs.rmSync(this.resolveDataPath(file.storage_path), { force: true });
    } catch {
      // Missing files should not block permanent deletion of database records.
    }
  }

  deleteStoredAssets(file) {
    this.deleteStoredFile(file);
    this.deletePreviewFiles(file);
  }

  deletePreviewFiles(file) {
    const previewPdfDir = path.join(config.previewCacheDir, "pdf");
    if (!file?.id || !fs.existsSync(previewPdfDir)) return;

    try {
      for (const entry of fs.readdirSync(previewPdfDir)) {
        if (entry.startsWith(`${file.id}-`)) {
          fs.rmSync(path.join(previewPdfDir, entry), { force: true });
        }
      }
    } catch {
      // Preview cache cleanup should not block the primary delete operation.
    }
  }

  makeStoredPath(ownerId, fileId, fileName) {
    const userKey = sha256(ownerId).slice(0, 24);
    const extension = path.extname(fileName || "").toLowerCase().replace(/[^a-z0-9.]/g, "").slice(0, 16);
    return path.join("storage", "users", userKey, `${fileId}${extension}`);
  }

  resolveDataPath(relativePath) {
    const resolved = path.resolve(config.dataDir, relativePath);
    const dataRoot = path.resolve(config.dataDir);
    if (resolved !== dataRoot && !resolved.startsWith(`${dataRoot}${path.sep}`)) {
      fail(500, "Invalid storage path.");
    }
    return resolved;
  }
}

export const fileStorage = new FileStorage();
