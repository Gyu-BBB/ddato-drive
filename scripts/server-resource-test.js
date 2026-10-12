import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { crc32, deflateRawSync } from 'node:zlib';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ddato-resource-test-'));
process.env.DDATO_DRIVE_DATA_DIR = root;
process.env.DDATO_DRIVE_DB_FILE = path.join(root, 'app-data', 'drive.sqlite');
const { initializeDatabase, closeDatabase, withTransaction } = await import('../src/database/database.js');
const { config } = await import('../src/core/config.js');
const { fileRepository } = await import('../src/features/files/FileRepository.js');
const { fileService } = await import('../src/features/files/FileService.js');
const { shareService } = await import('../src/features/shares/ShareService.js');
const { accessPasswordService } = await import('../src/features/protection/AccessPasswordService.js');
const { ArchivePreviewService } = await import('../src/features/files/ArchivePreviewService.js');
const { DocumentPreviewJobService } = await import('../src/features/files/DocumentPreviewJobService.js');
const { DocumentPreviewWorkerService } = await import('../src/features/files/DocumentPreviewWorkerService.js');
const { documentTextPreviewService } = await import('../src/features/files/DocumentTextPreviewService.js');
const { documentPdfPreviewService } = await import('../src/features/files/DocumentPdfPreviewService.js');
const { ZipArchiveService } = await import('../src/features/files/ZipArchiveService.js');
const originalList = fileRepository.listActiveByOwner;
const originalFolders = fileRepository.listFoldersByOwner;
const tick = () => new Promise(resolve => setImmediate(resolve));

async function until(predicate) {
  for (let i = 0; i < 2000; i++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 1));
  }
  assert.fail('background work did not finish');
}

