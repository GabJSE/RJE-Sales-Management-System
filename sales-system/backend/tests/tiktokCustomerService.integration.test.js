import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import Shop from "../models/TikTokShop.js";
import Mapping from "../models/TikTokProductMapping.js";
import Order from "../models/TikTokOrder.js";
import { Conversation, Message, Outbound, CSSettings, CSJob, DeliveryFollowup } from "../models/TikTokCustomerService.js";
import { accessStatus, acceptCSWebhook, csSettings, getHistory, pollCSInbox, processAutomation, queueCSConversation, registerCSWebhooks, resolveOutbound, runCSJob, runDeliveryFollowups, saveCSSettings, sendManualReply, setConversationMode, syncConversations, syncMessages } from "../services/tiktokCustomerService.js";
import { encryptToken } from "../config/tiktok.js";
import express from "express";
import csRoutes from "../routes/tiktokCustomerServiceRoutes.js";
import User from "../models/User.js";
import { signToken } from "../middleware/auth.js";
let server;
const id = "7494560109732334261"; const buyerId = "7494560109732334262";
const rawMessage = (overrides = {}) => ({ id: "7494560109732334263", index: "7494560109732334263", type: "TEXT", content: '{"content":"opening hours"}', create_time: Math.floor(Date.now() / 1000), is_visible: true, sender: { role: "BUYER", nickname: "Buyer" }, ...overrides });
const rawConversation = () => ({ id, participants: [{ role: "BUYER", user_id: buyerId, nickname: "Buyer" }], can_send_message: true, unread_count: 1, latest_message: rawMessage() });
const reply = data => new Response(JSON.stringify({ code: 0, data }));
before(async () => {
  Object.assign(process.env, { JWT_SECRET: "isolated-cs-test-secret", TIKTOK_APP_KEY: "cs-fixture", TIKTOK_APP_SECRET: "fixture", TIKTOK_SERVICE_ID: "fixture", TIKTOK_REDIRECT_URI: "https://example.test/callback", TIKTOK_TOKEN_ENCRYPTION_KEY: "a".repeat(64), TIKTOK_API_BASE_URL: "https://example.test" });
  server = await MongoMemoryServer.create({ binary: { downloadDir: fileURLToPath(new URL("../node_modules/.cache/mongodb-memory-server", import.meta.url)) } });
  await mongoose.connect(server.getUri("customer_service_test"));
  await Promise.all(Object.values(mongoose.models).map(model => model.init()));
});
after(async () => { await mongoose.disconnect(); if (server) await server.stop(); });
beforeEach(async () => {
  await Promise.all(Object.values(mongoose.models).map(model => model.deleteMany({})));
  await Shop.create({ shopId: "shop", shopCipher: "cipher", status: "connected", connectedAt: new Date(), region: "PH", scopes: ["seller.customer_service", "seller.order.info", "seller.authorization.info"], accessToken: encryptToken("fixture"), accessTokenExpiresAt: new Date(Date.now() + 3600_000) });
});
async function prepare({ automatic = false } = {}) {
  const shop = await Shop.findOne(); const settings = await csSettings(shop);
  settings.readVerifiedAt = new Date(); settings.manualVerifiedAt = automatic ? new Date() : undefined;
  settings.enabled = automatic; settings.enabledAt = new Date(Date.now() - 60000);
  settings.faqs = [{ id: "hours", enabled: true, keywords: ["opening hours", "oras"], english: "We are open daily.", tagalog: "Bukas po kami araw-araw." }]; await settings.save();
  await Conversation.create({ shopId: "shop", conversationId: id, buyerUserId: buyerId, canSendMessage: true, mode: automatic ? "automatic" : "human" });
  return { shop, settings };
}
function mockAPI(t, handler) { t.mock.method(globalThis, "fetch", async (url, options) => { assert.equal(url.origin, "https://example.test"); return handler(url, options); }); }

test("reports missing vs unknown scope and refuses enabling automation before manual verification", async () => {
  await Shop.updateOne({}, { $set: { scopes: ["seller.order.info"] } });
  assert.equal((await accessStatus()).scope, "missing"); await assert.rejects(syncConversations(), /reauthorize/i);
  await Shop.updateOne({}, { $set: { scopes: [] } }); assert.equal((await accessStatus()).scope, "unknown");
  await assert.rejects(saveCSSettings({ enabled: true, productReplies: false, orderReplies: false, faqs: [] }), /manual reply/);
});

