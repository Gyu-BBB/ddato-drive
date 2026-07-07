import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config } from "../../core/config.js";
import { fail } from "../../core/errors.js";
import { fileRepository } from "./FileRepository.js";
import { fileService } from "./FileService.js";
import { uploadSessionStore } from "./UploadSessionStore.js";
import { userRepository } from "../users/UserRepository.js";

const SESSION_ID_PATTERN = /^[a-f0-9-]{36}$/i;

export class ResumableUploadService {
  createSession(req, payload = {}) {
    const requestUser = req.user;
    const owner = fileService.resolveTargetOwner(requestUser, payload.ownerId);
    const parentId = fileService.normalizeParentId(payload.parentId);
    if (parentId) fileService.assertFolderAccess(req, owner.id, parentId);

    const sizeBytes = Number(payload.sizeBytes);
    if (!Number.isFinite(sizeBytes) || sizeBytes < 0) fail(400, "Upload size is required.");
    if (sizeBytes > config.maxUploadBytes) {
      fail(413, "파일이 너무 큽니다.", {
        code: "upload_file_too_large",
        fileBytes: sizeBytes,
        maxBytes: config.maxUploadBytes
      });
    }

    uploadSessionStore.cleanupStaleSessions();
    fileService.assertUserQuota(owner, sizeBytes);
    fileService.assertProjectQuota(sizeBytes + uploadSessionStore.getPendingRemainingBytes());

    const now = Date.now();
    const metadata = {
      id: crypto.randomUUID(),
      requestUserId: requestUser.id,
      ownerId: owner.id,
      parentId,
      originalName: String(payload.name || "upload").trim() || "upload",
      mimeType: String(payload.mimeType || "application/octet-stream").trim() || "application/octet-stream",
      sizeBytes,
      createdAt: now,
      updatedAt: now
    };

    fs.mkdirSync(this.sessionDir(metadata), { recursive: true });
    this.writeMetadata(metadata);
    if (sizeBytes === 0) fs.closeSync(fs.openSync(this.partialPath(metadata), "a"));
    return this.serializeStatus(metadata);
  }

  getStatus(requestUser, sessionId) {
    return this.serializeStatus(this.loadAuthorizedMetadata(requestUser, sessionId));
  }

  appendChunk(requestUser, sessionId, { offset, buffer }) {
    const metadata = this.loadAuthorizedMetadata(requestUser, sessionId);
    const chunk = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || "");
    const requestedOffset = Number(offset);
    if (!Number.isSafeInteger(requestedOffset) || requestedOffset < 0) {
      fail(400, "Valid upload offset is required.");
    }

    const partialPath = this.partialPath(metadata);
    fs.mkdirSync(path.dirname(partialPath), { recursive: true });
    const uploadedBytes = this.uploadedBytes(metadata);

    if (requestedOffset < uploadedBytes) {
      if (requestedOffset + chunk.length <= uploadedBytes) {
        return this.serializeStatus(metadata);
      }
      fail(409, "Upload offset is behind the stored file.", this.serializeStatus(metadata));
    }

    if (requestedOffset !== uploadedBytes) {
      fail(409, "Upload offset does not match the stored file.", this.serializeStatus(metadata));
    }

    if (uploadedBytes + chunk.length > metadata.sizeBytes) {
      fail(400, "Upload chunk exceeds the expected file size.");
    }

    this.assertSessionQuota(metadata, chunk.length);
    if (chunk.length) fs.appendFileSync(partialPath, chunk);
    metadata.updatedAt = Date.now();
    this.writeMetadata(metadata);
    return this.serializeStatus(metadata);
  }

  completeSession(req, sessionId) {
    const requestUser = req.user;
    const metadata = this.loadAuthorizedMetadata(requestUser, sessionId);
    const partialPath = this.partialPath(metadata);
    if (metadata.sizeBytes === 0 && !fs.existsSync(partialPath)) {
      fs.closeSync(fs.openSync(partialPath, "a"));
    }

    const uploadedBytes = this.uploadedBytes(metadata);
    if (uploadedBytes !== metadata.sizeBytes) {
      fail(409, "Upload is not complete.", this.serializeStatus(metadata));
    }

    const record = fileService.createFileFromUpload(req, {
      ownerId: metadata.ownerId,
      parentId: metadata.parentId,
      tempPath: partialPath,
      originalName: metadata.originalName,
      mimeType: metadata.mimeType,
      sizeBytes: metadata.sizeBytes,
      uploadSessionId: metadata.id
    });

    fs.rmSync(this.sessionDir(metadata), { recursive: true, force: true });
    return record;
  }

  cancelSession(requestUser, sessionId) {
    const metadata = this.loadAuthorizedMetadata(requestUser, sessionId);
    fs.rmSync(this.sessionDir(metadata), { recursive: true, force: true });
    return { canceled: true };
  }

  loadAuthorizedMetadata(requestUser, sessionId) {
    const id = this.normalizeSessionId(sessionId);
    const metadataPath = this.metadataPath({ requestUserId: requestUser.id, id });
    if (!fs.existsSync(metadataPath)) fail(404, "Upload session was not found.");

    const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
    if (metadata.requestUserId !== requestUser.id || metadata.id !== id) {
      fail(403, "Access denied.");
    }
    return metadata;
  }

  serializeStatus(metadata) {
    const uploadedBytes = this.uploadedBytes(metadata);
    return {
      id: metadata.id,
      ownerId: metadata.ownerId,
      parentId: metadata.parentId,
      name: metadata.originalName,
      mimeType: metadata.mimeType,
      sizeBytes: metadata.sizeBytes,
      uploadedBytes,
      progress: metadata.sizeBytes ? Math.round((uploadedBytes / metadata.sizeBytes) * 100) : 100,
      complete: uploadedBytes === metadata.sizeBytes
    };
  }

  uploadedBytes(metadata) {
    try {
      return fs.statSync(this.partialPath(metadata)).size;
    } catch {
      return 0;
    }
  }

  assertSessionQuota(metadata, chunkBytes = 0) {
    const owner = userRepository.findById(metadata.ownerId);
    if (!owner) fail(404, "Target user was not found.");
    fileService.assertUserQuota(owner, 0);
    fileService.assertProjectQuota(
      chunkBytes + uploadSessionStore.getPendingRemainingBytes({
        excludeSessionId: metadata.id
      })
    );
  }

  writeMetadata(metadata) {
    fs.writeFileSync(this.metadataPath(metadata), JSON.stringify(metadata, null, 2));
  }

  metadataPath(metadata) {
    return path.join(this.sessionDir(metadata), "metadata.json");
  }

  partialPath(metadata) {
    return path.join(this.sessionDir(metadata), "upload.bin");
  }

  sessionDir(metadata) {
    return path.join(config.tempDir, "upload-sessions", this.userKey(metadata.requestUserId), metadata.id);
  }

  userKey(userId) {
    return crypto.createHash("sha256").update(String(userId)).digest("hex").slice(0, 24);
  }

  normalizeSessionId(value) {
    const id = String(value || "").trim();
    if (!SESSION_ID_PATTERN.test(id)) fail(400, "Invalid upload session id.");
    return id;
  }
}

export const resumableUploadService = new ResumableUploadService();
