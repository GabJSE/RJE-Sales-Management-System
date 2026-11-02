import crypto from "node:crypto";
import Shop from "../models/TikTokShop.js";
import Mapping from "../models/TikTokProductMapping.js";
import Order from "../models/TikTokOrder.js";
import { Conversation, Message, Outbound, CSSettings, CSJob, CSEvent, DeliveryFollowup } from "../models/TikTokCustomerService.js";
import { failure, tiktokRequest } from "./tiktokApiService.js";
import { compareMessages, DELIVERY_MESSAGES, languageFor, matchFaq, needsHuman, normalizeMessage, validateReply, validateSettings } from "./tiktokCustomerServicePolicy.js";

export const CS_SCOPE = "seller.customer_service";
export const CS_PATHS = Object.freeze({ conversations: "/customer_service/202309/conversations", messages: id => `/customer_service/202309/conversations/${id}/messages`, send: id => `/customer_service/202606/conversations/${id}/messages`, read: id => `/customer_service/202309/conversations/${id}/messages/read` });
export const csId = value => { if (typeof value !== "string" || !/^\d{1,30}$/.test(value)) throw failure("Invalid conversation or message ID.", 400); return value; };
const authorization = shop => crypto.createHash("sha256").update(`${process.env.TIKTOK_APP_KEY || ""}:${shop.shopId}:${shop.connectedAt?.toISOString() || "unknown"}`).digest("hex");

export async function csShop({ allowMissing = false } = {}) {
  const shop = await Shop.findOne({ key: "singleton" }).select("+shopCipher");
  if (!shop || shop.status !== "connected" || !shop.shopId || !shop.shopCipher) throw failure("Connect TikTok Shop and refresh shop information in Settings first.", 409);
  if (!allowMissing && shop.scopes.length && !shop.scopes.includes(CS_SCOPE)) throw failure("seller.customer_service is missing. Reauthorize the shop after enabling the approved scope in Partner Center.", 403);
  return shop;
}

export async function csSettings(shop) {
  const key = authorization(shop);
  let settings = await CSSettings.findOneAndUpdate({ shopId: shop.shopId }, { $setOnInsert: { authorization: key } }, { new: true, upsert: true });
  if (settings.authorization !== key) {
    settings = await CSSettings.findOneAndUpdate({ shopId: shop.shopId, authorization: settings.authorization }, { $set: { authorization: key, enabled: false, deliveryFollowup: false }, $unset: { readVerifiedAt: 1, manualVerifiedAt: 1, enabledAt: 1, deliveryFollowupEnabledAt: 1 } }, { new: true });
    if (!settings) return csSettings(shop);
  }
  return settings;
}

export async function accessStatus() {
  const shop = await csShop({ allowMissing: true });
  const settings = await csSettings(shop);
  const scope = shop.scopes.includes(CS_SCOPE) ? "granted" : shop.scopes.length ? "missing" : "unknown";
  const deliveryHistory = await DeliveryFollowup.find({ shopId: shop.shopId }).sort({ createdAt: -1 }).limit(20).select("orderId state reason conversationId messageId createdAt").lean();
  return { scope, requiredScope: CS_SCOPE, readVerifiedAt: settings.readVerifiedAt, manualVerifiedAt: settings.manualVerifiedAt, reauthorizationRequired: scope === "missing", settings, region: shop.region, deliveryTemplates: DELIVERY_MESSAGES, deliveryHistory };
}

export async function saveCSSettings(body) {
  if (!body || typeof body !== "object") throw failure("Settings are required.", 400);
  const shop = await csShop({ allowMissing: !body.enabled });
  const settings = await csSettings(shop);
  const values = validateSettings(body);
  if (values.deliveryFollowup === true && !values.enabled) throw failure("Enable verified automation before enabling delivered-order follow-ups.", 409);
  if (!values.enabled) values.deliveryFollowup = false;
  const deliveryEnabled = values.deliveryFollowup ?? settings.deliveryFollowup;
  if (deliveryEnabled && !shop.scopes.includes("seller.order.info")) throw failure("Delivered-order follow-ups require seller.order.info.", 403);
  if (values.enabled && (!settings.readVerifiedAt || !settings.manualVerifiedAt)) throw failure("Verify API access and confirm a manual reply in synchronized message history before enabling automation.", 409);
  if (values.enabled && !settings.enabled) values.enabledAt = new Date();
  if (deliveryEnabled && (!settings.deliveryFollowup || !settings.enabled)) values.deliveryFollowupEnabledAt = new Date();
  Object.assign(settings, values);
  await settings.save();
  return settings;
}

