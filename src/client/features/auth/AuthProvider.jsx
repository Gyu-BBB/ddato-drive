import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { authApi } from "./authApi.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    refresh();
  }, []);

  async function refresh() {
    try {
      const result = await authApi.me();
      setUser(result.user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }

  async function login(id, password) {
    const result = await authApi.login({ id, password });
    setUser(result.user);
    return result.user;
  }

  async function logout() {
    await authApi.logout().catch(() => null);
    setUser(null);
  }

  async function updateProfile(payload) {
    const result = await authApi.updateProfile(payload);
    setUser(result.user);
    return result.user;
  }

  const value = useMemo(() => ({ user, loading, login, logout, refresh, updateProfile }), [user, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