test("syncs inbox pagination, stores history once, and isolates shops", async t => {
  mockAPI(t, url => { assert.equal(url.searchParams.get("page_size"), "20"); return reply({ conversations: [rawConversation()], next_page_token: "next" }); });
  assert.equal((await syncConversations()).nextPageToken, "next"); await syncConversations();
  assert.equal(await Conversation.countDocuments(), 1); assert.equal(await Message.countDocuments(), 1); assert.equal((await accessStatus()).scope, "granted");
  await Message.create({ shopId: "other", conversationId: id, messageId: "1", text: "private", visible: true });
  const history = await getHistory(id); assert.equal(history.messages.length, 1); assert.ok((await accessStatus()).readVerifiedAt);
});

test("manual send is idempotent and automation unlocks only after matching history confirmation", async t => {
  await prepare(); let sends = 0;
  mockAPI(t, (url, options) => {
    if (options.method === "POST") { sends++; assert.equal(url.pathname, `/customer_service/202606/conversations/${id}/messages`); assert.equal(JSON.parse(options.body).sender_role, "CUSTOMER_SERVICE"); return reply({ message_id: "7494560109732334299" }); }
    return reply({ messages: [rawMessage({ id: "7494560109732334299", sender: { role: "CUSTOMER_SERVICE" }, content: '{"content":"Hello buyer"}' })], next_page_token: "" });
  });
  const body = { text: "Hello buyer", clientId: "fixture-manual-0001" };
  assert.equal((await sendManualReply(id, body, "agent")).state, "sent");
  assert.equal((await sendManualReply(id, body, "agent")).state, "sent"); assert.equal(sends, 1);
  assert.equal((await CSSettings.findOne()).manualVerifiedAt, undefined);
  await syncMessages(id); assert.ok((await CSSettings.findOne()).manualVerifiedAt);
  await assert.rejects(sendManualReply(id, { ...body, text: "different" }, "agent"), /different content/);
});

test("uncertain send is persisted, not retried, and blocks subsequent sends", async t => {
  await prepare(); let sends = 0; mockAPI(t, () => { sends++; throw new Error("connection reset"); });
  const row = await sendManualReply(id, { text: "Hello", clientId: "fixture-uncertain-01" }, "agent");
  assert.equal(row.state, "unknown"); assert.equal(sends, 1);
  await assert.rejects(sendManualReply(id, { text: "Hello", clientId: "fixture-uncertain-02" }, "agent"), /uncertain delivery/);
  assert.equal(sends, 1); assert.equal((await Conversation.findOne()).mode, "human");
});

test("concurrent manual sends are serialized by a database lease", async t => {
  await prepare(); let release; let entered;
  const started = new Promise(resolve => { entered = resolve; });
  mockAPI(t, async () => { entered(); await new Promise(resolve => { release = resolve; }); return reply({ message_id: "123" }); });
  const first = sendManualReply(id, { text: "Hello", clientId: "fixture-concurrent-1" }, "agent"); await started;
  await assert.rejects(sendManualReply(id, { text: "Hello", clientId: "fixture-concurrent-2" }, "agent"), /being processed/);
  release(); await first; assert.equal(await Outbound.countDocuments(), 1);
});

test("webhook duplicates enqueue once, wrong-shop callbacks are rejected, and worker fetches authoritative messages", async t => {
  await prepare(); const payload = { shop_id: "shop", tts_notification_id: "notice-1", data: { conversation_id: id } };
  await acceptCSWebhook(payload, "NEW_MESSAGE"); assert.equal((await acceptCSWebhook(payload, "NEW_MESSAGE")).duplicate, true);
  assert.equal((await CSJob.findOne()).generation, 1);
  await assert.rejects(acceptCSWebhook({ ...payload, shop_id: "foreign" }, "NEW_MESSAGE"), /does not match/);
  mockAPI(t, () => reply({ messages: [rawMessage({ content: '{"content":"Refund please"}' })], next_page_token: "" }));
  await runCSJob(); assert.equal((await CSJob.findOne()).pending, false); assert.equal((await Conversation.findOne()).mode, "human"); assert.match((await Conversation.findOne()).handoffReason, /Refund/);
});

test("bilingual FAQ automation replies only once to a new buyer message", async t => {
  await prepare({ automatic: true }); let sends = 0;
  const raw = rawMessage({ content: '{"content":"oras po?"}' });
  mockAPI(t, (_url, options) => { if (options.method === "POST") { sends++; assert.equal(JSON.parse(JSON.parse(options.body).content).content, "Bukas po kami araw-araw."); return reply({ message_id: "888" }); } return reply({ messages: [raw], next_page_token: "" }); });
  await syncMessages(id); await processAutomation(id); await processAutomation(id);
  assert.equal(sends, 1); assert.equal((await Outbound.findOne()).source, "automatic");
});

