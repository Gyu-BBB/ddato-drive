import { fillPixels } from './imageFillPixels.js';

self.onmessage = async ({ data }) => {
  try {
    const image = new ImageData(new Uint8ClampedArray(data.pixels), data.width, data.height);
    const bounds = fillPixels(image, data.operation);
    if (!bounds) { self.postMessage({ type: 'result', patch: null }); return; }
    const { left: x, top: y, right, bottom } = bounds;
    const patch = await createImageBitmap(image, x, y, right - x + 1, bottom - y + 1);
    self.postMessage({ type: 'result', patch, x, y }, [patch]);
  } catch (error) { self.postMessage({ type: 'error', message: error.message }); }
};
