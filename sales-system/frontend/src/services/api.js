export const getToken = () => localStorage.getItem("rje_auth_token");
export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
export const resolveApiUrl = (url) => (url.startsWith("http") ? url : `${API_BASE_URL}${url}`);

export const request = async (url, options = {}) => {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(resolveApiUrl(url), { ...options, headers });
  const data = response.status === 204 ? null : await response.json();
  if (response.status === 401) {
    localStorage.removeItem("rje_auth_token");
    localStorage.removeItem("rje_auth_user");
    window.dispatchEvent(new Event("auth-expired"));
  }
  if (!response.ok) throw Object.assign(new Error(data?.message || "The request could not be completed."), { fieldErrors: data?.errors, statusCode: response.status });
  return data;
};
