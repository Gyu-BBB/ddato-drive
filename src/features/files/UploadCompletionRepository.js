import { getDb } from '../../database/database.js';

export class UploadCompletionRepository {
  find(userId, sessionId) {
    return this.deserialize(getDb().prepare('SELECT * FROM upload_completions WHERE request_user_id = ? AND session_id = ?').get(userId, sessionId));
  }

  findByClientId(userId, clientId) {
    if (!clientId) return null;
    return this.deserialize(getDb().prepare('SELECT * FROM upload_completions WHERE request_user_id = ? AND client_upload_id = ?').get(userId, clientId));
  }

  record(metadata, fileId) {
    getDb().prepare(`INSERT INTO upload_completions
      (session_id, request_user_id, client_upload_id, file_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(metadata.id, metadata.requestUserId, metadata.clientUploadId || null, fileId, JSON.stringify(metadata), Date.now());
  }

  cleanup() {
    getDb().prepare('DELETE FROM upload_completions WHERE created_at < ?').run(Date.now() - 30 * 24 * 60 * 60 * 1000);
  }

  deserialize(row) {
    return row ? { fileId: row.file_id, metadata: JSON.parse(row.metadata_json) } : null;
  }
}

export const uploadCompletionRepository = new UploadCompletionRepository();
