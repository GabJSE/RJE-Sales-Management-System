import { getToken } from "./api.js";

const API_URL = "http://localhost:5000/api/exports";

export const downloadExport = async (path, filename) => {
  const response = await fetch(`${API_URL}/${path}`, { headers: { Authorization: `Bearer ${getToken()}` } });
  if (!response.ok) {
    let message = "The export could not be generated.";
    try {
      const data = await response.json();
      message = data.message || message;
    } catch {
      // Keep a user-safe fallback when a proxy returns a non-JSON error.
    }
    throw new Error(message);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
};