test("historical messages and newer agent replies cannot trigger automation", async t => {
  await prepare({ automatic: true }); let sends = 0;
  let rows = [rawMessage({ create_time: Math.floor(Date.now() / 1000) - 3600 })];
  mockAPI(t, (_url, options) => { if (options.method === "POST") sends++; return reply({ messages: rows }); });
  await syncMessages(id); await processAutomation(id); assert.equal(sends, 0);
  rows = [rawMessage(), rawMessage({ id: "999", index: "9999999999999999999", sender: { role: "CUSTOMER_SERVICE" } })];
  await syncMessages(id); await processAutomation(id); assert.equal(sends, 0); assert.equal((await Conversation.findOne()).mode, "human");
});

test("order automation never reveals an order owned by another buyer", async t => {
  await prepare({ automatic: true }); await CSSettings.updateOne({}, { $set: { orderReplies: true } }); let sends = 0;
  const raw = rawMessage({ content: '{"content":"Where is order 7494560109732334267?"}' });
  mockAPI(t, (url, options) => { if (options.method === "POST") sends++; return url.pathname.startsWith("/order/") ? reply({ orders: [{ id: "7494560109732334267", user_id: "someone-else", status: "DELIVERED" }] }) : reply({ messages: [raw] }); });
  await syncMessages(id); await processAutomation(id); assert.equal(sends, 0); assert.match((await Conversation.findOne()).handoffReason, /ownership/);
});

test("verified order replies use live status without recipient PII", async t => {
  await prepare({ automatic: true }); await CSSettings.updateOne({}, { $set: { orderReplies: true } }); let sent;
  const raw = rawMessage({ content: '{"content":"Where is order 7494560109732334267?"}' });
  mockAPI(t, (url, options) => {
    if (options.method === "POST") { sent = JSON.parse(JSON.parse(options.body).content).content; return reply({ message_id: "888" }); }
    return url.pathname.startsWith("/order/") ? reply({ orders: [{ id: "7494560109732334267", user_id: buyerId, status: "IN_TRANSIT", recipient_address: { name: "Private Name" } }] }) : reply({ messages: [raw] });
  });
  await syncMessages(id); await processAutomation(id); assert.match(sent, /in transit/); assert.ok(!sent.includes("Private"));
});

test("product answers require exact, fresh, active synchronized variants", async t => {
  await prepare({ automatic: true }); await CSSettings.updateOne({}, { $set: { productReplies: true } }); let sent;
  await Mapping.create({ shopId: "shop", tiktokProductId: "1234", tiktokSkuId: "5678", sellerSku: "HELMET-1", title: "Helmet", price: "1200.00", stock: 3, currency: "PHP", status: "ACTIVATE", lastSyncedAt: new Date() });
  const raw = rawMessage({ content: '{"content":"price sku HELMET-1"}' });
  mockAPI(t, (_url, options) => { if (options.method === "POST") { sent = JSON.parse(JSON.parse(options.body).content).content; return reply({ message_id: "888" }); } return reply({ messages: [raw] }); });
  await syncMessages(id); await processAutomation(id); assert.match(sent, /PHP 1200.00/);
});

test("reauthorization resets access/manual verification and disables automation", async () => {
  await prepare({ automatic: true });
  await Shop.updateOne({}, { $set: { connectedAt: new Date(Date.now() + 10000) } });
  const result = await accessStatus(); assert.equal(result.settings.enabled, false); assert.equal(result.readVerifiedAt, undefined); assert.equal(result.manualVerifiedAt, undefined);
});

test("message subscription uses dedicated official topics without touching other integrations", async t => {
  await prepare(); process.env.TIKTOK_CS_WEBHOOK_BASE_URL = "https://example.test/api/tiktok/customer-service/webhooks";
  const bodies = [];
  mockAPI(t, (url, options) => { assert.equal(url.pathname, "/event/202309/webhooks"); bodies.push(JSON.parse(options.body)); return reply({}); });
  await registerCSWebhooks(); assert.deepEqual(bodies.map(row => row.event_type), ["NEW_MESSAGE", "NEW_CONVERSATION"]);
  assert.ok(bodies.every(row => row.address.includes("customer-service/webhooks/")));
});

