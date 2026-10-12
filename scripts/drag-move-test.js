import assert from 'node:assert/strict';
import { INTERNAL_MOVE_TYPE, hasInternalMove, readInternalMoveIds, compactMoveSelection,
  dragSelection, canDropSelection, createMoveDragImage } from '../src/client/features/files/dragMove.js';

const folder = { id: 'folder', type: 'folder', name: 'Folder', parentId: null, path: [] };
const first = { id: 'first', type: 'file', name: 'First', parentId: null, path: [] };
const second = { id: 'second', type: 'file', name: 'Second', parentId: null, path: [] };
const child = { id: 'child', type: 'file', name: 'Child', parentId: folder.id, path: [folder] };
const nested = { id: 'nested', type: 'folder', parentId: folder.id, path: [folder] };
const target = { id: 'target', type: 'folder', path: [] };
assert.deepEqual(dragSelection(first, [first, second]), [first, second]);
assert.deepEqual(dragSelection(folder, [first, second]), [folder]);
assert.deepEqual(dragSelection(child, [folder, child, first]), [folder, first]);
assert.deepEqual(compactMoveSelection([first, null, first, second]), [first, second]);
assert(canDropSelection([first, second], target));
assert(!canDropSelection([folder, first], folder));
assert(!canDropSelection([folder, first], nested));
assert(!canDropSelection([first, second], null), 'dropping onto the existing home folder is a no-op');
assert(canDropSelection([child], null), 'a child can move back home');
assert(!canDropSelection([child], folder));
assert(!canDropSelection([child], first));
assert(!canDropSelection([], target));

const transfer = { types: [INTERNAL_MOVE_TYPE], getData: () => JSON.stringify(['first', 'second', 'first', null, 12]) };
assert(hasInternalMove(transfer));
assert(!hasInternalMove({ types: ['Files'] }));
assert.deepEqual(readInternalMoveIds(transfer), ['first', 'second']);
assert.deepEqual(readInternalMoveIds({ getData: () => '' }, ['first', 'second']), ['first', 'second']);
assert.deepEqual(readInternalMoveIds({ getData: () => 'broken JSON' }, ['first']), ['first']);

let image;
let removed = false;
globalThis.document = {
  createElement: () => ({ setAttribute() {}, remove() { removed = true; } }),
  body: { append(element) { image = element; } }
};
const removeImage = createMoveDragImage({ setDragImage(element, x, y) {
  assert.equal(element, image);
  assert.equal(x, 16);
  assert.equal(y, 16);
} }, [first, second]);
assert.equal(image.textContent, '2개 항목');
removeImage();
assert(removed);
delete globalThis.document;
console.log('Drag move passed: multi-selection, single-file fallback, ancestor deduplication, folder/home targets, no-op rejection, payload recovery and drag image cleanup.');
