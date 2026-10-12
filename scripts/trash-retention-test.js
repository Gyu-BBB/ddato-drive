import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ddato-trash-retention-'));
process.env.DDATO_DRIVE_DATA_DIR = dataDir;
process.env.DDATO_DRIVE_DB_FILE = path.join(dataDir, 'app-data', 'drive.sqlite');
const { initializeDatabase, getDb, closeDatabase } = await import('../src/database/database.js');
const { config } = await import('../src/core/config.js');
const { fileRepository } = await import('../src/features/files/FileRepository.js');
const { TrashCleanupService } = await import('../src/features/files/TrashCleanupService.js');
const { serializeFile } = await import('../src/features/files/file.serializer.js');
const { TRASH_RETENTION_MS } = await import('../src/shared/trashRetention.js');
const cleanup = new TrashCleanupService();
const now = Date.now();
const cutoff = now - TRASH_RETENTION_MS;
const originalRemove = fs.rmSync;

try {
  initializeDatabase();
  const db = getDb();
  const cacheDir = path.join(config.previewCacheDir, 'pdf');
  fs.mkdirSync(cacheDir, { recursive: true });
  db.prepare(`INSERT INTO users (id, password_hash, role, created_at, updated_at)
    VALUES ('other', 'test-only', 'user', ?, ?)`).run(now, now);

  function fixture(id, { folder = false, parentId = null, deletedAt = cutoff,
    ownerId = config.adminId, locked = false } = {}) {
    const payload = { id, ownerId, parentId, name: id,
      accessPasswordHash: locked ? 'test-only' : null };
    if (folder) fileRepository.insertFolder(payload);
    else {
      const storagePath = path.join('storage', `${id}.txt`);
      fs.writeFileSync(path.join(dataDir, storagePath), 'test');
      fs.writeFileSync(path.join(cacheDir, `${id}-fixture.pdf`), 'preview');
      fileRepository.insertFile({ ...payload, storedName: `${id}.txt`,
        mimeType: 'text/plain', sizeBytes: 4, storagePath });
    }
    db.prepare('UPDATE files SET deleted_at = ? WHERE id = ?').run(deletedAt, id);
    return fileRepository.findById(id);
  }

  const boundary = fixture('boundary');
  fixture('older', { deletedAt: cutoff - 1, ownerId: 'other' });
  fixture('locked', { locked: true });
  fixture('recent', { deletedAt: cutoff + 1 });
  fixture('active', { deletedAt: null });
  const restored = fixture('restored');
  fileRepository.restoreTree([restored], { rootId: restored.id, parentId: null, rootName: restored.original_name });
  fixture('empty-folder', { folder: true });
  fixture('old-folder', { folder: true });
  fixture('old-child', { parentId: 'old-folder' });
  fixture('mixed-folder', { folder: true });
  fixture('new-child', { parentId: 'mixed-folder', deletedAt: cutoff + 1 });
  fixture('active-child-folder', { folder: true });
  fixture('active-child', { parentId: 'active-child-folder', deletedAt: null });
  db.prepare(`INSERT INTO file_shares (id, file_id, owner_id, token, mode, created_by, created_at, updated_at)
    VALUES ('share', 'boundary', ?, 'test-token', 'permanent', ?, ?, ?)`)
    .run(config.adminId, config.adminId, now, now);
  assert.equal(serializeFile(boundary).trashExpiresAt, now);
  assert.equal(serializeFile(fileRepository.findById('active')).trashExpiresAt, null);

  assert.deepEqual(await cleanup.run(now), { purged: 6, failed: 0 });
  for (const id of ['boundary', 'older', 'locked', 'empty-folder', 'old-folder', 'old-child']) {
    assert.equal(fileRepository.findById(id), undefined, `${id} must expire`);
    assert.equal(fs.existsSync(path.join(dataDir, 'storage', `${id}.txt`)), false);
    assert.equal(fs.existsSync(path.join(cacheDir, `${id}-fixture.pdf`)), false);
  }
  for (const id of ['recent', 'active', 'restored', 'mixed-folder', 'new-child', 'active-child-folder', 'active-child']) {
    assert(fileRepository.findById(id), `${id} must remain`);
  }
  assert.equal(db.prepare("SELECT * FROM file_shares WHERE id = 'share'").get(), undefined);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'trash.auto_purge'").get().count, 6);
  assert.deepEqual(await cleanup.run(now), { purged: 0, failed: 0 });
  assert.deepEqual(await cleanup.run(now + 1), { purged: 3, failed: 0 });
  assert.equal(fileRepository.getUsageBytes(config.adminId), 12);

  fixture('failure');
  fs.rmSync = (target, options) => {
    if (target === path.join(dataDir, 'storage', 'failure.txt')) {
      throw Object.assign(new Error('Simulated disk permission failure'), { code: 'EACCES' });
    }
    return originalRemove(target, options);
  };
  assert.deepEqual(await cleanup.run(now), { purged: 0, failed: 1 });
  assert(fileRepository.findById('failure'), 'failed disk cleanup must remain retryable');
  fs.rmSync = originalRemove;
  assert.deepEqual(await cleanup.run(now), { purged: 1, failed: 0 });

  fixture('cache-failure');
  fs.rmSync = (target, options) => {
    if (target === path.join(cacheDir, 'cache-failure-fixture.pdf')) {
      throw Object.assign(new Error('Simulated cache permission failure'), { code: 'EACCES' });
    }
    return originalRemove(target, options);
  };
  assert.deepEqual(await cleanup.run(now), { purged: 0, failed: 1 });
  assert(fileRepository.findById('cache-failure'));
  fs.rmSync = originalRemove;
  assert.deepEqual(await cleanup.run(now), { purged: 1, failed: 0 });

  for (let index = 0; index < 105; index++) fixture(`batch-${index}`);
  assert.deepEqual(await cleanup.run(now), { purged: 105, failed: 0 });
  fixture('startup', { deletedAt: cutoff - 60000 });
  cleanup.start();
  const timer = cleanup.timer;
  cleanup.start();
  assert.equal(cleanup.timer, timer, 'starting twice must not duplicate the scheduler');
  await cleanup.run();
  assert.equal(fileRepository.findById('startup'), undefined);
  await cleanup.stop();
  assert.equal(cleanup.timer, null);
  console.log('Trash retention passed: 30-day boundary, restore, locks, owners, nested folders, shares, quota, caches, retries, batches and startup cleanup.');
} finally {
  fs.rmSync = originalRemove;
  await cleanup.stop();
  closeDatabase();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