test("automation is disabled by default and enabling it does not opt existing human conversations in", async t => {
  await prepare(); let sends = 0;
  mockAPI(t, (_url, options) => { if (options.method === "POST") sends++; return reply({ messages: [rawMessage()] }); });
  await syncMessages(id); await processAutomation(id); assert.equal(sends, 0);
  await assert.rejects(setConversationMode(id, "automatic"), /Enable verified automation/);
  await CSSettings.updateOne({}, { $set: { manualVerifiedAt: new Date() } });
  await saveCSSettings({ enabled: true, productReplies: false, orderReplies: false, faqs: [] });
  assert.equal((await Conversation.findOne()).mode, "human");
});

test("stale product data escalates instead of quoting an old price", async t => {
  await prepare({ automatic: true }); await CSSettings.updateOne({}, { $set: { productReplies: true } }); let sends = 0;
  await Mapping.create({ shopId: "shop", tiktokProductId: "1234", tiktokSkuId: "5678", sellerSku: "HELMET-1", price: "1200", stock: 1, currency: "PHP", status: "ACTIVATE", lastSyncedAt: new Date(Date.now() - 3600_000) });
  mockAPI(t, (_url, options) => { if (options.method === "POST") sends++; return reply({ messages: [rawMessage({ content: '{"content":"price sku HELMET-1"}' })] }); });
  await syncMessages(id); await processAutomation(id); assert.equal(sends, 0); assert.match((await Conversation.findOne()).handoffReason, /recently synchronized/);
});

test("a buyer follow-up arriving during answer preparation prevents sending the old answer", async t => {
  await prepare({ automatic: true }); let reads = 0; let sends = 0;
  mockAPI(t, (_url, options) => {
    if (options.method === "POST") { sends++; return reply({ message_id: "888" }); }
    reads++;
    return reply({ messages: reads === 1 ? [rawMessage()] : [rawMessage({ id: "7494560109732334999", index: "7494560109732334999", content: '{"content":"I need a refund"}' }), rawMessage()] });
  });
  await syncMessages(id); await processAutomation(id); assert.equal(sends, 0);
  await processAutomation(id); assert.equal((await Conversation.findOne()).mode, "human");
});

test("complaints in the same buyer turn escalate even when the newest text matches a FAQ", async t => {
  await prepare({ automatic: true }); let sends = 0;
  mockAPI(t, (_url, options) => { if (options.method === "POST") sends++; return reply({ messages: [rawMessage(), rawMessage({ id: "11", index: "11", content: '{"content":"I want a refund"}' })] }); });
  await syncMessages(id); await processAutomation(id); assert.equal(sends, 0); assert.equal((await Conversation.findOne()).mode, "human");
});

test("an uncertain reply can be explicitly linked to a verified delivered message without resending", async () => {
  const { settings } = await prepare();
  const createdAt = new Date(Date.now() - 240_000);
  await Outbound.create({ shopId: "shop", conversationId: id, clientId: "uncertain-resolve-1", state: "unknown", source: "manual", text: "Hello", authorization: settings.authorization, createdAt });
  await Message.create({ shopId: "shop", conversationId: id, messageId: "123", senderRole: "CUSTOMER_SERVICE", type: "TEXT", text: "Hello", visible: true, sentAt: createdAt });
  await assert.rejects(resolveOutbound(id, "uncertain-resolve-1", { confirmedMessageId: "999" }, "agent"), /No matching delivered message/);
  const row = await resolveOutbound(id, "uncertain-resolve-1", { confirmedMessageId: "123" }, "agent");
  assert.equal(row.state, "sent"); assert.equal(row.resolvedBy, "agent"); assert.ok((await CSSettings.findOne()).manualVerifiedAt);
});

test("delivery holds need explicit confirmation and a three-minute wait; resolving never queues a send", async () => {
  await prepare();
  await Outbound.create({ shopId: "shop", conversationId: id, clientId: "uncertain-resolve-2", state: "unknown", source: "manual", text: "Hello" });
  await assert.rejects(resolveOutbound(id, "uncertain-resolve-2", {}, "agent"), /Confirm the delivery/);
  await assert.rejects(resolveOutbound(id, "uncertain-resolve-2", { confirmedNotSent: true }, "agent"), /Wait three minutes/);
  await Outbound.collection.updateOne({}, { $set: { createdAt: new Date(Date.now() - 240_000) } });
  assert.equal((await resolveOutbound(id, "uncertain-resolve-2", { confirmedNotSent: true }, "agent")).state, "confirmed_not_sent");
  assert.equal(await CSJob.countDocuments(), 0);
});

