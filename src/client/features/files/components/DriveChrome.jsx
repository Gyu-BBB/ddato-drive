import {
  ArrowDownAZ,
  ArrowLeft,
  ArrowUpDown,
  Camera,
  Columns3,
  Copy,
  Download,
  Edit3,
  FolderPlus,
  FolderUp,
  GalleryHorizontalEnd,
  Home,
  KeyRound,
  LayoutGrid,
  List as ListIcon,
  LockKeyhole,
  MoveRight,
  RefreshCcw,
  RotateCcw,
  Search,
  Share2,
  Square,
  SquareCheckBig,
  Trash2,
  Upload,
  X
} from "lucide-react";
import { useRef } from 'react';
import { Button } from "../../../shared/components/Button.jsx";
import { Breadcrumbs } from "./Breadcrumbs.jsx";

import { UploadPolicyControl } from './UploadPolicyControl.jsx';

const viewModes = [
  { id: "icon", label: "아이콘 보기", icon: LayoutGrid },
  { id: "list", label: "목록 보기", icon: ListIcon },
  { id: "column", label: "컬럼 보기", icon: Columns3 },
  { id: "gallery", label: "갤러리 보기", icon: GalleryHorizontalEnd }
];

const sortOptions = [
  { id: "capturedAt", label: "촬영일" },
  { id: "sourceModifiedAt", label: "원본 수정일" },
  { id: "name", label: "이름" },
  { id: "size", label: "용량" },
  { id: "extension", label: "확장자" },
  { id: "createdAt", label: "추가된 날짜" },
  { id: "updatedAt", label: "수정된 날짜" },
  { id: "kind", label: "종류" },
  { id: "location", label: "위치" }
];

