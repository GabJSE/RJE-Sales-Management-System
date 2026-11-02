import { request } from "./api.js";
const base = "/api/tiktok/customer-service";
const post = (path, body = {}) => request(`${base}${path}`, { method: "POST", body: JSON.stringify(body) });
export const customerService = {
  status: () => request(`${base}/status`),
  verify: () => post("/verify"),
  inbox: params => request(`${base}/conversations?${new URLSearchParams(params || {})}`),
  sync: pageToken => post("/sync", { pageToken }),
  history: (id, before) => request(`${base}/conversations/${id}/messages${before ? `?before=${encodeURIComponent(before)}` : ""}`),
  syncMessages: (id, pageToken) => post(`/conversations/${id}/sync`, { pageToken }),
  read: id => post(`/conversations/${id}/read`),
  reply: (id, body) => post(`/conversations/${id}/replies`, body),
  mode: (id, mode) => request(`${base}/conversations/${id}/mode`, { method: "PUT", body: JSON.stringify({ mode }) }),
  settings: body => request(`${base}/settings`, { method: "PUT", body: JSON.stringify(body) }),
  register: () => post("/webhooks/register"),
  resolve: (id, clientId) => post(`/conversations/${id}/replies/${encodeURIComponent(clientId)}/resolve`, { confirmedNotSent: true }),
  confirmDelivered: (id, clientId, confirmedMessageId) => post(`/conversations/${id}/replies/${encodeURIComponent(clientId)}/resolve`, { confirmedMessageId }),
};
