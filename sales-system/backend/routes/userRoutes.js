import { Router } from "express";
import { createUser, getUserById, listUsers, resetPassword, updateStatus, updateUser } from "../controllers/userController.js";
import { authenticate, requireRole } from "../middleware/auth.js";

const router = Router();
router.use(authenticate, requireRole("admin"));
router.get("/", listUsers);
router.get("/:id", getUserById);
router.post("/", createUser);
router.put("/:id", updateUser);
router.patch("/:id/status", updateStatus);
router.patch("/:id/reset-password", resetPassword);
export default router;
