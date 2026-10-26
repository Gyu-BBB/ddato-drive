import { Brush, Check, Crop, Eraser, Hand, Info, Loader2, PaintBucket, Pencil, Pipette, Redo2, RotateCcw, RotateCw, Save, Undo2, WandSparkles, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ReactCrop from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import './imageEditor.css';
import { Button } from '../../../shared/components/Button.jsx';
import { filesApi } from '../filesApi.js';
import { canvasPng, editedImageName, MAX_EDIT_PIXELS, paintStroke, renderImageEdits } from '../imageEditing.js';
import { removeImageBackground } from '../backgroundRemoval/backgroundRemoval.js';
import { BACKGROUND_ASSET_PATH, MODEL_INPUT_SIZE } from '../backgroundRemoval/config.js';
import { ImageZoom, ZOOM_TOOLBAR_HEIGHT } from './ImageZoom.jsx';
import { imageGeometry, paintImageBrush } from '../imageBrushes.js';
import { colorWithOpacity, fillImageRegion, pixelHex } from '../imageFill.js';

const initialCrop = () => ({ unit: '%', x: 10, y: 10, width: 80, height: 80 });
const colors = ['#ff3b30', '#ffcc00', '#34c759', '#007aff', '#ffffff', '#000000'];

export function ImageEditor({ file, onClose, onSaved }) {
  const dialogRef = useRef(null);
  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const strokeRef = useRef(null);
  const brushCursorRef = useRef(null);
  const restoreTransformRef = useRef(null);
  const removalRef = useRef(null);
  const fillRef = useRef(null);
  const bitmapsRef = useRef(new Set());
  const [source, setSource] = useState(null);
  const [history, setHistory] = useState({ past: [], future: [] });
  const [tool, setTool] = useState('pen');
  const [crop, setCrop] = useState(initialCrop);
  const [color, setColor] = useState(colors[0]);
  const [opacity, setOpacity] = useState(100);
  const [tolerance, setTolerance] = useState(16);
  const [filling, setFilling] = useState(false);
  const [penWidth, setPenWidth] = useState(5);
  const [brushWidth, setBrushWidth] = useState(24);
  const [name, setName] = useState(editedImageName(file.name));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState('');
  const [dimensions, setDimensions] = useState({ width: 1, height: 1 });
  const [viewport, setViewport] = useState({ width: 1, height: 1 });
  const dirty = history.past.length > 0;

  useEffect(() => () => {
    removalRef.current?.abort();
    fillRef.current?.abort();
    for (const bitmap of bitmapsRef.current) bitmap.close();
    bitmapsRef.current.clear();
  }, []);

  useEffect(() => {
    const used = new Set([...history.past, ...history.future].map(item => item.mask || item.patch).filter(Boolean));
    for (const bitmap of bitmapsRef.current) {
      if (!used.has(bitmap)) { bitmap.close(); bitmapsRef.current.delete(bitmap); }
    }
  }, [history]);

  useEffect(() => {
    let active = true;
    let bitmap;
    (async () => {
      try {
        const blob = await filesApi.previewBlob(file.id);
        bitmap = await createImageBitmap(blob);
        if (!active) { bitmap.close(); return; }
        if (bitmap.width * bitmap.height > MAX_EDIT_PIXELS) {
          bitmap.close();
          throw new Error('이 이미지는 너무 큽니다. 2,400만 화소 이하의 이미지를 선택해 주세요.');
        }
        setSource(bitmap);
      } catch (nextError) {
        if (active) setError(nextError.message || '이미지를 열지 못했습니다.');
      }
    })();
    return () => { active = false; bitmap?.close(); };
  }, [file.id]);

  useLayoutEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      setViewport({ width: Math.max(1, entry.contentRect.width - 32), height: Math.max(1, entry.contentRect.height - 32 - ZOOM_TOOLBAR_HEIGHT) });
    });
    observer.observe(stageRef.current);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (!source) return;
    renderImageEdits(canvasRef.current, source, history.past);
    setDimensions({ width: canvasRef.current.width, height: canvasRef.current.height });
  }, [source, history.past]);

  useEffect(() => {
    const previous = document.activeElement;
    dialogRef.current.focus();
    return () => previous?.focus?.();
  }, []);

  function close() {
    if (!saving && (!dirty || window.confirm('편집 내용을 저장하지 않고 닫을까요?'))) {
      removalRef.current?.abort();
      fillRef.current?.abort();
      onClose();
    }
  }

  function handleKeys(event) {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    if (event.key === 'Tab') {
      const controls = [...dialogRef.current.querySelectorAll('button:not(:disabled), input:not(:disabled), a[href], [tabindex="0"]')];
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }

  function commit(operation) {
    setHistory(current => ({ past: [...current.past, operation], future: [] }));
    setCrop(initialCrop());
  }

  function point(event) {
    const canvas = canvasRef.current;
    const bounds = canvas.getBoundingClientRect();
    return { x: Math.max(0, Math.min(canvas.width, (event.clientX - bounds.left) * canvas.width / bounds.width)),
      y: Math.max(0, Math.min(canvas.height, (event.clientY - bounds.top) * canvas.height / bounds.height)) };
  }

  function startStroke(event) {
    if (!['pen', 'erase', 'restore', 'fill', 'picker'].includes(tool) || !source || saving || removalRef.current || fillRef.current || event.button !== 0 || strokeRef.current) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    if (tool === 'fill' || tool === 'picker') {
      strokeRef.current = { type: tool, point: point(event), clientX: event.clientX, clientY: event.clientY, pointerId: event.pointerId };
      return;
    }
    const width = tool === 'pen' ? penWidth * dimensions.width / displayWidth : brushWidth * dimensions.width / canvasRef.current.getBoundingClientRect().width;
    restoreTransformRef.current = tool === 'restore' ? imageGeometry(source, history.past).transform : null;
    strokeRef.current = { type: tool, color: colorWithOpacity(color, opacity), width, points: [point(event)], pointerId: event.pointerId };
    paintLiveStroke(strokeRef.current);
  }

  function moveStroke(event) {
    updateBrushCursor(event);
    const stroke = strokeRef.current;
    if (!stroke || stroke.pointerId !== event.pointerId) return;
    if (stroke.type === 'fill' || stroke.type === 'picker') {
      if (Math.hypot(event.clientX - stroke.clientX, event.clientY - stroke.clientY) > 6) stroke.moved = true;
      return;
    }
    const next = point(event);
    const previous = stroke.points.at(-1);
    if (Math.hypot(next.x - previous.x, next.y - previous.y) < 0.5) return;
    stroke.points.push(next);
    paintLiveStroke({ ...stroke, points: [previous, next] });
  }

  function paintLiveStroke(stroke) {
    const context = canvasRef.current.getContext('2d');
    if (stroke.type === 'pen') paintStroke(context, stroke);
    else paintImageBrush(context, stroke, source, restoreTransformRef.current);
  }

  function updateBrushCursor(event) {
    const cursor = brushCursorRef.current;
    if (!cursor) return;
    if (!['erase', 'restore'].includes(tool) || event.pointerType === 'touch') { cursor.hidden = true; return; }
    const stage = stageRef.current.getBoundingClientRect();
    cursor.hidden = false;
    cursor.style.width = cursor.style.height = `${brushWidth}px`;
    cursor.style.transform = `translate(${event.clientX - stage.left - brushWidth / 2}px, ${event.clientY - stage.top - brushWidth / 2}px)`;
  }

  function endStroke(event) {
    const stroke = strokeRef.current;
    if (!stroke || stroke.pointerId !== event.pointerId) return;
    strokeRef.current = null;
    if (stroke.type === 'fill' || stroke.type === 'picker') {
      if (event.type === 'pointercancel' || stroke.moved || Math.hypot(event.clientX - stroke.clientX, event.clientY - stroke.clientY) > 6) return;
      const canvas = canvasRef.current;
      const x = Math.min(canvas.width - 1, Math.floor(stroke.point.x));
      const y = Math.min(canvas.height - 1, Math.floor(stroke.point.y));
      if (stroke.type === 'picker') {
        const pixel = canvas.getContext('2d').getImageData(x, y, 1, 1).data;
        setColor(pixelHex(pixel)); setOpacity(pixel[3] / 255 * 100);
      } else void fillRegion(x, y);
      return;
    }
    if (event.type === 'pointercancel') renderImageEdits(canvasRef.current, source, history.past);
    else commit(stroke);
  }

  function cancelStroke() {
    if (!strokeRef.current) return;
    strokeRef.current = null;
    renderImageEdits(canvasRef.current, source, history.past);
  }

  async function fillRegion(x, y) {
    if (fillRef.current || removalRef.current || saving || !source) return;
    const controller = new AbortController();
    fillRef.current = controller;
    setFilling(true); setError('');
    try {
      const canvas = canvasRef.current;
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
      const operation = await fillImageRegion(pixels, { x, y, color: colorWithOpacity(color, opacity), tolerance }, { signal: controller.signal });
      if (controller.signal.aborted) { operation?.patch.close(); return; }
      if (operation) { bitmapsRef.current.add(operation.patch); commit(operation); }
    } catch (nextError) {
      if (!controller.signal.aborted) setError(nextError.message || '영역을 채우지 못했습니다.');
    } finally {
      if (fillRef.current === controller) { fillRef.current = null; setFilling(false); }
    }
  }

  function applyCrop() {
    if (!crop?.width || !crop?.height) return;
    commit({ type: 'crop', x: dimensions.width * crop.x / 100, y: dimensions.height * crop.y / 100,
      width: dimensions.width * crop.width / 100, height: dimensions.height * crop.height / 100 });
    setTool('pen');
  }

  async function removeBackground() {
    if (!source || saving || removalRef.current || fillRef.current || strokeRef.current) return;
    if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined' || typeof WebAssembly === 'undefined') {
      setError('이 브라우저에서는 배경 제거를 지원하지 않습니다. 최신 브라우저에서 다시 시도해 주세요.');
      return;
    }
    const controller = new AbortController();
    removalRef.current = controller;
    setRemoving('loading');
    setError('');
    try {
      const input = document.createElement('canvas');
      input.width = input.height = MODEL_INPUT_SIZE;
      const context = input.getContext('2d');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, input.width, input.height);
      context.drawImage(canvasRef.current, 0, 0, input.width, input.height);
      const blob = await canvasPng(input);
      input.width = input.height = 0;
      const result = await removeImageBackground(blob, { signal: controller.signal, onProgress: setRemoving });
      const mask = await createImageBitmap(result);
      if (controller.signal.aborted) { mask.close(); return; }
      bitmapsRef.current.add(mask);
      commit({ type: 'mask', mask });
      setTool('pen');
    } catch (nextError) {
      if (!controller.signal.aborted) setError(nextError.message || '배경을 제거하지 못했습니다.');
    } finally {
      if (removalRef.current === controller) { removalRef.current = null; setRemoving(''); }
    }
  }

  async function save() {
    if (saving || removalRef.current || fillRef.current || !source || !dirty) return;
    const filename = name.trim();
    if (!filename || /[\\/\x00-\x1f]/.test(filename)) { setError('올바른 파일 이름을 입력해 주세요.'); return; }
    setSaving(true);
    setError('');
    try {
      const blob = await canvasPng(canvasRef.current);
      const outputName = /\.png$/i.test(filename) ? filename : `${filename}.png`;
      const result = await filesApi.upload({ file: new File([blob], outputName, { type: 'image/png' }), parentId: file.parentId, ownerId: file.ownerId });
      await onSaved(result.file);
    } catch (nextError) {
      setError(nextError.message || '편집한 이미지를 저장하지 못했습니다.');
      setSaving(false);
    }
  }

  const scale = Math.min(1, viewport.width / dimensions.width, viewport.height / dimensions.height);
  const displayWidth = Math.max(1, dimensions.width * scale);
  const displayHeight = Math.max(1, dimensions.height * scale);
  const disabled = !source || saving || Boolean(removing) || filling;

  return createPortal(<div className="modal-backdrop image-editor-backdrop">
    <section ref={dialogRef} className="image-editor" role="dialog" aria-modal="true" aria-labelledby="image-editor-title" tabIndex={-1} onKeyDown={handleKeys}>
      <header className="image-editor-header">
        <strong id="image-editor-title">이미지 편집</strong>
        <span title={file.name}>{file.name}</span>
        <a className="image-editor-notices" href={`${BACKGROUND_ASSET_PATH}NOTICE.txt`} target="_blank" rel="noreferrer" title="오픈소스 정보" aria-label="오픈소스 정보"><Info size={17} /></a>
        <Button icon={X} iconOnly onClick={close} disabled={saving}>편집 닫기</Button>
      </header>
      <div className="image-editor-tools" role="toolbar" aria-label="이미지 편집 도구">
        <Button icon={Crop} iconOnly aria-pressed={tool === 'crop'} disabled={disabled} onClick={() => setTool('crop')}>자르기</Button>
        <Button icon={Pencil} iconOnly aria-pressed={tool === 'pen'} disabled={disabled} onClick={() => setTool('pen')}>펜</Button>
        <Button icon={PaintBucket} iconOnly aria-pressed={tool === 'fill'} disabled={disabled} onClick={() => setTool('fill')}>채우기</Button>
        <Button icon={Pipette} iconOnly aria-pressed={tool === 'picker'} disabled={disabled} onClick={() => setTool('picker')}>스포이드</Button>
        <Button icon={Eraser} iconOnly aria-pressed={tool === 'erase'} disabled={disabled} onClick={() => setTool('erase')}>지우개</Button>
        <Button icon={Brush} iconOnly aria-pressed={tool === 'restore'} disabled={disabled} title="편집 시작 원본으로 복원" onClick={() => setTool('restore')}>복원 브러시</Button>
        <Button icon={Hand} iconOnly aria-pressed={tool === 'pan'} disabled={disabled} onClick={() => setTool('pan')}>이동</Button>
        <Button icon={WandSparkles} iconOnly disabled={disabled} onClick={removeBackground}>배경 제거</Button>
        <Button icon={RotateCcw} iconOnly disabled={disabled} onClick={() => commit({ type: 'rotate', direction: -1 })}>왼쪽으로 회전</Button>
        <Button icon={RotateCw} iconOnly disabled={disabled} onClick={() => commit({ type: 'rotate', direction: 1 })}>오른쪽으로 회전</Button>
        <Button icon={Undo2} iconOnly disabled={disabled || !history.past.length} onClick={() => { setHistory(current => ({ past: current.past.slice(0, -1), future: [current.past.at(-1), ...current.future] })); setCrop(initialCrop()); }}>되돌리기</Button>
        <Button icon={Redo2} iconOnly disabled={disabled || !history.future.length} onClick={() => { setHistory(current => ({ past: [...current.past, current.future[0]], future: current.future.slice(1) })); setCrop(initialCrop()); }}>다시 실행</Button>
      </div>
      <div className="image-editor-options">
        {['pen', 'fill', 'picker'].includes(tool) ? <>
          <div className="image-editor-colors" role="group" aria-label="편집 색상">
            {colors.map(value => <button key={value} type="button" title={value} aria-label={`색상 ${value}`} aria-pressed={color === value} disabled={disabled} style={{ backgroundColor: value }} onClick={() => setColor(value)} />)}
            <input type="color" aria-label="사용자 색상" title="사용자 색상" value={color} disabled={disabled} onChange={event => setColor(event.target.value)} />
          </div>
          {tool === 'pen' ? <label className="image-editor-width">굵기 <input aria-label="펜 굵기" type="range" min="1" max="24" value={penWidth} disabled={disabled} onChange={event => setPenWidth(Number(event.target.value))} /><output>{penWidth}</output></label> : null}
          {tool === 'fill' ? <label className="image-editor-width">허용 범위 <input aria-label="채우기 허용 범위" type="range" min="0" max="255" value={tolerance} disabled={disabled} onChange={event => setTolerance(Number(event.target.value))} /><output>{tolerance}</output></label> : null}
          <label className="image-editor-width image-editor-opacity">불투명도 <input aria-label="색상 불투명도" type="range" min="0" max="100" value={opacity} disabled={disabled} onChange={event => setOpacity(Number(event.target.value))} /><output>{Math.round(opacity)}%</output></label>
        </> : ['erase', 'restore'].includes(tool) ? <label className="image-editor-width">크기 <input aria-label="브러시 크기" type="range" min="1" max="160" value={brushWidth} disabled={disabled} onChange={event => setBrushWidth(Number(event.target.value))} /><output>{brushWidth}</output></label>
          : tool === 'crop' ? <Button icon={Check} disabled={disabled || !crop?.width || !crop?.height} onClick={applyCrop}>자르기 적용</Button> : null}
        <span className="image-editor-dimensions">{source ? `${dimensions.width} × ${dimensions.height}` : ''}</span>
      </div>
      {error ? <div className="error-banner" role="alert">{error}</div> : null}
      {filling ? <div className="image-editor-processing" role="status"><Loader2 size={16} className="upload-spinner" /><span>영역 채우는 중</span><Button icon={X} iconOnly onClick={() => fillRef.current?.abort()}>채우기 취소</Button></div> : null}
      {removing ? <div className="image-editor-processing" role="status">
        <Loader2 size={16} className="upload-spinner" />
        <span>{removing === 'loading' ? '배경 제거 모델 불러오는 중' : '배경 제거 중'}</span>
        <Button icon={X} iconOnly onClick={() => removalRef.current?.abort()}>배경 제거 취소</Button>
      </div> : null}
      <div ref={stageRef} className={`image-editor-stage ${['pen', 'erase', 'restore', 'fill', 'picker'].includes(tool) ? 'pen-mode' : ''}`} onPointerLeave={() => { if (brushCursorRef.current) brushCursorRef.current.hidden = true; }}>
        <div ref={brushCursorRef} className="image-editor-brush-cursor" hidden aria-hidden="true" />
        {!source && !error ? <Loader2 className="upload-spinner" aria-label="이미지 불러오는 중" /> : null}
        <ImageZoom baseScale={scale} resetKey={`${dimensions.width}:${dimensions.height}`} disabled={disabled} pan={tool === 'pan'} onGestureStart={cancelStroke}>
        <ReactCrop crop={tool === 'crop' ? crop : undefined} onChange={(_, percent) => setCrop(percent)} disabled={tool !== 'crop' || disabled} minWidth={8} minHeight={8} keepSelection style={{ display: source ? 'inline-block' : 'none' }}>
          <canvas ref={canvasRef} aria-label="편집 이미지" style={{ width: displayWidth, height: displayHeight }} onPointerDown={startStroke} onPointerMove={moveStroke} onPointerUp={endStroke} onPointerCancel={endStroke} />
        </ReactCrop>
        </ImageZoom>
      </div>
      <footer className="image-editor-footer">
        <label>파일 이름<input aria-label="편집 파일 이름" value={name} disabled={saving} onChange={event => setName(event.target.value)} /></label>
        <Button icon={Save} variant="primary" disabled={disabled || !dirty} onClick={save}>{saving ? '저장 중' : '새 파일로 저장'}</Button>
      </footer>
    </section>
  </div>, document.body);
}
