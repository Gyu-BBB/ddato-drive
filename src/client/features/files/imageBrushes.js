function strokeOutline({ points, width }) {
  const path = new Path2D();
  const radius = width / 2;
  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    path.moveTo(point.x + radius, point.y);
    path.arc(point.x, point.y, radius, 0, Math.PI * 2);
    const previous = points[i - 1];
    if (!previous) continue;
    const distance = Math.hypot(point.x - previous.x, point.y - previous.y);
    if (!distance) continue;
    const dx = (point.y - previous.y) * radius / distance;
    const dy = -(point.x - previous.x) * radius / distance;
    path.moveTo(previous.x + dx, previous.y + dy);
    path.lineTo(point.x + dx, point.y + dy);
    path.lineTo(point.x - dx, point.y - dy);
    path.lineTo(previous.x - dx, previous.y - dy);
    path.closePath();
  }
  return path;
}

export function imageGeometry(source, operations = []) {
  let width = source.width;
  let height = source.height;
  let transform = [1, 0, 0, 1, 0, 0];
  for (const operation of operations) {
    const [a, b, c, d, e, f] = transform;
    if (operation.type === 'rotate') {
      transform = operation.direction === 1 ? [-b, a, -d, c, height - f, e] : [b, -a, d, -c, f, width - e];
      [width, height] = [height, width];
    } else if (operation.type === 'crop') {
      const x = Math.max(0, Math.min(width - 1, Math.round(operation.x)));
      const y = Math.max(0, Math.min(height - 1, Math.round(operation.y)));
      transform = [a, b, c, d, e - x, f - y];
      width = Math.max(1, Math.min(width - x, Math.round(operation.width)));
      height = Math.max(1, Math.min(height - y, Math.round(operation.height)));
    }
  }
  return { width, height, transform };
}

export function paintImageBrush(context, stroke, source, transform) {
  if (!stroke.points.length) return;
  const outline = strokeOutline(stroke);
  context.save();
  if (stroke.type === 'erase') {
    context.globalCompositeOperation = 'destination-out';
    context.fillStyle = '#000000';
    context.fill(outline);
  } else if (stroke.type === 'restore') {
    // Clip original pixels directly; no full-resolution restore-layer copy is needed.
    context.clip(outline);
    context.clearRect(0, 0, context.canvas.width, context.canvas.height);
    context.globalCompositeOperation = 'source-over';
    context.setTransform(...transform);
    context.drawImage(source, 0, 0);
  }
  context.restore();
}
