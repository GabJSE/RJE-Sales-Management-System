import { failure } from "./tiktokApiService.js";

export const DELIVERY_MESSAGES = Object.freeze({
  tagalog: "Salamat po sa pag-order sa RJE! Na-deliver na ang inyong order. Maaari po kayong mag-iwan ng honest review sa TikTok Shop tungkol sa inyong experience. Kung may concern, message lang po kayo rito.",
  english: "Thank you for ordering from RJE! Your order has been delivered. You’re welcome to leave an honest review on TikTok Shop about your experience. If you have any concerns, please message us here.",
});

export const languageFor = text => /\b(po|opo|magkano|meron|mayroon|pwede|paano|saan|kailan|salamat|naman|ba|ako|ko|yung|ang|ng|hindi|wala|kayo|nyo|ninyo)\b/i.test(text) ? "tagalog" : "english";
export const needsHuman = text => /\b(refund|return|complaint|complain|damaged|broken|wrong|cancel|dispute|scam|fraud|lawyer|unsafe|injury|angry|bad|terrible|sira|sirang|reklamo|ibalik|palit|mali|galit|loko|panloloko|bayad|nawawala|kulang|hindi dumating|di dumating|tao|human|agent|manager)\b/i.test(text);

// Defense in depth, not a substitute for merchant review or platform moderation.
export function validateReply(value) {
  if (typeof value !== "string" || !value.trim() || [...value.trim()].length > 2000) throw failure("Enter a text reply of 1–2,000 characters.", 400);
  const text = value.trim();
  if (/(https?:\/\/|www\.|\b(?:whatsapp|telegram|gcash|viber)\b|\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b|\b(?:09|\+63)\d[\d -]{8,}\b)/i.test(text)) throw failure("Keep customer service and payments inside TikTok Shop. Links and personal contact details are not allowed in replies.", 400);
  if (/(?:5|five)\s*[- ]?stars?|\bchange (?:your )?review\b|\bcancel (?:your |the )?order\b|\bkanselahin\b/i.test(text)) throw failure("Replies must not pressure buyers to cancel orders or change reviews.", 400);
  return text;
}

export function normalizeMessage(raw) {
  if (!raw || typeof raw.id !== "string" || !/^\d+$/.test(raw.id)) throw failure("TikTok returned an invalid message ID.");
  let content = {};
  try { content = JSON.parse(raw.content || "{}"); } catch { /* Unsupported content is displayed as a type label. */ }
  const date = new Date(Number(raw.create_time) * 1000);
  if (!Number.isFinite(date.getTime())) throw failure("TikTok returned an invalid message timestamp.");
  return {
    messageId: raw.id, index: raw.index == null ? undefined : String(raw.index),
    type: String(raw.type || "OTHER"), text: typeof content.content === "string" ? content.content.slice(0, 10000) : "",
    productId: typeof content.product_id === "string" && /^\d+$/.test(content.product_id) ? content.product_id : undefined,
    orderId: typeof content.order_id === "string" && /^\d+$/.test(content.order_id) ? content.order_id : undefined,
    senderRole: String(raw.sender?.role || "UNKNOWN"), senderName: String(raw.sender?.nickname || ""),
    visible: raw.is_visible === true, sentAt: date,
  };
}

export function compareMessages(a, b) {
  if (/^\d+$/.test(a.index || "") && /^\d+$/.test(b.index || "")) return BigInt(a.index) < BigInt(b.index) ? -1 : BigInt(a.index) > BigInt(b.index) ? 1 : 0;
  return new Date(a.sentAt) - new Date(b.sentAt) || String(a.messageId).localeCompare(String(b.messageId), "en", { numeric: true });
}

export function matchFaq(text, faqs, language) {
  const normalized = text.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim();
  const matches = faqs.filter(faq => faq.enabled && faq.keywords.some(keyword => (` ${normalized} `).includes(` ${keyword.toLowerCase().trim()} `)));
  return matches.length === 1 ? matches[0][language] : null;
}

export function validateSettings(body) {
  for (const key of ["enabled", "productReplies", "orderReplies"]) if (typeof body[key] !== "boolean") throw failure(`${key} must be true or false.`, 400);
  if (!Array.isArray(body.faqs) || body.faqs.length > 50) throw failure("Provide at most 50 FAQs.", 400);
  const ids = new Set();
  const faqs = body.faqs.map(faq => {
    if (typeof faq.id !== "string" || !/^[a-zA-Z0-9-]{1,80}$/.test(faq.id) || ids.has(faq.id)) throw failure("FAQ IDs must be unique.", 400);
    ids.add(faq.id);
    if (!Array.isArray(faq.keywords) || !faq.keywords.length || faq.keywords.length > 15 || faq.keywords.some(k => typeof k !== "string" || k.trim().length < 2 || k.length > 80)) throw failure("Each FAQ needs 1–15 keywords or phrases, each 2–80 characters.", 400);
    if (typeof faq.enabled !== "boolean") throw failure("FAQ enabled must be true or false.", 400);
    return { id: faq.id, keywords: faq.keywords.map(k => k.trim()), enabled: faq.enabled, english: validateReply(faq.english), tagalog: validateReply(faq.tagalog) };
  });
  if (body.deliveryFollowup !== undefined && typeof body.deliveryFollowup !== "boolean") throw failure("deliveryFollowup must be true or false.", 400);
  if (body.deliveryLanguage !== undefined && !["tagalog", "english"].includes(body.deliveryLanguage)) throw failure("Choose Tagalog or English for delivery follow-ups.", 400);
  return { enabled: body.enabled, productReplies: body.productReplies, orderReplies: body.orderReplies, faqs,
    ...(body.deliveryFollowup !== undefined ? { deliveryFollowup: body.deliveryFollowup } : {}),
    ...(body.deliveryLanguage !== undefined ? { deliveryLanguage: body.deliveryLanguage } : {}),
  };
}