test("work arriving during an active job remains pending rather than being lost", async t => {
  await prepare(); await queueCSConversation("shop", id); let queued = false;
  mockAPI(t, async () => { if (!queued) { queued = true; await queueCSConversation("shop", id); } return reply({ messages: [rawMessage()] }); });
  await runCSJob(); assert.equal((await CSJob.findOne()).pending, true); assert.equal((await CSJob.findOne()).generation, 2);
  await runCSJob(); assert.equal((await CSJob.findOne()).pending, false);
});

test("expired worker leases recover and daily quota errors back off for a full day", async t => {
  await prepare(); await queueCSConversation("shop", id);
  await CSJob.updateOne({}, { $set: { leaseOwner: "dead-process", leaseUntil: new Date(Date.now() - 1000) } });
  mockAPI(t, () => new Response(JSON.stringify({ code: 45101004, message: "quota reached" })));
  await runCSJob(); const job = await CSJob.findOne();
  assert.equal(job.pending, true); assert.ok(job.nextAttemptAt.getTime() > Date.now() + 23 * 3600_000); assert.equal(job.leaseOwner, undefined);
});

test("recovery polling waits for verified access and preserves remote page checkpoints", async t => {
  let calls = 0;
  mockAPI(t, () => { calls++; return reply({ conversations: [], next_page_token: "next-page" }); });
  await pollCSInbox(); assert.equal(calls, 0);
  await prepare(); await pollCSInbox(); assert.equal(calls, 1); assert.equal((await CSSettings.findOne()).inboxPageToken, "next-page");
  await pollCSInbox(); assert.equal(calls, 1);
});

test("Customer Service routes authenticate history, restrict mutations to admins, and reject unsigned callbacks", async t => {
  await prepare();
  const staff = await User.create({ name: "Staff", username: "csstaff", email: "csstaff@example.test", role: "staff", password: "fixture-password" });
  const token = signToken(staff);
  const app = express(); app.use(express.json({ verify: (req, _res, buffer) => { req.rawBody = Buffer.from(buffer); } })); app.use(csRoutes);
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ message: error.message }));
  const http = await new Promise(resolve => { const instance = app.listen(0, "127.0.0.1", () => resolve(instance)); });
  t.after(() => new Promise(resolve => { http.closeAllConnections(); http.close(resolve); }));
  const url = `http://127.0.0.1:${http.address().port}`;
  assert.equal((await fetch(`${url}/conversations`)).status, 401);
  assert.equal((await fetch(`${url}/conversations`, { headers: { authorization: `Bearer ${token}` } })).status, 200);
  for (const [path, method] of [["/verify", "POST"], ["/settings", "PUT"], [`/conversations/${id}/replies`, "POST"], [`/conversations/${id}/mode`, "PUT"], ["/webhooks/register", "POST"]]) {
    assert.equal((await fetch(`${url}${path}`, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: "{}" })).status, 403);
  }
  assert.equal((await fetch(`${url}/webhooks/message`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status, 401);
});

test("a system greeting cannot hide an unresolved buyer complaint from the human queue", async t => {
  await prepare({ automatic: true });
  mockAPI(t, () => reply({ messages: [rawMessage({ content: '{"content":"Sira po ang item"}' }), rawMessage({ id: "999", index: "9999999999999999999", sender: { role: "SYSTEM" }, content: '{"content":"Welcome"}' })] }));
  await syncMessages(id); await processAutomation(id);
  assert.equal((await Conversation.findOne()).mode, "human"); assert.equal(await Outbound.countDocuments(), 0);
});

const deliveredOrderId = "7494560109732334333";
async function prepareDelivery() {
  await prepare({ automatic: true });
  await CSSettings.updateOne({}, { $set: { deliveryFollowup: true, deliveryFollowupEnabledAt: new Date(Date.now() - 60000), deliveryLanguage: "tagalog" } });
  await Order.create({ shopId: "shop", orderId: deliveredOrderId, status: "DELIVERED", deliveredAtTikTok: new Date(Date.now() - 10000) });
}
function deliveryAPI(t, { buyer = buyerId, status = "DELIVERED", failSend = false, complaint = false } = {}) {
  let sends = 0;
  mockAPI(t, (url, options) => {
    if (url.pathname.startsWith("/order/")) return reply({ orders: [{ id: deliveredOrderId, user_id: buyer, status, delivery_time: Math.floor(Date.now() / 1000) - 10 }] });
    if (options.method === "POST") { sends++; const body = JSON.parse(options.body); assert.equal(body.sender_role, "SYSTEM"); const text = JSON.parse(body.content).content; assert.match(text, /honest review/); assert.ok(!/5\s*star|five.star/i.test(text)); if (failSend) throw new Error("Response lost"); return reply({ message_id: "555" }); }
    return reply({ messages: complaint ? [rawMessage({ content: '{"content":"Sira po ang item"}' })] : [] });
  });
  return () => sends;
}

