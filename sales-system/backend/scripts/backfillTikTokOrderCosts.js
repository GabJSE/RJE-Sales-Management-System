import "dotenv/config";
import dns from "node:dns";
import mongoose from "mongoose";
import TikTokShop from "../models/TikTokShop.js";
import FinanceSyncLog from "../models/TikTokFinanceSyncLog.js";
import { backfillMissingOrderCosts } from "../services/tiktokVariantCostService.js";
import { syncTikTokSettlements } from "../services/tiktokSettlementService.js";

if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is not configured.");
dns.setServers(["1.1.1.1", "8.8.8.8"]);

try {
  await mongoose.connect(process.env.MONGODB_URI);
  const shop = await TikTokShop.findOne({ status: "connected" }).lean();
  if (!shop?.shopId) throw new Error("No connected TikTok shop was found.");
  const result = await backfillMissingOrderCosts({ shopId: shop.shopId, userId: null });
  const latestFinanceLog = await FinanceSyncLog.findOne({ shopId: shop.shopId }).sort({ startedAt: -1 }).lean();
  const output = { backfill: result, financeLeaseUntil: shop.settlementSyncLeaseUntil || null, latestFinanceSync: latestFinanceLog ? { status: latestFinanceLog.status, startedAt: latestFinanceLog.startedAt, completedAt: latestFinanceLog.completedAt || null } : null };
  if (process.argv.includes("--recover-stale-finance") && latestFinanceLog?.status === "running" && shop.settlementSyncOwner) {
    const recovered = await TikTokShop.updateOne({ _id: shop._id, settlementSyncOwner: shop.settlementSyncOwner, settlementSyncLeaseUntil: shop.settlementSyncLeaseUntil }, { $unset: { settlementSyncLeaseUntil: 1, settlementSyncOwner: 1 } });
    if (recovered.modifiedCount) await FinanceSyncLog.updateOne({ _id: latestFinanceLog._id, status: "running" }, { $set: { status: "failed", completedAt: new Date(), errorMessage: "Interrupted by backend restart during maintenance." } });
    output.recoveredStaleFinanceLease = Boolean(recovered.modifiedCount);
  }
  if (process.argv.includes("--sync-finance")) {
    try {
      output.finance = await syncTikTokSettlements({ from: new Date(Date.now() - 90 * 86400_000), to: new Date(), mode: "manual" });
    } catch (error) {
      output.financeError = error.message;
    }
  }
  console.log(JSON.stringify(output));
} finally {
  await mongoose.disconnect();
}
