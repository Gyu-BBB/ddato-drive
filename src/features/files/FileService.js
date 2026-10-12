import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config } from "../../core/config.js";
import { fail } from "../../core/errors.js";
import { getProjectStorageUsage } from "../../core/storageUsage.js";
import { withTransaction } from "../../database/database.js";
import { serializeUser } from "../users/user.serializer.js";
import { userRepository } from "../users/UserRepository.js";
import { fileNamePolicy } from "./FileNamePolicy.js";
import { fileRepository } from "./FileRepository.js";
import { serializeFile } from "./file.serializer.js";
import { fileStorage } from "./FileStorage.js";
import { mimeTypePolicy } from "./MimeTypePolicy.js";
import { previewPolicy } from "./PreviewPolicy.js";
import { documentTextPreviewService } from "./DocumentTextPreviewService.js";
import { documentPdfPreviewService } from "./DocumentPdfPreviewService.js";
import { documentPreviewJobService } from "./DocumentPreviewJobService.js";
import { uploadSessionStore } from "./UploadSessionStore.js";
import { shareService } from "../shares/ShareService.js";
import { accessPasswordService } from "../protection/AccessPasswordService.js";
import { archivePreviewService } from './ArchivePreviewService.js';

const FOLDER_COLORS = new Set(["yellow", "blue", "green", "pink", "purple", "orange", "gray"]);

export class FileService {
  listFiles(req, { ownerId = "", parentId = null, search = "" } = {}) {
    const requestUser = req.user;
    const owner = this.resolveTargetOwner(requestUser, ownerId);
    const searchText = String(search || "").trim();
    if (searchText) {
      const files = fileRepository.search(owner.id, searchText);
      return {
        owner: serializeUser(owner),
        parentId: null,
        search: {
          query: searchText,
          total: files.length
        },
        usageBytes: fileRepository.getUsageBytes(owner.id),
        projectQuotaBytes: config.projectDiskQuotaBytes,
        files: this.serializeFilesForRequest(req, owner.id, files)
      };
    }

    const normalizedParentId = this.normalizeParentId(parentId);
    if (normalizedParentId) this.assertFolder(owner.id, normalizedParentId);

    return {
      owner: serializeUser(owner),
      parentId: normalizedParentId,
      usageBytes: fileRepository.getUsageBytes(owner.id),
      projectQuotaBytes: config.projectDiskQuotaBytes,
      files: this.serializeFilesForRequest(req, owner.id, fileRepository.list(owner.id, normalizedParentId))
    };
  }

  listMediaFiles(req, { ownerId = "", search = "", kind = "" } = {}) {
    const requestUser = req.user;
    const owner = this.resolveTargetOwner(requestUser, ownerId);
    const query = String(search || "").trim().toLowerCase();
    const mediaKind = normalizeMediaKind(kind);
    const rows = fileRepository.listActiveByOwner(owner.id)
      .filter((file) => file.type === "file")
      .map((file) => ({ file, mediaKind: getMediaKind(file) }))
      .filter((entry) => entry.mediaKind && (!mediaKind || entry.mediaKind === mediaKind))
      .filter((entry) => !query || String(entry.file.original_name || "").toLowerCase().includes(query))
      .sort((left, right) => {
        const updated = Number(right.file.updated_at || 0) - Number(left.file.updated_at || 0);
        if (updated) return updated;
        return String(left.file.original_name || "").localeCompare(String(right.file.original_name || ""), "ko", { numeric: true, sensitivity: "base" });
      });

    const mediaKindById = new Map(rows.map((entry) => [entry.file.id, entry.mediaKind]));
    return {
      owner: serializeUser(owner),
      usageBytes: fileRepository.getUsageBytes(owner.id),
      projectQuotaBytes: config.projectDiskQuotaBytes,
      search: {
        query,
        kind: mediaKind || "all",
        total: rows.length
      },
      files: this.serializeFilesForRequest(req, owner.id, rows.map((entry) => entry.file))
        .map((file) => ({ ...file, mediaKind: mediaKindById.get(file.id) || "" }))
    };
  }

  listTrash(req, { ownerId = "" } = {}) {
    const requestUser = req.user;
    const owner = this.resolveTargetOwner(requestUser, ownerId);
    return {
      owner: serializeUser(owner),
      parentId: null,
      usageBytes: fileRepository.getUsageBytes(owner.id),
      projectQuotaBytes: config.projectDiskQuotaBytes,
      files: this.serializeFilesForRequest(req, owner.id, fileRepository.listTrash(owner.id), { includeDeleted: true })
    };
  }