test("neutral delivered-order follow-up sends once despite repeated scans and worker restarts", async t => {
  await prepareDelivery(); const sends = deliveryAPI(t);
  await runDeliveryFollowups(); await runDeliveryFollowups();
  assert.equal(sends(), 1); assert.equal((await DeliveryFollowup.findOne()).state, "sent"); assert.equal((await Outbound.findOne()).source, "delivery");
  // Simulate recovery after intent persistence but before final ledger acknowledgement.
  await DeliveryFollowup.updateOne({}, { $set: { state: "pending", nextAttemptAt: new Date() } });
  await runDeliveryFollowups(); assert.equal(sends(), 1); assert.equal((await DeliveryFollowup.findOne()).state, "sent");
});

test("delivered follow-ups are opt-in and never backfill orders delivered before activation", async t => {
  await prepareDelivery(); const sends = deliveryAPI(t);
  await CSSettings.updateOne({}, { $set: { deliveryFollowup: false } });
  await runDeliveryFollowups(); assert.equal(await DeliveryFollowup.countDocuments(), 0);
  await CSSettings.updateOne({}, { $set: { deliveryFollowup: true, deliveryFollowupEnabledAt: new Date() } });
  await runDeliveryFollowups(); assert.equal(sends(), 0); assert.equal(await DeliveryFollowup.countDocuments(), 0);
});

test("delivery follow-up does not message a different buyer or open a new chat", async t => {
  await prepareDelivery(); const sends = deliveryAPI(t, { buyer: "123456789" });
  await runDeliveryFollowups(); assert.equal(sends(), 0); assert.equal((await DeliveryFollowup.findOne()).state, "skipped"); assert.match((await DeliveryFollowup.findOne()).reason, /No unique/);
});

test("live delivery verification rejects stale synchronized order status", async t => {
  await prepareDelivery(); const sends = deliveryAPI(t, { status: "IN_TRANSIT" });
  await runDeliveryFollowups(); assert.equal(sends(), 0); assert.equal((await DeliveryFollowup.findOne()).state, "skipped");
});

test("delivery follow-up respects human takeover and complaint escalation", async t => {
  await prepareDelivery(); const sends = deliveryAPI(t);
  await Conversation.updateOne({}, { $set: { mode: "human" } });
  await runDeliveryFollowups(); assert.equal(sends(), 0); assert.match((await DeliveryFollowup.findOne()).reason, /human/);
});

test("delivery follow-up pauses for a complaint rather than requesting a review", async t => {
  await prepareDelivery(); const sends = deliveryAPI(t, { complaint: true });
  await runDeliveryFollowups(); assert.equal(sends(), 0); assert.equal((await Conversation.findOne()).mode, "human");
});

test("uncertain delivered-order follow-up is never automatically retried", async t => {
  await prepareDelivery(); const sends = deliveryAPI(t, { failSend: true });
  await runDeliveryFollowups(); await runDeliveryFollowups();
  assert.equal(sends(), 1); assert.equal((await DeliveryFollowup.findOne()).state, "unknown"); assert.equal((await Conversation.findOne()).mode, "human");
});

test("delivery settings require verified automation, preserve opt-in on unrelated saves and reset on reauthorization", async () => {
  await prepare();
  const body = { enabled: false, productReplies: false, orderReplies: false, faqs: [], deliveryFollowup: true, deliveryLanguage: "tagalog" };
  await assert.rejects(saveCSSettings(body), /Enable verified automation/);
  await CSSettings.updateOne({}, { $set: { manualVerifiedAt: new Date() } });
  const value = await saveCSSettings({ ...body, enabled: true }); assert.ok(value.deliveryFollowupEnabledAt);
  await Shop.updateOne({}, { $set: { connectedAt: new Date(Date.now() + 10000) } });
  assert.equal((await accessStatus()).settings.deliveryFollowup, false);
});
