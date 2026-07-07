import { apiRequest } from "../../shared/api/apiClient.js";

export const authApi = {
  me: () => apiRequest("/api/auth/me"),
  login: (payload) => apiRequest("/api/auth/login", { method: "POST", body: payload }),
  googleStatus: () => apiRequest("/api/auth/google/status"),
  updateProfile: (payload) => apiRequest("/api/auth/profile", { method: "PATCH", body: payload }),
  logout: () => apiRequest("/api/auth/logout", { method: "POST" })
};
