import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'drive-integrity-'));
process.env.DDATO_DRIVE_DATA_DIR = root;
process.env.DDATO_DRIVE_DB_FILE = path.join(root, 'drive.sqlite');
const { initializeDatabase, closeDatabase, getDb } = await import('../src/database/database.js');
const { StorageIntegrityService } = await import('../src/features/system/StorageIntegrityService.js');
const { fileRepository } = await import('../src/features/files/FileRepository.js');
initializeDatabase();
try {
  getDb().prepare("INSERT INTO users(id,password_hash,role,created_at,updated_at) VALUES ('test','test','user',0,0)").run();
  for (const [id, size] of [['missing', 10], ['wrong', 20], ['ok', 3]]) {
    fileRepository.insertFile({ id, ownerId: 'test', parentId: null, name: id, storedName: id, mimeType: 'text/plain', sizeBytes: size, storagePath: `storage/${id}` });
  }
  fs.writeFileSync(path.join(root, 'storage/wrong'), 'abc');
  fs.writeFileSync(path.join(root, 'storage/ok'), 'abc');
  fs.writeFileSync(path.join(root, 'storage/orphan'), 'orphan');
  fs.utimesSync(path.join(root, 'storage/orphan'), new Date(0), new Date(0));
  const service = new StorageIntegrityService();
  const before = getDb().prepare('SELECT * FROM files').all();
  service.start(); const task = service.task; service.start(); assert.equal(task, service.task);
  await task;
  assert.equal(service.status.state, 'done');
  assert.deepEqual(service.status.issues.map(issue => issue.kind).sort(), ['missing', 'orphan', 'size_mismatch']);
  assert.deepEqual(getDb().prepare('SELECT * FROM files').all(), before);
  assert.equal(fs.readFileSync(path.join(root, 'storage/orphan'), 'utf8'), 'orphan');
  console.log('Integrity: missing, mismatched and orphan files detected; no database or file mutations; concurrent runs coalesced.');
} finally { closeDatabase(); fs.rmSync(root, { recursive: true, force: true }); }
