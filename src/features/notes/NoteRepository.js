import { getDb } from "../../database/database.js";

export class NoteRepository {
  listByUser(userId) {
    return getDb().prepare(`
      SELECT id, user_id, title, content, access_password_hash, access_password_set_at, created_at, updated_at
      FROM notes
      WHERE user_id = ?
      ORDER BY updated_at DESC
    `).all(userId);
  }

  findById(userId, id) {
    return getDb().prepare(`
      SELECT id, user_id, title, content, access_password_hash, access_password_set_at, created_at, updated_at
      FROM notes
      WHERE user_id = ? AND id = ?
    `).get(userId, id);
  }

  findAnyById(id) {
    return getDb().prepare(`
      SELECT id, user_id, title, content, access_password_hash, access_password_set_at, created_at, updated_at
      FROM notes
      WHERE id = ?
    `).get(id);
  }

  create({ id, userId, title, content }) {
    const now = Date.now();
    getDb().prepare(`
      INSERT INTO notes (id, user_id, title, content, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, userId, title, content, now, now);
    return this.findById(userId, id);
  }

  update(userId, id, { title, content }) {
    const now = Date.now();
    getDb().prepare(`
      UPDATE notes
      SET title = ?, content = ?, updated_at = ?
      WHERE user_id = ? AND id = ?
    `).run(title, content, now, userId, id);
    return this.findById(userId, id);
  }

  delete(userId, id) {
    return getDb().prepare("DELETE FROM notes WHERE user_id = ? AND id = ?").run(userId, id);
  }

  setAccessPassword(userId, id, passwordHash) {
    const now = Date.now();
    getDb().prepare(`
      UPDATE notes
      SET access_password_hash = ?, access_password_set_at = ?, updated_at = ?
      WHERE user_id = ? AND id = ?
    `).run(passwordHash, now, now, userId, id);
    return this.findById(userId, id);
  }

  clearAccessPassword(userId, id) {
    const now = Date.now();
    getDb().prepare(`
      UPDATE notes
      SET access_password_hash = NULL, access_password_set_at = NULL, updated_at = ?
      WHERE user_id = ? AND id = ?
    `).run(now, userId, id);
    return this.findById(userId, id);
  }
}

export const noteRepository = new NoteRepository();
