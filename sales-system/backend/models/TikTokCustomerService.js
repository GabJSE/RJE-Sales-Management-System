import mongoose from "mongoose";

const conversation = new mongoose.Schema({
  shopId: { type: String, required: true }, conversationId: { type: String, required: true },
  buyerUserId: String, buyerName: String, canSendMessage: { type: Boolean, default: false },
  unreadCount: { type: Number, default: 0 }, preview: String, lastMessageAt: Date,
  mode: { type: String, enum: ["automatic", "human"], default: "human" }, handoffReason: String,
  leaseOwner: String, leaseUntil: Date, lastSyncedAt: Date,
}, { timestamps: true });
conversation.index({ shopId: 1, conversationId: 1 }, { unique: true });
conversation.index({ shopId: 1, lastMessageAt: -1 });

const message = new mongoose.Schema({
  shopId: { type: String, required: true }, conversationId: { type: String, required: true },
  messageId: { type: String, required: true }, index: String, type: String, text: String,
  productId: String, orderId: String, senderRole: String, senderName: String, sentAt: Date,
  visible: { type: Boolean, default: true },
}, { timestamps: true });
message.index({ shopId: 1, conversationId: 1, messageId: 1 }, { unique: true });
message.index({ shopId: 1, conversationId: 1, sentAt: -1, messageId: -1 });

const outbound = new mongoose.Schema({
  shopId: { type: String, required: true }, conversationId: { type: String, required: true },
  clientId: { type: String, required: true }, text: { type: String, required: true },
  source: { type: String, enum: ["manual", "automatic", "delivery"], required: true }, inboundMessageId: String,
  actorId: String, authorization: String, messageId: String,
  state: { type: String, enum: ["sending", "sent", "unknown", "rejected", "confirmed_not_sent"], default: "sending" },
  verifiedAt: Date, error: String, resolvedBy: String, resolvedAt: Date,
}, { timestamps: true });
outbound.index({ shopId: 1, clientId: 1 }, { unique: true });
outbound.index({ shopId: 1, conversationId: 1, messageId: 1 }, { unique: true, partialFilterExpression: { messageId: { $type: "string" } } });
outbound.index({ shopId: 1, conversationId: 1, inboundMessageId: 1 }, { unique: true, partialFilterExpression: { source: "automatic" } });

const settings = new mongoose.Schema({
  shopId: { type: String, required: true, unique: true }, authorization: String,
  readVerifiedAt: Date, manualVerifiedAt: Date,
  enabled: { type: Boolean, default: false }, enabledAt: Date,
  productReplies: { type: Boolean, default: false }, orderReplies: { type: Boolean, default: false },
  deliveryFollowup: { type: Boolean, default: false }, deliveryFollowupEnabledAt: Date,
  deliveryLanguage: { type: String, enum: ["tagalog", "english"], default: "tagalog" },
  faqs: [{ _id: false, id: String, keywords: [String], english: String, tagalog: String, enabled: Boolean }],
  webhookRegisteredAt: Date, lastWorkerError: String,
  nextInboxPollAt: Date, inboxPageToken: String, pollLeaseUntil: Date, pollLeaseOwner: String,
}, { timestamps: true, optimisticConcurrency: true });

const job = new mongoose.Schema({
  shopId: { type: String, required: true }, conversationId: { type: String, required: true },
  generation: { type: Number, default: 0 }, handledGeneration: { type: Number, default: 0 },
  pending: { type: Boolean, default: true }, leaseUntil: Date, leaseOwner: String,
  nextAttemptAt: { type: Date, default: Date.now }, error: String,
}, { timestamps: true });
job.index({ shopId: 1, conversationId: 1 }, { unique: true });
job.index({ pending: 1, nextAttemptAt: 1, leaseUntil: 1 });

const event = new mongoose.Schema({
  shopId: { type: String, required: true }, notificationId: { type: String, required: true },
  topic: String, conversationId: String, queued: { type: Boolean, default: false },
}, { timestamps: true });
event.index({ shopId: 1, notificationId: 1 }, { unique: true });
event.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 86400 });

const delivery = new mongoose.Schema({
  shopId: { type: String, required: true }, orderId: { type: String, required: true },
  conversationId: String, messageId: String,
  state: { type: String, enum: ["pending", "sent", "skipped", "unknown", "rejected"], default: "pending" },
  reason: String, attempts: { type: Number, default: 0 },
  nextAttemptAt: { type: Date, default: Date.now }, leaseUntil: Date, leaseOwner: String,
}, { timestamps: true });
delivery.index({ shopId: 1, orderId: 1 }, { unique: true });
delivery.index({ shopId: 1, state: 1, nextAttemptAt: 1 });

export const Conversation = mongoose.model("TikTokCSConversation", conversation);
export const Message = mongoose.model("TikTokCSMessage", message);
export const Outbound = mongoose.model("TikTokCSOutbound", outbound);
export const CSSettings = mongoose.model("TikTokCSSettings", settings);
export const CSJob = mongoose.model("TikTokCSJob", job);
export const CSEvent = mongoose.model("TikTokCSEvent", event);
export const DeliveryFollowup = mongoose.model("TikTokCSDeliveryFollowup", delivery);
