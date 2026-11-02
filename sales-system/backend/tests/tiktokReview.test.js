import test from "node:test";
import assert from "node:assert/strict";
import { generateReviewReply } from "../services/tiktokReviewService.js";

test("review replies use the configured language and deterministic local template", () => {
  const review = { _id: "review-1", productName: "Brake pad", rating: 5 };
  const first = generateReviewReply(review, { language: "taglish", tone: "friendly" });
  const second = generateReviewReply(review, { language: "taglish", tone: "friendly" });
  assert.equal(first.language, "taglish");
  assert.equal(first.text, second.text);
  assert.ok(first.text.length > 20);
});

test("custom templates override defaults and low ratings direct customers to support", () => {
  const custom = generateReviewReply({ _id: "x", rating: 5 }, { language: "english", templates: { english: { 5: ["Custom approved reply"] } } });
  const low = generateReviewReply({ _id: "y", rating: 1 }, { language: "english" });
  assert.equal(custom.text, "Custom approved reply");
  assert.match(low.text, /contact|message/i);
});
