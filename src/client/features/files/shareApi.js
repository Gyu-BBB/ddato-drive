import { apiRequest } from "../../shared/api/apiClient.js";

export const shareApi = {
  getActive: (fileId) => apiRequest(`/api/files/${encodeURIComponent(fileId)}/share`),
  create: (fileId, mode, password = "") => apiRequest(`/api/files/${encodeURIComponent(fileId)}/share`, {
    method: "POST",
    body: { mode, password }
  }),
  revoke: (fileId) => apiRequest(`/api/files/${encodeURIComponent(fileId)}/share`, { method: "DELETE" }),
  publicUnlock: (token, password) => apiRequest(`/api/shares/${encodeURIComponent(token)}/unlock`, {
    method: "POST",
    body: { password }
  }),
  publicPreviewStatus: (token) => apiRequest(`/api/shares/${encodeURIComponent(token)}/preview-status`),
  publicInfo: (token, parentId = "") => {
    const params = new URLSearchParams();
    if (parentId) params.set("parentId", parentId);
    const query = params.toString();
    return apiRequest(`/api/shares/${encodeURIComponent(token)}${query ? `?${query}` : ""}`);
  },
  publicPreviewBlob: (token) => apiRequest(`/api/shares/${encodeURIComponent(token)}/preview`, { responseType: "blob" }),
  publicPreviewUrl: (token) => `/api/shares/${encodeURIComponent(token)}/preview`,
  publicDownloadUrl: (token) => `/api/shares/${encodeURIComponent(token)}/download`,
  publicItemDownloadUrl: (token, itemId) => `/api/shares/${encodeURIComponent(token)}/items/${encodeURIComponent(itemId)}/download`
};
