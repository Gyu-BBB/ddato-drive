import { config } from "../core/config.js";
import { hashPassword } from "../core/passwords.js";

export function initializeSchema(db) {
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      display_name TEXT,
      password_hash TEXT NOT NULL,
      auth_provider TEXT NOT NULL DEFAULT 'password',
      google_sub TEXT,
      google_email TEXT,
      role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
      quota_bytes INTEGER,
      disabled_at INTEGER,
      login_failed_count INTEGER NOT NULL DEFAULT 0,
      login_locked_until INTEGER,
      login_suspended_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_login_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      parent_id TEXT,
      type TEXT NOT NULL CHECK (type IN ('file', 'folder')),
      original_name TEXT NOT NULL,
      stored_name TEXT,
      mime_type TEXT,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      storage_path TEXT,
      access_password_hash TEXT,
      access_password_set_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER,
      FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_id) REFERENCES files(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS files_owner_parent_idx
      ON files(owner_id, parent_id, deleted_at);

    CREATE INDEX IF NOT EXISTS files_trash_expiry_idx
      ON files(deleted_at) WHERE deleted_at IS NOT NULL;

    CREATE INDEX IF NOT EXISTS files_parent_idx ON files(parent_id);

    CREATE TABLE IF NOT EXISTS upload_completions (
      session_id TEXT PRIMARY KEY,
      request_user_id TEXT NOT NULL,
      client_upload_id TEXT,
      file_id TEXT,
      metadata_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (request_user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE SET NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS upload_completion_client_idx
      ON upload_completions(request_user_id, client_upload_id) WHERE client_upload_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS upload_completion_expiry_idx ON upload_completions(created_at);
    CREATE TABLE IF NOT EXISTS upload_cancellations (
      request_user_id TEXT NOT NULL,
      client_upload_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (request_user_id, client_upload_id),
      FOREIGN KEY (request_user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS upload_cancellation_expiry_idx ON upload_cancellations(created_at);

    CREATE INDEX IF NOT EXISTS files_owner_folder_idx ON files(owner_id)
      WHERE type = 'folder';

    CREATE UNIQUE INDEX IF NOT EXISTS files_owner_parent_name_active_idx
      ON files(owner_id, IFNULL(parent_id, ''), lower(original_name))
      WHERE deleted_at IS NULL;

    CREATE TABLE IF NOT EXISTS file_shares (
      id TEXT PRIMARY KEY,
      file_id TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      mode TEXT NOT NULL CHECK (mode IN ('hour', 'permanent')),
      expires_at INTEGER,
      access_password_hash TEXT,
      access_password_plain TEXT,
      access_password_set_at INTEGER,
      revoked_at INTEGER,
      created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE,
      FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS file_shares_file_active_idx
      ON file_shares(file_id, revoked_at, expires_at);

    CREATE INDEX IF NOT EXISTS file_shares_token_idx
      ON file_shares(token);

    CREATE TABLE IF NOT EXISTS sessions (
      id_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS sessions_user_idx
      ON sessions(user_id, expires_at);

    CREATE UNIQUE INDEX IF NOT EXISTS users_google_sub_unique_idx
      ON users(google_sub)
      WHERE google_sub IS NOT NULL;

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      action TEXT NOT NULL,
      target_id TEXT,
      ip TEXT,
      detail_json TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      access_password_hash TEXT,
      access_password_set_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS notes_user_updated_idx
      ON notes(user_id, updated_at DESC);
  `);
  ensureUserProfileColumns(db);
  ensureUserAuthProviderColumns(db);
  ensureUserLoginStateColumns(db);
  ensureFileMetadataColumns(db);
  ensureNotesTable(db);
  ensureAccessPasswordColumns(db);
  ensureSharePasswordColumns(db);
  bootstrapAdminUser(db);
}

function ensureUserProfileColumns(db) {
  const columns = db.prepare("PRAGMA table_info(users)").all().map((column) => column.name);
  if (!columns.includes("display_name")) {
    db.exec("ALTER TABLE users ADD COLUMN display_name TEXT");
    db.exec("UPDATE users SET display_name = id WHERE display_name IS NULL");
  }
}

function ensureUserAuthProviderColumns(db) {
  const columns = db.prepare("PRAGMA table_info(users)").all().map((column) => column.name);
  if (!columns.includes("auth_provider")) {
    db.exec("ALTER TABLE users ADD COLUMN auth_provider TEXT NOT NULL DEFAULT 'password'");
  }
  if (!columns.includes("google_sub")) {
    db.exec("ALTER TABLE users ADD COLUMN google_sub TEXT");
  }
  if (!columns.includes("google_email")) {
    db.exec("ALTER TABLE users ADD COLUMN google_email TEXT");
  }
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS users_google_sub_unique_idx
      ON users(google_sub)
      WHERE google_sub IS NOT NULL
  `);
}

function ensureUserLoginStateColumns(db) {
  const columns = db.prepare("PRAGMA table_info(users)").all().map((column) => column.name);
  if (!columns.includes("login_failed_count")) {
    db.exec("ALTER TABLE users ADD COLUMN login_failed_count INTEGER NOT NULL DEFAULT 0");
  }
  if (!columns.includes("login_locked_until")) {
    db.exec("ALTER TABLE users ADD COLUMN login_locked_until INTEGER");
  }
  if (!columns.includes("login_suspended_at")) {
    db.exec("ALTER TABLE users ADD COLUMN login_suspended_at INTEGER");
  }
}

function ensureFileMetadataColumns(db) {
  const columns = db.prepare("PRAGMA table_info(files)").all().map((column) => column.name);
  for (const [name, type] of [['source_modified_at', 'INTEGER'], ['captured_at', 'INTEGER'], ['content_sha256', 'TEXT']]) {
    if (!columns.includes(name)) db.exec(`ALTER TABLE files ADD COLUMN ${name} ${type}`);
  }
  db.exec("CREATE INDEX IF NOT EXISTS files_photo_hash_idx ON files(owner_id, content_sha256) WHERE content_sha256 IS NOT NULL AND deleted_at IS NULL");
  if (!columns.includes("folder_color")) {
    db.exec("ALTER TABLE files ADD COLUMN folder_color TEXT");
  }
}

function ensureNotesTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      access_password_hash TEXT,
      access_password_set_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS notes_user_updated_idx
      ON notes(user_id, updated_at DESC);
  `);
}

function ensureAccessPasswordColumns(db) {
  const fileColumns = db.prepare("PRAGMA table_info(files)").all().map((column) => column.name);
  if (!fileColumns.includes("access_password_hash")) {
    db.exec("ALTER TABLE files ADD COLUMN access_password_hash TEXT");
  }
  if (!fileColumns.includes("access_password_set_at")) {
    db.exec("ALTER TABLE files ADD COLUMN access_password_set_at INTEGER");
  }

  const noteColumns = db.prepare("PRAGMA table_info(notes)").all().map((column) => column.name);
  if (!noteColumns.includes("access_password_hash")) {
    db.exec("ALTER TABLE notes ADD COLUMN access_password_hash TEXT");
  }
  if (!noteColumns.includes("access_password_set_at")) {
    db.exec("ALTER TABLE notes ADD COLUMN access_password_set_at INTEGER");
  }
}

function ensureSharePasswordColumns(db) {
  const columns = db.prepare("PRAGMA table_info(file_shares)").all().map((column) => column.name);
  if (!columns.includes("access_password_hash")) {
    db.exec("ALTER TABLE file_shares ADD COLUMN access_password_hash TEXT");
  }
  if (!columns.includes("access_password_plain")) {
    db.exec("ALTER TABLE file_shares ADD COLUMN access_password_plain TEXT");
  }
  if (!columns.includes("access_password_set_at")) {
    db.exec("ALTER TABLE file_shares ADD COLUMN access_password_set_at INTEGER");
  }
}

function bootstrapAdminUser(db) {
  const now = Date.now();
  const existing = db.prepare("SELECT id, role, disabled_at FROM users WHERE id = ?").get(config.adminId);

  if (!existing) {
    db.prepare(`
      INSERT INTO users (id, display_name, password_hash, role, quota_bytes, disabled_at, created_at, updated_at, last_login_at)
      VALUES (?, ?, ?, 'admin', NULL, NULL, ?, ?, NULL)
    `).run(config.adminId, config.adminId, hashPassword(config.adminPassword), now, now);
    return;
  }

  if (existing.role !== "admin" || existing.disabled_at) {
    db.prepare(`
      UPDATE users
      SET role = 'admin', quota_bytes = NULL, disabled_at = NULL, updated_at = ?
      WHERE id = ?
    `).run(now, config.adminId);
  }

  db.prepare("UPDATE users SET display_name = COALESCE(display_name, id) WHERE id = ?").run(config.adminId);
}
