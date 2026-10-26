import { useEffect, useRef, useState } from 'react';
import { Play } from 'lucide-react';
import { isArchiveFile, isDocumentFile, isImageFile, isPdfFile, isSpreadsheetFile, isTextFile, isVideoFile } from './FilePreview.jsx';
import { DocumentThumbnail } from './DocumentThumbnail.jsx';
import { filesApi } from '../filesApi.js';
import './mediaThumbnail.css';
import { useCompatibleImage } from '../useCompatibleImage.js';

const pending = [];
let active = 0;

function drain() {
  while (active < 3 && pending.length) {
    const task = pending.shift();
    active += 1;
    task(() => { active -= 1; drain(); });
  }
}

export function MediaThumbnail({ file, fallback, size = 40 }) {
  const locked = file.passwordProtected && !file.passwordUnlocked;
  if (file.type === 'folder' || locked || isArchiveFile(file)) return fallback;
  const key = `${file.id}:${file.updatedAt}:${Boolean(file.passwordUnlocked)}`;
  if (isPdfFile(file) || isSpreadsheetFile(file) || isDocumentFile(file) || isTextFile(file)) {
    return <DocumentThumbnail key={key} file={file} fallback={fallback} size={size} />;
  }
  if (!isImageFile(file) && !isVideoFile(file)) return fallback;
  return <Thumbnail key={`${file.id}:${file.updatedAt}:${Boolean(file.passwordUnlocked)}`} file={file} fallback={fallback} size={size} />;
}

function Thumbnail({ file, fallback, size }) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  const [failed, setFailed] = useState(false);
  const [frame, setFrame] = useState('');
  const videoFile = isVideoFile(file);
  const src = filesApi.previewUrl(file.id);
  const compatible = useCompatibleImage(visible && !videoFile ? src : '', file.name);

  useEffect(() => {
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: '100px' });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || !videoFile) return;
    let cancelled = false;
    let stop;
    const task = release => {
      if (cancelled) { release(); return; }
      const video = document.createElement('video');
      let finished = false;
      let timer;
      stop = () => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        video.onloadedmetadata = video.onloadeddata = video.onseeked = video.onerror = null;
        video.removeAttribute('src');
        video.load();
        release();
      };
      const capture = () => {
        if (finished || cancelled || video.readyState < 2) return;
        try {
          const canvas = document.createElement('canvas');
          const scale = Math.min(1, 240 / Math.max(video.videoWidth, video.videoHeight));
          canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
          canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
          canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
          setFrame(canvas.toDataURL('image/jpeg', 0.8));
        } catch { setFailed(true); }
        stop();
      };
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';
      video.onloadedmetadata = () => {
        const time = Number.isFinite(video.duration) ? Math.min(0.1, video.duration / 2) : 0;
        if (time > 0) video.currentTime = time;
      };
      video.onloadeddata = () => { if (!video.seeking) capture(); };
      video.onseeked = capture;
      video.onerror = () => { if (!cancelled) setFailed(true); stop(); };
      timer = setTimeout(() => { if (!cancelled) setFailed(true); stop(); }, 10000);
      video.src = src;
      video.load();
    };
    pending.push(task);
    drain();
    return () => {
      cancelled = true;
      const index = pending.indexOf(task);
      if (index !== -1) pending.splice(index, 1);
      stop?.();
    };
  }, [visible, videoFile, src]);

  const image = videoFile ? frame : compatible.url;
  return (
    <span ref={ref} className="media-thumbnail" style={{ width: size, height: size }} aria-hidden="true">
      {failed || compatible.error || !image ? fallback : <img src={image} alt="" draggable={false} loading="lazy" decoding="async" onError={() => setFailed(true)} />}
      {videoFile && frame && !failed ? <span className="thumbnail-video-mark"><Play size={9} fill="currentColor" /></span> : null}
    </span>
  );
}
