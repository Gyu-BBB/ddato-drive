import express from "express";
import fs from "node:fs";
import multer from "multer";
import { config } from "../../core/config.js";
import { asyncRoute, contentDisposition, jsonError, sendFileStream } from "../../core/http.js";
import { getProjectStorageUsage } from "../../core/storageUsage.js";
import { auditLogger } from "../audit/AuditLogger.js";
import { requireUser } from "../auth/auth.middleware.js";
import { fileService } from "./FileService.js";
import { resumableUploadService } from "./ResumableUploadService.js";
import { zipArchiveService } from "./ZipArchiveService.js";

const upload = multer({
  dest: config.tempDir,
  limits: {
    files: 1,
    fileSize: config.maxUploadBytes
  }
});
const uploadChunk = express.raw({
  type: "application/octet-stream",
  limit: config.maxUploadChunkBytes
});

export const filesRouter = express.Router();

filesRouter.get("/files", requireUser, asyncRoute((req, res) => {
  res.json({
    ok: true,
    ...fileService.listFiles(req, {
      ownerId: req.query.ownerId,
      parentId: req.query.parentId,
      search: req.query.search
    })
  });
}));

filesRouter.get("/files/media", requireUser, asyncRoute((req, res) => {
  res.json({
    ok: true,
    ...fileService.listMediaFiles(req, {
      ownerId: req.query.ownerId,
      search: req.query.search,
      kind: req.query.kind
    })
  });
}));

filesRouter.post("/folders", requireUser, asyncRoute((req, res) => {
  const folder = fileService.createFolder(req, {
    ownerId: req.body?.ownerId,
    parentId: req.body?.parentId,
    name: req.body?.name
  });
  auditLogger.record("folder.create", req, folder.id, folder);
  res.status(201).json({ ok: true, file: folder });
}));

filesRouter.get("/trash", requireUser, asyncRoute((req, res) => {
  res.json({
    ok: true,
    ...fileService.listTrash(req, {
      ownerId: req.query.ownerId
    })
  });
}));

filesRouter.post("/files/upload", requireUser, rejectRequestOverProjectCapacity, upload.single("file"), asyncRoute((req, res) => {
  const file = req.file;
  if (!file) {
    jsonError(res, 400, "Upload file is required.");
    return;
  }

  try {
    const record = fileService.createFileFromUpload(req, {
      ownerId: req.body?.ownerId,
      parentId: req.body?.parentId,
      tempPath: file.path,
      originalName: req.body?.name || file.originalname,
      mimeType: file.mimetype,
      sizeBytes: file.size
    });
    auditLogger.record("file.upload", req, record.id, record);
    res.status(201).json({ ok: true, file: record });
  } catch (error) {
    fs.rmSync(file.path, { force: true });
    throw error;
  }
}));

filesRouter.post("/files/upload-sessions", requireUser, asyncRoute((req, res) => {
  const session = resumableUploadService.createSession(req, req.body);
  auditLogger.record("file.upload_session.create", req, session.id, session);
  res.status(201).json({ ok: true, session });
}));

filesRouter.get("/files/upload-sessions/:sessionId", requireUser, asyncRoute((req, res) => {
  const session = resumableUploadService.getStatus(req.user, req.params.sessionId);
  res.json({ ok: true, session });
}));

filesRouter.post("/files/upload-sessions/:sessionId/chunk", requireUser, uploadChunk, asyncRoute(async (req, res) => {
  const session = await resumableUploadService.appendChunk(req.user, req.params.sessionId, {
    offset: req.header("x-upload-offset"),
    buffer: req.body
  });
  res.json({ ok: true, session });
}));

filesRouter.post("/files/upload-sessions/:sessionId/complete", requireUser, asyncRoute(async (req, res) => {
  const record = await resumableUploadService.completeSession(req, req.params.sessionId);
  auditLogger.record("file.upload", req, record.id, record);
  res.status(201).json({ ok: true, file: record });
}));

filesRouter.delete("/files/upload-sessions/:sessionId", requireUser, asyncRoute(async (req, res) => {
  const result = await resumableUploadService.cancelSession(req.user, req.params.sessionId);
  auditLogger.record("file.upload_session.cancel", req, req.params.sessionId, result);
  res.json({ ok: true, ...result });
}));

filesRouter.post("/files/download", requireUser, asyncRoute(async (req, res) => {
  const target = fileService.getSelectionDownloadStreamTarget(req, req.body?.ids);
  auditLogger.record("file.download.selection", req, null, {
    rootIds: target.rootIds,
    count: target.rootIds.length
  });
  await sendZipStream(res, target);
}));

filesRouter.get("/files/:id", requireUser, asyncRoute((req, res) => {
  const file = fileService.getAccessibleFile(req.user, req.params.id);
  res.json({ ok: true, file: fileService.serializeFileForRequest(req, file) });
}));

filesRouter.get("/files/:id/preview-status", requireUser, asyncRoute((req, res) => {
  res.json({ ok: true, ...fileService.getPreviewStatus(req, req.params.id) });
}));

filesRouter.put("/files/:id/password", requireUser, asyncRoute((req, res) => {
  const file = fileService.setAccessPassword(req, req.params.id, req.body?.password);
  auditLogger.record("file.password.set", req, file.id);
  res.json({ ok: true, file });
}));

filesRouter.delete("/files/:id/password", requireUser, asyncRoute((req, res) => {
  const file = fileService.clearAccessPassword(req, req.params.id, req.body?.password);
  auditLogger.record("file.password.clear", req, file.id);
  res.json({ ok: true, file });
}));

