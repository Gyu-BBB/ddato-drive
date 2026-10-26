import { apiRequest } from "../../shared/api/apiClient.js";

export const adminApi = {
  integrity: () => apiRequest('/api/admin/integrity'),
  startIntegrity: () => apiRequest('/api/admin/integrity', { method: 'POST' }),
  users: () => apiRequest("/api/admin/users"),
  storage: () => apiRequest("/api/admin/storage"),
  system: () => apiRequest("/api/admin/system"),
  audit: ({ limit = 80, action = "" } = {}) => {
    const params = new URLSearchParams();
    if (limit) params.set("limit", String(limit));
    if (action) params.set("action", action);
    const query = params.toString();
    return apiRequest(`/api/admin/audit${query ? `?${query}` : ""}`);
  },
  createUser: (payload) => apiRequest("/api/admin/users", { method: "POST", body: payload }),
  updateDefaultQuota: (payload) => apiRequest("/api/admin/settings/default-quota", { method: "PATCH", body: payload }),
  updateQuota: (id, payload) => apiRequest(`/api/admin/users/${encodeURIComponent(id)}/quota`, { method: "PATCH", body: payload }),
  updateRole: (id, role) => apiRequest(`/api/admin/users/${encodeURIComponent(id)}/role`, { method: "PATCH", body: { role } }),
  unlockUserLogin: (id) => apiRequest(`/api/admin/users/${encodeURIComponent(id)}/unlock`, { method: "POST" }),
  resetFilePassword: (id) => apiRequest(`/api/admin/files/${encodeURIComponent(id)}/password`, { method: "DELETE" }),
  resetNotePassword: (id) => apiRequest(`/api/admin/notes/${encodeURIComponent(id)}/password`, { method: "DELETE" }),
  enableUser: (id) => apiRequest(`/api/admin/users/${encodeURIComponent(id)}/enable`, { method: "POST" }),
  deleteUser: (id) => apiRequest(`/api/admin/users/${encodeURIComponent(id)}/permanent`, { method: "DELETE" }),
  disableUser: (id) => apiRequest(`/api/admin/users/${encodeURIComponent(id)}`, { method: "DELETE" })
};
