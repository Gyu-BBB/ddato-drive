import assert from 'node:assert/strict';
import { createSpeedMeter } from '../src/client/shared/lib/transferProgress.js';
import { formatPercent } from '../src/client/shared/lib/formatPercent.js';
import { currentTransferSpeed, estimateRemainingSeconds, formatRemainingTime, remainingTransfersLabel } from '../src/client/shared/lib/transferEta.js';

assert.equal(estimateRemainingSeconds(1000, 200, 100), 8);
assert.equal(estimateRemainingSeconds(1000, 1000, 0), 0);
assert.equal(estimateRemainingSeconds(1000, 1200, 100), 0);
for (const size of [null, undefined, NaN, Infinity, -1]) assert.equal(estimateRemainingSeconds(size, 0, 100), null);
for (const speed of [0, -1, NaN, Infinity]) assert.equal(estimateRemainingSeconds(1000, 200, speed), null);
for (const [seconds, expected] of [[null, '남은 시간 계산 중'], [Infinity, '남은 시간 계산 중'], [0, '마무리 중'], [0.1, '약 1초 남음'], [8, '약 8초 남음'], [61, '약 1분 1초 남음'], [3661, '약 1시간 1분 남음'], [90000, '약 1일 1시간 남음']]) {
  assert.equal(formatRemainingTime(seconds), expected);
}
const activeTransfer = { status: 'uploading', sizeBytes: 1000, uploadedBytes: 200, speedBytes: 100, speedUpdatedAt: 1000 };
assert.equal(currentTransferSpeed(activeTransfer, 2000), 100);
assert.equal(currentTransferSpeed(activeTransfer, 3000), 0);
assert.equal(remainingTransfersLabel([activeTransfer, { ...activeTransfer, status: 'queued', uploadedBytes: 0 }], 2000), '약 18초 남음');
assert.equal(remainingTransfersLabel([activeTransfer, { status: 'failed', sizeBytes: null }, { status: 'paused', sizeBytes: 999999 }, { status: 'done', sizeBytes: 999999 }], 2000), '약 8초 남음');
assert.equal(remainingTransfersLabel([activeTransfer], 3000), '남은 시간 계산 중');
assert.equal(remainingTransfersLabel([activeTransfer, { status: 'uploading', sizeBytes: null }], 2000), '남은 시간 계산 중');
console.log('Transfer ETA passed: individual/queued totals, stale speed, unknown sizes, finalizing and duration formatting.');

for (const [value, expected] of [[0, '0.00%'], [12.3456789, '12.35%'], [12.3, '12.30%'], [99.999, '100.00%'], [100, '100.00%'], [-1, '0.00%'], [NaN, '0.00%'], [Infinity, '0.00%']]) {
  assert.equal(formatPercent(value), expected);
}
import { startDownload, getDownloads, subscribeDownloads, clearDownloads, cancelDownload } from '../src/client/features/files/downloadTransfers.js';
import { downloadPickerOptions } from '../src/client/features/files/downloadFilename.js';

for (const [name, extension] of [
  ['보고서.pdf', '.pdf'], ['사진.JPG', '.JPG'], ['budget.2026.xlsx', '.xlsx'],
  ['선택 항목.zip', '.zip'], ['backup.tar.gz', '.tar.gz'], ['backup.TAR.XZ', '.TAR.XZ'],
  ['archive.7z', '.7z'], ['.env', '.env']
]) {
  const options = downloadPickerOptions(name);
  assert.equal(options.suggestedName, name);
  assert.equal(options.excludeAcceptAllOption, true);
  assert.deepEqual(options.types[0].accept['application/octet-stream'], [extension]);
}
for (const name of ['README', 'trailing.', 'file.extensionthatiswaytoolong']) {
  assert.deepEqual(downloadPickerOptions(name), { suggestedName: name });
}

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
const pickerOptions = [];
globalThis.window = { showSaveFilePicker: async options => {
  pickerOptions.push(options);
  return { createWritable: async () => ({
  write: async chunk => written.push(chunk), close: async () => { closed = true; }, abort: async () => {}
}) }; } };
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
assert.deepEqual(pickerOptions[0], downloadPickerOptions('fixture.bin'));
for (const [name, method] of [['바꿀 이름.pdf', 'GET'], ['선택 항목.zip', 'POST'], ['backup.tar.gz', 'GET']]) {
  await startDownload('/rename-fixture', name, { method, body: method === 'POST' ? { ids: ['one', 'two'] } : undefined });
  assert.equal(getDownloads().at(-1).status, 'done');
  assert.deepEqual(pickerOptions.at(-1), downloadPickerOptions(name));
}
console.log('Save dialog extension preservation passed: documents, ZIP selections, compound archives and extensionless files.');
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

