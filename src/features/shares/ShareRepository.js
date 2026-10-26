import { getDb } from "../../database/database.js";

export class ShareRepository {
  listOwned(ownerId, { state = 'all', page = 0 } = {}) {
    const filters = { all: '1 = 1', active: 's.revoked_at IS NULL AND (s.expires_at IS NULL OR s.expires_at > @now)', expired: 's.revoked_at IS NULL AND s.expires_at <= @now', revoked: 's.revoked_at IS NOT NULL' };
    const where = `s.owner_id = @owner AND ${filters[state] || filters.all}`;
    const params = { owner: ownerId };
    if (state === 'active' || state === 'expired') params.now = Date.now();
    const total = getDb().prepare(`SELECT COUNT(*) AS count FROM file_shares s WHERE ${where}`).get(params).count;
    const rows = getDb().prepare(`SELECT s.*, f.original_name AS file_name, f.parent_id, f.type AS file_type
      FROM file_shares s JOIN files f ON f.id = s.file_id WHERE ${where}
      ORDER BY s.created_at DESC, s.id LIMIT 100 OFFSET @offset`).all({ ...params, offset: page * 100 });
    return { rows, total };
  }

  revokeIds(ids, now = Date.now()) {
    const statement = getDb().prepare('UPDATE file_shares SET revoked_at = ?, updated_at = ? WHERE id = ? AND revoked_at IS NULL');
    for (const id of ids) statement.run(now, now, id);
  }
  create({ id, fileId, ownerId, token, mode, expiresAt, accessPasswordHash = null, accessPasswordPlain = null, createdBy, now = Date.now() }) {
    const accessPasswordSetAt = accessPasswordHash ? now : null;
    getDb().prepare(`
      INSERT INTO file_shares (
        id, file_id, owner_id, token, mode, expires_at, access_password_hash,
        access_password_plain, access_password_set_at, revoked_at, created_by,
        created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
    `).run(id, fileId, ownerId, token, mode, expiresAt, accessPasswordHash, accessPasswordPlain, accessPasswordSetAt, createdBy, now, now);
    return this.findById(id);
  }

  findById(id) {
    return getDb().prepare("SELECT * FROM file_shares WHERE id = ?").get(id);
  }

  findActiveByFileId(fileId, now = Date.now()) {
    return getDb().prepare(`
      SELECT *
      FROM file_shares
      WHERE file_id = ?
        AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > ?)
      ORDER BY created_at DESC
      LIMIT 1
    `).get(fileId, now);
  }

  findActiveByToken(token, now = Date.now()) {
    return getDb().prepare(`
      SELECT *
      FROM file_shares
      WHERE token = ?
        AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > ?)
      LIMIT 1
    `).get(token, now);
  }

  revokeActiveForFile(fileId, now = Date.now()) {
    return getDb().prepare(`
      UPDATE file_shares
      SET revoked_at = ?, updated_at = ?
      WHERE file_id = ? AND revoked_at IS NULL
    `).run(now, now, fileId);
  }

  revokeActiveForFiles(fileIds, now = Date.now()) {
    if (!fileIds.length) return;
    const statement = getDb().prepare(`
      UPDATE file_shares
      SET revoked_at = ?, updated_at = ?
      WHERE file_id = ? AND revoked_at IS NULL
    `);
    for (const fileId of fileIds) {
      statement.run(now, now, fileId);
    }
  }
}

export const shareRepository = new ShareRepository();
