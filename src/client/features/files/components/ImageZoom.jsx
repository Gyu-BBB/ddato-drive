import { Ratio, Scan, X, ZoomIn, ZoomOut } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { TransformComponent, TransformWrapper } from 'react-zoom-pan-pinch';
import { Button } from '../../../shared/components/Button.jsx';
import './imageZoom.css';
import { useCompatibleImage } from '../useCompatibleImage.js';

export const ZOOM_TOOLBAR_HEIGHT = 44;

export function ImageZoom({ children, baseScale = 1, resetKey = '', disabled = false, pan = true, onGestureStart, onClose, className = '' }) {
  const transformRef = useRef(null);
  const [scale, setScale] = useState(1);
  const minScale = Math.min(0.25, 1 / baseScale);
  const maxScale = Math.max(8, 1 / baseScale, Math.min(512, 8 / baseScale));

  useEffect(() => {
    transformRef.current?.resetTransform(0);
  }, [resetKey]);

  function keys(event) {
    if (event.target.closest('input, textarea, select') || disabled) return;
    const controls = transformRef.current;
    if (!controls) return;
    if (['+', '=', '-', '0'].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === '-') controls.zoomOut(0.25, 0);
      else if (event.key === '0') controls.resetTransform(0);
      else controls.zoomIn(0.25, 0);
    } else if (event.key.startsWith('Arrow')) {
      event.preventDefault();
      event.stopPropagation();
      const dx = event.key === 'ArrowLeft' ? 40 : event.key === 'ArrowRight' ? -40 : 0;
      const dy = event.key === 'ArrowUp' ? 40 : event.key === 'ArrowDown' ? -40 : 0;
      controls.panBy(dx, dy, 0);
    }
  }

  return <div className={`image-zoom ${pan ? 'pan-enabled' : ''} ${className}`} tabIndex={disabled ? -1 : 0} onKeyDown={keys}
    onTouchStartCapture={event => { if (event.touches.length > 1) onGestureStart?.(); }}>
    <TransformWrapper ref={transformRef} minScale={minScale} maxScale={maxScale} disabled={disabled}
      centerZoomedOut centerOnInit smooth={false}
      panning={{ disabled: !pan, velocityDisabled: true, allowRightClickPan: false }}
      pinch={{ allowPanning: true }} doubleClick={{ disabled: true }}
      zoomAnimation={{ disabled: true }} autoAlignment={{ animationTime: 0 }} velocityAnimation={{ disabled: true }}
      onTransform={(_, state) => setScale(state.scale)}>
      <TransformComponent wrapperClass="image-zoom-viewport" contentClass="image-zoom-content"
        wrapperStyle={{ width: '100%', height: '100%' }} contentStyle={{ width: '100%', height: '100%' }}>
        {children}
      </TransformComponent>
    </TransformWrapper>
    <div className="image-zoom-toolbar" role="group" aria-label="이미지 확대 축소" onDoubleClick={event => event.stopPropagation()}>
      <Button icon={ZoomOut} iconOnly disabled={disabled || scale <= minScale + 0.0001} onClick={() => transformRef.current?.zoomOut(0.25, 0)}>축소</Button>
      <output aria-label="이미지 배율">{Math.round(scale * baseScale * 100)}%</output>
      <Button icon={ZoomIn} iconOnly disabled={disabled || scale >= maxScale - 0.001} onClick={() => transformRef.current?.zoomIn(0.25, 0)}>확대</Button>
      <Button icon={Ratio} iconOnly disabled={disabled} onClick={() => transformRef.current?.centerView(1 / baseScale, 0)}>원본 크기</Button>
      <Button icon={Scan} iconOnly disabled={disabled} onClick={() => transformRef.current?.resetTransform(0)}>화면에 맞추기</Button>
      {onClose ? <Button icon={X} iconOnly onClick={onClose}>전체 화면 닫기</Button> : null}
    </div>
  </div>;
}

export function ZoomableImage({ src, alt, onClose }) {
  const compatible = useCompatibleImage(src, alt);
  const rootRef = useRef(null);
  const [natural, setNatural] = useState(null);
  const [viewport, setViewport] = useState({ width: 1, height: 1 });
  const [failed, setFailed] = useState(false);
  useEffect(() => { setNatural(null); setFailed(false); }, [src]);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setViewport({ width: Math.max(1, entry.contentRect.width - 16), height: Math.max(1, entry.contentRect.height - ZOOM_TOOLBAR_HEIGHT - 16) }));
    observer.observe(rootRef.current);
    return () => observer.disconnect();
  }, []);
  const baseScale = natural ? Math.min(viewport.width / natural.width, viewport.height / natural.height) : 1;
  return <div ref={rootRef} className="zoomable-image" aria-label={alt}>
    <ImageZoom baseScale={baseScale} resetKey={`${src}:${viewport.width}:${viewport.height}`} disabled={!natural || failed} onClose={onClose}>
      {compatible.url ? <img src={compatible.url} alt={alt} draggable={false} onLoad={event => { setFailed(false); setNatural({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight }); }} onError={() => setFailed(true)} /> : <span role="status">{compatible.error || '사진 불러오는 중'}</span>}
    </ImageZoom>
  </div>;
}
