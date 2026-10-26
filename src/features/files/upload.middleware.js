import multer from 'multer';
import { config } from '../../core/config.js';
import { getProjectStorageUsage } from '../../core/storageUsage.js';
import { UploadTransferLimiter } from './UploadTransferLimiter.js';
import { fileRepository } from './FileRepository.js';
import { uploadSessionStore } from './UploadSessionStore.js';
import { multipartReservationStore } from './MultipartReservationStore.js';
import crypto from 'node:crypto';
import path from 'node:path';

const requests = new UploadTransferLimiter(10);

export function limitUploadRequests(req, res, next) {
  // Acquire before body parsing so queued requests cannot accumulate chunk buffers.
  void requests.run(req.user.id, () => new Promise(resolve => {
    if (req.aborted || res.destroyed) { resolve(); return; }
    const done = () => { res.off('finish', done); res.off('close', disconnected); resolve(); };
    const disconnected = () => { if (!req.uploadWorkActive) done(); };
    req.releaseUploadSlot = done;
    res.once('finish', done); res.once('close', disconnected);
    next();
  })).catch(next);
}

export function parseMultipartUpload(req, res, next) {
  try {
    const pendingProjectBytes = uploadSessionStore.getPendingRemainingBytes() + multipartReservationStore.remainingBytes();
    const storage = getProjectStorageUsage();
    const projectRemaining = Math.max(0, config.projectDiskQuotaBytes - storage.usedBytes - pendingProjectBytes);
    const usage = fileRepository.getUsageBytes(req.user.id);
    const pending = uploadSessionStore.getPendingBytes({ ownerId: req.user.id }) + multipartReservationStore.pendingBytes({ ownerId: req.user.id });
    const userRemaining = req.user.role === 'admin' || req.user.quota_bytes == null ? Infinity : Math.max(0, req.user.quota_bytes - usage - pending);
    const maxBytes = Math.min(config.maxUploadBytes, projectRemaining, userRemaining);
    const length = Number(req.headers['content-length']);
    multipartReservationStore.reserve(req, Number.isSafeInteger(length) && length >= 0 ? Math.min(length, maxBytes) : maxBytes);
    const release = () => { multipartReservationStore.release(req); res.off('finish', release); res.off('close', release); };
    res.once('finish', release); res.once('close', release);
    const storageEngine = multer.diskStorage({ destination: config.tempDir, filename: (_req, _file, callback) => {
      const name = crypto.randomBytes(16).toString('hex');
      multipartReservationStore.setPath(req, path.join(config.tempDir, name));
      callback(null, name);
    } });
    multer({ storage: storageEngine, limits: { files: 1, fields: 8, fileSize: Math.max(1, maxBytes) } }).single('file')(req, res, error => {
      if (error?.code === 'LIMIT_FILE_SIZE' && maxBytes < config.maxUploadBytes) {
        error.statusCode = 413;
        error.message = userRemaining <= projectRemaining ? '저장 공간이 부족합니다.' : '프로젝트 저장 공간이 부족합니다.';
        error.details = userRemaining <= projectRemaining
          ? { code: 'user_quota_exceeded', usageBytes: usage, pendingBytes: pending, quotaBytes: req.user.quota_bytes, remainingBytes: userRemaining }
          : { code: 'project_quota_exceeded', usageBytes: storage.usedBytes, quotaBytes: config.projectDiskQuotaBytes, availableBytes: projectRemaining };
      }
      if (error) release();
      next(error);
    });
  } catch (error) { next(error); }
}
