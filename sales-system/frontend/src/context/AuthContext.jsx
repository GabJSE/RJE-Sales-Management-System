import { createContext, useContext, useEffect, useState } from "react";
import { getCurrentUser, login as loginRequest, logout as logoutRequest } from "../services/authService.js";
const AuthContext = createContext(null);
export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => { if (!localStorage.getItem("rje_auth_token")) return null; try { return JSON.parse(localStorage.getItem("rje_auth_user") || "null"); } catch { return null; } });
  const [isLoading, setIsLoading] = useState(Boolean(localStorage.getItem("rje_auth_token")));
  const updateUser = next => { setUser(next); localStorage.setItem("rje_auth_user", JSON.stringify(next)); };
  useEffect(() => { const expired = () => { setUser(null); setIsLoading(false); }; window.addEventListener("auth-expired", expired); if (localStorage.getItem("rje_auth_token")) getCurrentUser().then(updateUser).catch(expired).finally(() => setIsLoading(false)); return () => window.removeEventListener("auth-expired", expired); }, []);
  const acceptSession = async result => { localStorage.setItem("rje_auth_token", result.token); updateUser(result.user); try { updateUser(await getCurrentUser()); } catch {} };
  const login = async credentials => acceptSession(await loginRequest(credentials));
  const logout = async () => { try { if (localStorage.getItem("rje_auth_token")) await logoutRequest(); } finally { localStorage.removeItem("rje_auth_token"); localStorage.removeItem("rje_auth_user"); setUser(null); } };
  return <AuthContext.Provider value={{ user, isLoading, login, logout, updateUser, acceptSession }}>{children}</AuthContext.Provider>;
}
export const useAuth = () => useContext(AuthContext);
