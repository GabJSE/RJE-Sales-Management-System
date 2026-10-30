import { getToken, request, resolveApiUrl } from "./api.js";

const API_URL = "/api/reports";

export const getReport = async (startDate, endDate) =>
  request(`${API_URL}?startDate=${startDate}&endDate=${endDate}`);

export const exportReport = async (startDate, endDate) => {
  const response = await fetch(
    resolveApiUrl(`${API_URL}/export?startDate=${startDate}&endDate=${endDate}`),
    { headers: { Authorization: `Bearer ${getToken()}` } }
  );
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.message || "The report could not be exported.");
  }
  return response.blob();
};
