import { Download, Expand, Film, Image as ImageIcon, Loader2, RefreshCcw, Search, Video } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../shared/components/Button.jsx";
import { EmptyState } from "../../shared/components/EmptyState.jsx";
import { formatDate } from "../../shared/lib/dates.js";
import { formatBytes } from "../../shared/lib/formatBytes.js";
import { filePath } from "./fileDisplay.js";
import { filesApi } from "./filesApi.js";
import { isImageFile, isVideoFile } from "./components/FilePreview.jsx";

const kindOptions = [
  { id: "", label: "전체", icon: Film },
  { id: "image", label: "이미지", icon: ImageIcon },
  { id: "video", label: "동영상", icon: Video }
];

export function MediaViewerPage() {
  const [files, setFiles] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fullscreenFile, setFullscreenFile] = useState(null);

  const selectedFile = useMemo(() => files.find((file) => file.id === selectedId) || files[0] || null, [files, selectedId]);
  const counts = useMemo(() => ({
    total: files.length,
    images: files.filter(isImageFile).length,
    videos: files.filter(isVideoFile).length
  }), [files]);

  useEffect(() => {
    const timer = window.setTimeout(() => loadMedia(), query.trim() ? 180 : 0);
    return () => window.clearTimeout(timer);
  }, [query, kind]);

  useEffect(() => {
    if (!files.length) {
      setSelectedId("");
      return;
    }
    setSelectedId((current) => files.some((file) => file.id === current) ? current : files[0].id);
  }, [files]);

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement) return;
      if (fullscreenFile) return;
      if (!selectedFile) return;
      if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        event.preventDefault();
        selectOffset(1);
      } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        event.preventDefault();
        selectOffset(-1);
      } else if (event.key.toLowerCase() === "f" || event.key === "Enter") {
        event.preventDefault();
        setFullscreenFile(selectedFile);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [files, selectedFile, fullscreenFile]);

  async function loadMedia() {
    setBusy(true);
    setError("");
    try {
      const result = await filesApi.media({ search: query.trim(), kind });
      setFiles(result.files || []);
    } catch (nextError) {
      setError(nextError.message || "미디어 파일을 불러오지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  function selectOffset(offset) {
    if (!files.length) return;
    const currentIndex = Math.max(0, files.findIndex((file) => file.id === selectedFile?.id));
    const nextIndex = Math.max(0, Math.min(files.length - 1, currentIndex + offset));
    setSelectedId(files[nextIndex].id);
  }

  function downloadSelected() {
    if (!selectedFile) return;
    window.open(filesApi.downloadUrl(selectedFile.id), "_blank", "noopener,noreferrer");
  }

  return (
    <div className="media-viewer-page">
      <header className="media-toolbar">
        <div className="media-title">
          <Film size={20} />
          <span>이미지/동영상</span>
        </div>
        <div className="media-kind-tabs" role="group" aria-label="미디어 종류">
          {kindOptions.map((option) => {
            const Icon = option.icon;
            return (
              <button
                key={option.id || "all"}
                className={kind === option.id ? "active" : ""}
                type="button"
                onClick={() => setKind(option.id)}
                aria-pressed={kind === option.id}
              >
                <Icon size={16} />
                <span>{option.label}</span>
              </button>
            );
          })}
        </div>
        <span className="toolbar-spacer" />
        <label className="search-box media-search">
          <Search size={16} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="이미지, 동영상 검색" />
        </label>
        <Button icon={RefreshCcw} iconOnly onClick={loadMedia} disabled={busy}>새로고침</Button>
      </header>

      {error ? <div className="error-banner page-error">{error}</div> : null}

      <div className="media-viewer-layout">
        <section className="media-browser" aria-label="미디어 목록">
          <div className="media-summary">
            <span>{counts.total}개</span>
            <small>이미지 {counts.images} · 동영상 {counts.videos}</small>
          </div>
          {busy ? (
            <div className="media-loading">
              <Loader2 className="upload-spinner" size={22} />
              <span>불러오는 중</span>
            </div>
          ) : files.length ? (
            <div className="media-grid">
              {files.map((file) => (
                <button
                  key={file.id}
                  className={selectedFile?.id === file.id ? "media-card selected" : "media-card"}
                  type="button"
                  onClick={() => setSelectedId(file.id)}
                  onDoubleClick={() => setFullscreenFile(file)}
                >
                  <MediaThumb file={file} />
                  <span>{file.name}</span>
                </button>
              ))}
            </div>
          ) : (
            <EmptyState
              title="표시할 이미지나 동영상이 없습니다"
              body="드라이브에 이미지 또는 동영상을 업로드하면 이곳에 모아 보여줍니다."
            />
          )}
        </section>

        <section className={isVideoFile(selectedFile) ? "media-preview-panel video-mode" : "media-preview-panel"} aria-label="미디어 미리보기">
          {selectedFile ? (
            <>
              <div className="media-preview-stage" onDoubleClick={() => setFullscreenFile(selectedFile)}>
                <MediaPreview file={selectedFile} />
              </div>
              <div className="media-details">
                <div>
                  <strong>{selectedFile.name}</strong>
                  <span>{selectedFile.mediaKind === "video" ? "동영상" : "이미지"} · {formatBytes(selectedFile.sizeBytes)}</span>
                </div>
                <div className="media-detail-actions">
                  <Button icon={Expand} onClick={() => setFullscreenFile(selectedFile)}>전체 화면</Button>
                  <Button icon={Download} onClick={downloadSelected}>다운로드</Button>
                </div>
                <dl>
                  <div>
                    <dt>경로</dt>
                    <dd>{filePath(selectedFile)}</dd>
                  </div>
                  <div>
                    <dt>수정일</dt>
                    <dd>{formatDate(selectedFile.updatedAt)}</dd>
                  </div>
                  <div>
                    <dt>종류</dt>
                    <dd>{selectedFile.mimeType || selectedFile.mediaKind}</dd>
                  </div>
                </dl>
              </div>
            </>
          ) : (
            <EmptyState title="미디어를 선택하세요" body="왼쪽 목록에서 이미지나 동영상을 선택하면 크게 볼 수 있습니다." />
          )}
        </section>
      </div>

      {fullscreenFile ? <MediaFullscreen file={fullscreenFile} onClose={() => setFullscreenFile(null)} /> : null}
    </div>
  );
}

function MediaThumb({ file }) {
  const src = filesApi.previewUrl(file.id);
  if (isImageFile(file)) return <img src={src} alt="" loading="lazy" />;
  return (
    <span className="media-video-thumb">
      <video src={src} muted preload="metadata" playsInline />
      <Video size={22} />
    </span>
  );
}

function MediaPreview({ file }) {
  const src = filesApi.previewUrl(file.id);
  if (isImageFile(file)) return <img src={src} alt={file.name} />;
  return <video src={src} controls preload="metadata" playsInline />;
}

function MediaFullscreen({ file, onClose }) {
  const shellRef = useRef(null);
  const videoRef = useRef(null);
  const src = filesApi.previewUrl(file.id);

  useEffect(() => {
    const shell = shellRef.current;
    shell?.focus();
    shell?.requestFullscreen?.().catch(() => {});

    function handleKeyDown(event) {
      const video = videoRef.current;
      const key = event.key;
      const lowerKey = key.toLowerCase();
      const handlesVideoKey = video && [" ", "arrowleft", "arrowright", "arrowup", "arrowdown", "m"].includes(lowerKey === " " ? " " : lowerKey);

      if (key === "Escape" || lowerKey === "f") {
        event.preventDefault();
        event.stopImmediatePropagation?.();
        close();
        return;
      }

      if (!handlesVideoKey) return;

      event.preventDefault();
      event.stopImmediatePropagation?.();

      if (key === " ") {
        toggleVideo();
      } else if (key === "ArrowLeft") {
        seekVideo(video, -5);
      } else if (key === "ArrowRight") {
        seekVideo(video, 5);
      } else if (key === "ArrowUp") {
        setVideoVolume(video, 0.08);
      } else if (key === "ArrowDown") {
        setVideoVolume(video, -0.08);
      } else if (lowerKey === "m") {
        video.muted = !video.muted;
      }
    }

    function handleFullscreenChange() {
      if (!document.fullscreenElement) onClose();
    }

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  useEffect(() => {
    if (!videoRef.current) return;
    videoRef.current.play().catch(() => {});
  }, [file.id]);

  function close() {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
    onClose();
  }

  function toggleVideo() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  }

  function seekVideo(video, seconds) {
    const duration = Number.isFinite(video.duration) ? video.duration : Infinity;
    video.currentTime = Math.max(0, Math.min(duration, video.currentTime + seconds));
  }

  function setVideoVolume(video, delta) {
    const nextVolume = Math.max(0, Math.min(1, Math.round((video.volume + delta) * 100) / 100));
    video.volume = nextVolume;
    if (nextVolume > 0) video.muted = false;
  }

  return (
    <div ref={shellRef} className="media-fullscreen-shell" tabIndex={-1} aria-label="전체 화면 미디어 보기">
      {isImageFile(file) ? (
        <img src={src} alt={file.name} />
      ) : (
        <video ref={videoRef} src={src} autoPlay playsInline onClick={toggleVideo} />
      )}
    </div>
  );
}
