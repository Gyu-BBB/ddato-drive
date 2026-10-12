import { File, FileAudio, FileText, FileVideo, Image, LockKeyhole, Maximize2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatDate } from "../../../shared/lib/dates.js";
import { formatBytes } from "../../../shared/lib/formatBytes.js";
import { IconButton } from "../../../shared/components/IconButton.jsx";
import { canInlinePreview, FilePreviewContent, isAudioFile, isDocumentFile, isImageFile, isPdfFile, isSpreadsheetFile, isTextFile, isVideoFile, useFilePreview } from "./FilePreview.jsx";
import { FullPreviewDialog } from "./FullPreviewDialog.jsx";
import { fileKind, fileLocation, sortFiles } from "../fileDisplay.js";
import { filesApi } from "../filesApi.js";
import { FolderGlyph } from "./FolderGlyph.jsx";

const MAX_COLUMN_DEPTH = 3;

export function FileList({
  files,
  selectedIds = [],
  selectedId,
  activeFile = null,
  onSelect,
  onToggleSelect,
  onOpenFolder,
  onContextMenu,
  viewMode = "icon",
  ownerId = "",
  canBrowseColumns = true,
  showLocation = false,
  sortField = "name",
  sortDirection = "asc",
  onFilesSeen = null,
  canMove = false,
  dropTargetId = "",
  onDragStart = null,
  onDragEnd = null,
  onDragOverFolder = null,
  onDragLeaveFolder = null,
  onDropOnFolder = null,
  onUnlock = null
}) {
  const selectedFile = useMemo(() => activeFile || files.find((file) => file.id === selectedId) || null, [files, selectedId, activeFile]);
  const moveHandlers = { canMove, dropTargetId, onDragStart, onDragEnd, onDragOverFolder, onDragLeaveFolder, onDropOnFolder };

  if (viewMode === "list") {
    return <ListView files={files} selectedIds={selectedIds} selectedId={selectedId} onSelect={onSelect} onToggleSelect={onToggleSelect} onOpenFolder={onOpenFolder} onContextMenu={onContextMenu} showLocation={showLocation} moveHandlers={moveHandlers} />;
  }

  if (viewMode === "column") {
    return (
      <ColumnView
        files={files}
        activeFile={selectedFile}
        selectedId={selectedId}
        selectedIds={selectedIds}
        onSelect={onSelect}
        onToggleSelect={onToggleSelect}
        onOpenFolder={onOpenFolder}
        onContextMenu={onContextMenu}
        ownerId={ownerId}
        canBrowseColumns={canBrowseColumns}
        sortField={sortField}
        sortDirection={sortDirection}
        onFilesSeen={onFilesSeen}
        moveHandlers={moveHandlers}
        onUnlock={onUnlock}
      />
    );
  }

  if (viewMode === "gallery") {
    return <GalleryView files={files} selectedFile={selectedFile} selectedIds={selectedIds} onSelect={onSelect} onToggleSelect={onToggleSelect} onOpenFolder={onOpenFolder} onContextMenu={onContextMenu} showLocation={showLocation} moveHandlers={moveHandlers} onUnlock={onUnlock} />;
  }

  return <IconView files={files} selectedIds={selectedIds} selectedId={selectedId} onSelect={onSelect} onToggleSelect={onToggleSelect} onOpenFolder={onOpenFolder} onContextMenu={onContextMenu} showLocation={showLocation} moveHandlers={moveHandlers} />;
}

function IconView({ files, selectedIds, selectedId, onSelect, onToggleSelect, onOpenFolder, onContextMenu, showLocation, moveHandlers }) {
  return (
    <div className="finder-icon-grid" role="list">
      {files.map((file) => {
        const checked = selectedIds.includes(file.id);
        const active = selectedId === file.id;
        return (
        <div
          key={file.id}
          className={itemClassName("file-tile", checked, active, isDropTarget(file, moveHandlers))}
          data-file-item="true"
          data-file-id={file.id}
          {...moveItemProps(file, moveHandlers)}
          onClick={(event) => onSelect(file, event)}
          onDoubleClick={() => activateFile(file, onSelect, onOpenFolder)}
          onContextMenu={(event) => onContextMenu(event, file)}
          onKeyDown={(event) => handleItemKeyDown(event, file, onSelect, onOpenFolder)}
          role="button"
          tabIndex={0}
        >
          <SelectionCheckbox file={file} checked={checked} onToggle={onToggleSelect} />
          <span className="file-tile-icon"><FileIconWithBadge file={file} size={42} /></span>
          <span className="file-tile-name">{file.name}</span>
          <span className="file-tile-meta">{tileMeta(file, showLocation)}</span>
        </div>
        );
      })}
    </div>
  );
}

