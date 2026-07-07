import { Download, Maximize2, X } from "lucide-react";
import { IconButton } from "../../../shared/components/IconButton.jsx";
import { FilePreviewContent } from "./FilePreview.jsx";

export function FullPreviewDialog({ file, preview, onClose, onDownload = null, onUnlock = null }) {
  if (!file) return null;

  return (
    <div className="modal-backdrop full-preview-backdrop" role="presentation">
      <section className="full-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="full-preview-title">
        <header className="full-preview-header">
          <div className="panel-title">
            <Maximize2 size={18} />
            <span id="full-preview-title">{file.name}</span>
          </div>
          <div className="panel-actions">
            {onDownload ? <IconButton icon={Download} label="다운로드" onClick={onDownload} /> : null}
            <IconButton icon={X} label="전체 보기 닫기" onClick={onClose} />
          </div>
        </header>
        <div className="full-preview-body">
          <FilePreviewContent file={file} preview={preview} onUnlock={onUnlock} />
        </div>
      </section>
    </div>
  );
}
