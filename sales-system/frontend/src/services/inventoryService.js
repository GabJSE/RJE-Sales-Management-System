import { request } from "./api.js";
const API_URL = "http://localhost:5000/api/inventory";

export const getInventory = () => request(API_URL);
export const getInventoryByProduct = (productId) => request(`${API_URL}/${productId}`);
export const getInventoryMovements = (params = "") => request(`${API_URL}/movements${params ? `?${params}` : ""}`);
export const getProductMovements = (productId) => request(`${API_URL}/${productId}/movements`);
export const stockIn = (data) => request(`${API_URL}/stock-in`, { method: "POST", body: JSON.stringify(data) });
export const adjustStock = (data) => request(`${API_URL}/adjustment`, { method: "POST", body: JSON.stringify(data) });
