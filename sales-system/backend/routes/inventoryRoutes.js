import { Router } from "express";
import {
  adjustStock,
  getInventory,
  getInventoryByProduct,
  getInventoryMovements,
  getProductMovements,
  stockIn,
} from "../controllers/inventoryController.js";

const router = Router();

router.get("/", getInventory);
router.get("/movements", getInventoryMovements);
router.get("/:productId/movements", getProductMovements);
router.get("/:productId", getInventoryByProduct);
router.post("/stock-in", stockIn);
router.post("/adjustment", adjustStock);

export default router;