try {
  initializeDatabase();
  fileRepository.insertFolder({ id: 'protected', ownerId: config.adminId, parentId: null, name: 'Protected', accessPasswordHash: 'test-only' });
  fileRepository.insertFolder({ id: 'nested', ownerId: config.adminId, parentId: 'protected', name: 'Nested' });
  const files = [];
  withTransaction(() => {
    for (let i = 0; i < 2000; i++) files.push(fileRepository.insertFile({ id: `file-${i}`, ownerId: config.adminId,
      parentId: 'nested', name: `${i}.txt`, storedName: `${i}.txt`, mimeType: 'text/plain', sizeBytes: 1, storagePath: `storage/${i}.txt` }));
  });
  fileRepository.listActiveByOwner = () => assert.fail('metadata must not load all files per item');
  let folderQueries = 0;
  fileRepository.listFoldersByOwner = (...args) => { folderQueries++; return originalFolders.apply(fileRepository, args); };
  const req = { sessionToken: 'resource-test', headers: {}, socket: {} };
  const start = performance.now();
  const serialized = fileService.serializeFilesForRequest(req, config.adminId, files);
  assert.equal(folderQueries, 1);
  assert(serialized.every(file => file.passwordProtected && !file.passwordUnlocked));
  assert.deepEqual(serialized[0].path.map(folder => folder.id), ['protected', 'nested']);
  assert.equal(accessPasswordService.findFileProtection(files[0]).id, 'protected');
  accessPasswordService.grantAuthenticatedUnlock(req, 'file', 'protected');
  assert(fileService.serializeFilesForRequest(req, config.adminId, files).every(file => file.passwordUnlocked));
  fileRepository.setAccessPassword('nested', 'nearer-protection');
  assert.equal(accessPasswordService.findFileProtection(files[0]).id, 'nested', 'nearest lock must be read immediately');
  assert(!accessPasswordService.serializeFileProtection(req, files[0]).passwordUnlocked);
  console.log(`Metadata: 2,000 items, one folder query, zero whole-file-list queries, ${(performance.now() - start).toFixed(1)}ms; inherited lock rules preserved.`);
  fileRepository.listActiveByOwner = originalList;
  fileRepository.listFoldersByOwner = originalFolders;

  const sharedRoot = fileRepository.findById('protected');
  const originalTree = fileRepository.loadActiveTree;
  try {
    fileRepository.loadActiveTree = () => assert.fail('shared item access must not load the entire shared tree');
    assert.equal(shareService.getSharedTreeItem(sharedRoot, 'file-0').id, 'file-0');
    assert.equal(shareService.getPublicFolderInfo(sharedRoot, 'nested').files.length, 2000);
    const outside = fileRepository.insertFolder({ id: 'outside', ownerId: config.adminId, parentId: null, name: 'Outside' });
    assert.throws(() => shareService.getSharedTreeItem(sharedRoot, outside.id), error => error.statusCode === 404);
    assert.throws(() => shareService.getPublicFolderInfo(sharedRoot, outside.id), error => error.statusCode === 404);
  } finally {
    fileRepository.loadActiveTree = originalTree;
  }
  console.log('Shared folder access: ancestor-only membership lookup, outside-tree access still denied.');

  let active = 0;
  let peak = 0;
  let inspections = 0;
  const archive = new ArchivePreviewService({ concurrency: 2, maxCacheEntries: 2, maxCacheBytes: 1024,
    inspectFile: async () => {
      inspections++; active++; peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 5));
      active--;
      return { kind: 'zip', entries: [] };
    } });
  const archivePath = path.join(root, 'same.zip');
  fs.writeFileSync(archivePath, 'test');
  await Promise.all(Array.from({ length: 10 }, () => archive.inspect(archivePath, 'same.zip')));
  assert.equal(inspections, 1, 'duplicate requests must share one job');
  await archive.inspect(archivePath, 'same.zip');
  assert.equal(inspections, 1, 'unchanged archives must reuse the cache');
  fs.appendFileSync(archivePath, 'changed');
  await archive.inspect(archivePath, 'same.zip');
  assert.equal(inspections, 2);
  await Promise.all(Array.from({ length: 12 }, (_, i) => {
    const file = path.join(root, `archive-${i}.zip`);
    fs.writeFileSync(file, 'test');
    return archive.inspect(file, `${i}.zip`);
  }));
  assert.equal(peak, 2);
  assert(archive.cache.size <= 2 && archive.cacheBytes <= 1024);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const limited = new ArchivePreviewService({ concurrency: 1, maxQueue: 1, inspectFile: async () => { await gate; return { entries: [] }; } });
  const one = limited.inspect(archivePath, 'one.zip');
  await until(() => limited.workQueue.active === 1);
  const two = limited.inspect(archivePath, 'two.zip');
  await until(() => limited.workQueue.queue.length === 1);
  await assert.rejects(limited.inspect(archivePath, 'three.zip'), error => error.statusCode === 503);
  release();
  await Promise.all([one, two]);
  let failures = 0;
  const retry = new ArchivePreviewService({ inspectFile: async () => { if (!failures++) throw new Error('test error'); return { entries: [] }; } });
  await assert.rejects(retry.inspect(archivePath, 'retry.zip'));
  await retry.inspect(archivePath, 'retry.zip');
  assert.equal(retry.pending.size, 0);
  console.log('Archive work: concurrency 2, duplicate suppression, bounded cache, version invalidation, queue overflow and retry passed.');

  const ready = new Set();
  const releases = [];
  let conversions = 0;
  const jobs = new DocumentPreviewJobService({ maxQueue: 2, maxHistory: 1, converter: {
    canTryConvert: () => true, canConvert: () => true, cachedPdfPath: file => ready.has(file.id) ? '/ready.pdf' : '',
    convertToPdf: file => { conversions++; return new Promise(resolve => releases.push(() => { ready.add(file.id); resolve('/ready.pdf'); })); }
  } });
  const docs = ['one', 'two', 'three', 'four'].map(id => ({ id, original_name: `${id}.docx` }));
  assert.equal(jobs.getStatus(docs[0], '/input').status, 'running');
  assert.equal(jobs.getStatus(docs[1], '/input').status, 'queued');
  assert.equal(jobs.getStatus(docs[2], '/input').status, 'queued');
  assert.equal(jobs.getStatus(docs[3], '/input').status, 'pending');
  jobs.trim();
  assert.equal(jobs.jobs.size, 3, 'active jobs must not be evicted');
  for (let i = 1; i <= 3; i++) {
    await until(() => releases.length > 0);
    assert.equal(conversions, i, 'only one conversion may run');
    releases.shift()();
    await tick();
  }
  await until(() => !jobs.running);
  assert.equal(jobs.jobs.size, 1, 'completed history must be bounded');
  assert.equal(jobs.getStatus(docs[0], '/input').status, 'ready');
  assert.equal(jobs.getStatus(docs[3], '/input').status, 'running', 'deferred requests must retry when capacity returns');
  await until(() => releases.length > 0);
  releases.shift()();
  await until(() => !jobs.running);
  console.log('PDF work: single conversion, bounded queue/history, no active-job eviction and deferred retry passed.');

  const docPath = path.join(root, 'test.docx');
  fs.writeFileSync(docPath, documentZip([
    ['word/document.xml', '<w:document><w:p><w:t>Hello preview</w:t></w:p></w:document>'],
    ['word/media/unused.png', 'invalid compressed image', true]
  ]));
  const doc = { original_name: 'test.docx', updated_at: 1, size_bytes: fs.statSync(docPath).size };
  assert(documentTextPreviewService.extractText(doc, docPath).includes('Hello preview'), 'unused images must not be decompressed');
  const workers = new DocumentPreviewWorkerService();
  const firstWorker = workers.extractText(doc, docPath);
  assert.equal(workers.extractText(doc, docPath), firstWorker, 'duplicate document requests must share the worker');
  assert((await firstWorker).includes('Hello preview'));
  const brokenPath = path.join(root, 'broken.docx');
  fs.writeFileSync(brokenPath, 'not a zip');
  await assert.rejects(workers.extractText(doc, brokenPath));
  assert.equal(workers.pending.size, 0);
  assert((await workers.extractText(doc, docPath)).includes('Hello preview'), 'worker errors must not stall later jobs');
  const busyPath = path.join(root, 'busy.rtf');
  fs.writeFileSync(busyPath, `{\\rtf1 ${'Hello preview\\par '.repeat(200000)}}`);
  let heartbeats = 0;
  const heartbeat = setInterval(() => { heartbeats++; }, 5);
  try {
    assert((await workers.extractText({ original_name: 'busy.rtf' }, busyPath)).includes('Hello preview'));
    assert(heartbeats > 0, 'document parsing must leave the main event loop responsive');
  } finally {
    clearInterval(heartbeat);
  }
  const sheetPath = path.join(root, 'test.xlsx');
  fs.writeFileSync(sheetPath, documentZip([
    ['xl/workbook.xml', '<workbook><sheet name="Test"/></workbook>'],
    ['xl/sharedStrings.xml', '<sst><si><t>Hello</t></si></sst>'],
    ['xl/worksheets/sheet1.xml', '<worksheet><row><c t="s"><v>0</v></c><c><v>42</v></c></row></worksheet>'],
    ['xl/media/unused.png', 'invalid compressed image', true]
  ]));
  const spreadsheet = await workers.extractSpreadsheetPreview({ original_name: 'test.xlsx' }, sheetPath);
  assert.deepEqual(spreadsheet.sheets[0].rows, [['Hello', '42']]);
  assert.equal(spreadsheet.sheets[0].name, 'Test');
  console.log('Document parsing: unused images skipped, isolated worker, duplicate suppression and failure recovery passed.');

  const rtfPath = path.join(root, 'preview.rtf');
  fs.writeFileSync(rtfPath, '{\\rtf1\\ansi Hello preview\\par}');
  const rtf = { id: 'real-pdf-test', original_name: 'preview.rtf', size_bytes: fs.statSync(rtfPath).size, updated_at: 1 };
  if (documentPdfPreviewService.canConvert(rtf)) {
    const pdf = await documentPdfPreviewService.convertToPdf(rtf, rtfPath);
    assert(pdf, 'real document conversion must succeed');
    assert.equal(fs.readFileSync(pdf).subarray(0, 4).toString(), '%PDF');
    assert.equal((await documentPdfPreviewService.convertToPdf(rtf, rtfPath)), pdf);
    assert.deepEqual(fs.readdirSync(config.tempDir), [], 'conversion temporary files must be cleaned up');
    console.log('Real LibreOffice conversion passed: async copy, atomic cache publication, cache reuse and temporary cleanup.');
  }

  const zip = new ZipArchiveService();
  const sourcePath = path.join(root, 'checksum.bin');
  const payload = Buffer.from('123456789');
  fs.writeFileSync(sourcePath, payload);
  const entry = { nameBuffer: Buffer.from('checksum.bin'), absolutePath: sourcePath, size: payload.length,
    isDirectory: false, dos: { dosTime: 0, dosDate: 0 } };
  const chunks = [];
  const stream = new PassThrough();
  stream.on('data', chunk => chunks.push(chunk));
  await zip.writeZipStream(stream, [entry]);
  const bytes = Buffer.concat(chunks);
  const central = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  assert.equal(bytes.readUInt32LE(central + 16), 0xcbf43926);
  const disconnected = new Writable({ highWaterMark: 1, write(_chunk, _encoding, _callback) { setImmediate(() => this.destroy()); } });
  await assert.rejects(zip.writeZipStream(disconnected, [entry]), /disconnected/);
  const block = Buffer.alloc(8 * 1024 * 1024, 123);
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let value = i;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[i] = value >>> 0;
  }
  const oldStart = performance.now();
  let oldCrc = 0xffffffff;
  for (const byte of block) oldCrc = table[(oldCrc ^ byte) & 0xff] ^ (oldCrc >>> 8);
  const oldMs = performance.now() - oldStart;
  const nativeStart = performance.now();
  assert.equal(crc32(block), (oldCrc ^ 0xffffffff) >>> 0);
  const nativeMs = performance.now() - nativeStart;
  console.log(`ZIP: checksum integrity and disconnect cancellation passed; 8MiB CRC JS ${oldMs.toFixed(1)}ms -> native ${nativeMs.toFixed(1)}ms.`);
} finally {
  fileRepository.listActiveByOwner = originalList;
  fileRepository.listFoldersByOwner = originalFolders;
  closeDatabase();
  fs.rmSync(root, { recursive: true, force: true });
}

function documentZip(parts) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const [name, contents, invalid = false] of parts) {
    const nameBytes = Buffer.from(name);
    const raw = Buffer.from(contents);
    const compressed = invalid ? raw : deflateRawSync(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc32(raw), 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(nameBytes.length, 26);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(20, 6); header.writeUInt16LE(8, 10);
    header.writeUInt32LE(crc32(raw), 16); header.writeUInt32LE(compressed.length, 20); header.writeUInt32LE(raw.length, 24); header.writeUInt16LE(nameBytes.length, 28); header.writeUInt32LE(offset, 42);
    chunks.push(local, nameBytes, compressed); central.push(header, nameBytes);
    offset += local.length + nameBytes.length + compressed.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(parts.length, 8); end.writeUInt16LE(parts.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, directory, end]);
}
