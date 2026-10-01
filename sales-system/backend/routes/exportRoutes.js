import { Router } from "express";
import { exportInventory, exportInventoryMovements, exportProducts, exportReports, exportSales } from "../controllers/exportController.js";
import { authenticate } from "../middleware/auth.js";

const router = Router();
router.use(authenticate);
router.get("/products", exportProducts);
router.get("/sales", exportSales);
router.get("/inventory", exportInventory);
router.get("/inventory-movements", exportInventoryMovements);
router.get("/reports", exportReports);
export default router;
