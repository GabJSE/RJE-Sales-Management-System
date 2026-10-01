import { request } from "./api.js";
const API_URL = "http://localhost:5000/api/sales";

export const getSales = () => request(API_URL);
export const getSaleById = (id) => request(`${API_URL}/${id}`);
export const createSale = (sale) => request(API_URL, { method: "POST", body: JSON.stringify(sale) });
export const updateSale = (id, sale) => request(`${API_URL}/${id}`, { method: "PUT", body: JSON.stringify(sale) });
export const deleteSale = (id) => request(`${API_URL}/${id}`, { method: "DELETE" });
