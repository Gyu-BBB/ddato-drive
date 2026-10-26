import assert from 'node:assert/strict';
import { fillPixels } from '../src/client/features/files/imageFillPixels.js';
import { colorWithOpacity, pixelHex } from '../src/client/features/files/imageFill.js';

function image(rows) {
  return { width: rows[0].length, height: rows.length, data: new Uint8ClampedArray(rows.flat(2)) };
}
const red = [255, 0, 0, 255];
const black = [0, 0, 0, 255];
const blue = [0, 0, 255, 255];
const pixel = (im, x, y) => [...im.data.slice((y * im.width + x) * 4, (y * im.width + x) * 4 + 4)];
const regions = image([[red, black, red], [red, black, red], [red, black, red]]);
assert.deepEqual(fillPixels(regions, { x: 0, y: 1, color: '#0000ff' }), { left: 0, top: 0, right: 0, bottom: 2 });
assert.deepEqual(pixel(regions, 0, 2), blue);
assert.deepEqual(pixel(regions, 2, 1), red, 'disconnected identical colors must remain unchanged');
assert.deepEqual(pixel(regions, 1, 1), black);
assert.equal(fillPixels(regions, { x: 0, y: 1, color: '#0000ff' }), null, 'same-color fill must not dirty history');
const diagonal = image([[red, black], [black, red]]);
fillPixels(diagonal, { x: 0, y: 0, color: '#0000ff', tolerance: 0 });
assert.deepEqual(pixel(diagonal, 1, 1), red, 'diagonals are not connected');
const similar = image([[red, [250, 0, 0, 255], [200, 0, 0, 255]]]);
fillPixels(similar, { x: 0, y: 0, color: '#fe0000', tolerance: 10 });
assert.deepEqual(pixel(similar, 0, 0), [254, 0, 0, 255]);
assert.deepEqual(pixel(similar, 1, 0), [254, 0, 0, 255], 'near-target replacement must fill, not loop or skip');
assert.deepEqual(pixel(similar, 2, 0), [200, 0, 0, 255]);
const transparent = image([[[255, 50, 100, 0], [0, 0, 0, 0], red]]);
fillPixels(transparent, { x: 0, y: 0, color: 'rgba(0,0,255,0.5)', tolerance: 0 });
assert.deepEqual(pixel(transparent, 1, 0), [0, 0, 255, 128], 'hidden RGB must not split transparent regions');
assert.deepEqual(pixel(transparent, 2, 0), red);
const edge = image([[red, red], [red, red]]);
fillPixels(edge, { x: 2, y: 2, color: '#0000ff', tolerance: 0 });
assert.deepEqual(pixel(edge, 1, 1), blue, 'edge coordinates must be clamped safely');
const big = { width: 1600, height: 1200, data: new Uint8ClampedArray(1600 * 1200 * 4).fill(255) };
fillPixels(big, { x: 800, y: 600, color: '#000000', tolerance: 0 });
assert.deepEqual(pixel(big, 1599, 1199), black, 'large connected regions must not overflow the call stack');
assert.equal(pixelHex([40, 120, 245, 128]), '#2878f5');
assert.equal(colorWithOpacity('#2878f5', 100), '#2878f5');
assert.equal(colorWithOpacity('#2878f5', 50), 'rgba(40,120,245,0.5)');
console.log('Fill tests passed: connected regions, barriers, diagonals, tolerance, similar-color replacement, alpha, edge coordinates, no-ops and large images.');