function ListView({ files, selectedIds, selectedId, onSelect, onToggleSelect, onOpenFolder, onContextMenu, showLocation, moveHandlers }) {
  return (
    <div className="file-list finder-list" role="list">
      <div className="file-list-header" aria-hidden="true">
        <span>이름</span>
        <span>크기</span>
        <span>수정일</span>
        <span>종류</span>
      </div>
      {files.map((file) => {
        const checked = selectedIds.includes(file.id);
        const active = selectedId === file.id;
        return (
        <div
          key={file.id}
          className={itemClassName("file-row", checked, active, isDropTarget(file, moveHandlers))}
          data-file-item="true"
          data-file-id={file.id}
          {...moveItemProps(file, moveHandlers)}
          onClick={(event) => onSelect(file, event)}
          onDoubleClick={() => activateFile(file, onSelect, onOpenFolder)}
          onContextMenu={(event) => onContextMenu(event, file)}
          onKeyDown={(event) => handleItemKeyDown(event, file, onSelect, onOpenFolder)}
          role="listitem"
          tabIndex={0}
        >
          <span className="file-name">
            <SelectionCheckbox file={file} checked={checked} onToggle={onToggleSelect} />
            <FileIconWithBadge file={file} />
            <span>
              <strong>{file.name}</strong>
              <span>{itemSubtitle(file, showLocation)}</span>
            </span>
          </span>
          <span className="file-meta right">{file.type === "folder" ? "-" : formatBytes(file.sizeBytes)}</span>
          <span className="file-meta right">{formatDate(file.updatedAt)}</span>
          <span className="file-meta right">{file.type === "folder" ? "folder" : "file"}</span>
        </div>
        );
      })}
    </div>
  );
}

