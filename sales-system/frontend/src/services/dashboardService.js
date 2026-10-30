const API_URL = "/api/dashboard";
import { request } from "./api.js";

export const getDashboard = async (startDate, endDate) => {
  const query = startDate && endDate ? `?startDate=${startDate}&endDate=${endDate}` : "";
  return request(`${API_URL}${query}`);
};
