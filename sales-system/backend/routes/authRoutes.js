import { sensitiveLimit } from "../middleware/sensitiveLimit.js";
import { Router } from "express";
import { changePassword, login, logout, logoutOthers, me, updateProfile } from "../controllers/authController.js";
import { authenticate } from "../middleware/auth.js";

const router = Router();
router.post("/login", sensitiveLimit({ limit: 10 }), login);
router.get("/me", authenticate, me);
router.put("/change-password", authenticate, sensitiveLimit(), changePassword);
router.put("/profile", authenticate, sensitiveLimit({ limit: 10 }), updateProfile);
router.post("/logout-others", authenticate, sensitiveLimit(), logoutOthers);
router.post("/logout", authenticate, logout);
export default router;
