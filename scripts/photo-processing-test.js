import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'drive-photos-'));
process.env.DDATO_DRIVE_DATA_DIR = root; process.env.DDATO_DRIVE_DB_FILE = path.join(root, 'drive.sqlite');
const { initializeDatabase, closeDatabase, getDb } = await import('../src/database/database.js');
const { photoMetadataService, MAX_PHOTO_INSPECTION_BYTES } = await import('../src/features/files/PhotoMetadataService.js');
const { fileRepository } = await import('../src/features/files/FileRepository.js');
const { resumableUploadService: service } = await import('../src/features/files/ResumableUploadService.js');
const { fileService } = await import('../src/features/files/FileService.js');
initializeDatabase();
try {
  getDb().prepare("INSERT INTO users(id,password_hash,role,quota_bytes,created_at,updated_at) VALUES ('photo-user','test','user',1000000,0,0)").run();
  const req = { user: getDb().prepare("SELECT * FROM users WHERE id = 'photo-user'").get(), headers: {}, socket: {} };
  // Minimal TIFF EXIF segment inserted into a JPEG container.
  const tiff = Buffer.alloc(64); tiff.write('II'); tiff.writeUInt16LE(42, 2); tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(1, 8); tiff.writeUInt16LE(0x8769, 10); tiff.writeUInt16LE(4, 12); tiff.writeUInt32LE(1, 14); tiff.writeUInt32LE(26, 18);
  tiff.writeUInt16LE(1, 26); tiff.writeUInt16LE(0x9003, 28); tiff.writeUInt16LE(2, 30); tiff.writeUInt32LE(20, 32); tiff.writeUInt32LE(44, 36);
  tiff.write('2024:07:25 16:34:23\0', 44);
  const segment = Buffer.concat([Buffer.from('Exif\0\0'), tiff]); const length = Buffer.alloc(2); length.writeUInt16BE(segment.length + 2);
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe1]), length, segment, Buffer.from([0xff, 0xd9])]);
  const fixture = path.join(root, 'fixture.jpg'); fs.writeFileSync(fixture, jpeg);
  const metadata = await photoMetadataService.inspect(fixture, { name: 'photo.jpg', sizeBytes: jpeg.length });
  assert.equal(metadata.contentSha256, crypto.createHash('sha256').update(jpeg).digest('hex'));
  assert.equal(new Date(metadata.capturedAt).getFullYear(), 2024);
  assert.deepEqual(await photoMetadataService.inspect(fixture, { name: 'huge.jpg', sizeBytes: MAX_PHOTO_INSPECTION_BYTES + 1 }), {});
  for (let index = 0; index < 2; index++) {
    const session = service.createSession(req, { name: `photo-${index}.jpg`, sizeBytes: jpeg.length, sourceModifiedAt: 1700000000000 });
    await service.appendChunk(req.user, session.id, { offset: 0, buffer: jpeg });
    const completed = await service.completeSession(req, session.id);
    assert.equal(completed.sourceModifiedAt, 1700000000000); assert.equal(completed.capturedAt, metadata.capturedAt);
  }
  const listed = fileService.listFiles(req).files;
  assert(listed.every(file => file.duplicatePhotoCount === 1));
  assert.equal(fileRepository.photoCounts('someone-else').size, 0);
  fileRepository.markDeleted([fileRepository.findById(listed[0].id)]);
  assert.equal(fileService.listFiles(req).files[0].duplicatePhotoCount, 0);
  fs.writeFileSync(fixture, 'invalid photo');
  assert.equal((await photoMetadataService.inspect(fixture, { name: 'broken.jpg', sizeBytes: 13 })).capturedAt, null);
  console.log('Photos: EXIF capture date, original modification date, streamed SHA-256, owner-scoped duplicate detection, trash exclusion and malformed EXIF fallback passed.');
} finally { closeDatabase(); fs.rmSync(root, { recursive: true, force: true }); }
