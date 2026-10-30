import crypto from 'node:crypto';
import { getDb } from '../../database/database.js';
import { fail } from '../../core/errors.js';
import { sha256 } from '../../core/passwords.js';
import { userRepository } from '../users/UserRepository.js';

export class SshCredentials {
  initialize() {
    getDb().exec(`CREATE TABLE IF NOT EXISTS ssh_credentials (
      owner_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      secret_hash TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
    )`);
  }
  info(ownerId) {
    const row = getDb().prepare('SELECT created_at, expires_at FROM ssh_credentials WHERE owner_id = ?').get(ownerId);
    return row && row.expires_at > Date.now() ? { createdAt: row.created_at, expiresAt: row.expires_at } : null;
  }
  rotate(ownerId) {
    const password = crypto.randomBytes(32).toString('base64url'); const now = Date.now();
    getDb().prepare('INSERT OR REPLACE INTO ssh_credentials(owner_id,secret_hash,created_at,expires_at) VALUES (?,?,?,?)')
      .run(ownerId, sha256(password), now, now + 30 * 86400000);
    return { password, ...this.info(ownerId) };
  }
  revoke(ownerId) { getDb().prepare('DELETE FROM ssh_credentials WHERE owner_id = ?').run(ownerId); }
  authenticate(ownerId, password) {
    const row = getDb().prepare('SELECT * FROM ssh_credentials WHERE owner_id = ?').get(ownerId);
    const actual = Buffer.from(sha256(password)); const expected = Buffer.from(row?.secret_hash || '0'.repeat(64));
    if (!crypto.timingSafeEqual(actual, expected) || !row || row.expires_at <= Date.now()) return null;
    const user = userRepository.findById(ownerId);
    if (!user || user.disabled_at || user.login_suspended_at || Number(user.login_locked_until) > Date.now()) return null;
    return { user, hash: row.secret_hash };
  }
  assertActive(ownerId, hash) {
    const row = getDb().prepare('SELECT * FROM ssh_credentials WHERE owner_id = ?').get(ownerId);
    const user = userRepository.findById(ownerId);
    if (!row || row.secret_hash !== hash || row.expires_at <= Date.now() || !user || user.disabled_at || user.login_suspended_at || Number(user.login_locked_until) > Date.now()) {
      fail(403, 'SSH 전송 인증이 만료되거나 해제되었습니다.');
    }
    return user;
  }
}
export const sshCredentials = new SshCredentials();
