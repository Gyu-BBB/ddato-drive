import { ChevronRight, Download, Info, X } from "lucide-react";
import { IconButton } from "../../../shared/components/IconButton.jsx";
import { formatDate } from "../../../shared/lib/dates.js";
import { formatBytes } from "../../../shared/lib/formatBytes.js";
import { fileKind, filePath } from "../fileDisplay.js";

export function MetadataPane({ file, onClose, onCollapse, onDownload, onOpenFolder, downloadDisabled = false, openFolderDisabled = false }) {
  return (
    <>
      <div className="panel-header">
        <div className="panel-title">
          <span>파일 정보</span>
        </div>
        <div className="panel-actions">
          <IconButton icon={Download} label="다운로드" onClick={onDownload} disabled={!file || downloadDisabled} />
          <IconButton icon={ChevronRight} label="사이드바 접기" onClick={onCollapse} disabled={!file} />
          <IconButton icon={X} label="닫기" onClick={onClose} disabled={!file} />
        </div>
      </div>
      <div className="panel-body metadata-pane-body">
        {!file ? (
          <div className="empty-state">
            <Info size={32} />
            <strong>항목을 선택하세요</strong>
            <span>선택한 파일이나 폴더의 정보를 여기서 확인합니다.</span>
          </div>
        ) : <MetadataDetails file={file} onOpenFolder={onOpenFolder} openFolderDisabled={openFolderDisabled} />}
      </div>
    </>
  );
}

export function MetadataDetails({ file, onOpenFolder, openFolderDisabled = false }) {
  return (
    <div className="metadata-card">
      <strong>{file.name}</strong>
      <dl className="metadata-list">
        <MetadataRow label="종류" value={fileKind(file)} />
        <MetadataRow label="크기" value={file.type === "folder" ? "-" : formatBytes(file.sizeBytes)} />
        <MetadataRow label="수정일" value={formatDate(file.updatedAt)} />
        <MetadataRow label="생성일" value={formatDate(file.createdAt)} />
        {file.deletedAt != null ? <>
          <MetadataRow label="삭제일" value={formatDate(file.deletedAt)} />
          <MetadataRow label="자동 영구 삭제일" value={formatDate(file.trashExpiresAt)} />
        </> : null}
        <MetadataRow label="경로" value={filePath(file)} />
        <MetadataRow label="암호" value={passwordLabel(file)} />
      </dl>
      {file.type === "folder" ? (
        <button className="button primary compact-action" type="button" onClick={() => onOpenFolder(file)} disabled={openFolderDisabled}>폴더 열기</button>
      ) : null}
    </div>
  );
}

function passwordLabel(file) {
  if (!file.passwordProtected) return "없음";
  if (file.ownPasswordProtected) return file.passwordUnlocked ? "설정됨 · 해제됨" : "설정됨";
  return file.passwordUnlocked ? "상위 폴더 암호 · 해제됨" : "상위 폴더 암호";
}

function MetadataRow({ label, value }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
