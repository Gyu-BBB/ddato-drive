import { ArrowLeft, ChevronLeft, Copy, Download, Edit3, FolderOpen, FolderPlus, Info, KeyRound, LockKeyhole, MoveRight, RefreshCcw, Share2, Square, SquareCheckBig, Trash2, UnlockKeyhole, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../shared/components/Button.jsx";
import { EmptyState } from "../../shared/components/EmptyState.jsx";
import { PasswordDialog } from "../../shared/components/PasswordDialog.jsx";
import { ProgressBar } from "../../shared/components/ProgressBar.jsx";
import { formatBytes, quotaPercent } from "../../shared/lib/formatBytes.js";
import { adminApi } from "../admin/adminApi.js";
import { useAuth } from "../auth/AuthProvider.jsx";
import { DriveChrome } from "./components/DriveChrome.jsx";
import { DriveContextMenu } from "./components/DriveContextMenu.jsx";
import { FileList } from "./components/FileList.jsx";
import { folderColorOptions } from "./components/FolderGlyph.jsx";
import { MetadataPane } from "./components/MetadataPane.jsx";
import { MoveDialog } from "./components/MoveDialog.jsx";
import { PreviewPane } from "./components/PreviewPane.jsx";
import { ShareDialog } from "./components/ShareDialog.jsx";
import { UploadQueue } from "./components/UploadQueue.jsx";
import { collectDroppedUploadEntries, collectSelectedUploadEntries, hasDroppedFiles, uploadCollectedEntries } from "./dragDropUpload.js";
import { sortFiles } from "./fileDisplay.js";
import { INTERNAL_MOVE_TYPE, hasInternalMove, readInternalMoveIds, compactMoveSelection, dragSelection, canDropSelection, createMoveDragImage } from "./dragMove.js";
import { filesApi } from "./filesApi.js";
import { startDownload } from "./downloadTransfers.js";
import { usePersistentUploadQueue } from "./usePersistentUploadQueue.js";

const VIEW_STORAGE_KEY = "ddato_drive_view_mode";
const SORT_FIELD_STORAGE_KEY = "ddato_drive_sort_field";
const SORT_DIRECTION_STORAGE_KEY = "ddato_drive_sort_direction";
const SIDE_PANEL_WIDTH_STORAGE_KEY = "ddato_drive_side_panel_width";
const SIDE_PANEL_MIN_WIDTH = 300;
const SIDE_PANEL_DEFAULT_WIDTH = 360;
const SIDE_PANEL_MAX_WIDTH = 820;
const viewModeIds = ["icon", "list", "column", "gallery"];
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

export function DrivePage({ ownerId = "", ownerLabel = "", trashMode = false, homeSignal = 0, initialFolderStack = [], allowAdminPasswordReset = false,
  routedFolderStack = null, routeFolderId, onFolderNavigate = null, folderLoading = false, folderError = "" }) {
  const { user, refresh } = useAuth();
  const inputRef = useRef(null);
  const folderInputRef = useRef(null);
  const [localFolderStack, setLocalFolderStack] = useState(() => initialFolderStack);
  const folderStack = routedFolderStack ?? localFolderStack;
  const fileLoadRequestRef = useRef(0);
  const previousHomeSignalRef = useRef(homeSignal);
  const [files, setFiles] = useState([]);
  const [knownFiles, setKnownFiles] = useState(() => new Map());
  const [owner, setOwner] = useState(null);
  const [usageBytes, setUsageBytes] = useState(0);
  const [projectQuotaBytes, setProjectQuotaBytes] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [activeFileId, setActiveFileId] = useState("");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [shareFiles, setShareFiles] = useState([]);
  const [moveFiles, setMoveFiles] = useState([]);
  const [passwordDialog, setPasswordDialog] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [dragActive, setDragActive] = useState(false);
  const [dropTargetId, setDropTargetId] = useState("");
  const [sidePanelCollapsed, setSidePanelCollapsed] = useState(true);
  const [sidePanelMode, setSidePanelMode] = useState("preview");
  const dragDepthRef = useRef(0);
  const currentDragIdsRef = useRef([]);
  const dragImageCleanupRef = useRef(null);
  const selectionAnchorIdRef = useRef("");
  const sidePanelWidthRef = useRef(SIDE_PANEL_DEFAULT_WIDTH);
  const [sidePanelWidth, setSidePanelWidth] = useState(() => {
    const saved = Number(window.localStorage.getItem(SIDE_PANEL_WIDTH_STORAGE_KEY));
    return clampPanelWidth(Number.isFinite(saved) ? saved : SIDE_PANEL_DEFAULT_WIDTH);
  });
  const [sortField, setSortField] = useState(() => {
    const saved = window.localStorage.getItem(SORT_FIELD_STORAGE_KEY);
    return sortOptions.some((option) => option.id === saved) ? saved : "name";
  });
  const [sortDirection, setSortDirection] = useState(() => {
    return window.localStorage.getItem(SORT_DIRECTION_STORAGE_KEY) === "desc" ? "desc" : "asc";
  });
  const [viewMode, setViewMode] = useState(() => {
    const saved = window.localStorage.getItem(VIEW_STORAGE_KEY);
    return viewModeIds.includes(saved) ? saved : "icon";
  });
  const [conflictPolicy, setConflictPolicy] = useState('keep');
  const uploadQueue = usePersistentUploadQueue({
    accountId: user?.id || "",
    enabled: !trashMode,
    onComplete: async () => {
      await loadFiles();
    }
  });

  const parentId = routeFolderId === undefined ? folderStack.at(-1)?.id || null : routeFolderId || null;

  function setFolderStack(value) {
    const nextStack = typeof value === "function" ? value(folderStack) : value;
    if (onFolderNavigate) onFolderNavigate(nextStack);
    else setLocalFolderStack(nextStack);
  }

  useEffect(() => () => dragImageCleanupRef.current?.(), []);

  useEffect(() => {
    if (folderLoading || folderError) return;
    const timer = window.setTimeout(() => loadFiles(), query.trim() ? 180 : 0);
    return () => {
      window.clearTimeout(timer);
      fileLoadRequestRef.current++;
    };
  }, [parentId, ownerId, query, trashMode, folderLoading, folderError]);

  useEffect(() => {
    setQuery("");
    setFiles([]);
    setError("");
    setSelectedIds([]);
    setActiveFileId("");
    setSidePanelCollapsed(true);
    setContextMenu(null);
  }, [parentId, ownerId, trashMode]);

  const filteredFiles = useMemo(() => {
    if (folderLoading || folderError) return [];
    const search = query.trim().toLowerCase();
    if (!trashMode || !search) return files;
    return files.filter((file) => String(file.name || "").toLowerCase().includes(search));
  }, [files, query, trashMode, folderLoading, folderError]);
  const visibleFiles = useMemo(() => sortFiles(filteredFiles, sortField, sortDirection), [filteredFiles, sortField, sortDirection]);
  const selectedFiles = useMemo(() => selectedIds.map((id) => knownFiles.get(id)).filter(Boolean), [knownFiles, selectedIds]);
  const selectedFile = useMemo(() => knownFiles.get(activeFileId) || files.find((file) => file.id === activeFileId) || null, [files, knownFiles, activeFileId]);
  const isSidePanelOpen = Boolean(selectedFile) && !sidePanelCollapsed;
  const isSearching = Boolean(query.trim());
  const allVisibleSelected = visibleFiles.length > 0 && visibleFiles.every((file) => selectedIds.includes(file.id));

  useEffect(() => {
    sidePanelWidthRef.current = sidePanelWidth;
  }, [sidePanelWidth]);

  useEffect(() => {
    if (!selectedFile) setSidePanelCollapsed(true);
  }, [selectedFile?.id]);

	  useEffect(() => {
	    if (previousHomeSignalRef.current === homeSignal) return;
	    previousHomeSignalRef.current = homeSignal;
	    if (trashMode) return;
	    setFolderStack([]);
	    setQuery("");
	    setSelectedIds([]);
	    setActiveFileId("");
	    setSidePanelCollapsed(true);
	  }, [homeSignal, trashMode]);

  async function loadFiles() {
    if (folderLoading || folderError) return;
    const requestId = ++fileLoadRequestRef.current;
    setBusy(true);
    setError("");
    try {
      if (trashMode) {
        const result = await filesApi.trash({ ownerId });
        if (requestId !== fileLoadRequestRef.current) return;
	        rememberFiles(result.files);
	        setFiles(result.files);
	        setOwner(result.owner);
	        setUsageBytes(result.usageBytes);
	        setProjectQuotaBytes(result.projectQuotaBytes ?? null);
	        await refresh();
        if (requestId !== fileLoadRequestRef.current) return;
	        setSelectedIds((ids) => ids.filter((id) => result.files.some((file) => file.id === id)));
	        setActiveFileId((id) => result.files.some((file) => file.id === id) ? id : "");
	        return;
	      }

      const search = query.trim();
      const result = await filesApi.list({ parentId: search ? null : parentId, ownerId, search });
      if (requestId !== fileLoadRequestRef.current) return;
	      rememberFiles(result.files);
	      setFiles(result.files);
	      setOwner(result.owner);
	      setUsageBytes(result.usageBytes);
	      setProjectQuotaBytes(result.projectQuotaBytes ?? null);
	      await refresh();
      if (requestId !== fileLoadRequestRef.current) return;
	      setSelectedIds((ids) => ids.filter((id) => result.files.some((file) => file.id === id)));
	      setActiveFileId((id) => result.files.some((file) => file.id === id) ? id : "");
	    } catch (nextError) {
      if (requestId !== fileLoadRequestRef.current) return;
      setError(nextError.message || "파일 목록을 불러오지 못했습니다.");
    } finally {
      if (requestId === fileLoadRequestRef.current) setBusy(false);
    }
  }

  function openFolder(file) {
    if (trashMode) return;
    rememberFiles([file]);
    const nextStack = Array.isArray(file.path) && file.path.length
      ? file.path
      : [...folderStack, { id: file.id, name: file.name }];
	    setFolderStack(nextStack);
	    setSelectedIds([]);
	    setActiveFileId("");
	    setQuery("");
	  }

  async function createFolder() {
    if (trashMode) return;
    if (!(await ensureCurrentFolderUnlocked("새 폴더 만들기"))) return;
    const name = window.prompt("새 폴더 이름", "새 폴더");
    if (!name) return;
    await runAction(() => filesApi.createFolder({ name, parentId, ownerId }));
  }

  async function renameSelected() {
    if (trashMode) return;
    if (selectedFiles.length !== 1) return;
    const selectedFile = selectedFiles[0];
    if (!(await unlockFileForAction(selectedFile, "이름 변경"))) return;
    const name = window.prompt("새 이름", selectedFile.name);
    if (!name || name === selectedFile.name) return;
    await runAction(() => filesApi.rename(selectedFile.id, name));
  }

  async function changeFolderColor(file, color) {
    if (trashMode || !file || file.type !== "folder") return;
    if (!(await unlockFileForAction(file, "색상 변경"))) return;
    await runAction(async () => {
      const result = await filesApi.setFolderColor(file.id, color);
      rememberFiles([result.file]);
    });
  }

  async function duplicateSelected(targets = selectedFiles) {
    if (trashMode) return;
    const items = compactTreeSelection(targets.filter(Boolean));
    if (!items.length) return;
    if (!(await ensureFilesUnlocked(items, "복제"))) return;
    await runAction(async () => {
      for (const item of items) {
        const result = await filesApi.duplicate(item.id);
        rememberFiles([result.root]);
      }
    });
  }

  async function deleteSelected(targets = selectedFiles) {
    if (trashMode) {
      await purgeSelected(targets);
      return;
    }
    const items = compactTreeSelection(targets.filter(Boolean));
    if (!items.length) return;
    const label = items.length === 1 ? `${items[0].name}을 삭제할까요?` : `${items.length}개 항목을 삭제할까요?`;
    if (!window.confirm(label)) return;
    await runAction(async () => {
      for (const item of items) {
        await filesApi.remove(item.id);
      }
	    });
	    setSelectedIds([]);
	    setActiveFileId((id) => items.some((item) => item.id === id) ? "" : id);
	  }

  async function restoreSelected(targets = selectedFiles) {
    const items = targets.filter(Boolean);
    if (!items.length) return;
    await runAction(async () => {
      for (const item of items) {
        await filesApi.restore(item.id);
      }
	    });
	    setSelectedIds([]);
	    setActiveFileId((id) => items.some((item) => item.id === id) ? "" : id);
	  }

  async function purgeSelected(targets = selectedFiles) {
    const items = targets.filter(Boolean);
    if (!items.length) return;
    const label = items.length === 1 ? `${items[0].name}을 영구 삭제할까요?` : `${items.length}개 항목을 영구 삭제할까요?`;
    if (!window.confirm(label)) return;
    await runAction(async () => {
      for (const item of items) {
        await filesApi.purge(item.id);
      }
	    });
	    setSelectedIds([]);
	    setActiveFileId((id) => items.some((item) => item.id === id) ? "" : id);
	  }

  async function runAction(action) {
    setError("");
    try {
      await action();
      await loadFiles();
    } catch (nextError) {
      setError(nextError.message || "작업을 완료하지 못했습니다.");
    }
  }

  function rememberFiles(nextFiles = []) {
    if (!nextFiles.length) return;
    setKnownFiles((current) => {
      const next = new Map(current);
      for (const file of nextFiles) {
        if (file?.id) next.set(file.id, file);
      }
      return next;
    });
  }

  async function handleUpload(event) {
    if (trashMode) return;
    const selected = [...event.target.files];
    event.target.value = "";
    if (!selected.length) return;
    try {
      if (!(await ensureCurrentFolderUnlocked("업로드"))) return;
      await uploadEntries(collectSelectedUploadEntries(selected));
    } catch (nextError) {
      await loadFiles();
      setError(nextError.message || "파일 또는 폴더를 업로드하지 못했습니다.");
    }
  }

  async function uploadEntries(entries) {
    await uploadCollectedEntries({ entries, rootParentId: parentId, ownerId,
      createFolder: filesApi.createFolder, uploadFile: payload => uploadQueue.enqueueUpload({ ...payload, conflictPolicy }),
      onQueueAdd: uploadQueue.addTransientUpload, onQueueUpdate: uploadQueue.updateTransientUpload });
    await loadFiles();
  }

  function handleDragEnter(event) {
    if (trashMode) return;
    if (hasInternalMove(event.dataTransfer)) return;
    if (!hasDroppedFiles(event.dataTransfer)) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setDragActive(true);
  }

  function handleDragOver(event) {
    if (trashMode) return;
    if (hasInternalMove(event.dataTransfer)) return;
    if (!hasDroppedFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  function handleDragLeave(event) {
    if (trashMode) return;
    if (hasInternalMove(event.dataTransfer)) return;
    if (!hasDroppedFiles(event.dataTransfer)) return;
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragActive(false);
  }

  async function handleDrop(event) {
    if (trashMode) return;
    if (hasInternalMove(event.dataTransfer)) {
      event.preventDefault();
      event.stopPropagation();
      setDropTargetId("");
      return;
    }
    if (!hasDroppedFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = 0;
    setDragActive(false);
    closeContextMenu();
    setError("");

    try {
      const entries = await collectDroppedUploadEntries(event.dataTransfer);
      if (!(await ensureCurrentFolderUnlocked("업로드"))) return;
      if (!entries.files.length && !entries.directories.length) {
        setError("업로드할 파일이나 폴더를 찾지 못했습니다.");
        return;
      }

      await uploadEntries(entries);
    } catch (nextError) {
      await loadFiles();
      setError(nextError.message || "드롭한 항목을 업로드하지 못했습니다.");
    }
  }

	  async function downloadSelected() {
	    if (trashMode) {
	      setError("휴지통 항목은 복원한 뒤 다운로드할 수 있습니다.");
	      return;
	    }
	    await downloadFiles(selectedFiles);
	  }

	  async function downloadActiveFile() {
	    if (!selectedFile) return;
	    await downloadFiles([selectedFile]);
	  }

  async function downloadFiles(targets) {
    if (trashMode) {
      setError("휴지통 항목은 복원한 뒤 다운로드할 수 있습니다.");
      return;
    }
    const itemsToDownload = compactTreeSelection(targets.filter(Boolean));
    if (!itemsToDownload.length) {
      setError("다운로드할 항목을 선택하세요.");
      return;
    }
    setError("");
    if (!(await ensureFilesUnlocked(itemsToDownload, "다운로드"))) return;
    if (itemsToDownload.length === 1) {
      const file = itemsToDownload[0];
      void startDownload(filesApi.downloadUrl(file.id), file.type === "folder" ? `${file.name}.zip` : file.name);
      return;
    }

    setBusy(true);
    try {
      await startDownload("/api/files/download", "DDATO Drive 선택 항목.zip", { method: "POST", body: { ids: itemsToDownload.map(item => item.id) } });
    } catch (nextError) {
      setError(nextError.message || "선택 항목을 다운로드하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function openShareDialog(targets) {
    if (trashMode) {
      setError("휴지통 항목은 복원한 뒤 공유할 수 있습니다.");
      return;
    }
    const itemsToShare = compactTreeSelection(targets.filter(Boolean));
    if (!itemsToShare.length) {
      setError("공유할 항목을 선택하세요.");
      return;
    }
    setError("");
    if (!(await ensureFilesUnlocked(itemsToShare, "공유"))) return;
    setShareFiles(itemsToShare);
  }

  async function ensureFilesUnlocked(items, actionLabel) {
    for (const item of items) {
      if (!(await unlockFileForAction(item, actionLabel))) return false;
    }
    return true;
  }

  async function ensureCurrentFolderUnlocked(actionLabel) {
    if (!parentId) return true;
    const folder = knownFiles.get(parentId);
    if (!folder) return true;
    return unlockFileForAction(folder, actionLabel);
  }

  async function unlockFileForAction(file, actionLabel = "작업") {
    if (!file?.passwordProtected || file.passwordUnlocked) return true;
    const canResetHere = allowAdminPasswordReset && file.ownPasswordProtected;
    const password = await requestPassword({
      title: "암호 입력",
      body: canResetHere
        ? `${file.name} 항목을 ${actionLabel}하려면 암호가 필요합니다. 암호를 잊었다면 관리자 권한으로 초기화할 수 있습니다.`
        : `${file.name} 항목을 ${actionLabel}하려면 암호가 필요합니다. 암호를 잊었다면 관리자에게 2차 암호 초기화를 요청하세요.`,
      confirmLabel: "잠금 해제",
      recoverLabel: canResetHere ? "2차 암호 초기화" : "",
      onRecover: canResetHere ? () => resetPasswordForFiles([file]) : null
    });
    if (!password) return false;

    try {
      const result = await filesApi.unlock(file.id, password);
      rememberFiles([result.file]);
      return true;
    } catch (nextError) {
      setError(nextError.message || "암호를 확인하지 못했습니다.");
      return false;
    }
  }

  async function setPasswordForFiles(targets) {
    const items = targets.filter(Boolean);
    if (!items.length) return;
    const protectedItems = items.filter((item) => item.ownPasswordProtected && !item.passwordUnlocked);
    if (protectedItems.length && !(await ensureFilesUnlocked(protectedItems, "암호 변경"))) return;
    const password = await requestPassword({
      title: items.length === 1 ? "암호 설정" : "선택 항목 암호 설정",
      body: items.length === 1 ? `${items[0].name}에 사용할 암호를 입력하세요.` : `${items.length}개 항목에 같은 암호를 설정합니다.`,
      confirmLabel: "암호 설정"
    });
    if (!password) return;

    await runAction(async () => {
      for (const item of items) {
        const result = await filesApi.setPassword(item.id, password);
        rememberFiles([result.file]);
      }
    });
  }

  async function clearPasswordForFiles(targets) {
    const items = targets.filter((item) => item?.ownPasswordProtected);
    if (!items.length) {
      setError("해제할 암호가 설정된 항목을 선택하세요.");
      return;
    }
    const password = await requestPassword({
      title: items.length === 1 ? "암호 해제" : "선택 항목 암호 해제",
      body: items.length === 1 ? `${items[0].name}의 암호를 해제하려면 현재 암호를 입력하세요.` : `${items.length}개 항목의 암호를 해제합니다. 같은 암호가 설정된 항목만 해제됩니다.`,
      confirmLabel: "암호 해제"
    });
    if (!password) return;

    await runAction(async () => {
      for (const item of items) {
        const result = await filesApi.clearPassword(item.id, password);
        rememberFiles([result.file]);
      }
    });
  }

  async function resetPasswordForFiles(targets) {
    if (!allowAdminPasswordReset) return;
    const items = targets.filter((item) => item?.ownPasswordProtected);
    if (!items.length) {
      setError("초기화할 2차 암호가 설정된 항목을 선택하세요.");
      return;
    }
    const label = items.length === 1 ? `${items[0].name}의 2차 암호를 초기화할까요?` : `${items.length}개 항목의 2차 암호를 초기화할까요?`;
    if (!window.confirm(`${label}\n초기화하면 암호 없이 미리보기, 다운로드, 공유, 삭제가 가능해집니다.`)) return;

    await runAction(async () => {
      for (const item of items) {
        const result = await adminApi.resetFilePassword(item.id);
        rememberFiles([result.file]);
      }
    });
  }

  function requestPassword(options) {
    return new Promise((resolve) => {
      setPasswordDialog({ ...options, resolve });
    });
  }

  function submitPasswordDialog(password) {
    const resolve = passwordDialog?.resolve;
    setPasswordDialog(null);
    resolve?.(password);
  }

  function closePasswordDialog() {
    const resolve = passwordDialog?.resolve;
    setPasswordDialog(null);
    resolve?.("");
  }

  function recoverPasswordDialog() {
    const resolve = passwordDialog?.resolve;
    const onRecover = passwordDialog?.onRecover;
    setPasswordDialog(null);
    resolve?.("");
    void onRecover?.();
  }

  async function openMoveDialog(targets) {
    if (trashMode) {
      setError("휴지통 항목은 복원한 뒤 이동할 수 있습니다.");
      return;
    }
    const itemsToMove = compactTreeSelection(targets.filter(Boolean));
    if (!itemsToMove.length) {
      setError("이동할 항목을 선택하세요.");
      return;
    }
    setError("");
    if (!(await ensureFilesUnlocked(itemsToMove, "이동"))) return;
    setMoveFiles(itemsToMove);
  }

  async function moveItems(targets, destinationParentId) {
    if (trashMode) {
      setError("휴지통 항목은 복원한 뒤 이동할 수 있습니다.");
      return false;
    }

    const items = compactTreeSelection(targets.filter(Boolean));
    if (!items.length) {
      setError("이동할 항목을 선택하세요.");
      return false;
    }

    if (!(await ensureFilesUnlocked(items, "이동"))) return false;

    const movedIds = new Set();
    setBusy(true);
    setError("");
    try {
      for (const item of items) {
        const result = await filesApi.move(item.id, destinationParentId);
        movedIds.add(item.id);
        rememberFiles([result.file]);
      }
      await loadFiles();
      setSelectedIds((ids) => ids.filter((id) => !movedIds.has(id)));
      setActiveFileId((id) => movedIds.has(id) ? "" : id);
      setMoveFiles([]);
      setDropTargetId("");
      return true;
    } catch (nextError) {
      await loadFiles();
      setSelectedIds((ids) => ids.filter((id) => !movedIds.has(id)));
      setActiveFileId((id) => movedIds.has(id) ? "" : id);
      setError(nextError.message || "항목을 이동하지 못했습니다.");
      setDropTargetId("");
      return false;
    } finally {
      setBusy(false);
    }
  }

  function handleItemDragStart(event, file) {
    if (trashMode || busy) {
      event.preventDefault();
      return;
    }
    const items = dragSelection(file, selectedFiles);
    const ids = items.map((item) => item.id).filter(Boolean);
    if (!ids.length) {
      event.preventDefault();
      return;
    }

    currentDragIdsRef.current = ids;
    rememberFiles(items);
    closeContextMenu();
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(INTERNAL_MOVE_TYPE, JSON.stringify(ids));
    event.dataTransfer.setData("text/plain", items.map((item) => item.name).join(", "));
    dragImageCleanupRef.current?.();
    dragImageCleanupRef.current = createMoveDragImage(event.dataTransfer, items);
  }

  function handleItemDragEnd() {
    dragImageCleanupRef.current?.();
    dragImageCleanupRef.current = null;
    currentDragIdsRef.current = [];
    setDropTargetId("");
  }

  function handleItemDragOverFolder(event, target) {
    if (trashMode || busy || !hasInternalMove(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    const items = currentDragIdsRef.current.map(id => knownFiles.get(id)).filter(Boolean);
    if (!canDropSelection(items, target)) {
      event.dataTransfer.dropEffect = "none";
      setDropTargetId("");
      return;
    }
    event.dataTransfer.dropEffect = "move";
    setDropTargetId(target?.id || "home");
  }

  function handleItemDragLeaveFolder(event, target) {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    setDropTargetId((id) => id === (target?.id || "home") ? "" : id);
  }

  async function handleItemDropOnFolder(event, target) {
    if (trashMode || busy || !hasInternalMove(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    const ids = readInternalMoveIds(event.dataTransfer, currentDragIdsRef.current);
    handleItemDragEnd();
    const items = ids.map((id) => knownFiles.get(id) || visibleFiles.find((file) => file.id === id)).filter(Boolean);
    if (!canDropSelection(items, target)) return;
    await moveItems(items, target?.id || null);
  }

  function changeViewMode(nextMode) {
    setViewMode(nextMode);
    window.localStorage.setItem(VIEW_STORAGE_KEY, nextMode);
  }

  function changeSortField(nextField) {
    setSortField(nextField);
    window.localStorage.setItem(SORT_FIELD_STORAGE_KEY, nextField);
  }

  function toggleSortDirection() {
    const nextDirection = sortDirection === "asc" ? "desc" : "asc";
    setSortDirection(nextDirection);
    window.localStorage.setItem(SORT_DIRECTION_STORAGE_KEY, nextDirection);
  }

  function selectFile(file, event = null) {
    event?.preventDefault();
    rememberFiles([file]);
    selectionAnchorIdRef.current = file.id;
    setActiveFileId(file.id);
    if (file.type !== "folder") {
      setSidePanelMode("preview");
      setSidePanelCollapsed(false);
    }
  }

  function showFileInfo(file) {
    rememberFiles([file]);
    setActiveFileId(file.id);
    setSidePanelMode("info");
    setSidePanelCollapsed(false);
  }

  function toggleFileSelection(file) {
    rememberFiles([file]);
    selectionAnchorIdRef.current = file.id;
    setSelectedIds((ids) => ids.includes(file.id) ? ids.filter((id) => id !== file.id) : [...ids, file.id]);
  }

  function toggleSelectAllVisible() {
    if (!visibleFiles.length) return;
    if (allVisibleSelected) {
      const visibleIds = new Set(visibleFiles.map((file) => file.id));
      setSelectedIds((ids) => ids.filter((id) => !visibleIds.has(id)));
      selectionAnchorIdRef.current = "";
      return;
    }

    selectionAnchorIdRef.current = visibleFiles[0].id;
    rememberFiles(visibleFiles);
    setSelectedIds(visibleFiles.map((file) => file.id));
  }

	  function handleDriveKeyDown(event) {
	    if (event.target.closest("input, textarea, select, button")) return;
	    if (!visibleFiles.length) return;

	    if (["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"].includes(event.key)) {
	      event.preventDefault();
	      const direction = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : -1;
	      const activeIndex = visibleFiles.findIndex((file) => file.id === selectedFile?.id);
	      const currentIndex = activeIndex >= 0 ? activeIndex : direction > 0 ? -1 : visibleFiles.length;
	      const nextIndex = Math.max(0, Math.min(visibleFiles.length - 1, currentIndex + direction));
	      const nextFile = visibleFiles[nextIndex];
        selectFile(nextFile);
	      focusFileItem(nextFile.id);
	      return;
	    }

    if (event.key === "Enter" && selectedFile) {
      event.preventDefault();
      if (!trashMode && selectedFile.type === "folder") openFolder(selectedFile);
      return;
    }

    if (event.key === " " && selectedFile) {
      event.preventDefault();
      setSidePanelCollapsed(false);
      return;
    }

    if ((event.key === "Delete" || event.key === "Backspace") && selectedFiles.length) {
      event.preventDefault();
      deleteSelected();
    }
  }

  function focusFileItem(fileId) {
    window.requestAnimationFrame(() => {
      const item = Array.from(document.querySelectorAll("[data-file-id]")).find((element) => element.dataset.fileId === fileId);
      item?.focus();
    });
  }

  function startSidePanelResize(event) {
    if (event.button !== undefined && event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const handlePointerMove = (moveEvent) => {
      const nextWidth = clampPanelWidth(window.innerWidth - moveEvent.clientX);
      sidePanelWidthRef.current = nextWidth;
      setSidePanelWidth(nextWidth);
    };

    const handlePointerUp = () => {
      window.localStorage.setItem(SIDE_PANEL_WIDTH_STORAGE_KEY, String(sidePanelWidthRef.current));
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
  }

  function getContextSelection(file) {
    if (!file) return selectedFiles;
    return selectedIds.includes(file.id) ? selectedFiles : [file];
  }

  function compactTreeSelection(items) {
    return compactMoveSelection(items);
  }

	  function openItemContextMenu(event, file) {
	    event.preventDefault();
	    event.stopPropagation();
	    rememberFiles([file]);
	    setActiveFileId(file.id);
	    setContextMenu(buildContextMenu(event.clientX, event.clientY, file));
	  }

  function openBlankContextMenu(event) {
    event.preventDefault();
    setContextMenu(buildContextMenu(event.clientX, event.clientY, null));
  }

  function closeContextMenu() {
    setContextMenu(null);
  }

	  function goBack() {
	    setFolderStack((stack) => stack.slice(0, -1));
	    setSelectedIds([]);
	    setActiveFileId("");
	  }

  function buildContextMenu(clientX, clientY, file) {
    const x = Math.max(8, Math.min(clientX, window.innerWidth - 228));
    const y = Math.max(8, Math.min(clientY, window.innerHeight - 360));
    const selection = getContextSelection(file);
    const hasSelection = selection.length > 0;
    const single = selection.length === 1 ? selection[0] : null;

    const run = (action) => () => {
      closeContextMenu();
      action();
    };

    if (!file) {
      return {
        x,
        y,
        items: trashMode ? [
          { id: "select-all", label: allVisibleSelected ? "선택 해제" : "전체 선택", icon: allVisibleSelected ? Square : SquareCheckBig, disabled: !visibleFiles.length, onClick: run(toggleSelectAllVisible) },
          { id: "refresh", label: "새로고침", icon: RefreshCcw, onClick: run(loadFiles) }
        ] : [
          { id: "select-all", label: allVisibleSelected ? "선택 해제" : "전체 선택", icon: allVisibleSelected ? Square : SquareCheckBig, disabled: !visibleFiles.length, onClick: run(toggleSelectAllVisible) },
          { id: "new-folder", label: "새 폴더", icon: FolderPlus, onClick: run(createFolder) },
          { id: "upload", label: "업로드", icon: Upload, onClick: run(() => inputRef.current?.click()) },
          { id: "upload-folder", label: "폴더 업로드", icon: FolderPlus, onClick: run(() => folderInputRef.current?.click()) },
          { id: "back", label: "뒤로가기", icon: ArrowLeft, disabled: !folderStack.length, onClick: run(goBack) },
          { id: "refresh", label: "새로고침", icon: RefreshCcw, onClick: run(loadFiles) }
        ]
      };
    }

    if (trashMode) {
      return {
        x,
        y,
        items: [
          { id: "info", label: "파일 정보", icon: Info, onClick: run(() => showFileInfo(file)) },
          { id: "restore", label: "복원", icon: RotateCcw, disabled: !hasSelection, onClick: run(() => restoreSelected(selection)) },
          { id: "delete", label: "영구 삭제", icon: Trash2, disabled: !hasSelection, onClick: run(() => purgeSelected(selection)) }
        ]
      };
    }

    return {
      x,
      y,
      items: [
        { id: "open", label: "열기", icon: FolderOpen, disabled: !single || single.type !== "folder", onClick: run(() => openFolder(single)) },
        { id: "info", label: "파일 정보", icon: Info, onClick: run(() => showFileInfo(file)) },
        { id: "download", label: "다운로드", icon: Download, disabled: !hasSelection, onClick: run(() => downloadFiles(selection)) },
        { id: "share", label: "공유", icon: Share2, disabled: !hasSelection, onClick: run(() => openShareDialog(selection)) },
        { id: "duplicate", label: "복제", icon: Copy, disabled: !hasSelection, onClick: run(() => duplicateSelected(selection)) },
        { id: "move", label: "이동...", icon: MoveRight, disabled: !hasSelection, onClick: run(() => openMoveDialog(selection)) },
        { id: "unlock", label: "암호 입력", icon: UnlockKeyhole, disabled: !selection.some((item) => item.passwordProtected && !item.passwordUnlocked), onClick: run(() => unlockFileForAction(selection.find((item) => item.passwordProtected && !item.passwordUnlocked), "열람")) },
        { id: "sep-1", separator: true },
        { id: "set-password", label: selection.some((item) => item.ownPasswordProtected) ? "암호 변경" : "암호 설정", icon: LockKeyhole, disabled: !hasSelection, onClick: run(() => setPasswordForFiles(selection)) },
        { id: "clear-password", label: "암호 해제", icon: UnlockKeyhole, disabled: !selection.some((item) => item.ownPasswordProtected), onClick: run(() => clearPasswordForFiles(selection)) },
        ...(allowAdminPasswordReset ? [
          { id: "admin-reset-password", label: "2차 암호 초기화", icon: KeyRound, disabled: !selection.some((item) => item.ownPasswordProtected), onClick: run(() => resetPasswordForFiles(selection)) }
        ] : []),
        { id: "sep-password", separator: true },
        { id: "rename", label: "이름 변경", icon: Edit3, disabled: selection.length !== 1, onClick: run(() => renameFile(selection[0])) },
        ...(single?.type === "folder" ? [
          {
            id: "folder-color",
            label: "색상 변경",
            palette: folderColorOptions.map((option) => ({
              ...option,
              active: (single.folderColor || "yellow") === option.id
            })),
            onSelect: (color) => {
              closeContextMenu();
              changeFolderColor(single, color);
            }
          },
          { id: "sep-2", separator: true }
        ] : []),
        { id: "delete", label: "삭제", icon: Trash2, onClick: run(() => deleteSelected(selection)) }
      ]
    };
  }

  async function renameFile(file) {
    if (!file) return;
    if (!(await unlockFileForAction(file, "이름 변경"))) return;
    const name = window.prompt("새 이름", file.name);
    if (!name || name === file.name) return;
    await runAction(() => filesApi.rename(file.id, name));
  }

  const quotaUser = owner || user;
  const effectiveQuotaBytes = quotaUser?.quotaBytes ?? projectQuotaBytes;
  const percent = quotaPercent(usageBytes, effectiveQuotaBytes);
  const quotaLabel = quotaUser?.quotaBytes == null
    ? `${formatBytes(usageBytes)} 사용 / 프로젝트 전체 ${formatBytes(projectQuotaBytes || 0)}`
    : `${formatBytes(usageBytes)} 사용 / 전체 ${formatBytes(quotaUser.quotaBytes)}`;
  const quotaCompactLabel = `${formatBytes(usageBytes)} / ${formatBytes(effectiveQuotaBytes || 0)}`;
  const chromeTitle = folderStack.at(-1)?.name || ownerLabel || (trashMode ? "휴지통" : "홈");
  const chromeSubtitle = isSearching ? `${visibleFiles.length}개 검색 결과` : `${visibleFiles.length}개 항목`;

  return (
    <div
      className={isSidePanelOpen ? "drive-layout" : "drive-layout side-panel-collapsed"}
      style={isSidePanelOpen ? { "--drive-side-panel-width": `${sidePanelWidth}px` } : undefined}
    >
      <section className="drive-main">
        <DriveChrome
          inputRef={inputRef}
          folderInputRef={folderInputRef}
          onUpload={handleUpload}
          title={chromeTitle}
          subtitle={chromeSubtitle}
          folderStack={folderStack}
          ownerLabel={ownerLabel}
          trashMode={trashMode}
          selectedCount={selectedFiles.length}
          visibleCount={visibleFiles.length}
          quotaLabel={quotaLabel}
          quotaCompactLabel={quotaCompactLabel}
          quotaPercent={percent}
          allVisibleSelected={allVisibleSelected}
          canAdminReset={allowAdminPasswordReset && selectedFiles.some((file) => file.ownPasswordProtected)}
          canRename={selectedFiles.length === 1}
          onNavigate={(index) => setFolderStack(index < 0 ? [] : folderStack.slice(0, index + 1))}
          onGoBack={goBack}
          onGoHome={() => {
            setFolderStack([]);
            setQuery("");
            setSelectedIds([]);
            setActiveFileId("");
          }}
          onSelectAll={toggleSelectAllVisible}
          onClearSelection={() => setSelectedIds([])}
          onCreateFolder={createFolder}
          conflictPolicy={conflictPolicy}
          onConflictPolicyChange={setConflictPolicy}
          onDownload={downloadSelected}
          onShare={() => openShareDialog(selectedFiles)}
          onDuplicate={() => duplicateSelected(selectedFiles)}
          onMove={() => openMoveDialog(selectedFiles)}
          onSetPassword={() => setPasswordForFiles(selectedFiles)}
          onAdminReset={() => resetPasswordForFiles(selectedFiles)}
          onRename={renameSelected}
          onDelete={() => deleteSelected()}
          onRestore={() => restoreSelected()}
          onPurge={() => purgeSelected()}
          viewMode={viewMode}
          onViewModeChange={changeViewMode}
          query={query}
          onQueryChange={setQuery}
          searchResultCount={visibleFiles.length}
          sortField={sortField}
          onSortFieldChange={changeSortField}
          sortDirection={sortDirection}
          onSortDirectionChange={toggleSortDirection}
          onRefresh={loadFiles}
          busy={busy || folderLoading}
          dropTargetId={dropTargetId}
          onDragOverFolder={handleItemDragOverFolder}
          onDragLeaveFolder={handleItemDragLeaveFolder}
          onDropOnFolder={handleItemDropOnFolder}
        />

        {folderError || error ? <div className="error-banner page-error">{folderError || error}</div> : null}

        <div
          className={dragActive ? "drive-content drag-active" : "drive-content"}
          onContextMenu={openBlankContextMenu}
          onClick={closeContextMenu}
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onKeyDown={handleDriveKeyDown}
          tabIndex={0}
        >
          {dragActive ? (
            <div className="drop-overlay" aria-hidden="true">
              <Upload size={30} />
              <strong>파일 또는 폴더 놓기</strong>
              <span>현재 위치에 업로드됩니다</span>
            </div>
          ) : null}
          {folderError ? null : folderLoading || (busy && !visibleFiles.length) ? (
            <div className="empty-state" role="status">불러오는 중...</div>
          ) : visibleFiles.length ? (
            <FileList
              files={visibleFiles}
              selectedIds={selectedIds}
              selectedId={activeFileId}
              activeFile={selectedFile}
              onSelect={selectFile}
              onToggleSelect={toggleFileSelection}
              onOpenFolder={trashMode ? () => {} : openFolder}
              onContextMenu={openItemContextMenu}
              viewMode={viewMode}
              ownerId={ownerId}
              canBrowseColumns={!trashMode && !isSearching}
              showLocation={isSearching}
              sortField={sortField}
              sortDirection={sortDirection}
              onFilesSeen={rememberFiles}
              canMove={!trashMode && !busy}
              dropTargetId={dropTargetId}
              onDragStart={handleItemDragStart}
              onDragEnd={handleItemDragEnd}
              onDragOverFolder={handleItemDragOverFolder}
              onDragLeaveFolder={handleItemDragLeaveFolder}
              onDropOnFolder={handleItemDropOnFolder}
              onUnlock={unlockFileForAction}
            />
          ) : (
            <EmptyState
              title={trashMode ? "휴지통이 비어 있습니다" : "파일이 없습니다"}
              body={trashMode ? "삭제한 항목이 이곳에 표시됩니다." : "업로드하거나 새 폴더를 만들어 시작하세요."}
              action={trashMode ? null : <Button icon={Upload} onClick={() => inputRef.current?.click()}>파일 선택</Button>}
            />
          )}
        </div>
      </section>

      {isSidePanelOpen ? (
        <aside className="side-panel">
          <button className="side-panel-resize-handle" type="button" aria-label="패널 너비 조절" onPointerDown={startSidePanelResize} />
          {sidePanelMode === "info" || selectedFile?.type === "folder" || viewMode === "gallery" || viewMode === "column" || trashMode ? (
	            <MetadataPane
	              file={selectedFile}
	              onClose={() => setActiveFileId("")}
	              onCollapse={() => setSidePanelCollapsed(true)}
	              onDownload={downloadActiveFile}
	              onOpenFolder={openFolder}
	              downloadDisabled={trashMode}
	              openFolderDisabled={trashMode}
            />
          ) : (
	            <PreviewPane
	              file={selectedFile}
	              onClose={() => setActiveFileId("")}
	              onCollapse={() => setSidePanelCollapsed(true)}
	              onDownload={downloadActiveFile}
	              onOpenFolder={openFolder}
	              onUnlock={unlockFileForAction}
	            />
          )}
          <div className="panel-body quota-panel">
            <ProgressBar value={percent} label={quotaLabel} />
          </div>
        </aside>
      ) : null}

      {selectedFile && sidePanelCollapsed ? (
        <button className="side-panel-toggle-open" type="button" onClick={() => setSidePanelCollapsed(false)} title="사이드바 열기" aria-label="사이드바 열기">
          <ChevronLeft size={19} />
        </button>
      ) : null}

      <UploadQueue
        uploads={uploadQueue.uploads}
        onCancel={uploadQueue.cancelUpload}
        onPause={uploadQueue.pauseUpload}
        onResume={uploadQueue.resumeUpload}
        onRetry={uploadQueue.resumeUpload}
        onCancelAll={uploadQueue.cancelAllUploads}
        onPauseAll={uploadQueue.pauseAllUploads}
        onResumeAll={uploadQueue.resumeAllUploads}
        onClearCompleted={uploadQueue.clearCompletedUploads}
      />
      <ShareDialog files={shareFiles} onClose={() => setShareFiles([])} />
      <MoveDialog files={moveFiles} ownerId={ownerId} onMove={(destinationParentId) => moveItems(moveFiles, destinationParentId)} onClose={() => setMoveFiles([])} />
      {passwordDialog ? (
        <PasswordDialog
          title={passwordDialog.title}
          body={passwordDialog.body}
          confirmLabel={passwordDialog.confirmLabel}
          recoverLabel={passwordDialog.recoverLabel}
          onSubmit={submitPasswordDialog}
          onRecover={recoverPasswordDialog}
          onClose={closePasswordDialog}
        />
      ) : null}
      <DriveContextMenu menu={contextMenu} onClose={closeContextMenu} />
    </div>
  );
}

function triggerUrlDownload(url) {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.rel = "noopener noreferrer";
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

function triggerBlobDownload(blob, fileName) {
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.rel = "noopener noreferrer";
    anchor.style.display = "none";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function clampPanelWidth(value) {
  const viewportMax = typeof window === "undefined" ? SIDE_PANEL_MAX_WIDTH : Math.floor(window.innerWidth * 0.72);
  const max = Math.max(SIDE_PANEL_MIN_WIDTH, Math.min(SIDE_PANEL_MAX_WIDTH, viewportMax));
  return Math.max(SIDE_PANEL_MIN_WIDTH, Math.min(max, Math.round(Number(value) || SIDE_PANEL_DEFAULT_WIDTH)));
}
