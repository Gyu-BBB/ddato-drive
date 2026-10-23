import { Check, Crop, Loader2, Pencil, Redo2, RotateCcw, RotateCw, Save, Undo2, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ReactCrop from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import './imageEditor.css';
import { Button } from '../../../shared/components/Button.jsx';
import { filesApi } from '../filesApi.js';
import { editedImageName, MAX_EDIT_PIXELS, paintStroke, renderImageEdits } from '../imageEditing.js';

const initialCrop = () => ({ unit: '%', x: 10, y: 10, width: 80, height: 80 });
const colors = ['#ff3b30', '#ffcc00', '#34c759', '#007aff', '#ffffff', '#000000'];

export function ImageEditor({ file, onClose, onSaved }) {
  const dialogRef = useRef(null);
  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const strokeRef = useRef(null);
  const [source, setSource] = useState(null);
  const [history, setHistory] = useState({ past: [], future: [] });
  const [tool, setTool] = useState('pen');
  const [crop, setCrop] = useState(initialCrop);
  const [color, setColor] = useState(colors[0]);
  const [penWidth, setPenWidth] = useState(5);
  const [name, setName] = useState(editedImageName(file.name));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [dimensions, setDimensions] = useState({ width: 1, height: 1 });
  const [viewport, setViewport] = useState({ width: 1, height: 1 });
  const dirty = history.past.length > 0;

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
      setViewport({ width: Math.max(1, entry.contentRect.width - 32), height: Math.max(1, entry.contentRect.height - 32) });
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
    if (!saving && (!dirty || window.confirm('편집 내용을 저장하지 않고 닫을까요?'))) onClose();
  }

  function handleKeys(event) {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    if (event.key === 'Tab') {
      const controls = [...dialogRef.current.querySelectorAll('button:not(:disabled), input:not(:disabled), [tabindex="0"]')];
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
    if (tool !== 'pen' || !source || saving || event.button !== 0 || strokeRef.current) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    strokeRef.current = { type: 'pen', color, width: penWidth * dimensions.width / displayWidth, points: [point(event)], pointerId: event.pointerId };
    paintStroke(canvasRef.current.getContext('2d'), strokeRef.current);
  }

  function moveStroke(event) {
    const stroke = strokeRef.current;
    if (!stroke || stroke.pointerId !== event.pointerId) return;
    const next = point(event);
    const previous = stroke.points.at(-1);
    if (Math.hypot(next.x - previous.x, next.y - previous.y) < 0.5) return;
    stroke.points.push(next);
    paintStroke(canvasRef.current.getContext('2d'), { ...stroke, points: [previous, next] });
  }

  function endStroke(event) {
    const stroke = strokeRef.current;
    if (!stroke || stroke.pointerId !== event.pointerId) return;
    strokeRef.current = null;
    if (event.type === 'pointercancel') renderImageEdits(canvasRef.current, source, history.past);
    else commit(stroke);
  }

  function applyCrop() {
    if (!crop?.width || !crop?.height) return;
    commit({ type: 'crop', x: dimensions.width * crop.x / 100, y: dimensions.height * crop.y / 100,
      width: dimensions.width * crop.width / 100, height: dimensions.height * crop.height / 100 });
    setTool('pen');
  }

  async function save() {
    if (saving || !source || !dirty) return;
    const filename = name.trim();
    if (!filename || /[\\/\x00-\x1f]/.test(filename)) { setError('올바른 파일 이름을 입력해 주세요.'); return; }
    setSaving(true);
    setError('');
    try {
      const blob = await new Promise((resolve, reject) => canvasRef.current.toBlob(value => value ? resolve(value) : reject(new Error('이미지를 저장하지 못했습니다.')), 'image/png'));
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
  const disabled = !source || saving;

  return createPortal(<div className="modal-backdrop image-editor-backdrop">
    <section ref={dialogRef} className="image-editor" role="dialog" aria-modal="true" aria-labelledby="image-editor-title" tabIndex={-1} onKeyDown={handleKeys}>
      <header className="image-editor-header">
        <strong id="image-editor-title">이미지 편집</strong>
        <span title={file.name}>{file.name}</span>
        <Button icon={X} iconOnly onClick={close} disabled={saving}>편집 닫기</Button>
      </header>
      <div className="image-editor-tools" role="toolbar" aria-label="이미지 편집 도구">
        <Button icon={Crop} iconOnly aria-pressed={tool === 'crop'} disabled={disabled} onClick={() => setTool('crop')}>자르기</Button>
        <Button icon={Pencil} iconOnly aria-pressed={tool === 'pen'} disabled={disabled} onClick={() => setTool('pen')}>펜</Button>
        <Button icon={RotateCcw} iconOnly disabled={disabled} onClick={() => commit({ type: 'rotate', direction: -1 })}>왼쪽으로 회전</Button>
        <Button icon={RotateCw} iconOnly disabled={disabled} onClick={() => commit({ type: 'rotate', direction: 1 })}>오른쪽으로 회전</Button>
        <Button icon={Undo2} iconOnly disabled={disabled || !history.past.length} onClick={() => { setHistory(current => ({ past: current.past.slice(0, -1), future: [current.past.at(-1), ...current.future] })); setCrop(initialCrop()); }}>되돌리기</Button>
        <Button icon={Redo2} iconOnly disabled={disabled || !history.future.length} onClick={() => { setHistory(current => ({ past: [...current.past, current.future[0]], future: current.future.slice(1) })); setCrop(initialCrop()); }}>다시 실행</Button>
      </div>
      <div className="image-editor-options">
        {tool === 'pen' ? <>
          <div className="image-editor-colors" role="group" aria-label="펜 색상">
            {colors.map(value => <button key={value} type="button" title={value} aria-label={`펜 색상 ${value}`} aria-pressed={color === value} disabled={disabled} style={{ backgroundColor: value }} onClick={() => setColor(value)} />)}
          </div>
          <label className="image-editor-width">굵기 <input aria-label="펜 굵기" type="range" min="1" max="24" value={penWidth} disabled={disabled} onChange={event => setPenWidth(Number(event.target.value))} /><output>{penWidth}</output></label>
        </> : <Button icon={Check} disabled={disabled || !crop?.width || !crop?.height} onClick={applyCrop}>자르기 적용</Button>}
        <span className="image-editor-dimensions">{source ? `${dimensions.width} × ${dimensions.height}` : ''}</span>
      </div>
      {error ? <div className="error-banner" role="alert">{error}</div> : null}
      <div ref={stageRef} className={`image-editor-stage ${tool === 'pen' ? 'pen-mode' : ''}`}>
        {!source && !error ? <Loader2 className="upload-spinner" aria-label="이미지 불러오는 중" /> : null}
        <ReactCrop crop={tool === 'crop' ? crop : undefined} onChange={(_, percent) => setCrop(percent)} disabled={tool !== 'crop' || disabled} minWidth={8} minHeight={8} keepSelection style={{ display: source ? 'inline-block' : 'none' }}>
          <canvas ref={canvasRef} aria-label="편집 이미지" style={{ width: displayWidth, height: displayHeight }} onPointerDown={startStroke} onPointerMove={moveStroke} onPointerUp={endStroke} onPointerCancel={endStroke} />
        </ReactCrop>
      </div>
      <footer className="image-editor-footer">
        <label>파일 이름<input aria-label="편집 파일 이름" value={name} disabled={saving} onChange={event => setName(event.target.value)} /></label>
        <Button icon={Save} variant="primary" disabled={disabled || !dirty} onClick={save}>{saving ? '저장 중' : '새 파일로 저장'}</Button>
      </footer>
    </section>
  </div>, document.body);
}
