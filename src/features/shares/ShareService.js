import crypto from "node:crypto";
import { archivePreviewService } from '../files/ArchivePreviewService.js';
import { fail } from "../../core/errors.js";
import { withTransaction } from "../../database/database.js";
import { fileRepository } from "../files/FileRepository.js";
import { serializeFile } from "../files/file.serializer.js";
import { fileStorage } from "../files/FileStorage.js";
import { previewPolicy } from "../files/PreviewPolicy.js";
import { documentPreviewWorkerService } from "../files/DocumentPreviewWorkerService.js";
import { documentPdfPreviewService } from "../files/DocumentPdfPreviewService.js";
import { documentPreviewJobService } from "../files/DocumentPreviewJobService.js";
import { accessPasswordService } from "../protection/AccessPasswordService.js";
import { serializeShare } from "./share.serializer.js";
import { shareRepository } from "./ShareRepository.js";

const ONE_HOUR_MS = 60 * 60 * 1000;

export class ShareService {
  listOwned(requestUser, query, urlBuilder) {
    const page = Math.min(100000, Math.max(0, Math.floor(Number(query.page) || 0)));
    const { rows, total } = shareRepository.listOwned(requestUser.id, { state: query.state, page });
    const folders = new Map(fileRepository.listFoldersByOwner(requestUser.id, { includeDeleted: true }).map(row => [row.id, row]));
    return { page, total, shares: rows.map(row => {
      const names = []; const seen = new Set(); let folder = folders.get(row.parent_id);
      while (folder && !seen.has(folder.id)) { seen.add(folder.id); names.unshift(folder.original_name); folder = folders.get(folder.parent_id); }
      return { ...serializeShare(row, urlBuilder(row.token)), name: row.file_name, fileType: row.file_type, path: ['홈', ...names].join(' / ') };
    }) };
  }

  revokeOwned(requestUser, ids) {
    if (!Array.isArray(ids) || !ids.length || ids.length > 100 || ids.some(id => typeof id !== 'string')) fail(400, '공유 링크를 1~100개 선택해 주세요.');
    const unique = [...new Set(ids)];
    for (const id of unique) {
      const share = shareRepository.findById(id);
      if (!share || share.owner_id !== requestUser.id) fail(404, '공유 링크를 찾을 수 없습니다.');
    }
    withTransaction(() => shareRepository.revokeIds(unique));
    return { revoked: unique.length };
  }

  getActiveShare(requestUser, fileId, urlBuilder = null) {
    const file = this.getShareableFile(requestUser, fileId);
    const share = shareRepository.findActiveByFileId(file.id);
    return {
      file: serializeFile(file),
      share: serializeShare(share, share && urlBuilder ? urlBuilder(share.token) : "", { includePassword: true })
    };
  }

  createShare(req, fileId, mode, password, urlBuilder) {
    const requestUser = req.user;
    const file = this.getShareableFile(requestUser, fileId);
    const rows = fileRepository.loadActiveTree(file.id);
    if (!rows.length) fail(404, "File was not found.");
    accessPasswordService.assertFileTreeAccess(req, file, rows);
    const normalizedMode = this.normalizeMode(mode);
    const sharePassword = this.normalizeSharePassword(password);
    const now = Date.now();
    const shareId = crypto.randomUUID();
    const token = crypto.randomBytes(32).toString("base64url");
    const expiresAt = normalizedMode === "hour" ? now + ONE_HOUR_MS : null;

    const share = withTransaction(() => {
      shareRepository.revokeActiveForFile(file.id, now);
      return shareRepository.create({
        id: shareId,
        fileId: file.id,
        ownerId: file.owner_id,
        token,
        mode: normalizedMode,
        expiresAt,
        accessPasswordHash: sharePassword ? accessPasswordService.hash(sharePassword) : null,
        accessPasswordPlain: sharePassword || null,
        createdBy: requestUser.id,
        now
      });
    });

    return {
      file: serializeFile(file),
      share: serializeShare(share, urlBuilder(share.token), { includePassword: true })
    };
  }

