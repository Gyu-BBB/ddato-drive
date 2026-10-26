import { config } from "../../core/config.js";
import { getDb } from "../../database/database.js";

export class FileRepository {
  setSourceMetadata(id, { sourceModifiedAt = null, capturedAt = null, contentSha256 = null } = {}) {
    getDb().prepare('UPDATE files SET source_modified_at = ?, captured_at = ?, content_sha256 = ? WHERE id = ?').run(sourceModifiedAt, capturedAt, contentSha256, id);
    return this.findById(id);
  }

  photoCounts(ownerId) {
    return new Map(getDb().prepare("SELECT content_sha256 AS hash, COUNT(*) AS count FROM files WHERE owner_id = ? AND content_sha256 IS NOT NULL AND deleted_at IS NULL GROUP BY content_sha256").all(ownerId).map(row => [row.hash, row.count]));
  }
  findByName(ownerId, parentId, name) {
    return getDb().prepare("SELECT * FROM files WHERE owner_id = ? AND parent_id IS ? AND lower(original_name) = lower(?) AND deleted_at IS NULL LIMIT 1").get(ownerId, parentId || null, name);
  }
  findById(id) {
    return getDb().prepare("SELECT * FROM files WHERE id = ?").get(id);
  }

  list(ownerId, parentId) {
    if (parentId) {
      return getDb().prepare(`
        SELECT *
        FROM files
        WHERE owner_id = ? AND parent_id = ? AND deleted_at IS NULL
        ORDER BY type = 'folder' DESC, lower(original_name) ASC
      `).all(ownerId, parentId);
    }

    return getDb().prepare(`
      SELECT *
      FROM files
      WHERE owner_id = ? AND parent_id IS NULL AND deleted_at IS NULL
      ORDER BY type = 'folder' DESC, lower(original_name) ASC
    `).all(ownerId);
  }

  listTrash(ownerId) {
    return getDb().prepare(`
      SELECT f.*
      FROM files f
      LEFT JOIN files parent ON parent.id = f.parent_id
      WHERE f.owner_id = ?
        AND f.deleted_at IS NOT NULL
        AND (f.parent_id IS NULL OR parent.deleted_at IS NULL)
      ORDER BY f.deleted_at DESC, lower(f.original_name) ASC
    `).all(ownerId);
  }

  listExpiredTrashLeaves(cutoff, limit = 100) {
    return getDb().prepare(`
      SELECT f.* FROM files f
      WHERE f.deleted_at IS NOT NULL AND f.deleted_at <= ?
        AND NOT EXISTS (SELECT 1 FROM files child WHERE child.parent_id = f.id)
      ORDER BY f.deleted_at, f.id LIMIT ?
    `).all(cutoff, limit);
  }

  search(ownerId, query) {
    const needle = `%${escapeLike(query)}%`;
    return getDb().prepare(`
      SELECT *
      FROM files
      WHERE owner_id = ?
        AND deleted_at IS NULL
        AND lower(original_name) LIKE lower(?) ESCAPE '\\'
      ORDER BY lower(original_name) ASC
      LIMIT 500
    `).all(ownerId, needle);
  }

  listActiveByOwner(ownerId) {
    return getDb().prepare(`
      SELECT *
      FROM files
      WHERE owner_id = ? AND deleted_at IS NULL
    `).all(ownerId);
  }

  listFoldersByOwner(ownerId, { includeDeleted = false } = {}) {
    return getDb().prepare(`
      SELECT * FROM files WHERE owner_id = ? AND type = 'folder'
        ${includeDeleted ? "" : "AND deleted_at IS NULL"}
    `).all(ownerId);
  }

  findAncestorProtection(file) {
    if (!file.parent_id) return null;
    return getDb().prepare(`
      WITH RECURSIVE parents AS (
        SELECT * FROM files WHERE id = ? AND owner_id = ? AND deleted_at IS NULL
        UNION
        SELECT f.* FROM files f JOIN parents p ON f.id = p.parent_id
        WHERE f.owner_id = ? AND f.deleted_at IS NULL
          AND (p.access_password_hash IS NULL OR p.access_password_hash = '')
      )
      SELECT * FROM parents WHERE access_password_hash IS NOT NULL AND access_password_hash <> '' LIMIT 1
    `).get(file.parent_id, file.owner_id, file.owner_id) || null;
  }

