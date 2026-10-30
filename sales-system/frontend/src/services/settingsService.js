import { request } from "./api.js";

const API_URL = "/api/settings";
export const getSettings = () => request(API_URL);
export const updateSettings = (section, data) => request(`${API_URL}/${section}`, { method: "PUT", body: JSON.stringify(data) });
export const updateProfile = (data) => request("/api/auth/profile", { method: "PUT", body: JSON.stringify(data) });
export const changePassword = (data) => request("/api/auth/change-password", { method: "PUT", body: JSON.stringify(data) });