  createFolder(req, { ownerId = "", parentId = null, name }) {
    const requestUser = req.user;
    const owner = this.resolveTargetOwner(requestUser, ownerId);
    const normalizedParentId = this.normalizeParentId(parentId);
    if (normalizedParentId) this.assertFolderAccess(req, owner.id, normalizedParentId);

    const safeName = fileNamePolicy.sanitize(name, "New Folder");
    const uniqueName = fileNamePolicy.nextAvailable(fileRepository, owner.id, normalizedParentId, safeName);
    return this.serializeFileForRequest(req, fileRepository.insertFolder({
      id: crypto.randomUUID(),
      ownerId: owner.id,
      parentId: normalizedParentId,
      name: uniqueName
    }));
  }

  createFileFromUpload(req, upload) {
    const requestUser = req.user;
    const owner = this.resolveTargetOwner(requestUser, upload.ownerId);
    const parentId = this.normalizeParentId(upload.parentId);
    if (parentId) this.assertFolderAccess(req, owner.id, parentId);

    this.assertUserQuota(owner, upload.sizeBytes, {
      excludeUploadSessionId: upload.uploadSessionId
    });
    this.assertProjectQuota(uploadSessionStore.getPendingRemainingBytes({
      excludeSessionId: upload.uploadSessionId
    }));

    const fileId = crypto.randomUUID();
    const safeName = fileNamePolicy.sanitizeUploadName(upload.originalName, "upload");
    const uniqueName = fileNamePolicy.nextAvailable(fileRepository, owner.id, parentId, safeName);
    const stored = fileStorage.moveUploadedFile({
      tempPath: upload.tempPath,
      ownerId: owner.id,
      fileId,
      displayName: uniqueName
    });

    try {
      return this.serializeFileForRequest(req, fileRepository.insertFile({
        id: fileId,
        ownerId: owner.id,
        parentId,
        name: uniqueName,
        storedName: stored.storedName,
        mimeType: mimeTypePolicy.normalize(upload.mimeType, uniqueName),
        sizeBytes: upload.sizeBytes,
        storagePath: stored.storagePath
      }));
    } catch (error) {
      fs.rmSync(stored.absolutePath, { force: true });
      throw error;
    }
  }

  renameFile(req, fileId, name) {
    const file = this.getAccessibleFile(req.user, fileId);
    accessPasswordService.assertFileAccess(req, file);
    const safeName = fileNamePolicy.sanitize(name, file.original_name);
    const uniqueName = fileNamePolicy.nextAvailable(fileRepository, file.owner_id, file.parent_id, safeName, file.id);
    return this.serializeFileForRequest(req, fileRepository.rename(file.id, uniqueName));
  }

  setAccessPassword(req, fileId, password) {
    const file = this.getAccessibleFile(req.user, fileId);
    if (file.access_password_hash) {
      accessPasswordService.assertFileAccess(req, file);
    }
    const nextFile = fileRepository.setAccessPassword(file.id, accessPasswordService.hash(password));
    accessPasswordService.revokeUnlocksForResource(nextFile.id);
    return this.serializeFileForRequest(req, nextFile);
  }

  clearAccessPassword(req, fileId, password) {
    const file = this.getAccessibleFile(req.user, fileId);
    if (!file.access_password_hash) return this.serializeFileForRequest(req, file);
    if (!accessPasswordService.verify(password, file.access_password_hash)) {
      fail(401, "암호가 올바르지 않습니다.", { code: "password_invalid", resourceType: "file" });
    }
    return this.serializeFileForRequest(req, fileRepository.clearAccessPassword(file.id));
  }

  resetAccessPasswordAsAdmin(req, fileId) {
    const file = this.getAccessibleFile(req.user, fileId);
    if (!file.access_password_hash) return this.serializeFileForRequest(req, file);
    const cleared = fileRepository.clearAccessPassword(file.id);
    accessPasswordService.revokeUnlocksForResource(file.id);
    return this.serializeFileForRequest(req, cleared);
  }

  unlockAccessPassword(req, fileId, password) {
    const file = this.getAccessibleFile(req.user, fileId);
    accessPasswordService.unlockFile(req, file, password);
    return this.serializeFileForRequest(req, file);
  }

