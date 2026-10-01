import { createContext, useContext, useEffect, useState } from "react";
import { getCurrentUser, login as loginRequest, logout as logoutRequest } from "../services/authService.js";

const AuthContext = createContext(null);
export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem("rje_auth_user") || "null"); } catch { return null; }
  });
  const [isLoading, setIsLoading] = useState(Boolean(localStorage.getItem("rje_auth_token")));
  useEffect(() => {
    const expired = () => { setUser(null); setIsLoading(false); };
    window.addEventListener("auth-expired", expired);
    if (localStorage.getItem("rje_auth_token")) getCurrentUser().then((current) => { setUser(current); localStorage.setItem("rje_auth_user", JSON.stringify(current)); }).catch(() => expired()).finally(() => setIsLoading(false));
    return () => window.removeEventListener("auth-expired", expired);
  }, []);
  const login = async (credentials) => {
    const result = await loginRequest(credentials);
    localStorage.setItem("rje_auth_token", result.token);
    localStorage.setItem("rje_auth_user", JSON.stringify(result.user));
    setUser(result.user);
  };
  const logout = async () => {
    try { if (localStorage.getItem("rje_auth_token")) await logoutRequest(); } finally { localStorage.removeItem("rje_auth_token"); localStorage.removeItem("rje_auth_user"); setUser(null); }
  };
  const updateUser = (nextUser) => { setUser(nextUser); localStorage.setItem("rje_auth_user", JSON.stringify(nextUser)); };
  return <AuthContext.Provider value={{ user, isLoading, login, logout, updateUser }}>{children}</AuthContext.Provider>;
}
export const useAuth = () => useContext(AuthContext);
