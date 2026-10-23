import * as ort from 'onnxruntime-web/wasm';
import { BACKGROUND_ASSET_PATH, MODEL_INPUT_SIZE } from './config.js';
import { normalizedAlphaMask, normalizedImageTensor } from './modelPixels.js';
import { MAX_EDIT_PIXELS } from '../imageEditing.js';

self.onmessage = async ({ data: { blob } }) => {
  let session;
  let bitmap;
  try {
    const base = new URL(BACKGROUND_ASSET_PATH, self.location.origin).href;
    ort.env.wasm.wasmPaths = base;
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    ort.env.logLevel = 'error';
    self.postMessage({ type: 'progress', stage: 'loading' });
    bitmap = await createImageBitmap(blob);
    if (bitmap.width * bitmap.height > MAX_EDIT_PIXELS) throw new Error('이미지가 너무 커서 배경을 제거할 수 없습니다.');
    const response = await fetch(`${base}u2netp.onnx`, { credentials: 'omit' });
    if (!response.ok) throw new Error('배경 제거 모델을 불러오지 못했습니다. 연결을 확인하고 다시 시도해 주세요.');
    session = await ort.InferenceSession.create(await response.arrayBuffer(), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    const input = new OffscreenCanvas(MODEL_INPUT_SIZE, MODEL_INPUT_SIZE);
    const inputContext = input.getContext('2d', { willReadFrequently: true });
    inputContext.fillStyle = '#ffffff';
    inputContext.fillRect(0, 0, input.width, input.height);
    inputContext.drawImage(bitmap, 0, 0, input.width, input.height);
    const pixels = inputContext.getImageData(0, 0, input.width, input.height);
    const tensor = new ort.Tensor('float32', normalizedImageTensor(pixels.data), [1, 3, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE]);
    self.postMessage({ type: 'progress', stage: 'processing' });
    const output = await session.run({ [session.inputNames[0]]: tensor }, [session.outputNames[0]]);
    const mask = new OffscreenCanvas(MODEL_INPUT_SIZE, MODEL_INPUT_SIZE);
    mask.getContext('2d').putImageData(new ImageData(normalizedAlphaMask(output[session.outputNames[0]].data), mask.width, mask.height), 0, 0);
    tensor.dispose();
    for (const result of Object.values(output)) result.dispose();
    await session.release();
    session = null;
    // Return only the small alpha mask: history keeps original-resolution RGB pixels.
    self.postMessage({ type: 'result', blob: await mask.convertToBlob({ type: 'image/png' }) });
  } catch (error) {
    self.postMessage({ type: 'error', message: error.message || '배경을 제거하지 못했습니다.' });
  } finally {
    bitmap?.close();
    await session?.release().catch(() => {});
  }
};
