import { Router } from "express";
import { changePassword, login, logout, me, updateProfile } from "../controllers/authController.js";
import { authenticate } from "../middleware/auth.js";

const router = Router();
router.post("/login", login);
router.get("/me", authenticate, me);
router.put("/change-password", authenticate, changePassword);
router.put("/profile", authenticate, updateProfile);
router.post("/logout", authenticate, logout);
export default router;