  revokeShares(requestUser, fileId) {
    const file = this.getShareableFile(requestUser, fileId);
    const result = shareRepository.revokeActiveForFile(file.id);
    return {
      file: serializeFile(file),
      revoked: result.changes
    };
  }

  revokeSharesForFiles(files) {
    shareRepository.revokeActiveForFiles(files.map((file) => file.id));
  }

  getPublicShare(req, token, urlBuilder = null, parentId = null) {
    const { share, file } = this.getActiveShareAndFile(token);
    const passwordRequired = this.isPublicPasswordRequired(req, share, file);
    if (passwordRequired) {
      return {
        share: serializeShare(share, urlBuilder ? urlBuilder(share.token) : ""),
        file: serializeFile(file),
        folder: null,
        previewSupported: false,
        passwordRequired: true
      };
    }
    const folder = file.type === "folder" ? this.getPublicFolderInfo(file, parentId) : null;
    return {
      share: serializeShare(share, urlBuilder ? urlBuilder(share.token) : ""),
      file: serializeFile(file),
      folder,
      previewSupported: file.type === "file" && Boolean(previewPolicy.getPreviewMode(file)?.supported),
      passwordRequired: false
    };
  }

  unlockPublicShare(req, token, password) {
    const { share, file } = this.getActiveShareAndFile(token);
    if (share.access_password_hash) {
      accessPasswordService.unlockPublicSharePassword(req, share, password);
    } else {
      accessPasswordService.unlockPublicFile(req, token, file, password);
    }
    return {
      file: serializeFile(file),
      unlocked: true
    };
  }

  getPublicDownloadTarget(req, token) {
    const { share, file } = this.getActiveShareAndFile(token);
    this.assertPublicSharedItemAccess(req, share, file);
    return this.getDownloadTargetForItem(file, req, share);
  }

  getPublicSharedItemDownloadTarget(req, token, itemId) {
    const { share, file: root } = this.getActiveShareAndFile(token);
    if (root.type !== "folder") fail(404, "Shared folder was not found.");
    const item = this.getSharedTreeItem(root, itemId, share);
    this.assertPublicSharedItemAccess(req, share, item);
    return this.getDownloadTargetForItem(item, req, share);
  }

