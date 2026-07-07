import crypto from "node:crypto";
import { config } from "../../core/config.js";
import { sha256 } from "../../core/passwords.js";
import { getDb } from "../../database/database.js";

export class SessionService {
  create(userId) {
    const token = crypto.randomBytes(32).toString("base64url");
    const now = Date.now();
    getDb().prepare(`
      INSERT INTO sessions (id_hash, user_id, expires_at, created_at)
      VALUES (?, ?, ?, ?)
    `).run(sha256(token), userId, now + config.sessionTtlMs, now);
    return token;
  }

  delete(token) {
    if (!token) return;
    getDb().prepare("DELETE FROM sessions WHERE id_hash = ?").run(sha256(token));
  }

  findUserByToken(token) {
    if (!token) return null;
    const now = Date.now();
    const row = getDb().prepare(`
      SELECT
        s.expires_at,
        u.id,
        u.role,
        u.quota_bytes,
        u.disabled_at,
        u.login_suspended_at,
        u.created_at,
        u.updated_at,
        u.last_login_at
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.id_hash = ?
    `).get(sha256(token));

    if (!row || row.expires_at <= now || row.disabled_at || row.login_suspended_at) {
      this.delete(token);
      return null;
    }

    return {
      id: row.id,
      role: row.role,
      quotaBytes: row.quota_bytes,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastLoginAt: row.last_login_at
    };
  }
}

export const sessionService = new SessionService();
