import { Router } from "express";
import {
  createSale,
  deleteSale,
  getSaleById,
  getSales,
  updateSale,
} from "../controllers/saleController.js";

const router = Router();

router.get("/", getSales);
router.get("/:id", getSaleById);
router.post("/", createSale);
router.put("/:id", updateSale);
router.delete("/:id", deleteSale);

export default router;
