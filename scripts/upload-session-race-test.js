import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ddato-session-races-'));
process.env.DDATO_DRIVE_DATA_DIR = root;
process.env.DDATO_DRIVE_DB_FILE = path.join(root, 'app-data', 'drive.sqlite');
process.env.DDATO_DRIVE_ADMIN_PASSWORD = '123456';
const { initializeDatabase, closeDatabase } = await import('../src/database/database.js');
const { userRepository } = await import('../src/features/users/UserRepository.js');
const { fileRepository } = await import('../src/features/files/FileRepository.js');
const { fileStorage } = await import('../src/features/files/FileStorage.js');
const { resumableUploadService: service } = await import('../src/features/files/ResumableUploadService.js');
const { uploadCompletionRepository } = await import('../src/features/files/UploadCompletionRepository.js');
const { limitUploadRequests } = await import('../src/features/files/upload.middleware.js');
const { uploadSessionStore } = await import('../src/features/files/UploadSessionStore.js');
const { multipartReservationStore } = await import('../src/features/files/MultipartReservationStore.js');
const { fileService } = await import('../src/features/files/FileService.js');
const { config } = await import('../src/core/config.js');
initializeDatabase();
const req = { user: userRepository.findById('admin'), sessionToken: 'race-test', headers: {}, socket: {} };
const originalAppend = fs.promises.appendFile;
try {
  let release;
  let started;
  const writing = new Promise(resolve => { started = resolve; });
  const blocked = new Promise(resolve => { release = resolve; });
  fs.promises.appendFile = async (...args) => { started(); await blocked; return originalAppend(...args); };
  const session = service.createSession(req, { name: 'race.bin', sizeBytes: 6, clientUploadId: 'race' });
  const first = service.appendChunk(req.user, session.id, { offset: 0, buffer: Buffer.from('abc') });
  await writing;
  uploadSessionStore.cleanupStaleSessions(Date.now() + config.uploadSessionTtlMs + 1);
  assert(uploadSessionStore.activeSessionIds.has(session.id));
  assert.equal(service.getStatus(req.user, session.id).sizeBytes, 6, 'TTL cleanup must not remove an active write');
  const second = service.appendChunk(req.user, session.id, { offset: 3, buffer: Buffer.from('def') });
  const complete = service.completeSession(req, session.id);
  const cancel = service.cancelSession(req.user, session.id);
  release(); await first; await second;
  const file = await complete;
  assert.equal((await cancel).completed, true, 'cancel after commit must not delete a completed file');
  assert.equal(fs.readFileSync(fileStorage.getAbsoluteFilePath(fileRepository.findById(file.id)), 'utf8'), 'abcdef');
  assert.equal((await service.completeSession(req, session.id)).id, file.id);
  fs.promises.appendFile = originalAppend;
  assert.equal(service.chunkWrites.size, 0);

  const interrupted = service.createSession(req, { name: 'interrupted.bin', sizeBytes: 6 });
  fs.promises.appendFile = async (filePath, data) => {
    await originalAppend(filePath, data.subarray(0, 2));
    throw Object.assign(new Error('injected disk write failure'), { code: 'ENOSPC' });
  };
  await assert.rejects(service.appendChunk(req.user, interrupted.id, { offset: 0, buffer: Buffer.from('abc') }));
  fs.promises.appendFile = originalAppend;
  assert.equal(service.getStatus(req.user, interrupted.id).uploadedBytes, 2);
  await service.appendChunk(req.user, interrupted.id, { offset: 2, buffer: Buffer.from('cdef') });
  const repaired = await service.completeSession(req, interrupted.id);
  assert.equal(fs.readFileSync(fileStorage.getAbsoluteFilePath(fileRepository.findById(repaired.id)), 'utf8'), 'abcdef');

  const rollback = service.createSession(req, { name: 'db-rollback.bin', sizeBytes: 3 });
  await service.appendChunk(req.user, rollback.id, { offset: 0, buffer: Buffer.from('xyz') });
  const originalRecord = uploadCompletionRepository.record;
  try {
    uploadCompletionRepository.record = () => { throw new Error('injected database failure'); };
    await assert.rejects(service.completeSession(req, rollback.id));
  } finally { uploadCompletionRepository.record = originalRecord; }
  assert.equal(service.getStatus(req.user, rollback.id).uploadedBytes, 3, 'DB rollback must retain resumable bytes');
  assert(!fileRepository.list(req.user.id, null).some(file => file.original_name === 'db-rollback.bin'));
  const retried = await service.completeSession(req, rollback.id);
  assert.equal(fs.readFileSync(fileStorage.getAbsoluteFilePath(fileRepository.findById(retried.id)), 'utf8'), 'xyz');

  await service.cancelByClientId(req.user, 'canceled-before-create');
  assert.throws(() => service.createSession(req, { name: 'never.bin', sizeBytes: 0, clientUploadId: 'canceled-before-create' }), error => error.statusCode === 410);
  const holder = { user: { id: 'pending-user' } };
  multipartReservationStore.reserve(holder, 8);
  const partial = path.join(root, 'temp', 'reserved-partial'); fs.writeFileSync(partial, Buffer.alloc(6));
  multipartReservationStore.setPath(holder, partial);
  try {
    assert.equal(multipartReservationStore.pendingBytes({ ownerId: 'pending-user' }), 8);
    assert.equal(multipartReservationStore.remainingBytes(), 2);
    assert.throws(() => fileService.assertUserQuota({ id: 'pending-user', quota_bytes: 8 }, 1), error => error.statusCode === 413);
    fileService.assertUserQuota({ id: 'pending-user', quota_bytes: 8 }, 8, { excludeRequest: holder });
  } finally { multipartReservationStore.release(holder); }

  const responses = [];
  let admitted = 0;
  for (let index = 0; index < 11; index++) {
    const response = new EventEmitter(); response.destroyed = false; responses.push(response);
    limitUploadRequests({ user: req.user, destroyed: false }, response, error => { if (error) throw error; admitted++; });
  }
  assert.equal(admitted, 10, 'body parsing must wait for a transfer slot');
  responses[0].emit('finish');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(admitted, 11);
  for (const response of responses) response.emit('finish');
  console.log('Upload race tests passed: serialized append/complete/cancel, partial-write recovery, transactional rollback, cancellation tombstones and pre-body admission.');
} finally { fs.promises.appendFile = originalAppend; closeDatabase(); fs.rmSync(root, { recursive: true, force: true }); }
