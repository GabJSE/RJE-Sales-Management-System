import { acceptTikTokWebhook, registerSupportedTikTokWebhooks, verifyTikTokWebhook } from "../services/tiktokWebhookService.js";

export const receiveTikTokWebhook = async (req, res, next) => {
  try {
    if (!verifyTikTokWebhook(req.rawBody, req.get("authorization"))) return res.status(401).json({ message: "Invalid webhook signature." });
    const result = await acceptTikTokWebhook(req.body);
    if (!result.accepted) return res.status(400).json({ message: "Invalid webhook notification." });
    return res.status(200).json({ code: 0, message: "Success" });
  } catch (error) { next(error); }
};
export const registerTikTokWebhooks = async (_req, res, next) => { try { res.json(await registerSupportedTikTokWebhooks()); } catch (error) { next(error); } };
