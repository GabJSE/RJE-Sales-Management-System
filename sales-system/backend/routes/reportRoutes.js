import { Router } from "express";
import { exportReport, getReport } from "../controllers/reportController.js";

const router = Router();

router.get("/", getReport);
router.get("/export", exportReport);

export default router;
