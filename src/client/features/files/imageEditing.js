import { imageGeometry, paintImageBrush } from './imageBrushes.js';

export const MAX_EDIT_PIXELS = 24_000_000;

export function renderImageEdits(target, source, operations) {
  target.width = source.width;
  target.height = source.height;
  // Keep mask/brush rasterization stable across readback, export and history replay.
  let context = target.getContext('2d', { willReadFrequently: true });
  context.drawImage(source, 0, 0);
  for (const [index, operation] of operations.entries()) {
    if (operation.type === 'pen') {
      paintStroke(context, operation);
      continue;
    }
    if (operation.type === 'erase' || operation.type === 'restore') {
      const transform = operation.type === 'restore' ? imageGeometry(source, operations.slice(0, index)).transform : null;
      paintImageBrush(context, operation, source, transform);
      continue;
    }
    if (operation.type === 'mask') {
      context.save();
      context.globalCompositeOperation = 'destination-in';
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(operation.mask, 0, 0, target.width, target.height);
      context.restore();
      continue;
    }
    const previous = document.createElement('canvas');
    previous.width = target.width;
    previous.height = target.height;
    previous.getContext('2d').drawImage(target, 0, 0);
    if (operation.type === 'rotate') {
      target.width = previous.height;
      target.height = previous.width;
      context = target.getContext('2d');
      context.save();
      context.translate(target.width / 2, target.height / 2);
      context.rotate(operation.direction * Math.PI / 2);
      context.drawImage(previous, -previous.width / 2, -previous.height / 2);
      context.restore();
    } else if (operation.type === 'crop') {
      const x = Math.max(0, Math.min(previous.width - 1, Math.round(operation.x)));
      const y = Math.max(0, Math.min(previous.height - 1, Math.round(operation.y)));
      target.width = Math.max(1, Math.min(previous.width - x, Math.round(operation.width)));
      target.height = Math.max(1, Math.min(previous.height - y, Math.round(operation.height)));
      context = target.getContext('2d');
      context.drawImage(previous, x, y, target.width, target.height, 0, 0, target.width, target.height);
    }
    previous.width = previous.height = 0;
  }
}

export function paintStroke(context, { points, color, width }) {
  if (!points.length) return;
  context.save();
  context.strokeStyle = context.fillStyle = color;
  context.lineWidth = width;
  context.lineCap = context.lineJoin = 'round';
  context.beginPath();
  if (points.length === 1) {
    context.arc(points[0].x, points[0].y, width / 2, 0, Math.PI * 2);
    context.fill();
  } else {
    context.moveTo(points[0].x, points[0].y);
    for (const point of points.slice(1)) context.lineTo(point.x, point.y);
    context.stroke();
  }
  context.restore();
}

export function editedImageName(name) {
  return `${name.replace(/\.[^.]+$/, '')} 편집.png`;
}

export function canvasPng(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('이미지를 읽지 못했습니다.')), 'image/png'));
}
