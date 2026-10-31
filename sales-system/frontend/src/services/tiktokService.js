import { request } from "./api.js";

const API_URL = "/api/tiktok";

export const getTikTokAuthorizationUrl = () => request(`${API_URL}/authorize`);
export const getTikTokStatus = () => request(`${API_URL}/status`);
export const disconnectTikTok = () => request(`${API_URL}/disconnect`, { method: "POST" });

export const refreshTikTokShop = () => request(`${API_URL}/shops/refresh`, { method: "POST" });
export const getTikTokProducts = (search = "", page = 1, missingCost = false) => request(`${API_URL}/products?${new URLSearchParams({ search, page, ...(missingCost ? { missingCost: "true" } : {}) })}`);
export const syncTikTokProducts = () => request(`${API_URL}/products/sync`, { method: "POST" });
export const updateTikTokVariantCosts = (edits, reason = "") => request(`${API_URL}/products/costs`, { method: "PUT", body: JSON.stringify({ edits, reason }) });
export const getTikTokVariantCostHistory = id => request(`${API_URL}/products/${id}/cost-history`);
export const mapTikTokProduct = (id, rjeProductId) => request(`${API_URL}/products/${id}/mapping`, { method: "PUT", body: JSON.stringify({ rjeProductId }) });
export const getTikTokFinanceOverview = (from, to) => request(`${API_URL}/finance/overview?${new URLSearchParams({ from, to })}`);
export const getTikTokEarnings = (from, to) => request(`${API_URL}/finance/earnings?${new URLSearchParams({ from, to })}`);
export const getTikTokEarning = id => request(`${API_URL}/finance/earnings/${id}`);
export const getTikTokSettlements = (from, to) => request(`${API_URL}/finance/settlements?${new URLSearchParams({ from, to })}`);
export const getTikTokSettlement = id => request(`${API_URL}/finance/settlements/${id}`);
export const getTikTokFinanceSyncStatus = () => request(`${API_URL}/finance/sync/status`);
export const syncTikTokSettlements = range => request(`${API_URL}/finance/sync`, { method: "POST", body: JSON.stringify(range || {}) });
export const getTikTokOrders = params => request(`${API_URL}/orders?${new URLSearchParams(params)}`);
export const getTikTokOrder = orderId => request(`${API_URL}/orders/${encodeURIComponent(orderId)}`);
export const updateTikTokOrderLineCost = (orderId, lineItemId, cost, reason) => request(`${API_URL}/orders/${encodeURIComponent(orderId)}/lines/${encodeURIComponent(lineItemId)}/cost`, { method: "PUT", body: JSON.stringify({ cost, reason }) });
export const syncTikTokOrders = range => request(`${API_URL}/orders/sync`, { method: "POST", body: JSON.stringify(range || {}) });
export const backfillTikTokOrderCosts = () => request(`${API_URL}/orders/backfill-costs`, { method: "POST" });
export const getTikTokOrderSyncLogs = () => request(`${API_URL}/orders/sync-logs`);