  async getPublicPreviewTarget(req, token) {
    const { share, file } = this.getActiveShareAndFile(token);
    this.assertPublicSharedItemAccess(req, share, file);
    const preview = previewPolicy.getPreviewMode(file);
    if (!preview?.supported) fail(415, "Preview is not supported for this file.");
    const absolutePath = fileStorage.getAbsoluteFilePath(file);

    if (preview.mode === 'archive') {
      return { file, json: await archivePreviewService.inspect(absolutePath, file.original_name), contentType: preview.contentType, disposition: preview.disposition };
    }
    if (preview.mode === "spreadsheet") {
      return {
        file,
        json: await documentPreviewWorkerService.extractSpreadsheetPreview(file, absolutePath),
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
        text: await documentPreviewWorkerService.extractText(file, absolutePath),
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

  getPublicPreviewStatus(req, token) {
    const { share, file } = this.getActiveShareAndFile(token);
    this.assertPublicSharedItemAccess(req, share, file);
    const preview = previewPolicy.getPreviewMode(file);
    if (!preview?.supported) fail(415, "Preview is not supported for this file.");

    if (preview.mode !== "document") {
      return {
        file: serializeFile(file),
        preview: { status: "ready", message: "미리보기가 준비되었습니다." }
      };
    }

    const absolutePath = fileStorage.getAbsoluteFilePath(file);
    return {
      file: serializeFile(file),
      preview: documentPreviewJobService.getStatus(file, absolutePath)
    };
  }

  getShareableFile(requestUser, fileId) {
    const file = fileRepository.findById(fileId);
    if (!file || file.deleted_at) fail(404, "File was not found.");
    if (requestUser.role !== "admin" && file.owner_id !== requestUser.id) {
      fail(403, "Access denied.");
    }
    return file;
  }

  getActiveShareAndFile(token) {
    const shareToken = String(token || "").trim();
    if (!shareToken) fail(404, "Share link was not found.");
    const share = shareRepository.findActiveByToken(shareToken);
    if (!share) fail(404, "Share link was not found or has expired.");

    const file = fileRepository.findById(share.file_id);
    if (!file || file.deleted_at) {
      fail(404, "Shared item was not found.");
    }
    this.assertShareProtectionVersion(share, fileRepository.loadActiveAncestors(file.id, file.owner_id));
    return { share, file };
  }

  getPublicFolderInfo(root, parentId = null) {
    const targetId = String(parentId || "").trim() || root.id;
    const rows = fileRepository.loadActiveAncestors(targetId, root.owner_id);
    const current = rows.find((row) => row.id === targetId && row.type === "folder");
    if (!current) fail(404, "Shared folder was not found.");

    const children = fileRepository.list(root.owner_id, current.id);
    const path = this.buildFolderPath(root, current, rows);
    return {
      current: serializeFile(current),
      path: path.map(serializeFile),
      files: children.map(serializeFile)
    };
  }

  getSharedTreeItem(root, itemId, share = null) {
    const requestedId = String(itemId || "").trim();
    if (!requestedId) fail(404, "Shared item was not found.");
    const rows = fileRepository.loadActiveAncestors(requestedId, root.owner_id);
    if (share) this.assertShareProtectionVersion(share, rows);
    const item = rows.find((row) => row.id === requestedId);
    if (!item || !rows.some(row => row.id === root.id)) fail(404, "Shared item was not found.");
    return item;
  }

  getDownloadTargetForItem(file, req, share) {
    if (file.type === "folder") {
      const rows = fileRepository.loadActiveTree(file.id);
      this.assertShareProtectionVersion(share, rows);
      for (const row of rows) this.assertPublicSharedItemAccess(req, share, row);
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

  buildFolderPath(root, current, rows) {
    const byId = new Map(rows.map((row) => [row.id, row]));
    const path = [];
    const visited = new Set();
    let cursor = current;

    while (cursor && !visited.has(cursor.id)) {
      visited.add(cursor.id);
      path.unshift(cursor);
      if (cursor.id === root.id) break;
      cursor = byId.get(cursor.parent_id);
    }

    if (!path.length || path[0].id !== root.id) fail(404, "Shared folder was not found.");
    return path;
  }

  normalizeMode(mode) {
    const value = String(mode || "").trim();
    if (value === "hour" || value === "permanent") return value;
    fail(400, "Share mode must be hour or permanent.");
  }

  normalizeSharePassword(password) {
    return String(password || "").trim();
  }

  assertShareProtectionVersion(share, rows) {
    if (rows.some(row => row.access_password_hash && Number(row.access_password_set_at) > Number(share.created_at))) {
      shareRepository.revokeActiveForFile(share.file_id);
      fail(404, '파일 잠금이 변경되어 이전 공유 링크가 해제되었습니다.');
    }
  }

  isPublicPasswordRequired(req, share, file) {
    if (share.access_password_hash) {
      return !accessPasswordService.isPublicUnlocked(req, share.token, share.id);
    }
    const protection = accessPasswordService.findFileProtection(file);
    return Boolean(protection && !accessPasswordService.isPublicUnlocked(req, share.token, protection.id));
  }

  assertPublicSharedItemAccess(req, share, item) {
    if (share.access_password_hash) {
      accessPasswordService.assertPublicSharePasswordAccess(req, share);
      return;
    }
    accessPasswordService.assertPublicFileAccess(req, share.token, item);
  }
}

function previewPdfName(file) {
  const name = String(file.original_name || "preview");
  return `${name.replace(/\.[^.]+$/, "")}.pdf`;
}

export const shareService = new ShareService();
