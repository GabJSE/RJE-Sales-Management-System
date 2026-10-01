const API_URL = "http://localhost:5000/api/dashboard";
import { request } from "./api.js";

export const getDashboard = async (startDate, endDate) => {
  const query = startDate && endDate ? `?startDate=${startDate}&endDate=${endDate}` : "";
  return request(`${API_URL}${query}`);
};
