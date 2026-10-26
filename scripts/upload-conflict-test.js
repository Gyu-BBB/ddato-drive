import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'drive-conflicts-'));
process.env.DDATO_DRIVE_DATA_DIR = root;
process.env.DDATO_DRIVE_DB_FILE = path.join(root, 'drive.sqlite');
const { initializeDatabase, closeDatabase, getDb } = await import('../src/database/database.js');
const { fileRepository } = await import('../src/features/files/FileRepository.js');
const { resumableUploadService: service } = await import('../src/features/files/ResumableUploadService.js');
const { fileService } = await import('../src/features/files/FileService.js');
initializeDatabase();
getDb().prepare("INSERT INTO users(id,password_hash,role,quota_bytes,created_at,updated_at) VALUES ('test','test','user',10000,0,0)").run();
const req = { user: getDb().prepare("SELECT * FROM users WHERE id = 'test'").get(), headers: {}, socket: {}, sessionToken: 'test' };
async function upload(policy, text = 'abc') {
  const session = service.createSession(req, { name: 'same.txt', sizeBytes: text.length, conflictPolicy: policy });
  if (session.skipped) return session;
  await service.appendChunk(req.user, session.id, { offset: 0, buffer: Buffer.from(text) });
  return service.completeSession(req, session.id);
}
try {
  const first = await upload('keep');
  assert.equal((await upload('keep')).name, 'same (1).txt');
  assert.equal((await upload('skip')).skipped, true);
  const next = await upload('replace', 'new');
  assert.equal(next.name, 'same.txt'); assert.notEqual(next.id, first.id);
  assert(fileRepository.findById(first.id).deleted_at);
  fileService.setAccessPassword(req, next.id, 'test');
  assert.throws(() => service.createSession(req, { name: 'same.txt', sizeBytes: 3, conflictPolicy: 'replace' }), error => error.statusCode === 423);
  fileService.resetAccessPasswordAsAdmin({ ...req, user: { ...req.user, role: 'admin' } }, next.id);
  const race = service.createSession(req, { name: 'same.txt', sizeBytes: 3, conflictPolicy: 'replace' });
  fileRepository.rename(next.id, 'renamed.txt');
  await service.appendChunk(req.user, race.id, { offset: 0, buffer: Buffer.from('new') });
  await assert.rejects(service.completeSession(req, race.id), error => error.statusCode === 409);
  assert.equal(fileRepository.findById(next.id).deleted_at, null);
  console.log('Upload conflicts: keep, skip, replace-to-trash, locked target rejection and concurrent target changes passed.');
} finally { closeDatabase(); fs.rmSync(root, { recursive: true, force: true }); }
