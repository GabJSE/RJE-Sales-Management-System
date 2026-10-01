import { request } from "./api.js";

const API_URL = "http://localhost:5000/api/settings";
export const getSettings = () => request(API_URL);
export const updateSettings = (section, data) => request(`${API_URL}/${section}`, { method: "PUT", body: JSON.stringify(data) });
export const updateProfile = (data) => request("http://localhost:5000/api/auth/profile", { method: "PUT", body: JSON.stringify(data) });
export const changePassword = (data) => request("http://localhost:5000/api/auth/change-password", { method: "PUT", body: JSON.stringify(data) });
