import { apiRequest, formatApiErrorMessage } from "../../shared/api/apiClient.js";
import { ApiError } from "../../shared/api/apiError.js";

export const filesApi = {
  list: ({ parentId = null, ownerId = "", search = "" } = {}) => {
    const params = new URLSearchParams();
    if (parentId) params.set("parentId", parentId);
    if (ownerId) params.set("ownerId", ownerId);
    if (search) params.set("search", search);
    const query = params.toString();
    return apiRequest(`/api/files${query ? `?${query}` : ""}`);
  },
  media: ({ ownerId = "", search = "", kind = "" } = {}) => {
    const params = new URLSearchParams();
    if (ownerId) params.set("ownerId", ownerId);
    if (search) params.set("search", search);
    if (kind) params.set("kind", kind);
    const query = params.toString();
    return apiRequest(`/api/files/media${query ? `?${query}` : ""}`);
  },
  trash: ({ ownerId = "" } = {}) => {
    const params = new URLSearchParams();
    if (ownerId) params.set("ownerId", ownerId);
    const query = params.toString();
    return apiRequest(`/api/trash${query ? `?${query}` : ""}`);
  },
  createFolder: (payload) => apiRequest("/api/folders", { method: "POST", body: payload }),
  rename: (id, name) => apiRequest(`/api/files/${encodeURIComponent(id)}/rename`, { method: "PATCH", body: { name } }),
  move: (id, parentId = null) => apiRequest(`/api/files/${encodeURIComponent(id)}/move`, { method: "PATCH", body: { parentId } }),
  setPassword: (id, password) => apiRequest(`/api/files/${encodeURIComponent(id)}/password`, { method: "PUT", body: { password } }),
  clearPassword: (id, password) => apiRequest(`/api/files/${encodeURIComponent(id)}/password`, { method: "DELETE", body: { password } }),
  unlock: (id, password) => apiRequest(`/api/files/${encodeURIComponent(id)}/unlock`, { method: "POST", body: { password } }),
  duplicate: (id) => apiRequest(`/api/files/${encodeURIComponent(id)}/duplicate`, { method: "POST" }),
  setFolderColor: (id, color) => apiRequest(`/api/folders/${encodeURIComponent(id)}/color`, { method: "PATCH", body: { color } }),
  remove: (id) => apiRequest(`/api/files/${encodeURIComponent(id)}`, { method: "DELETE" }),
  restore: (id) => apiRequest(`/api/trash/${encodeURIComponent(id)}/restore`, { method: "POST" }),
  purge: (id) => apiRequest(`/api/trash/${encodeURIComponent(id)}`, { method: "DELETE" }),
  upload: ({ file, parentId = null, ownerId = "", name = "", onProgress = null, signal = null }) => {
    const form = new FormData();
    form.set("file", file);
    if (parentId) form.set("parentId", parentId);
    if (ownerId) form.set("ownerId", ownerId);
    if (name) form.set("name", name);
    return uploadForm("/api/files/upload", form, { onProgress, signal });
  },
  createUploadSession: (payload, { signal = null } = {}) => apiRequest("/api/files/upload-sessions", {
    method: "POST",
    body: payload,
    signal
  }),
  getUploadSession: (sessionId, { signal = null } = {}) => apiRequest(`/api/files/upload-sessions/${encodeURIComponent(sessionId)}`, { signal }),
  uploadSessionChunk: (sessionId, { chunk, offset, onProgress = null, signal = null }) => {
    return uploadBlob(`/api/files/upload-sessions/${encodeURIComponent(sessionId)}/chunk`, chunk, {
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Upload-Offset": String(offset)
      },
      onProgress,
      signal
    });
  },
  completeUploadSession: (sessionId, { signal = null } = {}) => apiRequest(`/api/files/upload-sessions/${encodeURIComponent(sessionId)}/complete`, {
    method: "POST",
    signal
  }),
  cancelUploadSession: (sessionId) => apiRequest(`/api/files/upload-sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" }),
  previewStatus: (id) => apiRequest(`/api/files/${encodeURIComponent(id)}/preview-status`),
  previewBlob: (id) => apiRequest(`/api/files/${encodeURIComponent(id)}/preview`, { responseType: "blob" }),
  previewUrl: (id) => `/api/files/${encodeURIComponent(id)}/preview`,
  downloadSelection: (ids) => apiRequest("/api/files/download", { method: "POST", body: { ids }, responseType: "blob" }),
  downloadUrl: (id) => `/api/files/${encodeURIComponent(id)}/download`
};

function uploadForm(path, form, { onProgress, signal } = {}) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", path);
    request.withCredentials = true;

    const abort = () => {
      request.abort();
      reject(new ApiError("업로드가 취소되었습니다.", 0));
    };

    if (signal) {
      if (signal.aborted) {
        abort();
        return;
      }
      signal.addEventListener("abort", abort, { once: true });
    }

    request.upload.onprogress = (event) => {
      if (!event.lengthComputable || !onProgress) return;
      onProgress(Math.round((event.loaded / event.total) * 100));
    };

    request.onload = () => {
      signal?.removeEventListener("abort", abort);
      let json = null;
      try {
        json = request.responseText ? JSON.parse(request.responseText) : null;
      } catch {
        reject(new ApiError("서버 응답을 읽지 못했습니다.", request.status));
        return;
      }

      if (request.status < 200 || request.status >= 300 || json?.ok === false) {
        reject(new ApiError(formatApiErrorMessage(json?.error || request.statusText || "업로드하지 못했습니다.", json?.details || null), request.status, json?.details || null));
        return;
      }
      resolve(json);
    };

    request.onerror = () => {
      signal?.removeEventListener("abort", abort);
      reject(new ApiError("네트워크 문제로 업로드하지 못했습니다.", request.status || 0));
    };

    request.onabort = () => {
      signal?.removeEventListener("abort", abort);
      reject(new ApiError("업로드가 취소되었습니다.", 0));
    };

    request.send(form);
  });
}

function uploadBlob(path, blob, { headers = {}, onProgress, signal } = {}) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", path);
    request.withCredentials = true;
    for (const [key, value] of Object.entries(headers)) {
      request.setRequestHeader(key, value);
    }

    const abort = () => {
      request.abort();
      reject(new ApiError("업로드가 중단되었습니다.", 0));
    };

    if (signal) {
      if (signal.aborted) {
        abort();
        return;
      }
      signal.addEventListener("abort", abort, { once: true });
    }

    request.upload.onprogress = (event) => {
      if (!event.lengthComputable || !onProgress) return;
      onProgress(event.loaded, event.total);
    };

    request.onload = () => {
      signal?.removeEventListener("abort", abort);
      let json = null;
      try {
        json = request.responseText ? JSON.parse(request.responseText) : null;
      } catch {
        reject(new ApiError("서버 응답을 읽지 못했습니다.", request.status));
        return;
      }

      if (request.status < 200 || request.status >= 300 || json?.ok === false) {
        reject(new ApiError(formatApiErrorMessage(json?.error || request.statusText || "업로드하지 못했습니다.", json?.details || null), request.status, json?.details || null));
        return;
      }
      resolve(json);
    };

    request.onerror = () => {
      signal?.removeEventListener("abort", abort);
      reject(new ApiError("네트워크 문제로 업로드하지 못했습니다.", request.status || 0));
    };

    request.onabort = () => {
      signal?.removeEventListener("abort", abort);
      reject(new ApiError("업로드가 중단되었습니다.", 0));
    };

    request.send(blob);
  });
}