export function DriveChrome({
  inputRef,
  folderInputRef,
  onUpload,
  title,
  subtitle,
  folderStack,
  ownerLabel,
  trashMode,
  selectedCount,
  visibleCount,
  quotaLabel,
  quotaCompactLabel,
  quotaPercent,
  allVisibleSelected,
  canAdminReset,
  canRename,
  onNavigate,
  onGoBack,
  onGoHome,
  onSelectAll,
  onClearSelection,
  onCreateFolder,
  conflictPolicy,
  onConflictPolicyChange,
  onDownload,
  onShare,
  onDuplicate,
  onMove,
  onSetPassword,
  onAdminReset,
  onRename,
  onDelete,
  onRestore,
  onPurge,
  viewMode,
  onViewModeChange,
  query,
  onQueryChange,
  searchResultCount,
  sortField,
  onSortFieldChange,
  sortDirection,
  onSortDirectionChange,
  onRefresh,
  busy,
  dropTargetId,
  onDragOverFolder,
  onDragLeaveFolder,
  onDropOnFolder
}) {
  const cameraInputRef = useRef(null);
  const SelectIcon = allVisibleSelected ? Square : SquareCheckBig;

  return (
    <header className={selectedCount ? "drive-chrome has-selection" : "drive-chrome"}>
      <input ref={inputRef} type="file" multiple hidden onChange={onUpload} />
      <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" hidden onChange={onUpload} />
      <input ref={folderInputRef} type="file" webkitdirectory="" directory="" multiple hidden onChange={onUpload} />

      <div className="drive-titlebar">
        <div className="drive-titlebar-leading">
          <div className="chrome-control-group">
            <Button icon={ArrowLeft} iconOnly className="chrome-back" onClick={onGoBack} disabled={!folderStack.length || trashMode}>뒤로</Button>
            <Button icon={Home} iconOnly className="chrome-home" onClick={onGoHome} disabled={trashMode}>홈</Button>
          </div>
          {!trashMode ? (
            <div className="chrome-control-group create-controls">
              <Button icon={Upload} iconOnly onClick={() => inputRef.current?.click()}>업로드</Button>
              <Button icon={Camera} iconOnly className="capture-upload" onClick={() => cameraInputRef.current?.click()}>사진 촬영</Button>
              <Button icon={FolderUp} iconOnly onClick={() => folderInputRef.current?.click()}>폴더 업로드</Button>
              <Button icon={FolderPlus} iconOnly onClick={onCreateFolder}>새 폴더</Button>
              <UploadPolicyControl value={conflictPolicy} onChange={onConflictPolicyChange} />
            </div>
          ) : null}
        </div>

        <div className="drive-titleblock">
          <strong>{title}</strong>
          <span>{subtitle}</span>
        </div>

        <div className="drive-titlebar-trailing">
          <label className="search-box drive-search">
            <Search size={15} />
            <input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="파일, 폴더 검색" />
            {query.trim() ? <small>{searchResultCount}</small> : null}
          </label>

          <div className="view-switcher" role="group" aria-label="보기 방식">
            {viewModes.map((mode) => {
              const Icon = mode.icon;
              return (
                <button
                  key={mode.id}
                  type="button"
                  className={viewMode === mode.id ? "view-option active" : "view-option"}
                  title={mode.label}
                  aria-label={mode.label}
                  aria-pressed={viewMode === mode.id}
                  onClick={() => onViewModeChange(mode.id)}
                >
                  <Icon size={16} />
                </button>
              );
            })}
          </div>

          <div className="sort-control-group">
            <ArrowDownAZ size={15} aria-hidden="true" />
            <select aria-label="정렬 기준" value={sortField} onChange={(event) => onSortFieldChange(event.target.value)}>
              {sortOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
            <button type="button" onClick={onSortDirectionChange} aria-label="정렬 방향 변경" title={sortDirection === "asc" ? "오름차순" : "내림차순"}>
              <ArrowUpDown size={15} />
            </button>
          </div>

          <Button icon={RefreshCcw} iconOnly className="chrome-refresh" onClick={onRefresh} disabled={busy}>새로고침</Button>
        </div>
      </div>

      <Breadcrumbs stack={trashMode ? [] : folderStack} onNavigate={onNavigate} label={ownerLabel || (trashMode ? "휴지통" : "")} compact
        canDrop={!trashMode && !busy} dropTargetId={dropTargetId} onDragOverFolder={onDragOverFolder}
        onDragLeaveFolder={onDragLeaveFolder} onDropOnFolder={onDropOnFolder} />

      {selectedCount ? (
        <div className="selection-command-bar" role="toolbar" aria-label={`${selectedCount}개 선택 항목 작업`}>
          <div className="selection-summary">
            <button type="button" onClick={onClearSelection} aria-label="선택 해제"><X size={15} /></button>
            <strong>{selectedCount}개 선택</strong>
          </div>
          <div className="selection-actions">
            {trashMode ? (
              <>
                <Button icon={RotateCcw} onClick={onRestore}>복원</Button>
                <Button icon={Trash2} variant="danger" onClick={onPurge}>영구 삭제</Button>
              </>
            ) : (
              <>
                <Button icon={Download} onClick={onDownload}>다운로드</Button>
                <Button icon={Share2} onClick={onShare}>공유</Button>
                <Button icon={Copy} onClick={onDuplicate}>복제</Button>
                <Button icon={MoveRight} onClick={onMove}>이동</Button>
                <Button icon={LockKeyhole} onClick={onSetPassword}>암호</Button>
                {canAdminReset ? <Button icon={KeyRound} onClick={onAdminReset}>암호 초기화</Button> : null}
                <Button icon={Edit3} onClick={onRename} disabled={!canRename}>이름 변경</Button>
                <Button icon={Trash2} variant="danger" onClick={onDelete}>삭제</Button>
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="drive-status-strip">
          <button type="button" onClick={onSelectAll} disabled={!visibleCount}>
            <SelectIcon size={14} />
            <span>{allVisibleSelected ? "선택 해제" : "전체 선택"}</span>
          </button>
          <div className="drive-status-summary">
            <span>{visibleCount}개 항목</span>
            <span className="drive-storage-status" title={quotaLabel} aria-label={`저장 공간 ${quotaLabel}`}>
              <span className="drive-storage-track" aria-hidden="true">
                <span style={{ width: `${Math.max(0, Math.min(100, quotaPercent || 0))}%` }} />
              </span>
              <span className="drive-storage-label-full">{quotaLabel}</span>
              <span className="drive-storage-label-compact">{quotaCompactLabel}</span>
            </span>
          </div>
        </div>
      )}
    </header>
  );
}
