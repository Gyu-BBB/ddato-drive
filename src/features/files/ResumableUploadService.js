import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config } from "../../core/config.js";
import { fail } from "../../core/errors.js";
import { fileRepository } from "./FileRepository.js";
import { fileService } from "./FileService.js";
import { uploadSessionStore } from "./UploadSessionStore.js";
import { userRepository } from "../users/UserRepository.js";
import { recordProjectTempGrowth } from "../../core/storageUsage.js";
import { UploadTransferLimiter } from "./UploadTransferLimiter.js";
import { uploadCompletionRepository } from './UploadCompletionRepository.js';
import { uploadCancellationRepository } from './UploadCancellationRepository.js';
import { resolveUploadConflict } from './UploadConflictPolicy.js';
import { photoMetadataService, normalizeSourceDate } from './PhotoMetadataService.js';

const SESSION_ID_PATTERN = /^[a-f0-9-]{36}$/i;

export class ResumableUploadService {
  constructor() {
    this.chunkWrites = new Map();
    this.transferLimiter = new UploadTransferLimiter(10);
  }

  createSession(req, payload = {}) {
    const requestUser = req.user;
    const owner = fileService.resolveTargetOwner(requestUser, payload.ownerId);
    const parentId = fileService.normalizeParentId(payload.parentId);
    if (parentId) fileService.assertFolderAccess(req, owner.id, parentId);

    const sizeBytes = Number(payload.sizeBytes);
    if (payload.sizeBytes == null || !Number.isSafeInteger(sizeBytes) || sizeBytes < 0) fail(400, "Upload size must be a whole number of bytes.");
    if (sizeBytes > config.maxUploadBytes) {
      fail(413, "파일이 너무 큽니다.", {
        code: "upload_file_too_large",
        fileBytes: sizeBytes,
        maxBytes: config.maxUploadBytes
      });
    }

    const clientUploadId = String(payload.clientUploadId || '').trim();
    if (clientUploadId.length > 128) fail(400, 'Invalid client upload id.');
    if (uploadCancellationRepository.has(requestUser.id, clientUploadId)) fail(410, '이미 취소된 업로드입니다. 파일을 새로 선택해 주세요.');
    uploadSessionStore.cleanupStaleSessions();
    if (clientUploadId) {
      const completed = uploadCompletionRepository.findByClientId(requestUser.id, clientUploadId);
      const existing = completed?.metadata || uploadSessionStore.listSessions({ cleanup: true })
        .find(entry => entry.metadata.requestUserId === requestUser.id && entry.metadata.clientUploadId === clientUploadId)?.metadata;
      if (existing) {
        if (existing.ownerId !== owner.id || existing.parentId !== parentId || existing.sizeBytes !== sizeBytes || (existing.conflictPolicy || 'keep') !== (payload.conflictPolicy || 'keep') || existing.originalName !== (String(payload.name || 'upload').trim() || 'upload')) {
          fail(409, 'The upload id belongs to another file.');
        }
        return completed ? this.completedStatus(requestUser, completed) : this.serializeStatus(existing);
      }
    }
    uploadCompletionRepository.cleanup();
    uploadCancellationRepository.cleanup();
    const conflict = resolveUploadConflict(req, { ownerId: owner.id, parentId, name: payload.name, conflictPolicy: payload.conflictPolicy });
    if (conflict.skipped) return { skipped: true, originalName: payload.name };
    fileService.assertUserQuota(owner, sizeBytes);
    fileService.assertProjectQuota(sizeBytes + uploadSessionStore.getPendingRemainingBytes());

    const now = Date.now();
    const metadata = {
      ...conflict,
      sourceModifiedAt: normalizeSourceDate(payload.sourceModifiedAt),
      id: crypto.randomUUID(),
      clientUploadId,
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
    const id = this.normalizeSessionId(sessionId);
    const completed = uploadCompletionRepository.find(requestUser.id, id);
    return completed ? this.completedStatus(requestUser, completed) : this.serializeStatus(this.loadAuthorizedMetadata(requestUser, id));
  }

  async appendChunk(requestUser, sessionId, payload) {
    return this.withSessionLock(sessionId, id => this.transferLimiter.run(requestUser.id, () => this.writeChunk(requestUser, id, payload)));
  }

  async withSessionLock(sessionId, callback) {
    const id = this.normalizeSessionId(sessionId);
    const previous = this.chunkWrites.get(id) || Promise.resolve();
    const pending = previous.catch(() => {}).then(async () => {
      uploadSessionStore.activeSessionIds.add(id);
      try { return await callback(id); }
      finally { uploadSessionStore.activeSessionIds.delete(id); }
    });
    this.chunkWrites.set(id, pending);
    try {
      return await pending;
    } finally {
      if (this.chunkWrites.get(id) === pending) this.chunkWrites.delete(id);
    }
  }

  async writeChunk(requestUser, sessionId, { offset, buffer }) {
    const metadata = this.loadAuthorizedMetadata(requestUser, sessionId);
    if (!Buffer.isBuffer(buffer) || !buffer.length) fail(400, 'Upload chunk must contain binary data.');
    const chunk = buffer;
    const requestedOffset = Number(offset);
    if (offset == null || String(offset).trim() === '' || !Number.isSafeInteger(requestedOffset) || requestedOffset < 0) {
      fail(400, "Valid upload offset is required.");
    }

    const partialPath = this.partialPath(metadata);
    fs.mkdirSync(path.dirname(partialPath), { recursive: true });
    const uploadedBytes = this.uploadedBytes(metadata);

    if (requestedOffset < uploadedBytes) {
      if (requestedOffset + chunk.length <= uploadedBytes) {
        const handle = await fs.promises.open(partialPath, 'r');
        try {
          const stored = Buffer.alloc(chunk.length);
          let loaded = 0;
          while (loaded < stored.length) {
            const { bytesRead } = await handle.read(stored, loaded, stored.length - loaded, requestedOffset + loaded);
            if (!bytesRead) break;
            loaded += bytesRead;
          }
          if (loaded !== chunk.length || !stored.equals(chunk)) fail(409, 'Retried upload chunk does not match stored bytes.');
        } finally { await handle.close(); }
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
    // Reserve growth before yielding so concurrent sessions cannot reuse capacity.
    recordProjectTempGrowth(chunk.length);
    if (chunk.length) await fs.promises.appendFile(partialPath, chunk);
    metadata.updatedAt = Date.now();
    this.writeMetadata(metadata);
    return this.serializeStatus(metadata);
  }

  async completeSession(req, sessionId) {
    return this.withSessionLock(sessionId, id => this.finishSession(req, id));
  }

  async finishSession(req, sessionId) {
    const requestUser = req.user;
    const completed = uploadCompletionRepository.find(requestUser.id, sessionId);
    if (completed) {
      this.completedStatus(requestUser, completed);
      const file = fileService.getAccessibleFile(requestUser, completed.fileId);
      return fileService.serializeFileForRequest(req, file);
    }
    const metadata = this.loadAuthorizedMetadata(requestUser, sessionId);
    const partialPath = this.partialPath(metadata);
    if (metadata.sizeBytes === 0 && !fs.existsSync(partialPath)) {
      fs.closeSync(fs.openSync(partialPath, "a"));
    }

    const uploadedBytes = this.uploadedBytes(metadata);
    if (uploadedBytes !== metadata.sizeBytes) {
      fail(409, "Upload is not complete.", this.serializeStatus(metadata));
    }

    const photoMetadata = await photoMetadataService.inspect(partialPath, { name: metadata.originalName, mimeType: metadata.mimeType, sizeBytes: metadata.sizeBytes });
    const record = fileService.createFileFromUpload(req, {
      photoMetadata: { ...photoMetadata, sourceModifiedAt: metadata.sourceModifiedAt },
      ownerId: metadata.ownerId,
      parentId: metadata.parentId,
      tempPath: partialPath,
      originalName: metadata.originalName,
      mimeType: metadata.mimeType,
      sizeBytes: metadata.sizeBytes,
      uploadSessionId: metadata.id,
      uploadSessionMetadata: metadata,
      conflictPolicy: metadata.conflictPolicy,
      replaceTargetId: metadata.replaceTargetId,
      replaceTargetVersion: metadata.replaceTargetVersion
    });

    fs.rmSync(this.sessionDir(metadata), { recursive: true, force: true });
    uploadSessionStore.invalidate();
    return record;
  }

  async cancelSession(requestUser, sessionId) {
    return this.withSessionLock(sessionId, id => this.removeSession(requestUser, id));
  }

  removeSession(requestUser, sessionId) {
    const completed = uploadCompletionRepository.find(requestUser.id, sessionId);
    if (completed) return { canceled: false, completed: true, fileId: completed.fileId };
    const metadata = this.loadAuthorizedMetadata(requestUser, sessionId);
    uploadCancellationRepository.record(requestUser.id, metadata.clientUploadId);
    fs.rmSync(this.sessionDir(metadata), { recursive: true, force: true });
    uploadSessionStore.invalidate();
    return { canceled: true };
  }

  async cancelByClientId(requestUser, value) {
    const clientId = String(value || '').trim();
    if (!clientId || clientId.length > 128) fail(400, 'Invalid client upload id.');
    const completed = uploadCompletionRepository.findByClientId(requestUser.id, clientId);
    if (completed) return { canceled: false, completed: true, fileId: completed.fileId };
    uploadCancellationRepository.record(requestUser.id, clientId);
    const session = uploadSessionStore.listSessions({ cleanup: true })
      .find(entry => entry.metadata.requestUserId === requestUser.id && entry.metadata.clientUploadId === clientId);
    if (session) {
      try { return await this.cancelSession(requestUser, session.metadata.id); }
      catch (error) { if (error.statusCode !== 404) throw error; }
    }
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
    if (Date.now() - Number(metadata.updatedAt || metadata.createdAt || 0) > config.uploadSessionTtlMs) fail(404, 'Upload session has expired.');
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
      chunkSizeBytes: config.maxUploadChunkBytes,
      complete: uploadedBytes === metadata.sizeBytes
    };
  }

  completedStatus(requestUser, completion) {
    fileService.resolveTargetOwner(requestUser, completion.metadata.ownerId);
    const file = completion.fileId && fileRepository.findById(completion.fileId);
    if (!file || file.deleted_at != null) fail(410, '이미 업로드된 파일이 삭제되었습니다. 다시 업로드하려면 파일을 새로 선택하세요.');
    return { ...this.serializeStatus(completion.metadata), uploadedBytes: completion.metadata.sizeBytes, progress: 100,
      complete: true, finalized: true, fileId: file.id };
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
      }),
      { maxAgeMs: 1000 }
    );
  }

  writeMetadata(metadata) {
    const metadataPath = this.metadataPath(metadata);
    const oldSize = fs.existsSync(metadataPath) ? fs.statSync(metadataPath).size : 0;
    const contents = JSON.stringify(metadata);
    const pendingPath = `${metadataPath}.tmp`;
    try {
      fs.writeFileSync(pendingPath, contents);
      fs.renameSync(pendingPath, metadataPath);
    } finally { fs.rmSync(pendingPath, { force: true }); }
    recordProjectTempGrowth(Math.max(0, Buffer.byteLength(contents) - oldSize));
    uploadSessionStore.updateMetadata(metadata);
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
