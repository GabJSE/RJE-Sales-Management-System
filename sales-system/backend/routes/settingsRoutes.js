import { sensitiveLimit } from "../middleware/sensitiveLimit.js";
import { Router } from "express";
import { getSettings, updateSettings } from "../controllers/settingsController.js";
import { authenticate, requireRole } from "../middleware/auth.js";

const router = Router();
router.use(authenticate);
router.get("/", getSettings);
router.put("/", requireRole("admin"), sensitiveLimit({ limit: 10 }), updateSettings);
router.put("/:section", requireRole("admin"), updateSettings);
export default router;
