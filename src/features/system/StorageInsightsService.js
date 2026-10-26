import { getDb } from '../../database/database.js';
import { fileService } from '../files/FileService.js';
import { uploadSessionStore } from '../files/UploadSessionStore.js';
import { multipartReservationStore } from '../files/MultipartReservationStore.js';

export class StorageInsightsService {
  get(req) {
    const db = getDb();
    const owner = fileService.resolveTargetOwner(req.user, '');
    const totals = db.prepare(`SELECT COUNT(*) AS files, COALESCE(SUM(size_bytes), 0) AS usedBytes,
      COALESCE(SUM(CASE WHEN deleted_at IS NULL THEN size_bytes ELSE 0 END), 0) AS activeBytes,
      COALESCE(SUM(CASE WHEN deleted_at IS NOT NULL THEN size_bytes ELSE 0 END), 0) AS trashBytes
      FROM files WHERE owner_id = ? AND type = 'file'`).get(owner.id);
    const kinds = db.prepare(`SELECT CASE
      WHEN mime_type LIKE 'image/%' THEN 'image' WHEN mime_type LIKE 'video/%' THEN 'video'
      WHEN mime_type LIKE 'audio/%' THEN 'audio'
      WHEN lower(original_name) GLOB '*.zip' OR lower(original_name) GLOB '*.7z' OR lower(original_name) GLOB '*.rar'
        OR lower(original_name) GLOB '*.tar' OR lower(original_name) GLOB '*.gz' OR lower(original_name) GLOB '*.xz' THEN 'archive'
      WHEN mime_type LIKE 'text/%' OR mime_type = 'application/pdf' OR mime_type LIKE '%officedocument%' OR mime_type LIKE '%msword%' OR mime_type LIKE '%opendocument%' THEN 'document'
      ELSE 'other' END AS kind, COUNT(*) AS count, SUM(size_bytes) AS bytes
      FROM files WHERE owner_id = ? AND type = 'file' AND deleted_at IS NULL GROUP BY kind ORDER BY bytes DESC`).all(owner.id);
    const largestRows = db.prepare("SELECT * FROM files WHERE owner_id = ? AND type = 'file' AND deleted_at IS NULL ORDER BY size_bytes DESC, id LIMIT 30").all(owner.id);
    const pendingBytes = uploadSessionStore.getPendingBytes({ ownerId: owner.id }) + multipartReservationStore.pendingBytes({ ownerId: owner.id });
    const users = req.user.role === 'admin' ? db.prepare(`SELECT u.id, u.quota_bytes AS quotaBytes,
      COALESCE(SUM(f.size_bytes), 0) AS usedBytes,
      COALESCE(SUM(CASE WHEN f.deleted_at IS NOT NULL THEN f.size_bytes ELSE 0 END), 0) AS trashBytes
      FROM users u LEFT JOIN files f ON f.owner_id = u.id AND f.type = 'file'
      GROUP BY u.id ORDER BY usedBytes DESC, u.id`).all() : undefined;
    return { ...totals, quotaBytes: owner.quota_bytes, pendingBytes, freeBytes: owner.quota_bytes == null ? null : Math.max(0, owner.quota_bytes - totals.usedBytes - pendingBytes),
      kinds, largest: fileService.serializeFilesForRequest(req, owner.id, largestRows), ...(users ? { users } : {}) };
  }
}
export const storageInsightsService = new StorageInsightsService();