  moveFile(req, fileId, { parentId = null } = {}) {
    const requestUser = req.user;
    const file = this.getAccessibleFile(requestUser, fileId);
    accessPasswordService.assertFileAccess(req, file);
    const normalizedParentId = this.normalizeParentId(parentId);
    if ((file.parent_id || null) === normalizedParentId) {
      return this.serializeFileForRequest(req, file, {
        path: this.buildPath(file, new Map(fileRepository.listActiveByOwner(file.owner_id).map((row) => [row.id, row])))
      });
    }

    if (normalizedParentId) {
      this.assertFolderAccess(req, file.owner_id, normalizedParentId);
      if (file.type === "folder") {
        const movingRows = fileRepository.loadActiveTree(file.id);
        if (movingRows.some((row) => row.id === normalizedParentId)) {
          fail(400, "폴더를 자기 자신 또는 하위 폴더로 이동할 수 없습니다.");
        }
      }
    }

    const uniqueName = fileNamePolicy.nextAvailable(fileRepository, file.owner_id, normalizedParentId, file.original_name, file.id);
    const moved = fileRepository.move(file.id, {
      parentId: normalizedParentId,
      name: uniqueName
    });
    return this.serializeFileForRequest(req, moved, {
      path: this.buildPath(moved, new Map(fileRepository.listActiveByOwner(moved.owner_id).map((row) => [row.id, row])))
    });
  }

  changeFolderColor(req, fileId, color) {
    const file = this.getAccessibleFile(req.user, fileId);
    accessPasswordService.assertFileAccess(req, file);
    if (file.type !== "folder") fail(400, "Only folders can have a color.");
    const normalizedColor = this.normalizeFolderColor(color);
    return this.serializeFileForRequest(req, fileRepository.updateFolderColor(file.id, normalizedColor));
  }

  duplicateFileTree(req, fileId) {
    const requestUser = req.user;
    const file = this.getAccessibleFile(requestUser, fileId);
    const rows = fileRepository.loadActiveTree(file.id);
    if (!rows.length) fail(404, "File was not found.");
    accessPasswordService.assertFileTreeAccess(req, file, rows);

    const owner = userRepository.findById(file.owner_id);
    if (!owner || (owner.disabled_at && requestUser.role !== "admin")) fail(404, "Target user was not found.");

    const duplicateBytes = this.totalFileBytes(rows);
    this.assertUserQuota(owner, duplicateBytes);
    this.assertProjectQuota(duplicateBytes + uploadSessionStore.getPendingRemainingBytes());

    const byParent = this.groupRowsByParent(rows);
    const copiedPaths = [];

    try {
      const duplicatedRoot = withTransaction(() => {
        const preferredName = fileNamePolicy.copyName(file.original_name);
        const uniqueName = fileNamePolicy.nextAvailable(fileRepository, file.owner_id, file.parent_id, preferredName);
        return this.duplicateTreeRow(file, {
          parentId: file.parent_id,
          name: uniqueName,
          byParent,
          copiedPaths
        });
      });

      return {
        copied: rows.length,
        bytesCopied: duplicateBytes,
        root: this.serializeFileForRequest(req, duplicatedRoot)
      };
    } catch (error) {
      for (const absolutePath of copiedPaths.reverse()) {
        fs.rmSync(absolutePath, { force: true });
      }
      throw error;
    }
  }

  deleteFileTree(req, fileId) {
    const requestUser = req.user;
    const file = this.getAccessibleFile(requestUser, fileId);
    const rows = fileRepository.loadActiveTree(file.id);
    if (!rows.length) fail(404, "File was not found.");

    withTransaction(() => {
      fileRepository.markDeleted(rows);
      shareService.revokeSharesForFiles(rows);
    });

    return {
      deleted: rows.length,
      root: this.serializeFileForRequest(req, file)
    };
  }

  restoreFileTree(requestUser, fileId) {
    const file = this.getAccessibleTrashFile(requestUser, fileId);
    const rows = fileRepository.loadDeletedTree(file.id);
    if (!rows.length) fail(404, "Trash item was not found.");

    const parentId = file.parent_id && fileRepository.folderExists(file.owner_id, file.parent_id) ? file.parent_id : null;
    const uniqueName = fileNamePolicy.nextAvailable(fileRepository, file.owner_id, parentId, file.original_name, file.id);
    const restored = withTransaction(() => fileRepository.restoreTree(rows, {
      rootId: file.id,
      parentId,
      rootName: uniqueName
    }));

    return {
      restored: rows.length,
      root: serializeFile(restored)
    };
  }

