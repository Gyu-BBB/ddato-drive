import { useEffect, useRef, useState } from "react";
import { ApiError } from "../../shared/api/apiError.js";
import { filesApi } from "./filesApi.js";
import { createSpeedMeter } from "../../shared/lib/transferProgress.js";
import { getStoredUploads, removeStoredUpload, saveStoredUpload } from "./uploadQueueStore.js";

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

    getStoredUploads(accountId).then(async (storedItems) => {
      if (disposed) return;
      const activeItems = storedItems
        .filter((item) => item.file && item.status !== "done" && item.status !== "canceled")
        .map((item) => {
          if (RESUMABLE_STATUSES.has(item.status)) {
            return { ...item, status: "queued", detail: "재개 대기", error: "" };
          }
          return item;
        });

      setUploadItems(activeItems);
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
      for (const controller of controllersRef.current.values()) {
        controller.abort();
      }
      controllersRef.current.clear();
    };
  }, [accountId, enabled]);

  async function enqueueUpload({ file, parentId = null, ownerId = "", name = "", displayName = "" }) {
    if (!file || !accountId) return null;
    const item = {
      id: createUploadId(),
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

    try {
      await saveStoredUpload(item);
      addVisibleItem(item);
      startUpload(item);
      return item;
    } catch (error) {
      addVisibleItem({
        ...item,
        file: null,
        status: "failed",
        detail: "저장 실패",
        error: error.message || "새로고침 복구용 업로드 저장소에 파일을 저장하지 못했습니다."
      });
      return null;
    }
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
    updateStoredAndVisible(id, { status: "paused", detail: "일시정지됨", error: "" });
  }

  function resumeUpload(id) {
    const item = getVisibleItem(id);
    if (!item || item.transient || controllersRef.current.has(id)) return;
    pausedIdsRef.current.delete(id);
    canceledIdsRef.current.delete(id);
    const next = { ...item, status: "queued", detail: "재개 대기", error: "", updatedAt: Date.now() };
    addVisibleItem(next);
    saveStoredUpload(stripRuntimeOnly(next)).then(() => startUpload(next)).catch((error) => {
      updateVisibleOnly(id, { status: "failed", detail: "저장 실패", error: error.message || "업로드 상태를 저장하지 못했습니다." });
    });
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
      if (item.transient) continue;
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
    if (!getVisibleItem(initialItem.id) || controllersRef.current.size >= MAX_CONCURRENT_UPLOADS) return;
    const controller = new AbortController();
    controllersRef.current.set(initialItem.id, controller);
    pausedIdsRef.current.delete(initialItem.id);
    canceledIdsRef.current.delete(initialItem.id);

    let item = { ...initialItem };
    try {
      if (!item.file) {
        throw new ApiError("저장된 파일을 읽지 못했습니다. 파일을 다시 선택해주세요.", 0);
      }

      item = await updateStoredAndVisible(item.id, { status: "uploading", detail: "업로드 준비 중", error: "" }) || item;
      const session = await prepareSession(item, controller.signal);
      item = await updateStoredAndVisible(item.id, {
        serverSessionId: session.id,
        uploadedBytes: session.uploadedBytes,
        progress: session.progress,
        detail: session.uploadedBytes ? `${session.progress}%부터 재개` : "업로드 중"
      }) || item;

      let uploadedBytes = session.uploadedBytes;
      const initialBytes = uploadedBytes;
      const speedMeter = createSpeedMeter();
      const chunkSize = Math.max(1, Math.min(Number(session.chunkSizeBytes) || CHUNK_SIZE, 32 * 1024 * 1024));
      let lastProgressAt = 0;
      while (uploadedBytes < item.sizeBytes) {
        throwIfAborted(controller.signal);
        const end = Math.min(uploadedBytes + chunkSize, item.sizeBytes);
        const chunk = item.file.slice(uploadedBytes, end);
        const baseOffset = uploadedBytes;
        const result = await filesApi.uploadSessionChunk(session.id, {
          chunk,
          offset: uploadedBytes,
          signal: controller.signal,
          onProgress: (loaded) => {
            const now = performance.now();
            if (now - lastProgressAt < 200 && loaded < chunk.size) return;
            lastProgressAt = now;
            const optimisticBytes = Math.min(item.sizeBytes, baseOffset + loaded);
            const progress = item.sizeBytes ? Math.round((optimisticBytes / item.sizeBytes) * 100) : 100;
            updateVisibleOnly(item.id, {
              uploadedBytes: optimisticBytes,
              speedBytes: speedMeter(optimisticBytes - initialBytes),
              speedUpdatedAt: Date.now(),
              progress,
              detail: `${progress}%`
            });
          }
        });

        uploadedBytes = result.session.uploadedBytes;
        updateVisibleOnly(item.id, {
          uploadedBytes,
          progress: result.session.progress,
          detail: `${result.session.progress}%`
        });
      }

      const completed = await filesApi.completeUploadSession(session.id, { signal: controller.signal });
      controllersRef.current.delete(item.id);
      await removeStoredUpload(item.id);
      updateVisibleOnly(item.id, { status: "done", progress: 100, detail: "업로드됨", error: "", fileId: completed.file?.id || "" });
      await onCompleteRef.current?.();
    } catch (error) {
      controllersRef.current.delete(initialItem.id);
      await handleUploadError(initialItem.id, error);
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
      mimeType: item.mimeType
    }, { signal });
    return result.session;
  }

  async function handleUploadError(id, error) {
    const item = getVisibleItem(id);
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
      if (item.serverSessionId) await filesApi.cancelUploadSession(item.serverSessionId);
    } catch {
      // Local cancellation should still remove the persisted upload.
    }
    await removeStoredUpload(item.id).catch(() => {});
    setUploadItems((items) => items.filter((entry) => entry.id !== item.id));
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
