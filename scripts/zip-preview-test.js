import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { ZipArchiveService } from '../src/features/files/ZipArchiveService.js';
import { zipPreviewService } from '../src/features/files/ZipPreviewService.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ddato-zip-preview-'));
async function archive(names) {
  const stream = new PassThrough();
  const buffers = [];
  stream.on('data', chunk => buffers.push(chunk));
  await new ZipArchiveService().writeZipStream(stream, names.map(name => ({
    nameBuffer: Buffer.from(name), size: 0, isDirectory: true, dos: { dosTime: 0, dosDate: 33 }
  })));
  return Buffer.concat(buffers);
}
try {
  const empty = path.join(root, 'empty.zip');
  fs.writeFileSync(empty, await archive([]));
  assert.equal((await zipPreviewService.inspect(empty)).entries.length, 0);
  const normal = path.join(root, 'normal.zip');
  const encoded = await archive(['한글/'.normalize('NFD'), 'folder/', 'folder/nested/']);
  fs.writeFileSync(normal, encoded);
  const listing = await zipPreviewService.inspect(normal);
  assert.equal(listing.entries[0].path, '한글/');
  assert.equal(listing.totalEntries, 3);
  assert.equal(listing.truncated, false);
  const encrypted = Buffer.from(encoded);
  let central = encrypted.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  encrypted.writeUInt16LE(encrypted.readUInt16LE(central + 8) | 1, central + 8);
  fs.writeFileSync(normal, encrypted);
  assert((await zipPreviewService.inspect(normal)).entries[0].encrypted);
  const invalid = path.join(root, 'invalid.zip');
  fs.writeFileSync(invalid, 'not a zip file');
  await assert.rejects(zipPreviewService.inspect(invalid), error => error.status === 422 || error.statusCode === 422);
  const unsafe = path.join(root, 'unsafe.zip');
  fs.writeFileSync(unsafe, await archive(['../outside/']));
  await assert.rejects(zipPreviewService.inspect(unsafe));
  const large = path.join(root, 'many.zip');
  fs.writeFileSync(large, await archive(Array.from({ length: 10001 }, (_, index) => `${index}/`)));
  const limited = await zipPreviewService.inspect(large);
  assert.equal(limited.entries.length, 10000);
  assert.equal(limited.totalEntries, 10001);
  assert.equal(limited.truncated, true);
  assert.deepEqual(fs.readdirSync(root).sort(), ['empty.zip', 'invalid.zip', 'many.zip', 'normal.zip', 'unsafe.zip']);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
console.log('ZIP preview tests passed: Unicode, empty, encrypted, corrupt, unsafe paths, limits and no extraction.');