  purgeFileTree(requestUser, fileId) {
    const file = this.getAccessibleTrashFile(requestUser, fileId);
    const rows = fileRepository.loadDeletedTree(file.id);
    if (!rows.length) fail(404, "Trash item was not found.");

    withTransaction(() => {
      fileRepository.purgeTree(rows);
      shareService.revokeSharesForFiles(rows);
    });

    for (const row of rows.filter((entry) => entry.type === "file" && entry.storage_path)) {
      fileStorage.deleteStoredAssets(row);
    }

    return {
      purged: rows.length,
      root: serializeFile(file)
    };
  }

  getAccessibleFile(requestUser, fileId) {
    const file = fileRepository.findById(fileId);
    if (!file || file.deleted_at) fail(404, "File was not found.");
    if (requestUser.role !== "admin" && file.owner_id !== requestUser.id) {
      fail(403, "Access denied.");
    }
    return file;
  }

  getAccessibleTrashFile(requestUser, fileId) {
    const file = fileRepository.findById(fileId);
    if (!file || !file.deleted_at) fail(404, "Trash item was not found.");
    if (requestUser.role !== "admin" && file.owner_id !== requestUser.id) {
      fail(403, "Access denied.");
    }
    return file;
  }

  getDownloadStreamTarget(req, fileId) {
    const file = this.getAccessibleFile(req.user, fileId);
    accessPasswordService.assertFileAccess(req, file);
    if (file.type === "folder") {
      const rows = fileRepository.loadActiveTree(file.id);
      return {
        file,
        zipRows: rows,
        contentType: "application/zip",
        disposition: "attachment",
        fileName: `${file.original_name}.zip`
      };
    }

    return {
      file,
      absolutePath: fileStorage.getAbsoluteFilePath(file),
      contentType: file.mime_type || "application/octet-stream",
      disposition: "attachment",
      fileName: file.original_name
    };
  }

  getSelectionDownloadStreamTarget(req, fileIds) {
    const ids = normalizeFileIds(fileIds);
    if (!ids.length) fail(400, "다운로드할 항목을 선택하세요.");
    if (ids.length > 500) fail(400, "한 번에 다운로드할 수 있는 항목은 500개까지입니다.");

    const selected = ids.map((id) => this.getAccessibleFile(req.user, id));
    const roots = this.filterSelectedTreeRoots(selected);
    const rowsById = new Map();

    for (const root of roots) {
      const rows = fileRepository.loadActiveTree(root.id);
      if (!rows.length) fail(404, "File was not found.");
      accessPasswordService.assertFileTreeAccess(req, root, rows);
      for (const row of rows) rowsById.set(row.id, row);
    }

    return {
      file: { original_name: "DDATO Drive 선택 항목" },
      zipRows: [...rowsById.values()],
      rootIds: roots.map((root) => root.id),
      contentType: "application/zip",
      disposition: "attachment",
      fileName: roots.length === 1 ? `${roots[0].original_name}.zip` : "DDATO Drive 선택 항목.zip"
    };
  }

  async getPreviewStreamTarget(req, fileId) {
    const file = this.getAccessibleFile(req.user, fileId);
    accessPasswordService.assertFileAccess(req, file);
    const preview = previewPolicy.getPreviewMode(file);
    if (!preview?.supported) fail(415, "Preview is not supported for this file.");
    const absolutePath = fileStorage.getAbsoluteFilePath(file);

    if (preview.mode === 'archive') {
      return { file, json: await archivePreviewService.inspect(absolutePath, file.original_name), contentType: preview.contentType, disposition: preview.disposition };
    }
    if (preview.mode === "spreadsheet") {
      return {
        file,
        json: documentTextPreviewService.extractSpreadsheetPreview(file, absolutePath),
        contentType: preview.contentType,
        disposition: preview.disposition
      };
    }

    if (preview.mode === "document") {
      const pdfPath = documentPdfPreviewService.cachedPdfPath(file);
      if (pdfPath) {
        return {
          file,
          absolutePath: pdfPath,
          contentType: "application/pdf",
          disposition: "inline",
          fileName: previewPdfName(file)
        };
      }

      const status = documentPreviewJobService.getStatus(file, absolutePath, { enqueue: false });
      if (status.status !== "fallback") {
        return {
          file,
          pending: true,
          preview: status
        };
      }

      return {
        file,
        text: documentTextPreviewService.extractText(file, absolutePath),
        contentType: preview.contentType,
        disposition: preview.disposition
      };
    }

    return {
      file,
      absolutePath,
      contentType: preview.contentType,
      disposition: preview.disposition
    };
  }

