import assert from 'node:assert/strict';
import { indexedDB } from 'fake-indexeddb';
import { getStoredUploads, saveStoredUpload, removeStoredUpload } from '../src/client/features/files/uploadQueueStore.js';

globalThis.window = { indexedDB };
const open = (version) => new Promise((resolve, reject) => {
  const request = indexedDB.open('ddato-drive-upload-queue', version);
  request.onupgradeneeded = () => {
    const store = request.result.createObjectStore('uploads', { keyPath: 'id' });
    store.createIndex('accountId', 'accountId');
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
const legacy = await open(1);
const transaction = legacy.transaction('uploads', 'readwrite');
transaction.objectStore('uploads').put({ id: 'old', accountId: 'alice', status: 'paused', file: new Blob(['preserved data']) });
await new Promise(resolve => { transaction.oncomplete = resolve; });
legacy.close();

const restored = await getStoredUploads('alice');
assert.equal(await restored[0].file.text(), 'preserved data');
assert.equal(restored[0].status, 'paused');
for (let index = 0; index < 10; index++) {
  await saveStoredUpload({ ...restored[0], uploadedBytes: index, status: 'uploading' });
}
const database = await open(2);
const read = database.transaction(['uploads', 'uploadFiles'], 'readonly');
const result = request => new Promise(resolve => { request.onsuccess = () => resolve(request.result); });
const metadataRequest = read.objectStore('uploads').get('old');
const payloadRequest = read.objectStore('uploadFiles').getAll();
const [metadata, payloads] = await Promise.all([result(metadataRequest), result(payloadRequest)]);
assert.equal(metadata.file, undefined);
assert.equal(metadata.uploadedBytes, 9);
assert.equal(payloads.length, 1);
assert.equal(await payloads[0].file.text(), 'preserved data');
assert.equal((await getStoredUploads('bob')).length, 0);
database.close();
await removeStoredUpload('old');
assert.equal((await getStoredUploads('alice')).length, 0);
console.log('Upload store migration, payload separation, resume and cancellation tests passed.');