  loadActiveAncestors(fileId, ownerId) {
    return getDb().prepare(`
      WITH RECURSIVE parents AS (
        SELECT * FROM files WHERE id = ? AND owner_id = ? AND deleted_at IS NULL
        UNION
        SELECT f.* FROM files f JOIN parents p ON f.id = p.parent_id
        WHERE f.owner_id = ? AND f.deleted_at IS NULL
      )
      SELECT * FROM parents
    `).all(fileId, ownerId, ownerId);
  }

  listByOwner(ownerId) {
    return getDb().prepare(`
      SELECT *
      FROM files
      WHERE owner_id = ?
    `).all(ownerId);
  }

  getUsageBytes(userId) {
    return Number(getDb().prepare(`
      SELECT COALESCE(SUM(size_bytes), 0) AS bytes
      FROM files
      WHERE owner_id = ? AND type = 'file'
    `).get(userId)?.bytes || 0);
  }

  getStorageSummary() {
    const database = getDb();
    return {
      dataDir: config.dataDir,
      dbFile: config.dbFile,
      users: Number(database.prepare("SELECT COUNT(*) AS count FROM users WHERE disabled_at IS NULL").get()?.count || 0),
      files: Number(database.prepare("SELECT COUNT(*) AS count FROM files WHERE type = 'file' AND deleted_at IS NULL").get()?.count || 0),
      folders: Number(database.prepare("SELECT COUNT(*) AS count FROM files WHERE type = 'folder' AND deleted_at IS NULL").get()?.count || 0),
      activeBytes: Number(database.prepare(`
        SELECT COALESCE(SUM(size_bytes), 0) AS bytes
        FROM files
        WHERE type = 'file' AND deleted_at IS NULL
      `).get()?.bytes || 0),
      trashBytes: Number(database.prepare(`
        SELECT COALESCE(SUM(size_bytes), 0) AS bytes
        FROM files
        WHERE type = 'file' AND deleted_at IS NOT NULL
      `).get()?.bytes || 0),
      usedBytes: Number(database.prepare(`
        SELECT COALESCE(SUM(size_bytes), 0) AS bytes
        FROM files
        WHERE type = 'file'
      `).get()?.bytes || 0)
    };
  }

  folderExists(ownerId, folderId) {
    return Boolean(getDb().prepare(`
      SELECT id
      FROM files
      WHERE id = ? AND owner_id = ? AND type = 'folder' AND deleted_at IS NULL
    `).get(folderId, ownerId));
  }

  nameExists(ownerId, parentId, name, exceptId = "") {
    const row = parentId
      ? getDb().prepare(`
        SELECT id
        FROM files
        WHERE owner_id = ? AND parent_id = ? AND lower(original_name) = lower(?) AND deleted_at IS NULL AND id <> ?
      `).get(ownerId, parentId, name, exceptId)
      : getDb().prepare(`
        SELECT id
        FROM files
        WHERE owner_id = ? AND parent_id IS NULL AND lower(original_name) = lower(?) AND deleted_at IS NULL AND id <> ?
      `).get(ownerId, name, exceptId);
    return Boolean(row);
  }

  insertFolder({ id, ownerId, parentId, name, folderColor = null, accessPasswordHash = null, accessPasswordSetAt = null, now = Date.now() }) {
    getDb().prepare(`
      INSERT INTO files (
        id, owner_id, parent_id, type, original_name, stored_name, mime_type,
        size_bytes, storage_path, folder_color, access_password_hash,
        access_password_set_at, created_at, updated_at, deleted_at
      )
      VALUES (?, ?, ?, 'folder', ?, NULL, NULL, 0, NULL, ?, ?, ?, ?, ?, NULL)
    `).run(id, ownerId, parentId, name, folderColor, accessPasswordHash, accessPasswordSetAt, now, now);
    return this.findById(id);
  }