function ColumnView({
  files,
  activeFile,
  selectedId,
  selectedIds,
  onSelect,
  onToggleSelect,
  onOpenFolder,
  onContextMenu,
  ownerId,
  canBrowseColumns,
  sortField,
  sortDirection,
  onFilesSeen,
  moveHandlers,
  onUnlock
}) {
  const [trail, setTrail] = useState([]);
  const requestIdRef = useRef(0);
  const previewColumnRef = useRef(null);
  const baseColumnKey = useMemo(() => files.map((file) => file.id).join("|"), [files]);
  const columns = useMemo(() => {
    return [
      { id: "current", title: "현재 위치", files, loading: false, error: "" },
      ...trail.map((entry) => ({
        id: entry.folder.id,
        title: entry.folder.name,
        files: entry.files,
        loading: entry.loading,
        error: entry.error
      }))
    ].slice(0, MAX_COLUMN_DEPTH);
  }, [files, trail]);
  const selectedFile = findFileInColumns(columns, selectedId) || activeFile;

  useEffect(() => {
    requestIdRef.current += 1;
    setTrail([]);
  }, [baseColumnKey, ownerId, canBrowseColumns]);

  useEffect(() => {
    if (!selectedFile || selectedFile.type === "folder" || !window.matchMedia("(max-width: 720px)").matches) return;
    const frame = window.requestAnimationFrame(() => {
      previewColumnRef.current?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "nearest",
        inline: "start"
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selectedFile]);

  async function selectColumnFile(file, event, columnIndex) {
    onSelect(file, event);

    if (!canBrowseColumns || file.type !== "folder" || columnIndex >= MAX_COLUMN_DEPTH - 1) {
      requestIdRef.current += 1;
      setTrail((items) => items.slice(0, columnIndex));
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setTrail((items) => {
      const next = items.slice(0, columnIndex);
      next[columnIndex] = { folder: file, files: [], loading: true, error: "" };
      return next;
    });

    try {
      const result = await filesApi.list({ parentId: file.id, ownerId });
      const nextFiles = sortFiles(result.files, sortField, sortDirection);
      onFilesSeen?.(result.files);
      if (requestIdRef.current !== requestId) return;
      setTrail((items) => {
        const next = items.slice(0, columnIndex);
        next[columnIndex] = { folder: file, files: nextFiles, loading: false, error: "" };
        return next;
      });
    } catch (error) {
      if (requestIdRef.current !== requestId) return;
      setTrail((items) => {
        const next = items.slice(0, columnIndex);
        next[columnIndex] = {
          folder: file,
          files: [],
          loading: false,
          error: error.message || "폴더를 열 수 없습니다."
        };
        return next;
      });
    }
  }

  return (
    <div className="finder-column-view">
      {columns.map((column, columnIndex) => (
        <section className="finder-column" key={column.id}>
          <div className="finder-column-header" title={column.title}>{column.title}</div>
          <ColumnList
            column={column}
            columnIndex={columnIndex}
            selectedId={selectedId}
            selectedIds={selectedIds}
            onSelect={selectColumnFile}
            onToggleSelect={onToggleSelect}
            onOpenFolder={onOpenFolder}
            onContextMenu={onContextMenu}
            moveHandlers={moveHandlers}
          />
        </section>
      ))}
      <section ref={previewColumnRef} className="finder-column finder-column-preview">
        <div className="finder-column-header">미리보기</div>
        <ColumnPreview file={selectedFile} onUnlock={onUnlock} />
      </section>
    </div>
  );
}

function ColumnList({ column, columnIndex, selectedId, selectedIds, onSelect, onToggleSelect, onOpenFolder, onContextMenu, moveHandlers }) {
  if (column.loading) return <ColumnState message="불러오는 중" />;
  if (column.error) return <ColumnState message={column.error} tone="error" />;
  if (!column.files.length) return <ColumnState message="비어 있습니다" />;

  return (
    <div className="finder-column-list" role="list">
      {column.files.map((file) => {
        const checked = selectedIds.includes(file.id);
        const active = selectedId === file.id;
        return (
          <div
            key={file.id}
            className={itemClassName("column-row", checked, active, isDropTarget(file, moveHandlers))}
            data-file-item="true"
            data-file-id={file.id}
            {...moveItemProps(file, moveHandlers)}
            onClick={(event) => onSelect(file, event, columnIndex)}
            onDoubleClick={() => activateColumnFile(file, columnIndex, onSelect, onOpenFolder)}
            onContextMenu={(event) => onContextMenu(event, file)}
            onKeyDown={(event) => handleColumnItemKeyDown(event, file, columnIndex, onSelect, onOpenFolder)}
            role="listitem"
            tabIndex={0}
          >
            <span className="column-row-name">
              <SelectionCheckbox file={file} checked={checked} onToggle={onToggleSelect} />
              <FileIconWithBadge file={file} />
              <span>{file.name}</span>
            </span>
            <span className="column-row-meta">{columnMeta(file)}</span>
          </div>
        );
      })}
    </div>
  );
}

function ColumnState({ message, tone = "" }) {
  return (
    <div className={["finder-column-state", tone].filter(Boolean).join(" ")}>
      {message}
    </div>
  );
}

function findFileInColumns(columns, fileId) {
  if (!fileId) return null;
  for (const column of columns) {
    const file = column.files.find((item) => item.id === fileId);
    if (file) return file;
  }
  return null;
}

function ColumnPreview({ file, onUnlock }) {
  const [fullPreviewOpen, setFullPreviewOpen] = useState(false);
  const preview = useFilePreview(
    file,
    (target) => filesApi.previewBlob(target.id),
    (target) => filesApi.previewUrl(target.id),
    (target) => filesApi.previewStatus(target.id)
  );

  if (!file) {
    return (
      <div className="column-preview-empty">
        <FileSearchIcon />
        <span>항목을 선택하세요</span>
      </div>
    );
  }

  return (
    <div className="column-preview-stage">
      <IconButton
        className="preview-fullscreen-button"
        icon={Maximize2}
        label="전체 보기"
        onClick={() => setFullPreviewOpen(true)}
        disabled={file.type !== "file" || !canInlinePreview(file)}
      />
      <div className="column-preview-surface">
        <FilePreviewContent file={file} preview={preview} onUnlock={onUnlock} />
      </div>
      {fullPreviewOpen ? <FullPreviewDialog file={file} preview={preview} onClose={() => setFullPreviewOpen(false)} onUnlock={onUnlock} /> : null}
    </div>
  );
}

function GalleryView({ files, selectedFile, selectedIds, onSelect, onToggleSelect, onOpenFolder, onContextMenu, showLocation, moveHandlers, onUnlock }) {
  return (
    <div className="finder-gallery-view">
      <GalleryStage file={selectedFile} onUnlock={onUnlock} />
      <div className="gallery-strip" role="list" onWheel={handleGalleryStripWheel}>
	        {files.map((file) => {
	          const checked = selectedIds.includes(file.id);
	          const active = selectedFile?.id === file.id;
	          return (
	          <div
	            key={file.id}
	            className={itemClassName("gallery-thumb", checked, active, isDropTarget(file, moveHandlers))}
            data-file-item="true"
            data-file-id={file.id}
            {...moveItemProps(file, moveHandlers)}
            onClick={(event) => onSelect(file, event)}
            onDoubleClick={() => activateFile(file, onSelect, onOpenFolder)}
            onContextMenu={(event) => onContextMenu(event, file)}
            onKeyDown={(event) => handleItemKeyDown(event, file, onSelect, onOpenFolder)}
            role="listitem"
            tabIndex={0}
          >
            <SelectionCheckbox file={file} checked={checked} onToggle={onToggleSelect} />
            <FileIconWithBadge file={file} size={28} />
            <span className="gallery-thumb-name">{file.name}</span>
            {showLocation && fileLocation(file) ? <small className="gallery-thumb-location">{locationLabel(file)}</small> : null}
          </div>
          );
        })}
      </div>
    </div>
  );
}

function handleGalleryStripWheel(event) {
  const element = event.currentTarget;
  const maxScrollLeft = element.scrollWidth - element.clientWidth;
  if (maxScrollLeft <= 0) return;

  const scale = event.deltaMode === 1 ? 32 : event.deltaMode === 2 ? element.clientWidth : 1;
  const horizontalDelta = event.deltaX * scale;
  const verticalDelta = event.deltaY * scale;
  const delta = Math.abs(horizontalDelta) > Math.abs(verticalDelta) ? horizontalDelta : verticalDelta;
  if (!delta) return;

  const nextScrollLeft = Math.max(0, Math.min(maxScrollLeft, element.scrollLeft + delta));
  if (nextScrollLeft === element.scrollLeft) return;

  event.preventDefault();
  element.scrollLeft = nextScrollLeft;
}

function GalleryStage({ file, onUnlock }) {
  const [fullPreviewOpen, setFullPreviewOpen] = useState(false);
  const preview = useFilePreview(
    file,
    (target) => filesApi.previewBlob(target.id),
    (target) => filesApi.previewUrl(target.id),
    (target) => filesApi.previewStatus(target.id)
  );

  if (!file) {
    return (
      <div className="gallery-stage empty-gallery-stage">
        <FileSearchIcon />
        <strong>항목을 선택하세요</strong>
      </div>
    );
  }

  return (
    <div className="gallery-stage">
      <IconButton
        className="preview-fullscreen-button"
        icon={Maximize2}
        label="전체 보기"
        onClick={() => setFullPreviewOpen(true)}
        disabled={file.type !== "file" || !canInlinePreview(file)}
      />
      <div className="gallery-preview-surface">
        <FilePreviewContent file={file} preview={preview} onUnlock={onUnlock} />
      </div>
      {fullPreviewOpen ? <FullPreviewDialog file={file} preview={preview} onClose={() => setFullPreviewOpen(false)} onUnlock={onUnlock} /> : null}
    </div>
  );
}

function FileIcon({ file, size = 20 }) {
  if (file.type === "folder") return <FolderGlyph color={file.folderColor} size={size} />;
  if (isImageFile(file)) return <Image size={size} />;
  if (isVideoFile(file)) return <FileVideo size={size} />;
  if (isAudioFile(file)) return <FileAudio size={size} />;
  if (isTextFile(file) || isSpreadsheetFile(file) || isPdfFile(file) || isDocumentFile(file)) return <FileText size={size} />;
  return <File size={size} />;
}

function FileIconWithBadge({ file, size = 20 }) {
  const locked = Boolean(file.passwordProtected);
  const label = file.passwordUnlocked ? "2차 암호 해제됨" : "2차 암호 잠김";
  return (
    <span className={locked ? "file-icon-lock-wrap locked" : "file-icon-lock-wrap"} title={locked ? label : undefined}>
      <FileIcon file={file} size={size} />
      {locked ? (
        <span className="file-lock-badge" aria-label={label}>
          <LockKeyhole size={10} strokeWidth={2.6} />
        </span>
      ) : null}
    </span>
  );
}

function FileSearchIcon() {
  return <FileText size={42} />;
}

function itemClassName(base, checked, active, dropTarget = false) {
  return [base, checked ? "selected" : "", active ? "active" : "", dropTarget ? "move-drop-target" : ""].filter(Boolean).join(" ");
}

function isDropTarget(file, moveHandlers) {
  return file.type === "folder" && moveHandlers?.dropTargetId === file.id;
}

function moveItemProps(file, moveHandlers) {
  const canMove = Boolean(moveHandlers?.canMove);
  const canDrop = canMove && file.type === "folder";
  return {
    draggable: canMove,
    onDragStart: canMove ? (event) => moveHandlers.onDragStart?.(event, file) : undefined,
    onDragEnd: canMove ? (event) => moveHandlers.onDragEnd?.(event, file) : undefined,
    onDragOver: canDrop ? (event) => moveHandlers.onDragOverFolder?.(event, file) : undefined,
    onDragLeave: canDrop ? (event) => moveHandlers.onDragLeaveFolder?.(event, file) : undefined,
    onDrop: canDrop ? (event) => moveHandlers.onDropOnFolder?.(event, file) : undefined
  };
}

function SelectionCheckbox({ file, checked, onToggle }) {
  return (
    <input
      className="file-checkbox"
      type="checkbox"
      checked={checked}
      aria-label={`${file.name} 선택`}
      onChange={() => onToggle(file)}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
    />
  );
}

function activateFile(file, onSelect, onOpenFolder) {
  if (file.type === "folder") {
    onOpenFolder(file);
    return;
  }
  onSelect(file);
}

function activateColumnFile(file, columnIndex, onSelect, onOpenFolder) {
  if (file.type === "folder") {
    onOpenFolder(file);
    return;
  }
  onSelect(file, null, columnIndex);
}

function handleItemKeyDown(event, file, onSelect, onOpenFolder) {
  if (event.key !== "Enter") return;
  event.preventDefault();
  activateFile(file, onSelect, onOpenFolder);
}

function handleColumnItemKeyDown(event, file, columnIndex, onSelect, onOpenFolder) {
  if (event.key !== "Enter") return;
  event.preventDefault();
  activateColumnFile(file, columnIndex, onSelect, onOpenFolder);
}

function tileMeta(file, showLocation) {
  const base = file.type === "folder" ? "폴더" : formatBytes(file.sizeBytes);
  return showLocation && fileLocation(file) ? `${base} · ${locationLabel(file)}` : base;
}

function itemSubtitle(file, showLocation) {
  return showLocation && fileLocation(file) ? `${fileKind(file)} · ${locationLabel(file)}` : fileKind(file);
}

function columnMeta(file) {
  return file.type === "folder" ? ">" : formatBytes(file.sizeBytes);
}

function locationLabel(file) {
  return fileLocation(file);
}
