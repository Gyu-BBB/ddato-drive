import { getDb } from '../../database/database.js';

export const uploadCancellationRepository = {
  has(userId, clientId) {
    return Boolean(clientId && getDb().prepare('SELECT 1 FROM upload_cancellations WHERE request_user_id = ? AND client_upload_id = ?').get(userId, clientId));
  },
  record(userId, clientId) {
    if (!clientId) return;
    getDb().prepare('INSERT OR IGNORE INTO upload_cancellations (request_user_id, client_upload_id, created_at) VALUES (?, ?, ?)').run(userId, clientId, Date.now());
  },
  cleanup() {
    getDb().prepare('DELETE FROM upload_cancellations WHERE created_at < ?').run(Date.now() - 30 * 24 * 60 * 60 * 1000);
  }
};
