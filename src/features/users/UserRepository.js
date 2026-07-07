import { getDb } from "../../database/database.js";

export class UserRepository {
  create({
    id,
    passwordHash,
    role = "user",
    quotaBytes = null,
    lastLoginAt = null,
    displayName = null,
    authProvider = "password",
    googleSub = null,
    googleEmail = null
  }) {
    const now = Date.now();
    getDb().prepare(`
      INSERT INTO users (
        id, display_name, password_hash, auth_provider, google_sub, google_email,
        role, quota_bytes, disabled_at, created_at, updated_at, last_login_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
    `).run(id, displayName || id, passwordHash, authProvider, googleSub, googleEmail, role, quotaBytes, now, now, lastLoginAt);
    return this.findById(id);
  }

  findById(id) {
    return getDb().prepare(`
      SELECT
        id,
        display_name,
        password_hash,
        auth_provider,
        google_sub,
        google_email,
        role,
        quota_bytes,
        disabled_at,
        login_failed_count,
        login_locked_until,
        login_suspended_at,
        created_at,
        updated_at,
        last_login_at
      FROM users
      WHERE id = ?
    `).get(id);
  }

  findByGoogleSub(googleSub) {
    return getDb().prepare(`
      SELECT
        id,
        display_name,
        password_hash,
        auth_provider,
        google_sub,
        google_email,
        role,
        quota_bytes,
        disabled_at,
        login_failed_count,
        login_locked_until,
        login_suspended_at,
        created_at,
        updated_at,
        last_login_at
      FROM users
      WHERE google_sub = ?
    `).get(googleSub);
  }

  listAll() {
    return getDb().prepare(`
      SELECT
        id,
        display_name,
        auth_provider,
        google_sub,
        google_email,
        role,
        quota_bytes,
        disabled_at,
        login_failed_count,
        login_locked_until,
        login_suspended_at,
        created_at,
        updated_at,
        last_login_at
      FROM users
      ORDER BY role = 'admin' DESC, lower(id) ASC
    `).all();
  }

  touchLogin(id) {
    const now = Date.now();
    getDb().prepare(`
      UPDATE users
      SET
        last_login_at = ?,
        login_failed_count = 0,
        login_locked_until = NULL,
        login_suspended_at = NULL,
        updated_at = ?
      WHERE id = ?
    `).run(now, now, id);
    return this.findById(id);
  }

  recordLoginFailure(id, { failedCount, lockedUntil = null, suspendedAt = null }) {
    const now = Date.now();
    getDb().prepare(`
      UPDATE users
      SET
        login_failed_count = ?,
        login_locked_until = ?,
        login_suspended_at = ?,
        updated_at = ?
      WHERE id = ?
    `).run(failedCount, lockedUntil, suspendedAt, now, id);

    if (suspendedAt) {
      getDb().prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
    }

    return this.findById(id);
  }

  clearLoginFailureState(id) {
    const now = Date.now();
    getDb().prepare(`
      UPDATE users
      SET
        login_failed_count = 0,
        login_locked_until = NULL,
        login_suspended_at = NULL,
        updated_at = ?
      WHERE id = ?
    `).run(now, id);
    return this.findById(id);
  }

  setQuota(id, quotaBytes) {
    const now = Date.now();
    getDb().prepare("UPDATE users SET quota_bytes = ?, updated_at = ? WHERE id = ?").run(quotaBytes, now, id);
    return this.findById(id);
  }

  setRole(id, role) {
    const now = Date.now();
    getDb().prepare("UPDATE users SET role = ?, updated_at = ? WHERE id = ?").run(role, now, id);
    return this.findById(id);
  }

  updateProfile(id, { displayName = null, passwordHash = null }) {
    const now = Date.now();
    if (displayName !== null) {
      getDb().prepare("UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?").run(displayName, now, id);
    }
    if (passwordHash !== null) {
      getDb().prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?").run(passwordHash, now, id);
    }
    return this.findById(id);
  }

  updateGoogleProfile(id, { googleEmail = null }) {
    const now = Date.now();
    getDb().prepare(`
      UPDATE users
      SET google_email = ?, updated_at = ?
      WHERE id = ?
    `).run(googleEmail, now, id);
    return this.findById(id);
  }

  disable(id) {
    const now = Date.now();
    getDb().prepare("UPDATE users SET disabled_at = ?, updated_at = ? WHERE id = ?").run(now, now, id);
    getDb().prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
    return this.findById(id);
  }

  enable(id) {
    const now = Date.now();
    getDb().prepare("UPDATE users SET disabled_at = NULL, updated_at = ? WHERE id = ?").run(now, id);
    return this.findById(id);
  }

  delete(id) {
    return getDb().prepare("DELETE FROM users WHERE id = ?").run(id);
  }
}

export const userRepository = new UserRepository();