async function persistMessages(shop, id, rawMessages) {
  const rows = rawMessages.map(normalizeMessage);
  for (const row of rows) {
    await Message.updateOne({ shopId: shop.shopId, conversationId: id, messageId: row.messageId }, { $set: row }, { upsert: true });
    const sent = await Outbound.findOneAndUpdate({ shopId: shop.shopId, conversationId: id, messageId: row.messageId, state: "sent", source: "manual", authorization: authorization(shop) }, { $set: { verifiedAt: new Date() } }, { new: true });
    if (sent && row.senderRole !== "BUYER" && row.visible && row.type === "TEXT" && row.text === sent.text) {
      await CSSettings.updateOne({ shopId: shop.shopId, authorization: authorization(shop) }, { $set: { manualVerifiedAt: new Date() } });
    }
  }
  const visible = rows.filter(row => row.visible).sort(compareMessages);
  if (visible.length) {
    const latest = visible.at(-1);
    await Conversation.updateOne({ shopId: shop.shopId, conversationId: id, $or: [{ lastMessageAt: { $lte: latest.sentAt } }, { lastMessageAt: null }] }, { $set: { lastMessageAt: latest.sentAt, preview: latest.text || `[${latest.type}]` } });
    // Any observed agent reply pauses RJE automation, including replies from Seller Center.
    const externalAgent = visible.filter(row => ["SHOP", "CUSTOMER_SERVICE"].includes(row.senderRole));
    for (const row of externalAgent) {
      if (!(await Outbound.exists({ shopId: shop.shopId, conversationId: id, messageId: row.messageId }))) {
        const settings = await csSettings(shop);
        if (settings.enabledAt && row.sentAt >= settings.enabledAt) await handoff(shop.shopId, id, "An agent replied in TikTok Shop.");
      }
    }
  }
  return rows;
}

export async function syncConversations(pageToken) {
  const shop = await csShop();
  const data = await tiktokRequest(CS_PATHS.conversations, { query: { shop_cipher: shop.shopCipher, page_size: 20, ...(pageToken ? { page_token: String(pageToken) } : {}) } });
  if (!Array.isArray(data.conversations)) throw failure("TikTok returned an invalid conversation list.");
  const settings = await csSettings(shop);
  for (const raw of data.conversations) {
    const id = csId(raw.id); const buyer = raw.participants?.find(person => person.role === "BUYER");
    await Conversation.updateOne({ shopId: shop.shopId, conversationId: id }, { $set: { buyerUserId: buyer?.user_id, buyerName: buyer?.nickname || "TikTok buyer", canSendMessage: raw.can_send_message === true, unreadCount: Number(raw.unread_count) || 0, lastSyncedAt: new Date() }, $setOnInsert: { mode: settings.enabled ? "automatic" : "human" } }, { upsert: true });
    if (raw.latest_message) await persistMessages(shop, id, [raw.latest_message]);
    await queueCSConversation(shop.shopId, id);
  }
  await CSSettings.updateOne({ shopId: shop.shopId, authorization: authorization(shop) }, { $set: { readVerifiedAt: new Date() } });
  return { nextPageToken: data.next_page_token || "", count: data.conversations.length };
}

export async function syncMessages(id, pageToken) {
  csId(id); const shop = await csShop();
  if (!(await Conversation.exists({ shopId: shop.shopId, conversationId: id }))) throw failure("Sync the inbox before opening this conversation.", 404);
  const data = await tiktokRequest(CS_PATHS.messages(id), { query: { shop_cipher: shop.shopCipher, page_size: 10, sort_order: "DESC", ...(pageToken ? { page_token: String(pageToken) } : {}) } });
  if (!Array.isArray(data.messages)) throw failure("TikTok returned an invalid message list.");
  const rows = await persistMessages(shop, id, data.messages);
  await Conversation.updateOne({ shopId: shop.shopId, conversationId: id }, { $set: { lastSyncedAt: new Date() } });
  return { nextPageToken: data.next_page_token || "", rows };
}

export async function getInbox({ before, mode } = {}) {
  const shop = await csShop({ allowMissing: true });
  const filter = { shopId: shop.shopId };
  if (mode === "human" || mode === "automatic") filter.mode = mode;
  if (before) { if (!/^[a-f\d]{24}$/i.test(before)) throw failure("Invalid history cursor.", 400); filter._id = { $lt: before }; }
  const items = await Conversation.find(filter).sort({ _id: -1 }).limit(50).lean();
  return { items, nextPage: items.length === 50 ? String(items.at(-1)._id) : null };
}

export async function getHistory(id, before) {
  csId(id); const shop = await csShop({ allowMissing: true });
  const conversation = await Conversation.findOne({ shopId: shop.shopId, conversationId: id }).lean();
  if (!conversation) throw failure("Conversation not found.", 404);
  const filter = { shopId: shop.shopId, conversationId: id, visible: true };
  if (before) { if (!/^[a-f\d]{24}$/i.test(before)) throw failure("Invalid history cursor.", 400); filter._id = { $lt: before }; }
  const rows = await Message.find(filter).sort({ _id: -1 }).limit(100).lean();
  const outbounds = await Outbound.find({ shopId: shop.shopId, conversationId: id }).sort({ createdAt: -1 }).limit(50).lean();
  return { conversation, messages: rows.sort(compareMessages), outbounds, nextPage: rows.length === 100 ? String(rows.reduce((a, b) => String(a._id) < String(b._id) ? a : b)._id) : null };
}

