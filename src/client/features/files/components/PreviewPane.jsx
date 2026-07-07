import { ChevronRight, Download, FileSearch, Maximize2, X } from "lucide-react";
import { useState } from "react";
import { IconButton } from "../../../shared/components/IconButton.jsx";
import { canInlinePreview, FilePreviewContent, useFilePreview } from "./FilePreview.jsx";
import { FullPreviewDialog } from "./FullPreviewDialog.jsx";
import { MetadataDetails } from "./MetadataPane.jsx";
import { filesApi } from "../filesApi.js";

export function PreviewPane({ file, onClose, onCollapse, onDownload, onOpenFolder, onUnlock }) {
  const [fullPreviewOpen, setFullPreviewOpen] = useState(false);
  const preview = useFilePreview(
    file,
    (target) => filesApi.previewBlob(target.id),
    (target) => filesApi.previewUrl(target.id),
    (target) => filesApi.previewStatus(target.id)
  );
  const fullPreviewDisabled = !file || file.type !== "file" || !canInlinePreview(file);

  return (
    <>
      <div className="panel-header">
        <div className="panel-title">
          <FileSearch size={18} />
          <span>{file ? file.name : "미리보기"}</span>
        </div>
        <div className="panel-actions">
          <IconButton icon={Maximize2} label="전체 보기" onClick={() => setFullPreviewOpen(true)} disabled={fullPreviewDisabled} />
          <IconButton icon={Download} label="다운로드" onClick={onDownload} disabled={!file} />
          <IconButton icon={ChevronRight} label="사이드바 접기" onClick={onCollapse} disabled={!file} />
          <IconButton icon={X} label="닫기" onClick={onClose} disabled={!file} />
        </div>
      </div>
      <div className="panel-body preview-pane-body">
        {!file ? (
          <div className="empty-state">
            <FileSearch size={32} />
            <strong>파일을 선택하세요</strong>
            <span>이미지, PDF, 텍스트, 영상, 오디오를 여기서 확인할 수 있습니다.</span>
          </div>
        ) : file.type === "folder" ? (
          <div className="empty-state">
            <strong>폴더</strong>
            <span>더블 클릭하면 폴더 안으로 이동합니다.</span>
          </div>
        ) : (
          <div className="preview-section">
            <div className="preview-frame">
              <FilePreviewContent file={file} preview={preview} onUnlock={onUnlock} />
            </div>
          </div>
        )}
        {file ? <MetadataDetails file={file} onOpenFolder={onOpenFolder} /> : null}
      </div>
      {fullPreviewOpen ? <FullPreviewDialog file={file} preview={preview} onClose={() => setFullPreviewOpen(false)} onDownload={onDownload} onUnlock={onUnlock} /> : null}
    </>
  );
}
