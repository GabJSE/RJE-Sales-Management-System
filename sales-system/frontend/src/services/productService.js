import { request } from "./api.js";
const API_URL = "http://localhost:5000/api/products";

export const getProducts = () => request(API_URL);
export const createProduct = (product) =>
  request(API_URL, { method: "POST", body: JSON.stringify(product) });
export const updateProduct = (id, product) =>
  request(`${API_URL}/${id}`, { method: "PUT", body: JSON.stringify(product) });
export const deleteProduct = (id) => request(`${API_URL}/${id}`, { method: "DELETE" });
