import { shops, sync, list, map, updateCosts, costHistory } from "../controllers/tiktokProductController.js";
import { Router } from "express";
import { authenticate, requireRole } from "../middleware/auth.js";
import { authorize, callback, disconnect, getStatus } from "../controllers/tiktokController.js";
import { dailyProfit, earningDetail, earnings, overview, settlementDetail, settlements, syncSettlements, syncStatus, transactions } from "../controllers/tiktokSettlementController.js";
import { backfillCosts, getOrder, listOrders, listOrderSyncLogs, syncOrders, updateLineCost } from "../controllers/tiktokOrderController.js";

const router = Router();

router.get("/callback", callback);
router.use(authenticate);
router.get("/authorize", requireRole("admin"), authorize);
router.get("/status", getStatus);
router.post("/shops/refresh", requireRole("admin"), shops);
router.get("/products", list);
router.post("/products/sync", requireRole("admin"), sync);
router.put("/products/costs", requireRole("admin"), updateCosts);
router.get("/products/:id/cost-history", costHistory);
router.put("/products/:id/mapping", requireRole("admin"), map);
router.get("/orders", listOrders);
router.get("/orders/sync-logs", listOrderSyncLogs);
router.post("/orders/backfill-costs", requireRole("admin"), backfillCosts);
router.get("/orders/:orderId", getOrder);
router.put("/orders/:orderId/lines/:lineItemId/cost", requireRole("admin"), updateLineCost);
router.post("/orders/sync", requireRole("admin"), syncOrders);
router.get("/finance/overview", overview);
router.get("/finance/earnings", earnings);
router.get("/finance/earnings/:id", earningDetail);
router.get("/finance/settlements", settlements);
router.get("/finance/settlements/:id", settlementDetail);
router.get("/finance/transactions", transactions);
router.get("/finance/daily-profit", dailyProfit);
router.get("/finance/sync/status", syncStatus);
router.post("/finance/sync", requireRole("admin"), syncSettlements);
router.post("/disconnect", requireRole("admin"), disconnect);

export default router;

