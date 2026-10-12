import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ddato-storage-perf-'));
process.env.DDATO_DRIVE_DATA_DIR = root;
process.env.DDATO_DRIVE_DB_FILE = path.join(root, 'app-data', 'drive.sqlite');
const { config, ensureDataDirectories } = await import('../src/core/config.js');
const { getProjectStorageUsage, recordProjectTempGrowth } = await import('../src/core/storageUsage.js');
const { UploadSessionStore } = await import('../src/features/files/UploadSessionStore.js');
ensureDataDirectories();
const originalReadDir = fs.readdirSync;
let reads = 0;
try {
  for (let index = 0; index < 2000; index++) fs.writeFileSync(path.join(config.storageDir, String(index)), 'payload');
  fs.readdirSync = (...args) => { reads++; return originalReadDir(...args); };
  const initial = getProjectStorageUsage();
  assert.equal(initial.storageBytes, 14000);
  const firstReads = reads;
  const start = performance.now();
  for (let index = 0; index < 100; index++) {
    fs.appendFileSync(path.join(config.tempDir, 'partial.bin'), Buffer.alloc(128));
    recordProjectTempGrowth(128);
    assert.equal(getProjectStorageUsage({ maxAgeMs: 1000 }).usedBytes, initial.usedBytes + (index + 1) * 128);
  }
  assert.equal(reads, firstReads, 'chunk accounting must not rescan unchanged directories');
  console.log(`Storage accounting: 100 chunk checks, ${reads - firstReads} repeat directory scans, ${(performance.now() - start).toFixed(1)}ms.`);
  assert.equal(getProjectStorageUsage().usedBytes, initial.usedBytes + 12800);

  const store = new UploadSessionStore();
  const sessionDir = path.join(store.rootDir(), 'user', 'session');
  fs.mkdirSync(sessionDir, { recursive: true });
  const metadata = { id: 'session', ownerId: 'alice', sizeBytes: 100, updatedAt: Date.now() };
  fs.writeFileSync(path.join(sessionDir, 'metadata.json'), JSON.stringify(metadata));
  assert.equal(store.getPendingBytes({ ownerId: 'alice' }), 100);
  const sessionReads = reads;
  for (let index = 1; index <= 10; index++) {
    fs.appendFileSync(path.join(sessionDir, 'upload.bin'), Buffer.alloc(1));
    store.updateMetadata({ ...metadata, updatedAt: Date.now() });
    assert.equal(store.getPendingRemainingBytes({ ownerId: 'alice' }), 100 - index);
  }
  assert.equal(reads, sessionReads, 'session progress must not reread metadata directories');
  fs.rmSync(sessionDir, { recursive: true });
  store.invalidate();
  assert.equal(store.getPendingBytes({ ownerId: 'alice' }), 0);
} finally {
  fs.readdirSync = originalReadDir;
  fs.rmSync(root, { recursive: true, force: true });
}
console.log('Storage cache growth, reconciliation and session invalidation tests passed.');
