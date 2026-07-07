import { apiRequest } from "../../shared/api/apiClient.js";

export const notesApi = {
  list: () => apiRequest("/api/notes"),
  create: (payload = {}) => apiRequest("/api/notes", { method: "POST", body: payload }),
  update: (id, payload = {}) => apiRequest(`/api/notes/${encodeURIComponent(id)}`, { method: "PATCH", body: payload }),
  setPassword: (id, password) => apiRequest(`/api/notes/${encodeURIComponent(id)}/password`, { method: "PUT", body: { password } }),
  clearPassword: (id, password) => apiRequest(`/api/notes/${encodeURIComponent(id)}/password`, { method: "DELETE", body: { password } }),
  unlock: (id, password) => apiRequest(`/api/notes/${encodeURIComponent(id)}/unlock`, { method: "POST", body: { password } }),
  remove: (id) => apiRequest(`/api/notes/${encodeURIComponent(id)}`, { method: "DELETE" })
};
