import assert from 'node:assert/strict';
import { createSpeedMeter } from '../src/client/shared/lib/transferProgress.js';
import { startDownload, getDownloads, subscribeDownloads, clearDownloads, cancelDownload } from '../src/client/features/files/downloadTransfers.js';

let time = 0;
const meter = createSpeedMeter(() => time);
time = 500;
assert.equal(meter(1024), 2048);
time = 1000;
assert.equal(meter(3072), 4096);
time = 1500;
assert.equal(meter(3072), 0);

const written = [];
let closed = false;
globalThis.window = { showSaveFilePicker: async () => ({ createWritable: async () => ({
  write: async chunk => written.push(chunk), close: async () => { closed = true; }, abort: async () => {}
}) }) };
globalThis.fetch = async () => new Response(new ReadableStream({
  start(controller) {
    controller.enqueue(new Uint8Array(1024));
    controller.enqueue(new Uint8Array(2048));
    controller.close();
  }
}), { headers: { 'Content-Length': '3072' } });
const snapshots = [];
const unsubscribe = subscribeDownloads(() => snapshots.push({ ...getDownloads().at(-1) }));
await startDownload('/fixture', 'fixture.bin');
assert(closed);
assert.equal(written.reduce((sum, chunk) => sum + chunk.byteLength, 0), 3072);
assert(snapshots.some(item => item.status === 'uploading' && item.uploadedBytes > 0 && item.sizeBytes === 3072));
assert.equal(getDownloads().at(-1).status, 'done');
assert.equal(getDownloads().at(-1).progress, 100);
written.length = 0;
snapshots.length = 0;
globalThis.fetch = async () => new Response(new ReadableStream({
  start(controller) {
    for (let index = 0; index < 4096; index++) controller.enqueue(new Uint8Array(1024).fill(index % 256));
    controller.close();
  }
}), { headers: { 'Content-Length': String(4 * 1024 * 1024) } });
await startDownload('/large-fixture', 'large.bin');
assert.equal(written.length, 4, '4096 network chunks should be batched into four disk writes');
assert(snapshots.length < 30, 'progress should not render once per network chunk');
const bytes = new Uint8Array(await new Blob(written).arrayBuffer());
assert.equal(bytes.length, 4 * 1024 * 1024);
for (let index = 0; index < 4096; index++) assert.equal(bytes[index * 1024], index % 256);
console.log(`Download batching: 4096 chunks -> ${written.length} writes, ${snapshots.length} progress updates.`);
globalThis.fetch = async () => new Response(JSON.stringify({ error: '암호가 필요합니다.', details: { code: 'password_required' } }), { status: 423 });
await startDownload('/locked', 'locked.bin');
assert.equal(getDownloads().at(-1).status, 'failed');
assert.equal(getDownloads().at(-1).error, '암호가 필요합니다.');
let aborted = false;
globalThis.window.showSaveFilePicker = async () => ({ createWritable: async () => ({
  write: async () => { cancelDownload(getDownloads().at(-1).id); },
  close: async () => { throw new Error('canceled download must not finish'); },
  abort: async () => { aborted = true; }
}) });
globalThis.fetch = async () => new Response(new Uint8Array(1024 * 1024));
await startDownload('/cancel-fixture', 'cancel.bin');
assert(aborted);
assert.equal(getDownloads().at(-1).status, 'failed');
assert.equal(getDownloads().at(-1).error, '다운로드가 취소되었습니다.');
const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
const originalDocument = globalThis.document;
const originalTimeout = globalThis.setTimeout;
const cleanupUrls = [];
const anchors = [];
try {
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {} });
  globalThis.window = {};
  globalThis.document = {
    createElement: () => ({ click() { anchors.push({ href: this.href, name: this.download }); }, remove() {} }),
    body: { append() {} }
  };
  globalThis.setTimeout = (callback, delay, ...args) => {
    if (delay === 60000) { cleanupUrls.push(callback); return 0; }
    return originalTimeout(callback, delay, ...args);
  };
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, ...options });
    return new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Length': '3' } });
  };
  await startDownload('/lan/file', 'single.txt');
  const single = getDownloads().at(-1);
  assert.equal(single.status, 'done');
  assert.equal(single.uploadedBytes, 3);
  assert(single.id.startsWith('download-'));
  await startDownload('/api/files/download', 'selection.zip', { method: 'POST', body: { ids: ['one', 'two'] } });
  assert.equal(getDownloads().at(-1).status, 'done');
  assert.notEqual(single.id, getDownloads().at(-1).id);
  assert.deepEqual(JSON.parse(requests[1].body), { ids: ['one', 'two'] });
  assert(requests.every(request => request.credentials === 'include'));
  assert.deepEqual(anchors.map(anchor => anchor.name), ['single.txt', 'selection.zip']);
  assert(anchors.every(anchor => anchor.href.startsWith('blob:')));
  console.log('LAN HTTP fallback passed: no randomUUID/file picker, single download, multi-file POST, browser save and authenticated requests.');
} finally {
  for (const cleanup of cleanupUrls) cleanup();
  Object.defineProperty(globalThis, 'crypto', cryptoDescriptor);
  if (originalDocument === undefined) delete globalThis.document;
  else globalThis.document = originalDocument;
  globalThis.setTimeout = originalTimeout;
}
clearDownloads();
assert.equal(getDownloads().length, 0);
unsubscribe();
console.log('Transfer progress tests passed.');
