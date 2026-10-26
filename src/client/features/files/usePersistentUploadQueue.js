import { useEffect, useRef, useState } from "react";
import { ApiError } from "../../shared/api/apiError.js";
import { filesApi } from "./filesApi.js";
import { createSpeedMeter } from "../../shared/lib/transferProgress.js";
import { formatPercent } from "../../shared/lib/formatPercent.js";
import { getStoredUploads, removeStoredUpload, saveStoredUpload } from "./uploadQueueStore.js";
import { retryTransfer } from '../../shared/lib/retryTransfer.js';
import { createTransferSlots } from '../../shared/lib/transferSlots.js';
import { chooseUploadPersistence, selectUploadSource, sourceFingerprint, verifyUploadSource } from './uploadSource.js';

const CHUNK_SIZE = 8 * 1024 * 1024;
const MAX_CONCURRENT_UPLOADS = 10;
const RESUMABLE_STATUSES = new Set(["queued", "uploading"]);
const RESTARTABLE_STATUSES = new Set(["queued", "paused", "failed"]);

export function usePersistentUploadQueue({ accountId = "", enabled = true, onComplete = null } = {}) {
  const [uploads, setUploads] = useState([]);
  const uploadsRef = useRef([]);
  const controllersRef = useRef(new Map());
  const pausedIdsRef = useRef(new Set());
  const canceledIdsRef = useRef(new Set());
  const onCompleteRef = useRef(onComplete);
  const lifecycleRef = useRef(0);
  const uploadSlotsRef = useRef(null);
  if (!uploadSlotsRef.current) uploadSlotsRef.current = createTransferSlots(MAX_CONCURRENT_UPLOADS);

  useEffect(() => {
    if (!enabled) return;
    for (const item of uploads) {
      if (item.status === "queued") startUpload(item);
    }
  }, [uploads, enabled]);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    if (!enabled || !accountId) return;
    let disposed = false;
    setUploadItems(items => items.filter(item => item.accountId === accountId));

    getStoredUploads(accountId).then(async (storedItems) => {
      if (disposed) return;
      const activeItems = storedItems
        .filter((item) => (item.file || item.persistenceMode === 'reselect') && item.status !== "done" && item.status !== "canceled")
        .map((item) => {
          if (!item.file) return { ...item, status: 'paused', detail: '원본 파일 다시 선택', error: '' };
          if (RESUMABLE_STATUSES.has(item.status)) {
            return { ...item, status: "queued", detail: "재개 대기", error: "" };
          }
          return item;
        });

      for (const item of storedItems.filter(entry => entry.status === 'done' || entry.status === 'canceled')) {
        void removeStoredUpload(item.id).catch(() => {});
      }
      setUploadItems(items => [...activeItems, ...items.filter(item => item.accountId === accountId && !activeItems.some(stored => stored.id === item.id))]);
      await Promise.all(activeItems.map((item) => saveStoredUpload(item)));
      for (const item of activeItems.filter((entry) => RESUMABLE_STATUSES.has(entry.status))) {
        startUpload(item);
      }
    }).catch((error) => {
      addVisibleItem({
        id: `restore-error-${Date.now()}`,
        name: "업로드 복원",
        status: "failed",
        progress: 0,
        detail: "복원 실패",
        error: error.message || "업로드 큐를 복원하지 못했습니다."
      });
    });

    return () => {
      disposed = true;
      lifecycleRef.current += 1;
      for (const controller of controllersRef.current.values()) {
        controller.abort();
      }
      controllersRef.current.clear();
    };
  }, [accountId, enabled]);

  async function enqueueUpload({ file, parentId = null, ownerId = "", name = "", displayName = "", conflictPolicy = 'keep' }) {
    if (!file || !accountId) return null;
    const item = {
      id: createUploadId(),
      conflictPolicy,
      accountId,
      file,
      fileName: file.name,
      name: name || file.name,
      displayName: displayName || name || file.name,
      sizeBytes: file.size,
      mimeType: file.type || "application/octet-stream",
      lastModified: file.lastModified || 0,
      parentId: parentId || null,
      ownerId: ownerId || "",
      serverSessionId: "",
      uploadedBytes: 0,
      progress: 0,
      status: "queued",
      detail: "대기 중",
      error: "",
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    addVisibleItem(item);
    startUpload(item);
    return item;
  }

  function addTransientUpload(item) {
    addVisibleItem({
      ...item,
      transient: true,
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
  }

  function updateTransientUpload(id, patch) {
    setUploadItems((items) => items.map((item) => item.id === id ? { ...item, ...patch, updatedAt: Date.now() } : item));
  }

  function pauseUpload(id) {
    pausedIdsRef.current.add(id);
    const controller = controllersRef.current.get(id);
    if (controller) {
      controller.abort();
      return;
    }
    if (getVisibleItem(id)?.serverSessionId) {
      void updateStoredAndVisible(id, { status: "paused", detail: "일시정지됨", error: "" });
    } else {
      updateVisibleOnly(id, { status: "paused", detail: "일시정지됨", error: "" });
    }
  }

  async function resumeUpload(id) {
    let item = getVisibleItem(id);
    if (!item || item.transient || controllersRef.current.has(id)) return;
    if (!item.file) {
      const lifecycle = lifecycleRef.current;
      try {
        const file = await selectUploadSource();
        if (!file || lifecycle !== lifecycleRef.current || !getVisibleItem(id)) return;
        await verifyUploadSource(item, file);
        if (lifecycle !== lifecycleRef.current || !getVisibleItem(id)) return;
        item = { ...item, file };
      } catch (error) { updateVisibleOnly(id, { error: error.message }); return; }
    }
    pausedIdsRef.current.delete(id);
    canceledIdsRef.current.delete(id);
    const next = { ...item, status: "queued", detail: "재개 대기", error: "", updatedAt: Date.now() };
    addVisibleItem(next);
    startUpload(next);
  }

  function cancelUpload(id) {
    const item = getVisibleItem(id);
    if (!item) return;
    canceledIdsRef.current.add(id);
    setUploadItems((items) => items.filter((entry) => entry.id !== id));
    const controller = controllersRef.current.get(id);
    controller?.abort();
    void cancelStoredItem(item);
  }

  function pauseAllUploads() {
    for (const item of uploadsRef.current) {
      if (item.transient) continue;
      if (item.status === "uploading" || item.status === "queued") pauseUpload(item.id);
    }
  }

  function resumeAllUploads() {
    for (const item of uploadsRef.current) {
      if (item.transient || !item.file) continue;
      if (RESTARTABLE_STATUSES.has(item.status)) resumeUpload(item.id);
    }
  }

  function cancelAllUploads() {
    for (const item of [...uploadsRef.current]) {
      if (item.transient) continue;
      if (item.status !== "done") cancelUpload(item.id);
    }
  }

  function clearCompletedUploads() {
    setUploadItems((items) => items.filter((item) => item.status !== "done"));
  }

  async function startUpload(initialItem) {
    if (!enabled || !initialItem || initialItem.transient || controllersRef.current.has(initialItem.id)) return;
    if (initialItem.accountId !== accountId || getVisibleItem(initialItem.id)?.status !== 'queued'
      || pausedIdsRef.current.has(initialItem.id) || canceledIdsRef.current.has(initialItem.id)) return;
    const controller = new AbortController();
    const lifecycle = lifecycleRef.current;
    controllersRef.current.set(initialItem.id, controller);
    pausedIdsRef.current.delete(initialItem.id);
    canceledIdsRef.current.delete(initialItem.id);

    let item = { ...initialItem };
    let persisted = Boolean(initialItem.serverSessionId);
    let releaseSlot;
    const retryOptions = { signal: controller.signal, onRetry: attempt => {
      if (lifecycle === lifecycleRef.current) updateVisibleOnly(item.id, { detail: `연결 재시도 ${attempt}/3`, speedBytes: 0 });
    } };
    try {
      if (!item.file) {
        throw new ApiError("저장된 파일을 읽지 못했습니다. 파일을 다시 선택해주세요.", 0);
      }

      updateVisibleOnly(item.id, { status: "uploading", detail: "저장 공간 확인 중", error: "" });
      throwIfAborted(controller.signal);
      // Reserve server capacity before cloning the original file into IndexedDB.
      const session = await retryTransfer(() => prepareSession(item, controller.signal), retryOptions);
      if (session.skipped) {
        updateVisibleOnly(item.id, { status: 'done', uploadedBytes: 0, progress: 100, detail: '같은 이름 · 건너뜀', file: null });
        await removeStoredUpload(item.id).catch(() => {});
        return;
      }
      item = { ...item, serverSessionId: session.id };
      if (controller.signal.aborted) throw new DOMException('Upload interrupted', 'AbortError');
      if (!item.persistenceMode) {
        item.persistenceMode = await chooseUploadPersistence(item.file);
        if (item.persistenceMode === 'reselect') item.sourceFingerprint = await sourceFingerprint(item.file);
      }
      item = await updateStoredAndVisible(item.id, {
        persistenceMode: item.persistenceMode,
        sourceFingerprint: item.sourceFingerprint || '',
        status: "queued",
        serverSessionId: session.id,
        uploadedBytes: session.uploadedBytes,
        progress: session.progress,
        detail: session.uploadedBytes ? `${formatPercent(session.progress)}부터 재개` : "업로드 중"
      }) || item;
      persisted = true;
      throwIfAborted(controller.signal);
      releaseSlot = await uploadSlotsRef.current(controller.signal);
      item = await updateStoredAndVisible(item.id, { status: 'uploading', detail: '업로드 중' }) || item;
      throwIfAborted(controller.signal);

      let uploadedBytes = session.uploadedBytes;
      const initialBytes = uploadedBytes;
      const speedMeter = createSpeedMeter();
      let chunkSize = Math.max(1, Math.min(Number(session.chunkSizeBytes) || CHUNK_SIZE, 32 * 1024 * 1024));
      let lastProgressAt = 0;
      while (uploadedBytes < item.sizeBytes) {
        throwIfAborted(controller.signal);
        const result = await retryTransfer(async attempt => {
          if (attempt) {
            const status = await filesApi.getUploadSession(session.id, { signal: controller.signal });
            uploadedBytes = status.session.uploadedBytes;
            if (uploadedBytes === item.sizeBytes) return status;
          }
          const baseOffset = uploadedBytes;
          const end = Math.min(baseOffset + chunkSize, item.sizeBytes);
          const chunk = item.file.slice(baseOffset, end);
          return filesApi.uploadSessionChunk(session.id, {
            chunk,
            offset: uploadedBytes,
            signal: controller.signal,
            onProgress: (loaded) => {
              if (lifecycle !== lifecycleRef.current || controller.signal.aborted) return;
              const now = performance.now();
              if (now - lastProgressAt < 200 && loaded < chunk.size) return;
              lastProgressAt = now;
              const optimisticBytes = Math.min(item.sizeBytes, baseOffset + loaded);
              const progress = item.sizeBytes ? (optimisticBytes / item.sizeBytes) * 100 : 100;
              updateVisibleOnly(item.id, {
                uploadedBytes: optimisticBytes,
                speedBytes: speedMeter(optimisticBytes - initialBytes),
                speedUpdatedAt: Date.now(),
                progress,
                detail: formatPercent(progress)
              });
            }
          });
        }, { ...retryOptions, onRetry: attempt => {
          chunkSize = Math.max(Math.min(64 * 1024, chunkSize), Math.floor(chunkSize / 2));
          retryOptions.onRetry(attempt);
        } });

        uploadedBytes = result.session.uploadedBytes;
        updateVisibleOnly(item.id, {
          uploadedBytes,
          progress: result.session.progress,
          detail: formatPercent(result.session.progress)
        });
      }

      const completed = await retryTransfer(() => filesApi.completeUploadSession(session.id, { signal: controller.signal }), retryOptions);
      if (lifecycle !== lifecycleRef.current) return;
      if (controllersRef.current.get(item.id) === controller) controllersRef.current.delete(item.id);
      updateVisibleOnly(item.id, { status: "done", uploadedBytes: item.sizeBytes, speedBytes: 0, progress: 100, detail: "업로드됨", error: "", fileId: completed.file?.id || "" });
      await removeStoredUpload(item.id).catch(() => saveStoredUpload({ ...stripRuntimeOnly(item), status: 'done' }).catch(() => {}));
      // A failed list refresh must not turn a committed upload into a failed transfer.
      try { await onCompleteRef.current?.(); } catch (refreshError) { console.warn('업로드는 완료되었지만 목록을 새로고침하지 못했습니다.', refreshError); }
    } catch (error) {
      if (!persisted) {
        // Also cancel by client ID when a session response was lost.
        await filesApi.cancelUploadByClientId(item.id).catch(() => {});
        await removeStoredUpload(item.id).catch(() => {});
        item = { ...item, serverSessionId: "" };
        // Cancellation IDs cannot be reused when the user retries admission.
        if (!canceledIdsRef.current.has(item.id)) {
          const replacement = { ...item, id: createUploadId(), status: pausedIdsRef.current.has(item.id) ? 'paused' : 'failed',
            detail: pausedIdsRef.current.has(item.id) ? '일시정지됨' : '실패', error: pausedIdsRef.current.has(item.id) ? '' : error.message || '업로드를 준비하지 못했습니다.' };
          if (lifecycle === lifecycleRef.current) {
            setUploadItems(items => items.map(entry => entry.id === item.id ? replacement : entry));
          }
          pausedIdsRef.current.delete(item.id);
        }
      }
      if (controllersRef.current.get(initialItem.id) === controller) controllersRef.current.delete(initialItem.id);
      if (lifecycle !== lifecycleRef.current) return;
      if (!persisted && !canceledIdsRef.current.has(item.id)) return;
      await handleUploadError(initialItem.id, error, item);
    } finally {
      if (controllersRef.current.get(initialItem.id) === controller) controllersRef.current.delete(initialItem.id);
      releaseSlot?.();
    }
  }

  async function prepareSession(item, signal) {
    if (item.serverSessionId) {
      try {
        const result = await filesApi.getUploadSession(item.serverSessionId, { signal });
        return result.session;
      } catch (error) {
        if (error.status !== 404) throw error;
      }
    }

    const result = await filesApi.createUploadSession({
      ownerId: item.ownerId,
      parentId: item.parentId,
      name: item.name,
      sizeBytes: item.sizeBytes,
      mimeType: item.mimeType,
      clientUploadId: item.id,
      conflictPolicy: item.conflictPolicy || 'keep',
      sourceModifiedAt: item.lastModified
    }, { signal });
    return result.session;
  }

  async function handleUploadError(id, error, fallbackItem) {
    const item = getVisibleItem(id) || fallbackItem;
    if (canceledIdsRef.current.has(id)) {
      canceledIdsRef.current.delete(id);
      pausedIdsRef.current.delete(id);
      await cancelStoredItem(item);
      return;
    }

    if (pausedIdsRef.current.has(id)) {
      pausedIdsRef.current.delete(id);
      await updateStoredAndVisible(id, { status: "paused", detail: "일시정지됨", error: "" });
      return;
    }

    const message = error.message || "업로드하지 못했습니다.";
    await updateStoredAndVisible(id, { status: "failed", detail: "실패", error: message });
  }

  async function cancelStoredItem(item) {
    if (!item) return;
    setUploadItems((items) => items.filter((entry) => entry.id !== item.id));
    try {
      const result = item.serverSessionId ? await filesApi.cancelUploadSession(item.serverSessionId) : await filesApi.cancelUploadByClientId(item.id);
      if (result.completed) { try { await onCompleteRef.current?.(); } catch {} }
    } catch {
      // Local cancellation should still remove the persisted upload.
    }
    await removeStoredUpload(item.id).catch(() => {});
    setUploadItems((items) => items.filter((entry) => entry.id !== item.id));
    if (!controllersRef.current.has(item.id)) {
      canceledIdsRef.current.delete(item.id);
      pausedIdsRef.current.delete(item.id);
    }
  }

  function addVisibleItem(item) {
    setUploadItems((items) => {
      const index = items.findIndex((entry) => entry.id === item.id);
      if (index === -1) return [...items, item];
      return items.map((entry) => entry.id === item.id ? { ...entry, ...item } : entry);
    });
  }

  function updateVisibleOnly(id, patch) {
    setUploadItems((items) => items.map((item) => item.id === id ? { ...item, ...patch, updatedAt: Date.now() } : item));
  }

  async function updateStoredAndVisible(id, patch) {
    let nextItem = null;
    setUploadItems((items) => items.map((item) => {
      if (item.id !== id) return item;
      nextItem = { ...item, ...patch, updatedAt: Date.now() };
      return nextItem;
    }));
    if (!nextItem || nextItem.transient) return nextItem;
    await saveStoredUpload(stripRuntimeOnly(nextItem));
    return nextItem;
  }

  function setUploadItems(updater) {
    const next = typeof updater === "function" ? updater(uploadsRef.current) : updater;
    uploadsRef.current = next;
    setUploads(next);
  }

  function getVisibleItem(id) {
    return uploadsRef.current.find((item) => item.id === id);
  }

  return {
    uploads,
    enqueueUpload,
    addTransientUpload,
    updateTransientUpload,
    pauseUpload,
    resumeUpload,
    cancelUpload,
    pauseAllUploads,
    resumeAllUploads,
    cancelAllUploads,
    clearCompletedUploads
  };
}

function stripRuntimeOnly(item) {
  const { transient, fileId, ...stored } = item;
  return stored;
}

function throwIfAborted(signal) {
  if (signal.aborted) throw new ApiError("업로드가 중단되었습니다.", 0);
}

function createUploadId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
