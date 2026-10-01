import { request } from "./api.js";
const API_URL = "http://localhost:5000/api/auth";
export const login = (credentials) => request(`${API_URL}/login`, { method: "POST", body: JSON.stringify(credentials) });
export const getCurrentUser = () => request(`${API_URL}/me`);
export const changePassword = (data) => request(`${API_URL}/change-password`, { method: "PUT", body: JSON.stringify(data) });
export const logout = () => request(`${API_URL}/logout`, { method: "POST" });
