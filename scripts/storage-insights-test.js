import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'drive-insights-'));
process.env.DDATO_DRIVE_DATA_DIR = root; process.env.DDATO_DRIVE_DB_FILE = path.join(root, 'drive.sqlite');
const { initializeDatabase, closeDatabase, getDb } = await import('../src/database/database.js');
const { fileRepository } = await import('../src/features/files/FileRepository.js');
const { storageInsightsService } = await import('../src/features/system/StorageInsightsService.js');
initializeDatabase();
try {
  for (const id of ['a', 'b']) getDb().prepare("INSERT INTO users(id,password_hash,role,quota_bytes,created_at,updated_at) VALUES (?,'test','user',1000,0,0)").run(id);
  for (const [id, owner, mime, bytes] of [['photo', 'a', 'image/jpeg', 200], ['video', 'a', 'video/mp4', 400], ['trash', 'a', 'text/plain', 100], ['secret', 'b', 'text/plain', 900]]) {
    fileRepository.insertFile({ id, ownerId: owner, parentId: null, name: id, mimeType: mime, sizeBytes: bytes, storedName: id, storagePath: `storage/${id}` });
  }
  fileRepository.markDeleted([fileRepository.findById('trash')]);
  const req = { user: getDb().prepare("SELECT * FROM users WHERE id = 'a'").get(), headers: {}, socket: {} };
  const report = storageInsightsService.get(req);
  assert.equal(report.usedBytes, 700); assert.equal(report.activeBytes, 600); assert.equal(report.trashBytes, 100); assert.equal(report.freeBytes, 300);
  assert.equal(report.users, undefined); assert.equal(report.largest[0].id, 'video'); assert.equal(report.largest.length, 2);
  assert.deepEqual(report.kinds.map(row => row.kind), ['video', 'image']);
  assert(storageInsightsService.get({ ...req, user: { ...req.user, role: 'admin' } }).users.some(user => user.id === 'b' && user.usedBytes === 900));
  console.log('Storage insights: quota, active/trash separation, categories, largest files and administrator-only user totals passed.');
} finally { closeDatabase(); fs.rmSync(root, { recursive: true, force: true }); }
