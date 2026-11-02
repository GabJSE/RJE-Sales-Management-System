import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { verifyTikTokWebhook, webhookCategory } from "../services/tiktokWebhookService.js";

test("TikTok Shop webhook signature is checked against the unmodified raw body", () => {
  const config = { appKey: "app-key", appSecret: "app-secret" };
  const body = Buffer.from('{"type":1,"tts_notification_id":"123","data":{"order_id":"456"}}');
  const signature = crypto.createHmac("sha256", config.appSecret).update(config.appKey).update(body).digest("hex");
  assert.equal(verifyTikTokWebhook(body, signature, config), true);
  assert.equal(verifyTikTokWebhook(Buffer.from(`${body} `), signature, config), false);
  assert.equal(verifyTikTokWebhook(body, "invalid", config), false);
});

test("webhooks are routed only to authoritative order or product synchronization", () => {
  assert.equal(webhookCategory({ type: 1, data: { order_id: "1" } }), "order");
  assert.equal(webhookCategory({ type: 71, data: { product_id: "2" } }), "inventory");
  assert.equal(webhookCategory({ type: 18, data: { product_id: "2" } }), "product");
  assert.equal(webhookCategory({ type: 999, data: {} }), "unknown");
});
