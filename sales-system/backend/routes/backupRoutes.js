import { Router } from "express";
import { getBackupInfo } from "../controllers/backupController.js";
import { authenticate, requireRole } from "../middleware/auth.js";

const router = Router();
router.use(authenticate, requireRole("admin"));
router.get("/", getBackupInfo);
export default router;
