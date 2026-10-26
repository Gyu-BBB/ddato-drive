import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'drive-shares-'));
process.env.DDATO_DRIVE_DATA_DIR = root; process.env.DDATO_DRIVE_DB_FILE = path.join(root, 'drive.sqlite');
const { initializeDatabase, closeDatabase, getDb } = await import('../src/database/database.js');
const { fileRepository } = await import('../src/features/files/FileRepository.js');
const { shareRepository } = await import('../src/features/shares/ShareRepository.js');
const { shareService } = await import('../src/features/shares/ShareService.js');
initializeDatabase();
try {
  for (const user of ['a', 'b']) {
    getDb().prepare('INSERT INTO users(id,password_hash,role,created_at,updated_at) VALUES (?,\'test\',\'user\',0,0)').run(user);
    fileRepository.insertFolder({ id: user, ownerId: user, parentId: null, name: `Folder ${user}` });
    shareRepository.create({ id: user, ownerId: user, fileId: user, token: user, mode: 'permanent', expiresAt: null, createdBy: user });
  }
  shareRepository.create({ id: 'expired', ownerId: 'a', fileId: 'a', token: 'old', mode: 'hour', expiresAt: 1, createdBy: 'a' });
  assert.equal(shareService.listOwned({ id: 'a' }, {}, token => `/share/${token}`).total, 2);
  assert.equal(shareService.listOwned({ id: 'a' }, { state: 'active' }, String).total, 1);
  assert.equal(shareService.listOwned({ id: 'a' }, { state: 'expired' }, String).total, 1);
  assert.throws(() => shareService.revokeOwned({ id: 'a' }, ['a', 'b']), error => error.statusCode === 404);
  assert.equal(shareRepository.findById('a').revoked_at, null, 'mixed-owner request must not partially revoke');
  shareService.revokeOwned({ id: 'a' }, ['a', 'expired']);
  assert.equal(shareService.listOwned({ id: 'a' }, { state: 'revoked' }, String).total, 2);
  assert.equal(shareRepository.findActiveByToken('a'), undefined);
  assert.equal(shareRepository.findById('b').revoked_at, null);
  console.log('Share management: owner isolation, filters, URLs, batch atomic validation and revocation passed.');
} finally { closeDatabase(); fs.rmSync(root, { recursive: true, force: true }); }