  getPreviewStatus(req, fileId) {
    const file = this.getAccessibleFile(req.user, fileId);
    accessPasswordService.assertFileAccess(req, file);
    const preview = previewPolicy.getPreviewMode(file);
    if (!preview?.supported) fail(415, "Preview is not supported for this file.");

    if (preview.mode !== "document") {
      return {
        file: this.serializeFileForRequest(req, file),
        preview: { status: "ready", message: "미리보기가 준비되었습니다." }
      };
    }

    const absolutePath = fileStorage.getAbsoluteFilePath(file);
    return {
      file: this.serializeFileForRequest(req, file),
      preview: documentPreviewJobService.getStatus(file, absolutePath)
    };
  }

  resolveTargetOwner(requestUser, ownerId = "") {
    const requestedOwner = String(ownerId || "").trim();
    const targetOwnerId = requestUser.role === "admin" && requestedOwner ? requestedOwner : requestUser.id;
    const owner = userRepository.findById(targetOwnerId);

    if (!owner || (owner.disabled_at && requestUser.role !== "admin")) fail(404, "Target user was not found.");
    if (requestUser.role !== "admin" && owner.id !== requestUser.id) fail(403, "Access denied.");
    return owner;
  }

  assertFolder(ownerId, folderId) {
    if (!fileRepository.folderExists(ownerId, folderId)) {
      fail(404, "Parent folder was not found.");
    }
  }

  assertFolderAccess(req, ownerId, folderId) {
    this.assertFolder(ownerId, folderId);
    const folder = this.getAccessibleFile(req.user, folderId);
    if (folder.owner_id !== ownerId || folder.type !== "folder") {
      fail(404, "Parent folder was not found.");
    }
    accessPasswordService.assertFileAccess(req, folder);
    return folder;
  }

  normalizeParentId(value) {
    const text = String(value || "").trim();
    return text && text !== "null" && text !== "root" ? text : null;
  }

  normalizeFolderColor(value) {
    const color = String(value || "yellow").trim().toLowerCase();
    if (FOLDER_COLORS.has(color)) return color;
    fail(400, "Folder color is not supported.");
  }

  assertProjectQuota(additionalBytes = 0, { maxAgeMs = 0 } = {}) {
    let storage = getProjectStorageUsage({ maxAgeMs });
    // Reconcile near capacity, including changes made outside upload sessions.
    if (maxAgeMs && storage.usedBytes + Number(additionalBytes || 0) + 64 * 1024 * 1024 >= config.projectDiskQuotaBytes) {
      storage = getProjectStorageUsage();
    }
    const nextBytes = Number(storage.usedBytes || 0) + Number(additionalBytes || 0);
    if (nextBytes > config.projectDiskQuotaBytes) {
      fail(413, "프로젝트 저장 공간이 부족합니다.", {
        code: "project_quota_exceeded",
        usageBytes: storage.usedBytes,
        quotaBytes: config.projectDiskQuotaBytes,
        availableBytes: Math.max(0, config.projectDiskQuotaBytes - Number(storage.usedBytes || 0)),
        fileBytes: additionalBytes
      });
    }
  }

  assertUserQuota(owner, additionalBytes = 0, { excludeUploadSessionId = "" } = {}) {
    const usageBytes = fileRepository.getUsageBytes(owner.id);
    const pendingBytes = uploadSessionStore.getPendingBytes({
      ownerId: owner.id,
      excludeSessionId: excludeUploadSessionId
    });
    const nextBytes = usageBytes + pendingBytes + Number(additionalBytes || 0);

    if (owner.quota_bytes != null && nextBytes > owner.quota_bytes) {
      fail(413, "저장 공간이 부족합니다.", {
        code: "user_quota_exceeded",
        usageBytes,
        pendingBytes,
        quotaBytes: owner.quota_bytes,
        remainingBytes: Math.max(0, owner.quota_bytes - usageBytes - pendingBytes),
        fileBytes: additionalBytes
      });
    }
  }

  totalFileBytes(rows) {
    return rows.reduce((total, row) => total + (row.type === "file" ? Number(row.size_bytes || 0) : 0), 0);
  }