let partialAborted = false;
globalThis.window = { showSaveFilePicker: async () => ({ createWritable: async () => ({
  write: async () => {}, close: async () => assert.fail('truncated transfers must not commit a local file'),
  abort: async () => { partialAborted = true; }
}) }) };
globalThis.fetch = async () => new Response(new Uint8Array([1, 2]), { headers: { 'Content-Length': '4' } });
await startDownload('/truncated', 'truncated.bin');
assert(partialAborted); assert.equal(getDownloads().at(-1).status, 'failed');
clearDownloads();
globalThis.window.showSaveFilePicker = async () => ({ createWritable: async () => ({ write: async () => {}, close: async () => {}, abort: async () => {} }) });
globalThis.fetch = async () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Length': '1', 'Content-Encoding': 'gzip' } });
await startDownload('/decoded', 'decoded.bin');
assert.equal(getDownloads().at(-1).status, 'done', 'decoded bytes must not be compared with encoded Content-Length');
clearDownloads();

let activeDownloads = 0;
let peakDownloads = 0;
let requestsStarted = 0;
globalThis.window.showSaveFilePicker = async () => ({ createWritable: async () => ({ write: async () => {}, close: async () => {}, abort: async () => {} }) });
globalThis.fetch = async () => {
  activeDownloads++; requestsStarted++; peakDownloads = Math.max(peakDownloads, activeDownloads);
  return new Response(new ReadableStream({ start(controller) {
    setTimeout(() => { activeDownloads--; controller.enqueue(new Uint8Array([1])); controller.close(); }, 40);
  } }), { headers: { 'Content-Length': '1' } });
};
const downloads = Array.from({ length: 25 }, (_, index) => startDownload('/concurrent', `file-${index}.bin`));
await new Promise(resolve => setTimeout(resolve, 10));
assert.equal(getDownloads().at(-1).status, 'queued');
cancelDownload(getDownloads().at(-1).id);
clearDownloads();
assert(getDownloads().length >= 24, 'clearing completed entries must keep queued transfers');
await Promise.all(downloads);
assert.equal(peakDownloads, 10); assert.equal(requestsStarted, 24);
clearDownloads();

const nativeStarts = [];
let canceledBodies = 0;
globalThis.window = {};
globalThis.document = {
  body: { append() {} },
  createElement(tag) { return { tag, children: [], append(child) { this.children.push(child); }, remove() {},
    click() { nativeStarts.push({ tag, url: this.href }); },
    submit() { nativeStarts.push({ tag, url: this.action, ids: this.children.map(child => child.value) }); }
  }; }
};
globalThis.fetch = async () => new Response(new ReadableStream({ cancel() { canceledBodies++; } }), {
  headers: { 'Content-Length': String(129 * 1024 * 1024) }
});
await startDownload('/large-native', 'large.bin');
assert.equal(getDownloads().at(-1).status, 'browser');
await startDownload('/api/files/download', 'selection.zip', { method: 'POST', body: { ids: ['one', 'two'] } });
assert.equal(getDownloads().at(-1).status, 'browser');
assert.deepEqual(nativeStarts, [{ tag: 'a', url: '/large-native' }, { tag: 'form', url: '/api/files/download', ids: ['one', 'two'] }]);
assert.equal(canceledBodies, 2);
clearDownloads();
console.log('Download reliability passed: truncated-file rejection, ten active transfers, queued cancellation/clearing and memory-safe native large-file/ZIP handoff.');
const { retryTransfer } = await import('../src/client/shared/lib/retryTransfer.js');
let attempts = 0;
const retryEvents = [];
assert.equal(await retryTransfer(async () => {
  if (++attempts < 3) throw Object.assign(new Error('temporary'), { status: 503 });
  return 'recovered';
}, { delayMs: 0, onRetry: attempt => retryEvents.push(attempt) }), 'recovered');
assert.deepEqual(retryEvents, [1, 2]);
attempts = 0;
await assert.rejects(retryTransfer(async () => { attempts++; throw Object.assign(new Error('quota'), { status: 413 }); }, { delayMs: 0 }));
assert.equal(attempts, 1, 'quota and permission failures must not be retried');
attempts = 0;
await assert.rejects(retryTransfer(async () => { attempts++; throw new TypeError('network'); }, { delayMs: 0 }));
assert.equal(attempts, 4, 'transient retries must be bounded');
const interruptedRetry = new AbortController();
await assert.rejects(retryTransfer(async () => { throw new TypeError('network'); }, {
  signal: interruptedRetry.signal, delayMs: 0, onRetry: () => interruptedRetry.abort()
}));
console.log('Transfer retries passed: bounded transient retries, non-retryable quotas and abortable backoff.');
