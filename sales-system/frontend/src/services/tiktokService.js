import { waitForTikTokSync } from "./tiktokSyncService.js";
import { request } from "./api.js";

const API_URL = "/api/tiktok";

export const getTikTokAuthorizationUrl = () => request(`${API_URL}/authorize`);
export const getTikTokStatus = () => request(`${API_URL}/status`);
export const disconnectTikTok = () => request(`${API_URL}/disconnect`, { method: "POST" });

export const refreshTikTokShop = () => request(`${API_URL}/shops/refresh`, { method: "POST" });
export const getTikTokProducts = (search = "", page = 1, missingCost = false, sort = "title_asc", options = {}) => request(`${API_URL}/products?${new URLSearchParams({ search, page, sort, ...(missingCost ? { missingCost: "true" } : {}), ...options })}`);
export const syncTikTokProducts = () => request(`${API_URL}/products/sync`, { method: "POST" }).then(result => { window.dispatchEvent(new Event("tiktok-sync-started")); return waitForTikTokSync(result); });
export const updateTikTokVariantCosts = (edits, reason = "") => request(`${API_URL}/products/costs`, { method: "PUT", body: JSON.stringify({ edits, reason }) });
export const getTikTokVariantCostHistory = id => request(`${API_URL}/products/${id}/cost-history`);
export const getTikTokFinanceOverview = (from, to) => request(`${API_URL}/finance/overview?${new URLSearchParams({ from, to })}`);
export const getTikTokEarnings = (from, to) => request(`${API_URL}/finance/earnings?${new URLSearchParams({ from, to })}`);
export const getTikTokEarning = id => request(`${API_URL}/finance/earnings/${id}`);
export const getTikTokSettlements = (from, to) => request(`${API_URL}/finance/settlements?${new URLSearchParams({ from, to })}`);
export const getTikTokSettlement = id => request(`${API_URL}/finance/settlements/${id}`);
export const getTikTokFinanceSyncStatus = () => request(`${API_URL}/finance/sync/status`);
export const syncTikTokSettlements = range => request(`${API_URL}/finance/sync`, { method: "POST", body: JSON.stringify(range || {}) }).then(result => { window.dispatchEvent(new Event("tiktok-sync-started")); return waitForTikTokSync(result); });
export const getTikTokOrders = params => request(`${API_URL}/orders?${new URLSearchParams(params)}`);
export const getTikTokOrder = orderId => request(`${API_URL}/orders/${encodeURIComponent(orderId)}`);
export const updateTikTokOrderLineCost = (orderId, lineItemId, cost, reason) => request(`${API_URL}/orders/${encodeURIComponent(orderId)}/lines/${encodeURIComponent(lineItemId)}/cost`, { method: "PUT", body: JSON.stringify({ cost, reason }) });
export const syncTikTokOrders = range => request(`${API_URL}/orders/sync`, { method: "POST", body: JSON.stringify(range || {}) });
export const backfillTikTokOrderCosts = () => request(`${API_URL}/orders/backfill-costs`, { method: "POST" });
export const getTikTokOrderSyncLogs = () => request(`${API_URL}/orders/sync-logs`);
export const getTikTokReviews = params => request(`${API_URL}/reviews?${new URLSearchParams(params)}`);
export const getTikTokReviewStats = () => request(`${API_URL}/reviews/stats`);
export const getTikTokReviewSettings = () => request(`${API_URL}/reviews/settings`);
export const createTikTokReview = review => request(`${API_URL}/reviews`, { method: "POST", body: JSON.stringify(review) });
export const importTikTokReviews = reviews => request(`${API_URL}/reviews/import`, { method: "POST", body: JSON.stringify({ reviews }) });
export const updateTikTokReviewSettings = settings => request(`${API_URL}/reviews/settings`, { method: "PUT", body: JSON.stringify(settings) });
export const generateTikTokReviewReply = (id, options = {}) => request(`${API_URL}/reviews/${id}/generate`, { method: "POST", body: JSON.stringify(options) });
export const editTikTokReviewReply = (id, replyText) => request(`${API_URL}/reviews/${id}/reply`, { method: "PUT", body: JSON.stringify({ replyText }) });
export const approveTikTokReviewReply = id => request(`${API_URL}/reviews/${id}/approve`, { method: "POST" });
export const markTikTokReviewPublished = id => request(`${API_URL}/reviews/${id}/manual-publish`, { method: "POST" });

export const getTikTokPricing = (id, options = {}) => request(`/api/tiktok/products/${encodeURIComponent(id)}/pricing?${new URLSearchParams(options)}`);
