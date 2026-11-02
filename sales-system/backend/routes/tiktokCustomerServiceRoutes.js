import { Router } from "express";
import { authenticate, requireRole } from "../middleware/auth.js";
import { sensitiveLimit } from "../middleware/sensitiveLimit.js";
import { verifyTikTokWebhook } from "../services/tiktokWebhookService.js";
import { acceptCSWebhook, accessStatus, csId, csShop, getHistory, getInbox, processAutomation, registerCSWebhooks, resolveOutbound, saveCSSettings, sendManualReply, setConversationMode, syncConversations, syncMessages } from "../services/tiktokCustomerService.js";
import { Conversation } from "../models/TikTokCustomerService.js";
import { tiktokRequest, failure } from "../services/tiktokApiService.js";
import { CS_PATHS } from "../services/tiktokCustomerService.js";

const router = Router();
const handle = fn => async (req, res, next) => { try { res.json(await fn(req)); } catch (error) { next(error); } };
for (const [path, topic] of [["message", "NEW_MESSAGE"], ["conversation", "NEW_CONVERSATION"]]) {
  router.post(`/webhooks/${path}`, async (req, res, next) => {
    try {
      if (!verifyTikTokWebhook(req.rawBody, req.get("authorization"))) return res.status(401).json({ message: "Invalid webhook signature." });
      await acceptCSWebhook(req.body, topic);
      res.status(200).json({ code: 0, message: "Success" });
    } catch (error) { next(error); }
  });
}
router.use(authenticate);
// Match existing TikTok write permissions; non-admin users have read-only access.
router.get("/status", handle(() => accessStatus()));
router.get("/conversations", handle(req => getInbox(req.query)));
router.get("/conversations/:id/messages", handle(req => getHistory(req.params.id, req.query.before)));
router.post("/verify", requireRole("admin"), sensitiveLimit(), handle(() => syncConversations()));
router.post("/sync", requireRole("admin"), sensitiveLimit({ limit: 30, windowMs: 60_000 }), handle(req => syncConversations(req.body.pageToken)));
router.post("/webhooks/register", requireRole("admin"), sensitiveLimit(), handle(() => registerCSWebhooks()));
router.put("/settings", requireRole("admin"), handle(req => saveCSSettings(req.body)));
router.post("/conversations/:id/sync", requireRole("admin"), sensitiveLimit({ limit: 30, windowMs: 60_000 }), handle(async req => {
  const result = await syncMessages(req.params.id, req.body.pageToken);
  // Escalate even if automation is disabled. History backfill never triggers old replies.
  if (!req.body.pageToken) await processAutomation(req.params.id);
  return { nextPageToken: result.nextPageToken };
}));
router.post("/conversations/:id/read", requireRole("admin"), handle(async req => {
  const id = csId(req.params.id); const shop = await csShop();
  if (!(await Conversation.exists({ shopId: shop.shopId, conversationId: id }))) throw failure("Conversation not found.", 404);
  await tiktokRequest(CS_PATHS.read(id), { method: "POST", query: { shop_cipher: shop.shopCipher } });
  await Conversation.updateOne({ shopId: shop.shopId, conversationId: id }, { $set: { unreadCount: 0 } });
  return { read: true };
}));
router.put("/conversations/:id/mode", requireRole("admin"), handle(req => setConversationMode(req.params.id, req.body.mode)));
router.post("/conversations/:id/replies", requireRole("admin"), sensitiveLimit({ limit: 20, windowMs: 60_000 }), handle(req => sendManualReply(req.params.id, req.body, req.user._id)));
router.post("/conversations/:id/replies/:clientId/resolve", requireRole("admin"), handle(req => resolveOutbound(req.params.id, req.params.clientId, req.body, req.user._id)));
export default router;
