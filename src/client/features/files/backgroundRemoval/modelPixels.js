const mean = [0.485, 0.456, 0.406];
const std = [0.229, 0.224, 0.225];

export function normalizedImageTensor(rgba) {
  const pixels = rgba.length / 4;
  let max = 1e-6;
  for (let i = 0; i < rgba.length; i += 4) {
    max = Math.max(max, rgba[i], rgba[i + 1], rgba[i + 2]);
  }
  const tensor = new Float32Array(pixels * 3);
  for (let pixel = 0; pixel < pixels; pixel++) {
    for (let channel = 0; channel < 3; channel++) {
      tensor[channel * pixels + pixel] = (rgba[pixel * 4 + channel] / max - mean[channel]) / std[channel];
    }
  }
  return tensor;
}

export function normalizedAlphaMask(prediction) {
  let min = Infinity;
  let max = -Infinity;
  for (const value of prediction) {
    if (!Number.isFinite(value)) throw new Error('배경 제거 결과를 읽지 못했습니다.');
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  const range = max - min;
  const mask = new Uint8ClampedArray(prediction.length * 4);
  for (let i = 0; i < prediction.length; i++) {
    const alpha = range > 1e-6 ? (prediction[i] - min) / range : prediction[i];
    mask.set([255, 255, 255, Math.round(Math.max(0, Math.min(1, alpha)) * 255)], i * 4);
  }
  return mask;
}