  insertFile({ id, ownerId, parentId, name, storedName, mimeType, sizeBytes, storagePath, accessPasswordHash = null, accessPasswordSetAt = null, now = Date.now() }) {
    getDb().prepare(`
      INSERT INTO files (
        id, owner_id, parent_id, type, original_name, stored_name, mime_type,
        size_bytes, storage_path, access_password_hash, access_password_set_at,
        created_at, updated_at, deleted_at
      )
      VALUES (?, ?, ?, 'file', ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    `).run(id, ownerId, parentId, name, storedName, mimeType, sizeBytes, storagePath, accessPasswordHash, accessPasswordSetAt, now, now);
    return this.findById(id);
  }

  rename(id, name) {
    const now = Date.now();
    getDb().prepare("UPDATE files SET original_name = ?, updated_at = ? WHERE id = ?").run(name, now, id);
    return this.findById(id);
  }

  updateFolderColor(id, color) {
    const now = Date.now();
    getDb().prepare("UPDATE files SET folder_color = ?, updated_at = ? WHERE id = ? AND type = 'folder'").run(color, now, id);
    return this.findById(id);
  }

  move(id, { parentId, name }) {
    const now = Date.now();
    getDb().prepare("UPDATE files SET parent_id = ?, original_name = ?, updated_at = ? WHERE id = ?").run(parentId, name, now, id);
    return this.findById(id);
  }

  setAccessPassword(id, passwordHash) {
    const now = Date.now();
    getDb().prepare(`
      UPDATE files
      SET access_password_hash = ?, access_password_set_at = ?, updated_at = ?
      WHERE id = ?
    `).run(passwordHash, now, now, id);
    return this.findById(id);
  }

  clearAccessPassword(id) {
    const now = Date.now();
    getDb().prepare(`
      UPDATE files
      SET access_password_hash = NULL, access_password_set_at = NULL, updated_at = ?
      WHERE id = ?
    `).run(now, id);
    return this.findById(id);
  }

  loadActiveTree(rootId) {
    return getDb().prepare(`
      WITH RECURSIVE tree AS (
        SELECT *
        FROM files
        WHERE id = ? AND deleted_at IS NULL
        UNION ALL
        SELECT f.*
        FROM files f
        JOIN tree t ON f.parent_id = t.id
        WHERE f.deleted_at IS NULL
      )
      SELECT *
      FROM tree
    `).all(rootId);
  }

  loadDeletedTree(rootId) {
    return getDb().prepare(`
      WITH RECURSIVE tree AS (
        SELECT *
        FROM files
        WHERE id = ? AND deleted_at IS NOT NULL
        UNION ALL
        SELECT f.*
        FROM files f
        JOIN tree t ON f.parent_id = t.id
        WHERE f.deleted_at IS NOT NULL
      )
      SELECT *
      FROM tree
    `).all(rootId);
  }

  markDeleted(rows) {
    const now = Date.now();
    const statement = getDb().prepare("UPDATE files SET deleted_at = ?, updated_at = ? WHERE id = ?");
    for (const row of rows) {
      statement.run(now, now, row.id);
    }
  }

  restoreTree(rows, { rootId, parentId, rootName }) {
    const now = Date.now();
    const restoreStatement = getDb().prepare("UPDATE files SET deleted_at = NULL, updated_at = ? WHERE id = ?");
    getDb().prepare("UPDATE files SET parent_id = ?, original_name = ?, updated_at = ? WHERE id = ?").run(parentId, rootName, now, rootId);
    for (const row of rows) {
      restoreStatement.run(now, row.id);
    }
    return this.findById(rootId);
  }

  purgeTree(rows) {
    const statement = getDb().prepare("DELETE FROM files WHERE id = ?");
    for (const row of [...rows].reverse()) {
      statement.run(row.id);
    }
  }
}

function escapeLike(value) {
  return String(value || "").replace(/[\\%_]/g, (match) => `\\${match}`);
}

export const fileRepository = new FileRepository();
