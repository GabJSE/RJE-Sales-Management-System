export const getToken = () => localStorage.getItem("rje_auth_token");

export const request = async (url, options = {}) => {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(url, { ...options, headers });
  const data = response.status === 204 ? null : await response.json();
  if (response.status === 401) {
    localStorage.removeItem("rje_auth_token");
    localStorage.removeItem("rje_auth_user");
    window.dispatchEvent(new Event("auth-expired"));
  }
  if (!response.ok) throw new Error(data?.message || "The request could not be completed.");
  return data;
};