async function handoff(shopId, id, reason) {
  await Conversation.updateOne({ shopId, conversationId: id }, { $set: { mode: "human", handoffReason: reason } });
}

export async function withConversationLock(shopId, id, action) {
  const owner = crypto.randomUUID();
  const locked = await Conversation.findOneAndUpdate({ shopId, conversationId: id, $or: [{ leaseUntil: null }, { leaseUntil: { $lte: new Date() } }] }, { $set: { leaseOwner: owner, leaseUntil: new Date(Date.now() + 180_000) } }, { new: true });
  if (!locked) throw failure("This conversation is being processed. Wait and refresh its history.", 409);
  const heartbeat = setInterval(() => Conversation.updateOne({ shopId, conversationId: id, leaseOwner: owner }, { $set: { leaseUntil: new Date(Date.now() + 180_000) } }).catch(() => {}), 30_000); heartbeat.unref?.();
  try { return await action(locked); }
  finally { clearInterval(heartbeat); await Conversation.updateOne({ shopId, conversationId: id, leaseOwner: owner }, { $unset: { leaseOwner: 1, leaseUntil: 1 } }); }
}

export async function setConversationMode(id, mode) {
  csId(id); if (!["human", "automatic"].includes(mode)) throw failure("Invalid conversation mode.", 400);
  const shop = await csShop({ allowMissing: mode === "human" });
  const settings = await csSettings(shop);
  if (mode === "automatic" && (!settings.enabled || !settings.manualVerifiedAt)) throw failure("Enable verified automation in settings first.", 409);
  return withConversationLock(shop.shopId, id, async () => {
    await Conversation.updateOne({ shopId: shop.shopId, conversationId: id }, { $set: { mode, handoffReason: mode === "human" ? "Taken over by an agent." : "" } });
    return { mode };
  });
}

async function sendOnce(shop, id, { text, clientId, source, inboundMessageId, actorId, leaseOwner }) {
  const previous = await Outbound.findOne({ shopId: shop.shopId, clientId });
  if (previous) {
    if (previous.conversationId !== id || previous.text !== text || previous.source !== source) throw failure("This reply key was already used for different content.", 409);
    return previous;
  }
  if (await Outbound.exists({ shopId: shop.shopId, conversationId: id, state: { $in: ["sending", "unknown"] } })) throw failure("A previous reply has uncertain delivery. Check history and resolve it before sending again.", 409);
  const settings = await csSettings(shop);
  if (!settings.readVerifiedAt) throw failure("Verify Customer Service API access first.", 409);
  const conversation = await Conversation.findOne({ shopId: shop.shopId, conversationId: id });
  if (!conversation?.canSendMessage) throw failure("TikTok has not marked this conversation as eligible for replies. Sync the inbox first.", 409);
  if (conversation.leaseOwner !== leaseOwner || !conversation.leaseUntil || conversation.leaseUntil <= new Date()) throw failure("Conversation lease expired. Refresh before sending.", 409);
  let outbound;
  try { outbound = await Outbound.create({ shopId: shop.shopId, conversationId: id, clientId, source, text, inboundMessageId, actorId, authorization: authorization(shop) }); }
  catch (error) { if (error.code === 11000) return Outbound.findOne({ shopId: shop.shopId, $or: [{ clientId }, { conversationId: id, inboundMessageId, source: "automatic" }] }); throw error; }
  try {
    const result = await tiktokRequest(CS_PATHS.send(id), { method: "POST", query: { shop_cipher: shop.shopCipher }, body: { type: "TEXT", content: JSON.stringify({ content: text }), sender_role: source === "manual" ? "CUSTOMER_SERVICE" : "SYSTEM" }, retry: false });
    if (typeof result.message_id !== "string" || !/^\d+$/.test(result.message_id)) throw Object.assign(failure("TikTok did not confirm a message ID."), { deliveryUncertain: true });
    outbound.messageId = result.message_id; outbound.state = "sent";
  } catch (error) {
    const rejectedCodes = [105002, 105005, 105006, 105007, 106001, 104029, 45101002, 45101003, 45101004, 45101006, 45102007, 45109001, 45111001];
    outbound.state = !error.deliveryUncertain && rejectedCodes.includes(error.apiDiagnostics?.code) ? "rejected" : "unknown";
    outbound.error = outbound.state === "unknown" ? "Delivery is uncertain. Check TikTok message history; do not resend." : `TikTok rejected this reply (code ${error.apiDiagnostics.code ?? "unknown"}).`;
    await handoff(shop.shopId, id, outbound.error);
  }
  // A crash or database failure leaves 'sending', deliberately blocking subsequent sends.
  await outbound.save();
  return outbound;
}

