import FloodFill, { getColorAtPixel, isSameColor, setColorAtPixel } from 'q-floodfill/dist/index.bundle.esm.js';

export function fillPixels(imageData, { x, y, color, tolerance = 16 }) {
  x = Math.max(0, Math.min(imageData.width - 1, Math.floor(x)));
  y = Math.max(0, Math.min(imageData.height - 1, Math.floor(y)));
  const visited = new Uint8Array(Math.ceil(imageData.width * imageData.height / 8));
  const bounds = { left: imageData.width, top: imageData.height, right: -1, bottom: -1 };
  const fill = new FloodFill(imageData);
  fill.getColorAtPixel = (image, px, py) => ({ ...getColorAtPixel(image, px, py), index: py * image.width + px });
  // Track visits independently so a replacement within tolerance cannot be revisited.
  fill.isSameColor = (target, candidate, threshold) => {
    if (candidate.index === undefined) return isSameColor(target, candidate, 0);
    if (visited[candidate.index >> 3] & (1 << (candidate.index & 7))) return false;
    if (target.a === 0 && candidate.a === 0) return true;
    return isSameColor(target, candidate, threshold);
  };
  fill.setColorAtPixel = (image, replacement, px, py) => {
    const index = py * image.width + px;
    visited[index >> 3] |= 1 << (index & 7);
    setColorAtPixel(image, replacement, px, py);
    bounds.left = Math.min(bounds.left, px); bounds.right = Math.max(bounds.right, px);
    bounds.top = Math.min(bounds.top, py); bounds.bottom = Math.max(bounds.bottom, py);
  };
  fill.fill(color, x, y, Math.max(0, Math.min(255, tolerance)));
  return fill.modifiedPixelsCount ? bounds : null;
}
