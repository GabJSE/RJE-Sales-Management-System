import { request } from "./api.js";
const API_URL = "http://localhost:5000/api/reports";

export const getReport = async (startDate, endDate) => {
  return request(`${API_URL}?startDate=${startDate}&endDate=${endDate}`);
};

export const exportReport = async (startDate, endDate) => {
  const response = await fetch(`${API_URL}/export?startDate=${startDate}&endDate=${endDate}`, { headers: { Authorization: `Bearer ${localStorage.getItem("rje_auth_token") || ""}` } });
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.message || "The report could not be exported.");
  }
  return response.blob();
};