export async function sendManualReply(id, body, actorId) {
  if (!body || typeof body !== "object") throw failure("Reply text and a stable reply key are required.", 400);
  csId(id); const shop = await csShop(); const text = validateReply(body.text);
  if (typeof body.clientId !== "string" || !/^[a-zA-Z0-9-]{16,100}$/.test(body.clientId)) throw failure("A stable reply key is required.", 400);
  return withConversationLock(shop.shopId, id, async locked => {
    await handoff(shop.shopId, id, "Manual reply: automation paused.");
    return sendOnce(shop, id, { text, clientId: body.clientId, source: "manual", actorId: String(actorId), leaseOwner: locked.leaseOwner });
  });
}

export async function resolveOutbound(id, clientId, body, actorId) {
  csId(id); const shop = await csShop({ allowMissing: true });
  if (!body || (body.confirmedNotSent !== true && !body.confirmedMessageId)) throw failure("Confirm the delivery outcome in TikTok Shop before clearing the hold.", 400);
  return withConversationLock(shop.shopId, id, async () => {
    const row = await Outbound.findOne({ shopId: shop.shopId, conversationId: id, clientId, state: { $in: ["unknown", "sending"] }, createdAt: { $lt: new Date(Date.now() - 180_000) } });
    if (!row) throw failure("Delivery hold not found or still in progress. Wait three minutes before resolving.", 409);
    if (body.confirmedMessageId) {
      const messageId = csId(body.confirmedMessageId);
      const message = await Message.findOne({ shopId: shop.shopId, conversationId: id, messageId, visible: true, type: "TEXT", senderRole: { $in: ["SHOP", "CUSTOMER_SERVICE", "SYSTEM", "ROBOT"] }, text: row.text, sentAt: { $gte: new Date(row.createdAt.getTime() - 10_000), $lte: new Date(row.createdAt.getTime() + 10 * 60_000) } });
      if (!message) throw failure("No matching delivered message in synchronized history. Refresh messages and verify the exact message ID.", 409);
      if (await Outbound.exists({ shopId: shop.shopId, conversationId: id, messageId })) throw failure("This delivered message is already linked to another reply.", 409);
      row.state = "sent"; row.messageId = messageId; row.verifiedAt = new Date();
      if (row.source === "manual" && row.authorization === authorization(shop)) await CSSettings.updateOne({ shopId: shop.shopId, authorization: authorization(shop) }, { $set: { manualVerifiedAt: new Date() } });
    } else row.state = "confirmed_not_sent";
    row.resolvedBy = String(actorId); row.resolvedAt = new Date();
    await row.save();
    if (row.source === "delivery") await DeliveryFollowup.updateOne({ shopId: shop.shopId, orderId: row.clientId.slice("delivery-".length) }, { $set: { state: row.state === "sent" ? "sent" : "skipped", reason: "Delivery outcome explicitly resolved by an agent; no resend.", messageId: row.messageId } });
    return row;
  });
}

export async function queueCSConversation(shopId, id) {
  csId(id);
  await CSJob.updateOne({ shopId, conversationId: id }, { $inc: { generation: 1 }, $set: { pending: true }, $setOnInsert: { nextAttemptAt: new Date() } }, { upsert: true });
}

export async function acceptCSWebhook(payload, topic) {
  if (!["NEW_MESSAGE", "NEW_CONVERSATION"].includes(topic)) throw failure("Unsupported message topic.", 400);
  const id = csId(payload?.data?.conversation_id);
  if (typeof payload.tts_notification_id !== "string" || !payload.tts_notification_id || payload.tts_notification_id.length > 100) throw failure("Invalid notification ID.", 400);
  const shop = await csShop();
  if (String(payload.shop_id || "") !== shop.shopId) throw failure("Webhook shop does not match the connected shop.", 400);
  let event;
  try { event = await CSEvent.create({ shopId: shop.shopId, notificationId: payload.tts_notification_id, conversationId: id, topic }); }
  catch (error) { if (error.code !== 11000) throw error; event = await CSEvent.findOne({ shopId: shop.shopId, notificationId: payload.tts_notification_id }); }
  if (event.queued) return { duplicate: true };
  // Payloads are signals only; never trust message content or buyer identity from them.
  await queueCSConversation(shop.shopId, id);
  await CSEvent.updateOne({ _id: event._id }, { $set: { queued: true } });
  return { accepted: true };
}