  groupRowsByParent(rows) {
    const byParent = new Map();
    for (const row of rows) {
      const key = row.parent_id || "";
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key).push(row);
    }
    return byParent;
  }

  filterSelectedTreeRoots(files) {
    const selectedIds = new Set(files.map((file) => file.id));
    const ownerMaps = new Map();
    return files.filter((file) => !hasSelectedAncestor(file, selectedIds, ownerMaps));
  }

  duplicateTreeRow(row, { parentId, name, byParent, copiedPaths }) {
    const id = crypto.randomUUID();
    let copy;

    if (row.type === "folder") {
      copy = fileRepository.insertFolder({
        id,
        ownerId: row.owner_id,
        parentId,
        name,
        folderColor: row.folder_color || null,
        accessPasswordHash: row.access_password_hash || null,
        accessPasswordSetAt: row.access_password_set_at || null
      });
    } else {
      const stored = fileStorage.copyStoredFile(row, {
        ownerId: row.owner_id,
        fileId: id,
        displayName: name
      });
      copiedPaths.push(stored.absolutePath);
      copy = fileRepository.insertFile({
        id,
        ownerId: row.owner_id,
        parentId,
        name,
        storedName: stored.storedName,
        mimeType: row.mime_type,
        sizeBytes: row.size_bytes,
        storagePath: stored.storagePath,
        accessPasswordHash: row.access_password_hash || null,
        accessPasswordSetAt: row.access_password_set_at || null
      });
    }

    const children = byParent.get(row.id) || [];
    for (const child of children) {
      this.duplicateTreeRow(child, {
        parentId: copy.id,
        name: child.original_name,
        byParent,
        copiedPaths
      });
    }

    return copy;
  }

  serializeFilesWithPaths(ownerId, files, { includeDeleted = false } = {}) {
    const rows = includeDeleted ? fileRepository.listByOwner(ownerId) : fileRepository.listActiveByOwner(ownerId);
    const byId = new Map(rows.map((row) => [row.id, row]));
    return files.map((file) => serializeFile(file, {
      path: this.buildPath(file, byId)
    }));
  }

  serializeFilesForRequest(req, ownerId, files, { includeDeleted = false } = {}) {
    const rows = includeDeleted ? fileRepository.listByOwner(ownerId) : fileRepository.listActiveByOwner(ownerId);
    const byId = new Map(rows.map((row) => [row.id, row]));
    return files.map((file) => serializeFile(file, {
      path: this.buildPath(file, byId),
      ...accessPasswordService.serializeFileProtection(req, file)
    }));
  }

  serializeFileForRequest(req, file, extra = {}) {
    return serializeFile(file, {
      ...accessPasswordService.serializeFileProtection(req, file),
      ...extra
    });
  }

  buildPath(file, byId) {
    const path = [];
    let cursor = file.type === "folder" ? file : byId.get(file.parent_id);

    while (cursor) {
      if (cursor.type === "folder") {
        path.unshift({
          id: cursor.id,
          name: cursor.original_name
        });
      }
      cursor = cursor.parent_id ? byId.get(cursor.parent_id) : null;
    }

    return path;
  }
}

function normalizeFileIds(value) {
  const values = Array.isArray(value) ? value : [];
  return [...new Set(values.map((id) => String(id || "").trim()).filter(Boolean))];
}

function hasSelectedAncestor(file, selectedIds, ownerMaps) {
  if (!file?.parent_id) return false;
  let byId = ownerMaps.get(file.owner_id);
  if (!byId) {
    byId = new Map(fileRepository.listActiveByOwner(file.owner_id).map((row) => [row.id, row]));
    ownerMaps.set(file.owner_id, byId);
  }

  let parentId = file.parent_id;
  while (parentId) {
    if (selectedIds.has(parentId)) return true;
    const parent = byId.get(parentId);
    parentId = parent?.parent_id || "";
  }
  return false;
}

function previewPdfName(file) {
  const name = String(file.original_name || "preview");
  return `${name.replace(/\.[^.]+$/, "")}.pdf`;
}

function normalizeMediaKind(value) {
  const kind = String(value || "").trim().toLowerCase();
  return kind === "image" || kind === "video" ? kind : "";
}

function getMediaKind(file) {
  const preview = previewPolicy.getPreviewMode(file);
  const contentType = String(preview?.contentType || "").toLowerCase();
  if (preview?.supported && contentType.startsWith("image/")) return "image";
  if (preview?.supported && contentType.startsWith("video/")) return "video";
  return "";
}

export const fileService = new FileService();
