import { CheckCircle2, ChevronDown, ChevronUp, Loader2, PauseCircle, PlayCircle, RotateCcw, Trash2, UploadCloud, X, XCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatBytes } from "../../../shared/lib/formatBytes.js";

export function UploadQueue({ uploads, onCancel, onPause, onResume, onRetry, onCancelAll, onPauseAll, onResumeAll, onClearCompleted }) {
  const [collapsed, setCollapsed] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const previousCountRef = useRef(uploads.length);
  const summary = useMemo(() => summarizeUploads(uploads), [uploads]);

  useEffect(() => {
    if (uploads.length && (previousCountRef.current === 0 || uploads.length > previousCountRef.current || summary.active)) {
      setCollapsed(false);
    }
    if (summary.active) setDismissed(false);
    previousCountRef.current = uploads.length;
  }, [uploads.length, summary.active]);

  if (!uploads.length || dismissed) return null;

  return (
    <section className={collapsed ? "upload-queue-card collapsed" : "upload-queue-card"} aria-label="업로드 상태">
      <div className="upload-card-header">
        <button className="upload-card-toggle" type="button" onClick={() => setCollapsed((value) => !value)} aria-expanded={!collapsed}>
          <span className="upload-card-title">
            {summary.failed ? <XCircle size={18} color="var(--dd-danger)" /> : summary.uploading ? <Loader2 className="upload-spinner" size={18} /> : <UploadCloud size={18} />}
            <span>
              <strong>업로드</strong>
              <span>{summary.label}</span>
            </span>
          </span>
          <span className="upload-card-count">{summary.total}개</span>
          {collapsed ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
        </button>
        <div className="upload-card-actions" aria-label="전체 업로드 제어">
          {summary.canPause ? (
            <button className="upload-action" type="button" onClick={onPauseAll} title="전체 일시정지" aria-label="전체 업로드 일시정지">
              <PauseCircle size={15} />
            </button>
          ) : null}
          {summary.canResume ? (
            <button className="upload-action" type="button" onClick={onResumeAll} title="전체 재개" aria-label="전체 업로드 재개">
              <PlayCircle size={15} />
            </button>
          ) : null}
          {summary.canCancel ? (
            <button className="upload-action danger" type="button" onClick={onCancelAll} title="전체 취소" aria-label="전체 업로드 취소">
              <X size={15} />
            </button>
          ) : null}
          {summary.done ? (
            <button className="upload-action" type="button" onClick={onClearCompleted} title="완료된 내용 지우기" aria-label="완료된 업로드 내용 지우기">
              <Trash2 size={15} />
            </button>
          ) : null}
          <button className="upload-action" type="button" onClick={() => setDismissed(true)} disabled={Boolean(summary.active)} title={summary.active ? "업로드 진행 중에는 닫을 수 없습니다" : "닫기"} aria-label="업로드 카드 닫기">
            <X size={15} />
          </button>
        </div>
      </div>

      {collapsed && summary.active ? (
        <div className="upload-card-mini-progress" aria-hidden="true">
          <span style={{ width: `${summary.progress}%` }} />
        </div>
      ) : null}

      {!collapsed ? (
        <div className="upload-card-body">
          {uploads.slice(-5).map((upload) => (
            <div className="upload-item" key={upload.id}>
              <div className="file-name">
                {statusIcon(upload.status)}
                <span>
                  <strong>{upload.name || upload.displayName}</strong>
                  <span>{upload.error || upload.detail || uploadLabel(upload)}</span>
                </span>
              </div>
              <div className="upload-row-actions">
                {rowActions(upload, { onCancel, onPause, onResume, onRetry })}
              </div>
              {upload.status === "uploading" ? (
                <div className="upload-progress" aria-hidden="true">
                  <span style={{ width: `${Math.max(0, Math.min(100, upload.progress || 0))}%` }} />
                </div>
              ) : null}
            </div>
          ))}
          {uploads.length > 5 ? (
            <div className="upload-card-more">최근 5개만 표시 중</div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function summarizeUploads(uploads) {
  const summary = uploads.reduce((result, upload) => {
    result.total += 1;
    if (upload.status === "uploading" || upload.status === "queued") {
      result.active += 1;
      result.progressTotal += Number.isFinite(upload.progress) ? upload.progress : 0;
      result.canPause = result.canPause || !upload.transient;
      result.canCancel = result.canCancel || !upload.transient;
    }
    if (upload.status === "uploading") {
      result.uploading += 1;
    } else if (upload.status === "queued") {
      result.queued += 1;
    } else if (upload.status === "paused") {
      result.paused += 1;
      result.canResume = result.canResume || !upload.transient;
      result.canCancel = result.canCancel || !upload.transient;
    } else if (upload.status === "failed" || upload.status === "canceled") {
      result.failed += 1;
      result.canResume = result.canResume || (upload.status === "failed" && !upload.transient);
      result.canCancel = result.canCancel || !upload.transient;
    } else if (upload.status === "done") {
      result.done += 1;
    }
    return result;
  }, { total: 0, active: 0, uploading: 0, queued: 0, paused: 0, failed: 0, done: 0, progressTotal: 0, canPause: false, canResume: false, canCancel: false });

  const progress = summary.active ? Math.round(summary.progressTotal / summary.active) : 100;
  if (summary.uploading) return { ...summary, progress, label: `${summary.uploading}개 업로드 중` };
  if (summary.queued) return { ...summary, progress, label: `${summary.queued}개 대기 중` };
  if (summary.paused) return { ...summary, progress, label: `${summary.paused}개 일시정지됨` };
  if (summary.failed) return { ...summary, progress, label: `${summary.failed}개 확인 필요` };
  return { ...summary, progress, label: `${summary.done}개 완료` };
}

function statusIcon(status) {
  if (status === "done") return <CheckCircle2 size={17} color="var(--dd-success)" />;
  if (status === "failed" || status === "canceled") return <XCircle size={17} color="var(--dd-danger)" />;
  if (status === "paused") return <PauseCircle size={17} />;
  if (status === "queued") return <UploadCloud size={17} />;
  return <Loader2 className="upload-spinner" size={17} />;
}

function rowActions(upload, actions) {
  if (upload.transient || upload.status === "done") return null;
  const label = upload.name || upload.displayName || "파일";

  if (upload.status === "uploading" || upload.status === "queued") {
    return (
      <>
        <button className="upload-action" type="button" onClick={() => actions.onPause(upload.id)} title="일시정지" aria-label={`${label} 업로드 일시정지`}>
          <PauseCircle size={15} />
        </button>
        <button className="upload-action danger" type="button" onClick={() => actions.onCancel(upload.id)} title="취소" aria-label={`${label} 업로드 취소`}>
          <X size={15} />
        </button>
      </>
    );
  }

  if (upload.status === "paused") {
    return (
      <>
        <button className="upload-action" type="button" onClick={() => actions.onResume(upload.id)} title="재개" aria-label={`${label} 업로드 재개`}>
          <PlayCircle size={15} />
        </button>
        <button className="upload-action danger" type="button" onClick={() => actions.onCancel(upload.id)} title="취소" aria-label={`${label} 업로드 취소`}>
          <X size={15} />
        </button>
      </>
    );
  }

  if (upload.status === "failed") {
    return (
      <>
        <button className="upload-action" type="button" onClick={() => actions.onRetry(upload.id)} title="재시도" aria-label={`${label} 업로드 재시도`}>
          <RotateCcw size={15} />
        </button>
        <button className="upload-action danger" type="button" onClick={() => actions.onCancel(upload.id)} title="취소" aria-label={`${label} 업로드 취소`}>
          <X size={15} />
        </button>
      </>
    );
  }

  return null;
}

function uploadLabel(upload) {
  const size = uploadSizeLabel(upload);
  const suffix = size ? ` · ${size}` : "";
  if (upload.status === "queued") return `대기 중${suffix}`;
  if (upload.status === "uploading" && Number.isFinite(upload.progress)) return `${upload.progress}%${suffix}`;
  if (upload.status === "paused") return `일시정지됨${suffix}`;
  if (upload.status === "done") return `업로드됨${suffix}`;
  if (upload.status === "canceled") return `취소됨${suffix}`;
  if (upload.status === "failed") return `실패${suffix}`;
  return `${upload.status}${suffix}`;
}

function uploadSizeLabel(upload) {
  const sizeBytes = Number(upload.sizeBytes);
  if (!Number.isFinite(sizeBytes) || sizeBytes < 0) return "";

  const uploadedBytes = Number(upload.uploadedBytes);
  if ((upload.status === "uploading" || upload.status === "paused") && Number.isFinite(uploadedBytes) && uploadedBytes > 0) {
    return `${formatBytes(Math.min(uploadedBytes, sizeBytes))} / ${formatBytes(sizeBytes)}`;
  }

  return formatBytes(sizeBytes);
}