export async function registerCSWebhooks() {
  const shop = await csShop();
  if (shop.scopes.length && !shop.scopes.includes("seller.authorization.info")) throw failure("Webhook registration requires seller.authorization.info.", 403);
  const base = String(process.env.TIKTOK_CS_WEBHOOK_BASE_URL || "").replace(/\/$/, "");
  if (!/^https:\/\//i.test(base)) throw failure("Set TIKTOK_CS_WEBHOOK_BASE_URL to the public HTTPS /api/tiktok/customer-service/webhooks URL.", 409);
  const registered = [];
  for (const [topic, suffix] of [["NEW_MESSAGE", "message"], ["NEW_CONVERSATION", "conversation"]]) {
    const address = `${base}/${suffix}`;
    if (address.length > 255) throw failure("Webhook URL exceeds 255 characters.", 400);
    await tiktokRequest("/event/202309/webhooks", { method: "PUT", query: { shop_cipher: shop.shopCipher }, body: { address, event_type: topic } });
    registered.push(topic);
  }
  await CSSettings.updateOne({ shopId: shop.shopId }, { $set: { webhookRegisteredAt: new Date() } });
  return { registered };
}

async function automaticAnswer(shop, conversation, message, settings, history) {
  const text = message.text; const language = languageFor(text); const tl = language === "tagalog";
  if (message.type !== "TEXT" || needsHuman(text)) return { reason: "Refund, complaint, complex concern or unsupported message requires an agent." };
  if (/\b(order|tracking|delivery|deliver|shipping|shipped|padala|dumating|nasaan|kailan)\b/i.test(text)) {
    if (!settings.orderReplies || !shop.scopes.includes("seller.order.info")) return { reason: "Order replies are disabled or order permission is missing." };
    const card = [...history].reverse().find(row => row.senderRole === "BUYER" && row.orderId);
    const orderId = text.match(/\b\d{15,25}\b/)?.[0] || card?.orderId;
    if (!orderId || !conversation.buyerUserId) return { reason: "An order and verified buyer identity are needed." };
    const result = await tiktokRequest("/order/202507/orders", { query: { shop_cipher: shop.shopCipher, ids: orderId } });
    const order = result.orders?.find(row => row.id === orderId);
    if (!order || String(order.user_id || "") !== conversation.buyerUserId) return { reason: "Order ownership could not be verified." };
    const statuses = {
      UNPAID: ["awaiting payment", "naghihintay ng bayad"], ON_HOLD: ["on hold", "naka-hold"], AWAITING_SHIPMENT: ["awaiting shipment", "inihahanda para ipadala"], AWAITING_COLLECTION: ["awaiting courier collection", "naghihintay na kunin ng courier"], IN_TRANSIT: ["in transit", "nasa biyahe"], DELIVERED: ["delivered", "nai-deliver na"], COMPLETED: ["completed", "kumpleto na"], PARTIALLY_SHIPPING: ["partially shipped", "bahagyang naipadala"], CANCELLED: ["cancelled", "nakansela"] };
    if (!statuses[order.status]) return { reason: "An agent needs to review this order status." };
    return { text: tl ? `Ang order ${orderId} ay ${statuses[order.status][1]}. Tingnan ang TikTok Shop order details para sa pinakabagong delivery updates.` : `Order ${orderId} is ${statuses[order.status][0]}. Check your TikTok Shop order details for the latest delivery updates.` };
  }
  if (/\b(product|price|stock|available|availability|magkano|presyo|meron|mayroon|size|sukat|compatible|fit)\b/i.test(text)) {
    if (!settings.productReplies || /\b(compatible|fit|kasya|sukat)\b/i.test(text)) return { reason: "Product compatibility or detailed specifications need an agent." };
    const card = [...history].reverse().find(row => row.senderRole === "BUYER" && row.productId);
    const productId = card?.productId;
    // Exact SKU/product context only. Never guess a variant from a fuzzy title match.
    const rows = await Mapping.find({ shopId: shop.shopId, archivedAt: null, ...(productId ? { tiktokProductId: productId } : { sellerSku: text.match(/\bsku\s*[:#]?\s*([\w-]+)/i)?.[1] || "__no_match__" }) }).limit(21).lean();
    if (rows.length !== 1 || !rows[0].lastSyncedAt || Date.now() - new Date(rows[0].lastSyncedAt).getTime() > 15 * 60_000) return { reason: "Select an exact product variant with recently synchronized data." };
    const row = rows[0];
    if (row.status !== "ACTIVATE" || row.stock == null || !/^\d+(\.\d+)?$/.test(row.price || "") || row.currency !== "PHP") return { reason: "Product availability or pricing needs verification." };
    return { text: tl ? `${row.title}: PHP ${row.price}. ${row.stock > 0 ? "May stock ayon sa huling sync" : "Walang stock ayon sa huling sync"}. Kumpirmahin ang presyo at stock sa TikTok Shop bago mag-checkout.` : `${row.title}: PHP ${row.price}. ${row.stock > 0 ? "In stock at the last sync" : "Out of stock at the last sync"}. Confirm price and availability in TikTok Shop before checkout.` };
  }
  const answer = matchFaq(text, settings.faqs, language);
  return answer ? { text: answer } : { reason: "No unambiguous approved FAQ matches. An agent should respond." };
}

export async function processAutomation(id) {
  const shop = await csShop();
  return withConversationLock(shop.shopId, id, async conversation => {
    const settings = await csSettings(shop);
    // Escalation still runs while sending automation is disabled.
    const history = (await Message.find({ shopId: shop.shopId, conversationId: id, visible: true }).sort({ sentAt: -1 }).limit(100).lean()).sort(compareMessages);
    const latest = history.at(-1);
    if (!latest) return;
    const lastAgentIndex = history.findLastIndex(row => ["SHOP", "CUSTOMER_SERVICE"].includes(row.senderRole));
    const buyerTurn = history.slice(lastAgentIndex + 1).filter(row => row.senderRole === "BUYER");
    if (buyerTurn.some(row => !["TEXT", "PRODUCT_CARD", "ORDER_CARD", "BUYER_ENTER_FROM_PRODUCT", "BUYER_ENTER_FROM_ORDER"].includes(row.type) || row.type === "TEXT" && needsHuman(row.text))) { await handoff(shop.shopId, id, "Refund, complaint, complex concern or media message needs an agent."); return; }
    if (latest.senderRole !== "BUYER" || latest.type !== "TEXT") return;
    if (!settings.enabled || !settings.manualVerifiedAt || conversation.mode !== "automatic" || !settings.enabledAt || latest.sentAt < settings.enabledAt || Date.now() - latest.sentAt > 24 * 3600_000) return;
    if (await Outbound.exists({ shopId: shop.shopId, conversationId: id, source: "automatic", inboundMessageId: latest.messageId })) return;
    const answer = await automaticAnswer(shop, conversation, latest, settings, history);
    if (!answer.text) { await handoff(shop.shopId, id, answer.reason); return; }
    let text;
    try { text = validateReply(answer.text); } catch { await handoff(shop.shopId, id, "Generated template answer needs policy or length review."); return; }
    // Refresh immediately before sending to detect buyer follow-ups and external agent replies.
    const fresh = await syncMessages(id);
    const newest = fresh.rows.filter(row => row.visible).sort(compareMessages).at(-1);
    const current = await Conversation.findOne({ shopId: shop.shopId, conversationId: id });
    const currentSettings = await csSettings(await csShop());
    if (!newest || newest.messageId !== latest.messageId || current.mode !== "automatic" || !currentSettings.enabled) return;
    await sendOnce(shop, id, { text, clientId: `auto-${id}-${latest.messageId}`, source: "automatic", inboundMessageId: latest.messageId, leaseOwner: conversation.leaseOwner });
  });
}

export async function runCSJob() {
  const owner = crypto.randomUUID(); const now = new Date();
  const job = await CSJob.findOneAndUpdate({ pending: true, nextAttemptAt: { $lte: now }, $or: [{ leaseUntil: null }, { leaseUntil: { $lte: now } }] }, { $set: { leaseOwner: owner, leaseUntil: new Date(Date.now() + 180_000) } }, { new: true, sort: { nextAttemptAt: 1 } });
  if (!job) return false;
  const heartbeat = setInterval(() => CSJob.updateOne({ _id: job._id, leaseOwner: owner }, { $set: { leaseUntil: new Date(Date.now() + 180_000) } }).catch(() => {}), 30_000); heartbeat.unref?.();
  try {
    const shop = await csShop();
    if (shop.shopId !== job.shopId) { await CSJob.updateOne({ _id: job._id, leaseOwner: owner }, { $set: { pending: false }, $unset: { leaseOwner: 1, leaseUntil: 1 } }); return true; }
    if (!(await Conversation.exists({ shopId: shop.shopId, conversationId: job.conversationId }))) {
      const data = await tiktokRequest(`/customer_service/202601/conversations/${job.conversationId}`, { query: { shop_cipher: shop.shopCipher } });
      const raw = data.conversation; if (!raw || raw.id !== job.conversationId) throw failure("Conversation not available.");
      const buyer = raw.participants?.find(row => row.role === "BUYER");
      // The detail endpoint does not promise can_send_message; inbox sync establishes eligibility.
      await Conversation.updateOne({ shopId: shop.shopId, conversationId: job.conversationId }, { $setOnInsert: { buyerUserId: buyer?.user_id, buyerName: buyer?.nickname || "TikTok buyer", mode: (await csSettings(shop)).enabled ? "automatic" : "human" } }, { upsert: true });
    }
    await syncMessages(job.conversationId);
    await processAutomation(job.conversationId);
    await CSJob.updateOne({ _id: job._id, leaseOwner: owner, generation: job.generation }, { $set: { pending: false, handledGeneration: job.generation, error: "" } });
    await CSJob.updateOne({ _id: job._id, leaseOwner: owner }, { $unset: { leaseOwner: 1, leaseUntil: 1 } });
  } catch (error) {
    const wait = error.apiDiagnostics?.code === 45101004 ? 24 * 3600_000 : Math.max(5 * 60_000, error.retryAfterMs || 0);
    await CSJob.updateOne({ _id: job._id, leaseOwner: owner }, { $set: { error: "Customer Service synchronization failed. Verify permissions, API versions and rate limits.", nextAttemptAt: new Date(Date.now() + wait) }, $unset: { leaseOwner: 1, leaseUntil: 1 } });
  } finally { clearInterval(heartbeat); }
  return true;
}

export async function pollCSInbox() {
  const shop = await csShop({ allowMissing: true });
  const settings = await csSettings(shop);
  if (!settings.readVerifiedAt || (shop.scopes.length && !shop.scopes.includes(CS_SCOPE))) return;
  const owner = crypto.randomUUID(); const now = new Date();
  const claimed = await CSSettings.findOneAndUpdate({ _id: settings._id, $and: [{ $or: [{ nextInboxPollAt: null }, { nextInboxPollAt: { $lte: now } }] }, { $or: [{ pollLeaseUntil: null }, { pollLeaseUntil: { $lte: now } }] }] }, { $set: { pollLeaseOwner: owner, pollLeaseUntil: new Date(Date.now() + 180_000) } }, { new: true });
  if (!claimed) return;
  try {
    const result = await syncConversations(claimed.inboxPageToken);
    await CSSettings.updateOne({ _id: claimed._id, pollLeaseOwner: owner }, { $set: { inboxPageToken: result.nextPageToken, nextInboxPollAt: new Date(Date.now() + (result.nextPageToken ? 30_000 : 5 * 60_000)), lastWorkerError: "" }, $unset: { pollLeaseOwner: 1, pollLeaseUntil: 1 } });
  } catch (error) {
    const wait = error.apiDiagnostics?.code === 45101004 ? 24 * 3600_000 : Math.max(15 * 60_000, error.retryAfterMs || 0);
    await CSSettings.updateOne({ _id: claimed._id, pollLeaseOwner: owner }, { $set: { nextInboxPollAt: new Date(Date.now() + wait), lastWorkerError: "Inbox recovery paused after an API failure. Verify access and rate limits." }, $unset: { pollLeaseOwner: 1, pollLeaseUntil: 1 } });
  }
}

export async function runDeliveryFollowups() {
  const shop = await csShop({ allowMissing: true });
  const settings = await csSettings(shop);
  if (!settings.enabled || !settings.deliveryFollowup || !settings.deliveryFollowupEnabledAt || !settings.readVerifiedAt || !settings.manualVerifiedAt || !shop.scopes.includes(CS_SCOPE) || !shop.scopes.includes("seller.order.info")) return false;
  // Discovery uses the existing synchronized order feed, including order webhook updates.
  // Never backfill deliveries that happened before explicit feature activation.
  const start = new Date(Math.max(settings.deliveryFollowupEnabledAt.getTime(), Date.now() - 7 * 86400_000));
  const candidates = await Order.aggregate([
    { $match: { shopId: shop.shopId, status: "DELIVERED", deliveredAtTikTok: { $gte: start, $lte: new Date() }, isSampleOrder: { $ne: true } } },
    { $sort: { deliveredAtTikTok: 1, _id: 1 } },
    { $lookup: { from: DeliveryFollowup.collection.name, let: { order: "$orderId", shop: "$shopId" }, pipeline: [{ $match: { $expr: { $and: [{ $eq: ["$orderId", "$$order"] }, { $eq: ["$shopId", "$$shop"] }] } } }, { $limit: 1 }], as: "followup" } },
    { $match: { followup: { $size: 0 } } }, { $limit: 10 }, { $project: { orderId: 1 } },
  ]);
  for (const order of candidates) {
    try { await DeliveryFollowup.create({ shopId: shop.shopId, orderId: order.orderId }); }
    catch (error) { if (error.code !== 11000) throw error; }
  }
  const owner = crypto.randomUUID(); const now = new Date();
  const job = await DeliveryFollowup.findOneAndUpdate({ shopId: shop.shopId, state: "pending", nextAttemptAt: { $lte: now }, $or: [{ leaseUntil: null }, { leaseUntil: { $lte: now } }] }, { $set: { leaseOwner: owner, leaseUntil: new Date(Date.now() + 180_000) }, $inc: { attempts: 1 } }, { new: true, sort: { createdAt: 1 } });
  if (!job) return false;
  const finish = (state, reason, extra = {}) => DeliveryFollowup.updateOne({ _id: job._id, leaseOwner: owner }, { $set: { state, reason, ...extra }, $unset: { leaseOwner: 1, leaseUntil: 1 } });
  const heartbeat = setInterval(() => DeliveryFollowup.updateOne({ _id: job._id, leaseOwner: owner }, { $set: { leaseUntil: new Date(Date.now() + 180_000) } }).catch(() => {}), 30_000); heartbeat.unref?.();
  try {
    const clientId = `delivery-${job.orderId}`;
    const prior = await Outbound.findOne({ shopId: shop.shopId, clientId });
    if (prior) { await finish(prior.state === "sent" ? "sent" : prior.state === "rejected" ? "rejected" : "unknown", "Existing attempt retained; no resend.", { conversationId: prior.conversationId, messageId: prior.messageId }); return true; }
    const local = await Order.findOne({ shopId: shop.shopId, orderId: job.orderId }).lean();
    if (!local || local.status !== "DELIVERED" || !local.deliveredAtTikTok || local.deliveredAtTikTok < start) { await finish("skipped", "Order is no longer eligible for a new delivery follow-up."); return true; }
    const result = await tiktokRequest("/order/202507/orders", { query: { ids: job.orderId, shop_cipher: shop.shopCipher } });
    const live = result.orders?.find(row => row.id === job.orderId);
    if (!live || live.status !== "DELIVERED" || !/^\d+$/.test(live.user_id || "") || !Number.isFinite(Number(live.delivery_time)) || Number(live.delivery_time) * 1000 < start.getTime()) { await finish("skipped", "Live delivered status, delivery date or buyer identity could not be verified."); return true; }
    const conversations = await Conversation.find({ shopId: shop.shopId, buyerUserId: live.user_id }).limit(2);
    if (conversations.length !== 1) { await finish("skipped", "No unique synchronized buyer chat. No new conversation was opened."); return true; }
    const conversation = conversations[0];
    await withConversationLock(shop.shopId, conversation.conversationId, async locked => {
      if (locked.mode !== "automatic" || !locked.canSendMessage) { await finish("skipped", "Chat is assigned to a human or TikTok has not allowed replies.", { conversationId: locked.conversationId }); return; }
      await syncMessages(locked.conversationId);
      // Refresh history and run escalation before considering an unsolicited follow-up.
      const history = (await Message.find({ shopId: shop.shopId, conversationId: locked.conversationId, visible: true }).sort({ sentAt: -1 }).limit(100).lean()).sort(compareMessages);
      if (history.some(row => row.senderRole === "BUYER" && (needsHuman(row.text) || row.type === "RETURN_REFUND_CARD"))) { await finish("skipped", "Buyer has a concern requiring human review."); await handoff(shop.shopId, locked.conversationId, "Delivery follow-up skipped: buyer concern needs review."); return; }
      const current = await csSettings(await csShop());
      const chat = await Conversation.findById(locked._id);
      if (!current.enabled || !current.deliveryFollowup || !current.manualVerifiedAt || current.authorization !== settings.authorization || current.deliveryFollowupEnabledAt?.getTime() !== settings.deliveryFollowupEnabledAt.getTime() || !chat || chat.mode !== "automatic" || chat.buyerUserId !== live.user_id || !chat.canSendMessage) { await finish("skipped", "Automation or chat settings changed before sending."); return; }
      const text = validateReply(DELIVERY_MESSAGES[current.deliveryLanguage]);
      const outbound = await sendOnce(shop, locked.conversationId, { text, clientId, source: "delivery", leaseOwner: locked.leaseOwner });
      await finish(outbound.state === "sent" ? "sent" : outbound.state === "rejected" ? "rejected" : "unknown", outbound.error || "Neutral delivered-order follow-up accepted by TikTok.", { conversationId: locked.conversationId, messageId: outbound.messageId });
    });
  } catch (error) {
    const prior = await Outbound.findOne({ shopId: shop.shopId, clientId: `delivery-${job.orderId}` });
    if (prior) await finish(prior.state === "sent" ? "sent" : prior.state === "rejected" ? "rejected" : "unknown", "Attempt recorded; no automatic resend.", { conversationId: prior.conversationId, messageId: prior.messageId });
    else if (job.attempts >= 5) await finish("skipped", "Pre-send verification failed repeatedly. No message was sent.");
    else await DeliveryFollowup.updateOne({ _id: job._id, leaseOwner: owner }, { $set: { nextAttemptAt: new Date(Date.now() + (error.apiDiagnostics?.code === 45101004 ? 24 * 3600_000 : 5 * 60_000)), reason: "Pre-send verification deferred. No message attempt yet." }, $unset: { leaseOwner: 1, leaseUntil: 1 } });
  } finally { clearInterval(heartbeat); }
  return true;
}

export async function startCSWorker() {
  // Dedupe guarantees must exist before the server accepts message mutations.
  await Promise.all([Conversation, Message, Outbound, CSSettings, CSJob, CSEvent, DeliveryFollowup].map(model => model.init()));
  let busy = false;
  let nextDeliveryScan = 0;
  const tick = async () => { if (busy) return; busy = true; try { await pollCSInbox(); await runCSJob(); if (Date.now() >= nextDeliveryScan) { nextDeliveryScan = Date.now() + 60_000; await runDeliveryFollowups(); } } catch { /* Durable pending work survives transient database outages. */ } finally { busy = false; } };
  const timer = setInterval(tick, 5000); timer.unref?.();
  return () => clearInterval(timer);
}
