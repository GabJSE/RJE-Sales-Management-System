import test from "node:test";
import assert from "node:assert/strict";
import { tiktokRequest } from "../services/tiktokApiService.js";
import { compareMessages, languageFor, matchFaq, needsHuman, normalizeMessage, validateReply, validateSettings } from "../services/tiktokCustomerServicePolicy.js";

test("manual message POST is never retried after an ambiguous network or server failure", async () => {
  for (const scenario of ["network", "server", "invalid-json", "auth"]) {
    let calls = 0; let refreshes = 0;
    const deps = { config: () => ({ appKey: scenario, appSecret: "fixture", apiBaseUrl: "https://example.test" }), getToken: async () => "fixture", refreshToken: async () => { refreshes++; return "fixture"; }, fetch: async () => {
      calls++;
      if (scenario === "network") throw new Error("private-token");
      if (scenario === "server") return new Response("{}", { status: 503 });
      if (scenario === "invalid-json") return new Response("not json");
      return new Response(JSON.stringify({ code: 105002, message: "private-token" }), { status: 401 });
    } };
    await assert.rejects(tiktokRequest("/messages", { method: "POST", retry: false, body: {} }, deps), error => !error.message.includes("private-token"));
    assert.equal(calls, 1); assert.equal(refreshes, 0);
  }
});

test("non-retrying sends honor Retry-After without replaying the message", async () => {
  let calls = 0;
  const deps = { config: () => ({ appKey: "cs-quota-test", appSecret: "fixture", apiBaseUrl: "https://example.test" }), getToken: async () => "fixture", fetch: async () => { calls++; return new Response(JSON.stringify({ code: 104029 }), { status: 429, headers: { "retry-after": "3600" } }); } };
  await assert.rejects(tiktokRequest("/messages", { method: "POST", retry: false }, deps));
  await assert.rejects(tiktokRequest("/messages", { method: "POST", retry: false }, deps));
  assert.equal(calls, 1);
});

test("English and Tagalog concerns escalate before any FAQ answer", () => {
  for (const text of ["I want a refund", "Sira po ang item", "Mali ang padala", "human please", "Hindi dumating ang order", "complaint"]) assert.equal(needsHuman(text), true);
  assert.equal(languageFor("Magkano po ito?"), "tagalog");
  assert.equal(languageFor("Is this available?"), "english");
});

test("FAQ matching is bounded, bilingual, and rejects ambiguous matches", () => {
  const faqs = [{ enabled: true, keywords: ["opening hours"], english: "Open daily", tagalog: "Bukas araw-araw" }];
  assert.equal(matchFaq("Opening hours?", faqs, "tagalog"), "Bukas araw-araw");
  assert.equal(matchFaq("reopening hours", faqs, "english"), null);
  assert.equal(matchFaq("opening hours", [...faqs, ...faqs], "english"), null);
});

test("reply validation rejects off-platform redirection, review pressure, invalid length", () => {
  for (const text of ["", "x".repeat(2001), "Visit https://example.test", "Contact me on WhatsApp", "Please give 5 stars", "Cancel your order"]) assert.throws(() => validateReply(text));
  assert.equal(validateReply(" Salamat po! "), "Salamat po!");
});

test("normalization preserves 64-bit identifiers and hides non-visible messages", () => {
  const result = normalizeMessage({ id: "7494560109732334263", index: "7494560109732334274", content: '{"order_id":"7494560109732334267"}', type: "ORDER_CARD", create_time: 1790000000, is_visible: false, sender: { role: "BUYER" } });
  assert.equal(result.orderId, "7494560109732334267"); assert.equal(result.visible, false);
  assert.ok(compareMessages(result, { ...result, index: "7494560109732334275" }) < 0);
  assert.throws(() => normalizeMessage({ id: 7494560109732334263 }));
});

test("settings cannot accept arbitrary operators or malformed FAQ entries", () => {
  assert.throws(() => validateSettings({ enabled: "false", productReplies: false, orderReplies: false, faqs: [] }));
  assert.throws(() => validateSettings({ enabled: false, productReplies: false, orderReplies: false, faqs: [{ id: "1", enabled: true, keywords: [""], english: "Hello", tagalog: "Kumusta" }] }));
});
