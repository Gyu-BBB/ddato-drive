import assert from 'node:assert/strict';
import { collectSelectedUploadEntries, collectDroppedUploadEntries, uploadCollectedEntries } from '../src/client/features/files/dragDropUpload.js';

function file(name, relativePath = '') {
  const value = new File(['test contents'], name);
  Object.defineProperty(value, 'webkitRelativePath', { value: relativePath });
  return value;
}
const selected = collectSelectedUploadEntries([
  file('one.txt', '한글 폴더/one.txt'), file('two.txt', '한글 폴더/sub/two.txt'), file('plain.txt')
]);
const created = [];
const queued = [];
await uploadCollectedEntries({ entries: selected, rootParentId: 'current-folder', ownerId: 'owner',
  createFolder: async payload => { const id = `created-${created.length}`; created.push({ ...payload, id }); return { file: { id, name: `${payload.name} (server unique name)` } }; },
  uploadFile: async payload => queued.push(payload), onQueueAdd: () => {}, onQueueUpdate: () => {} });
assert.deepEqual(created.map(item => [item.name, item.parentId]), [['한글 폴더', 'current-folder'], ['sub', 'created-0']]);
assert.deepEqual(queued.map(item => [item.name, item.parentId]), [['one.txt', 'created-0'], ['two.txt', 'created-1'], ['plain.txt', 'current-folder']]);
assert(created.every(item => item.ownerId === 'owner'));

function directory(name, batches) {
  return { isDirectory: true, name, createReader: () => { let index = 0; return { readEntries: resolve => resolve(batches[index++] || []) }; } };
}
function entry(name) { return { isFile: true, file: resolve => resolve(file(name)) }; }
const empty = directory('empty', [[]]);
const root = directory('dropped', [[entry('first.txt'), empty], [entry('second.txt')], []]);
const dropped = await collectDroppedUploadEntries({ items: [{ kind: 'file', webkitGetAsEntry: () => root }] });
assert.deepEqual(dropped.directories, [['dropped'], ['dropped', 'empty']]);
assert.deepEqual(dropped.files.map(item => item.pathSegments), [['dropped', 'first.txt'], ['dropped', 'second.txt']]);
const emptyFolders = [];
await uploadCollectedEntries({ entries: { directories: dropped.directories, files: [] }, rootParentId: null,
  createFolder: async payload => { emptyFolders.push(payload); return { file: { id: payload.name } }; },
  uploadFile: () => assert.fail('empty folder must not enqueue fake files'), onQueueAdd: () => {}, onQueueUpdate: () => {} });
assert.deepEqual(emptyFolders.map(item => [item.name, item.parentId]), [['dropped', null], ['empty', 'dropped']]);
const fallback = await collectDroppedUploadEntries({ files: [file('fallback.txt', 'root/sub/fallback.txt')] });
assert.deepEqual(fallback.files[0].pathSegments, ['root', 'sub', 'fallback.txt']);
await assert.rejects(uploadCollectedEntries({ entries: selected, rootParentId: null,
  createFolder: async () => { throw new Error('quota or permission failure'); },
  uploadFile: () => assert.fail('failed folder creation must not upload into the wrong parent'), onQueueAdd: () => {}, onQueueUpdate: () => {} }));
console.log('Folder uploads passed: picker, hierarchy, Unicode, collisions, batched drops, empty folders and failure handling.');