filesRouter.post("/files/:id/unlock", requireUser, asyncRoute((req, res) => {
  const file = fileService.unlockAccessPassword(req, req.params.id, req.body?.password);
  auditLogger.record("file.password.unlock", req, file.id);
  res.json({ ok: true, file });
}));

filesRouter.patch("/files/:id/rename", requireUser, asyncRoute((req, res) => {
  const file = fileService.renameFile(req, req.params.id, req.body?.name);
  auditLogger.record("file.rename", req, file.id, file);
  res.json({ ok: true, file });
}));

filesRouter.patch("/files/:id/move", requireUser, asyncRoute((req, res) => {
  const file = fileService.moveFile(req, req.params.id, {
    parentId: req.body?.parentId
  });
  auditLogger.record("file.move", req, file.id, { parentId: file.parentId, path: file.path });
  res.json({ ok: true, file });
}));

filesRouter.patch("/folders/:id/color", requireUser, asyncRoute((req, res) => {
  const file = fileService.changeFolderColor(req, req.params.id, req.body?.color);
  auditLogger.record("folder.color", req, file.id, { color: file.folderColor });
  res.json({ ok: true, file });
}));

filesRouter.post("/files/:id/duplicate", requireUser, asyncRoute((req, res) => {
  const result = fileService.duplicateFileTree(req, req.params.id);
  auditLogger.record("file.duplicate", req, result.root.id, {
    sourceId: req.params.id,
    copied: result.copied,
    bytesCopied: result.bytesCopied
  });
  res.status(201).json({ ok: true, ...result });
}));

filesRouter.delete("/files/:id", requireUser, asyncRoute((req, res) => {
  const result = fileService.deleteFileTree(req, req.params.id);
  auditLogger.record("file.delete", req, req.params.id, result);
  res.json({ ok: true, ...result });
}));

filesRouter.post("/trash/:id/restore", requireUser, asyncRoute((req, res) => {
  const result = fileService.restoreFileTree(req.user, req.params.id);
  auditLogger.record("trash.restore", req, req.params.id, result);
  res.json({ ok: true, ...result });
}));

filesRouter.delete("/trash/:id", requireUser, asyncRoute((req, res) => {
  const result = fileService.purgeFileTree(req.user, req.params.id);
  auditLogger.record("trash.purge", req, req.params.id, result);
  res.json({ ok: true, ...result });
}));

filesRouter.get("/files/:id/download", requireUser, asyncRoute(async (req, res) => {
  const target = fileService.getDownloadStreamTarget(req, req.params.id);
  if (target.zipRows) {
    await sendZipStream(res, target);
    return;
  }

  sendFileStream(req, res, target.absolutePath, {
    fs,
    fileName: target.fileName || target.file.original_name,
    contentType: target.contentType,
    disposition: target.disposition
  });
}));

filesRouter.get("/files/:id/preview", requireUser, asyncRoute(async (req, res) => {
  const target = await fileService.getPreviewStreamTarget(req, req.params.id);
  if (target.pending) {
    res.status(202).json({ ok: true, preview: target.preview });
    return;
  }
  if (target.text != null) {
    sendTextPreview(res, target);
    return;
  }
  if (target.json != null) {
    sendJsonPreview(res, target);
    return;
  }
  sendFileStream(req, res, target.absolutePath, {
    fs,
    fileName: target.fileName || target.file.original_name,
    contentType: target.contentType,
    disposition: target.disposition
  });
}));

async function sendZipStream(res, target, cacheControl = "private, no-store") {
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", contentDisposition(target.disposition || "attachment", target.fileName || `${target.file.original_name}.zip`));
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", cacheControl);
  if (target.rootIds) {
    await zipArchiveService.streamSelectionZip(target.zipRows, target.rootIds, res);
    return;
  }
  await zipArchiveService.streamFolderZip(target.file, target.zipRows, res);
}

function sendTextPreview(res, target, cacheControl = "private, no-store") {
  const body = String(target.text || "");
  res.setHeader("Content-Type", target.contentType || "text/plain; charset=utf-8");
  res.setHeader("Content-Disposition", contentDisposition(target.disposition || "inline", target.fileName || target.file.original_name));
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", cacheControl);
  res.setHeader("Content-Length", Buffer.byteLength(body, "utf8"));
  res.end(body);
}

function sendJsonPreview(res, target, cacheControl = "private, no-store") {
  const body = JSON.stringify(target.json || {});
  res.setHeader("Content-Type", target.contentType || "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", contentDisposition(target.disposition || "inline", target.fileName || target.file.original_name));
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", cacheControl);
  res.setHeader("Content-Length", Buffer.byteLength(body, "utf8"));
  res.end(body);
}

function rejectRequestOverProjectCapacity(req, res, next) {
  const contentLength = Number(req.headers["content-length"] || 0);
  if (!Number.isFinite(contentLength) || contentLength <= 0) {
    next();
    return;
  }

  const storage = getProjectStorageUsage();
  const availableBytes = Math.max(0, config.projectDiskQuotaBytes - Number(storage.usedBytes || 0));
  if (contentLength > availableBytes) {
    jsonError(res, 413, "프로젝트 저장 공간이 부족합니다.", {
      details: {
        code: "project_quota_exceeded",
        usageBytes: storage.usedBytes,
        quotaBytes: config.projectDiskQuotaBytes,
        availableBytes,
        fileBytes: contentLength
      }
    });
    return;
  }

  next();
}
