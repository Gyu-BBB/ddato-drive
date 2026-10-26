import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { sendFileStream } from '../src/core/http.js';
import { ZipArchiveService } from '../src/features/files/ZipArchiveService.js';
import { parseByteRange } from '../src/core/httpRange.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ddato-download-stream-'));
function response() {
  const stream = new PassThrough(); stream.headers = {};
  stream.setHeader = (name, value) => { stream.headers[name] = value; return stream; };
  stream.status = code => { stream.statusCode = code; return stream; };
  return stream;
}
try {
  assert.deepEqual(parseByteRange('bytes=-3', 10), { start: 7, end: 9 });
  assert.deepEqual(parseByteRange('bytes=2-999', 10), { start: 2, end: 9 });
  assert.equal(parseByteRange('bytes=0-1,4-5', 10), null);
  const file = path.join(root, 'data.bin'); fs.writeFileSync(file, Buffer.alloc(1024 * 1024, 65));
  let source;
  const disconnected = response();
  disconnected.once('data', () => disconnected.destroy(new Error('injected client disconnect')));
  await assert.rejects(sendFileStream({ headers: {}, method: 'GET' }, disconnected, file, { fs: {
    statSync: fs.statSync, createReadStream: (...args) => { source = fs.createReadStream(...args); return source; }
  } }));
  assert(source.destroyed, 'client disconnect must close the file descriptor');
  const broken = response(); broken.resume();
  await assert.rejects(sendFileStream({ headers: {}, method: 'GET' }, broken, file, { fs: {
    statSync: fs.statSync, createReadStream: () => new Readable({ read() { this.destroy(new Error('injected disk read failure')); } })
  } }));
  assert(broken.destroyed);
  const zip = new ZipArchiveService();
  const entry = { nameBuffer: Buffer.from('data.bin'), absolutePath: file, size: fs.statSync(file).size + 1,
    isDirectory: false, dos: { dosTime: 0, dosDate: 0 } };
  const truncated = response(); truncated.resume();
  await assert.rejects(zip.writeZipStream(truncated, [entry]), /source changed/);
  const gone = response(); gone.once('data', () => gone.destroy(new Error('injected ZIP disconnect')));
  await assert.rejects(zip.writeZipStream(gone, [{ ...entry, size: 1024 * 1024 }]));
  console.log('Download stream tests passed: ranges, source errors, client disconnect cleanup, ZIP truncation and ZIP disconnects.');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
