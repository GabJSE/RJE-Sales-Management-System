import test from "node:test";
import assert from "node:assert/strict";
import { tiktokRequest } from "../services/tiktokApiService.js";
import { normalizeSku, productRows, syncProducts } from "../services/tiktokProductService.js";
import Mapping from "../models/TikTokProductMapping.js";
import Shop from "../models/TikTokShop.js";
import ProductSyncLog from "../models/TikTokProductSyncLog.js";
import { createTikTokSignature } from "../services/tiktokSignature.js";
import { saveTokenResponse } from "../services/tiktokOAuthService.js";
const config = () => ({ appKey: "app", appSecret: "secret", apiBaseUrl: "https://example.test" });
const deps = { config, getToken: async () => "private-token", sleep: async () => {} };
const reply = (data, status = 200) => new Response(JSON.stringify(data), { status });
test("signed search includes the exact body and keeps token in the header", async () => {
  await tiktokRequest("/product/202502/products/search", { method: "POST", query: { page_size: 100 }, body: {} }, { ...deps, fetch: async (url, options) => {
    assert.equal(url.searchParams.has("access_token"), false);
    assert.equal(options.headers["x-tts-access-token"], "private-token");
    const query = Object.fromEntries(url.searchParams);
    assert.equal(query.sign, createTikTokSignature({ appSecret: "secret", path: url.pathname, query, body: options.body }));
    return reply({ code: 0, data: { products: [] } });
  } });
});
test("expired access token refreshes once and retries", async () => {
  let calls = 0; let refreshes = 0;
  const result = await tiktokRequest("/test", {}, { ...deps, refreshToken: async () => { refreshes++; return "new-token"; }, fetch: async (_url, options) => {
    calls++; if (calls === 1) return reply({ code: 105002 });
    assert.equal(options.headers["x-tts-access-token"], "new-token"); return reply({ code: 0, data: { ok: true } });
  } });
  assert.equal(result.ok, true); assert.equal(refreshes, 1); assert.equal(calls, 2);
});
test("rate limits retry a bounded number of times without exposing upstream secrets", async () => {
  let calls = 0;
  await assert.rejects(tiktokRequest("/test", {}, { ...deps, fetch: async () => { calls++; return reply({ message: "secret private-token" }, 429); } }), /busy or rate limited/);
  assert.equal(calls, 4);
});
test("errors are sanitized and network failures are safe", async () => {
  await assert.rejects(tiktokRequest("/test", {}, { ...deps, fetch: async () => reply({ code: 999, message: "private-token secret" }) }), error => !error.message.includes("private-token") && error.statusCode === 502);
  await assert.rejects(tiktokRequest("/test", {}, { ...deps, fetch: async () => { throw new Error("private-token"); } }), /could not be reached/);
});
test("invalid signatures return an actionable message without upstream details", async () => {
  await assert.rejects(
    tiktokRequest("/test", {}, {
      ...deps,
      fetch: async () => reply({ code: 106001, message: "secret upstream detail" }, 401),
      refreshToken: async () => "refreshed-token",
    }),
    error => error.statusCode === 502
      && error.message.includes("TIKTOK_APP_KEY")
      && !error.message.includes("upstream")
  );
});
test("OAuth persistence accepts TikTok's granted_scopes field", async t => {
  let update;
  t.mock.method(Shop, "findOneAndUpdate", async (_filter, value) => {
    update = value;
    return { save: async () => {} };
  });
  const testEnvironment = {
    TIKTOK_APP_KEY: "test",
    TIKTOK_SERVICE_ID: "test",
    TIKTOK_APP_SECRET: "test-secret",
    TIKTOK_REDIRECT_URI: "https://example.test/callback",
    TIKTOK_TOKEN_ENCRYPTION_KEY: "a".repeat(64),
  };
  const priorEnvironment = Object.fromEntries(
    Object.keys(testEnvironment).map(key => [key, process.env[key]])
  );
  Object.assign(process.env, testEnvironment);
  t.after(() => {
    for (const [key, value] of Object.entries(priorEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  await saveTokenResponse({
    access_token: "access",
    refresh_token: "refresh",
    access_token_expire_in: Math.floor(Date.now() / 1000) + 3600,
    refresh_token_expire_in: Math.floor(Date.now() / 1000) + 7200,
    granted_scopes: ["seller.authorization.info", "seller.product.basic"],
  });
  assert.deepEqual(update.$set.scopes, ["seller.authorization.info", "seller.product.basic"]);
});
test("normalization preserves zero values, variations, missing stock and string IDs", () => {
  const [row] = productRows({ id: "12345678901234567890", title: "Test", status: "ACTIVATE", skus: [{ id: "2", seller_sku: " abc ", price: { tax_exclusive_price: "0.00", currency: "PHP" }, inventory: [{ quantity: 0 }, { quantity: 2 }], sales_attributes: [{ name: "Color", value_name: "Red" }] }] });
  assert.equal(row.tiktokProductId, "12345678901234567890"); assert.equal(row.normalizedSku, "ABC"); assert.equal(row.price, "0.00"); assert.equal(row.stock, 2); assert.deepEqual(row.variations, [{ name: "Color", value: "Red" }]);
  assert.equal(productRows({ id: "1", skus: [{ id: "2", inventory: [] }] })[0].stock, null);
  assert.equal(productRows({ id: "1" })[0].price, null);
});
test("product normalization preserves a TikTok variant or listing image", () => {
  assert.equal(productRows({ id: "p", main_images: [{ urls: ["https://example.test/listing.jpg"] }], skus: [{ id: "s" }] })[0].imageUrl, "https://example.test/listing.jpg");
  assert.equal(productRows({ id: "p", skus: [{ id: "s", sku_image: { url: "https://example.test/variant.jpg" } }] })[0].imageUrl, "https://example.test/variant.jpg");
});
test("SKU normalization ignores hyphen and dash characters", () => {
  assert.equal(normalizeSku(" 9000-0000 "), "90000000");
  assert.equal(normalizeSku("9000–0000"), "90000000");
  assert.equal(normalizeSku("9000—0000"), "90000000");
});
test("sync rejects a concurrent operation before making API requests", async t => {
  t.mock.method(Shop, "findOne", async () => ({ status: "connected" }));
  t.mock.method(Shop, "findOneAndUpdate", async () => null);
  await assert.rejects(syncProducts(), error => error.statusCode === 409);
});
test("full sync traverses pages, retrieves details, upserts snapshots, releases lock", async t => {
  const { encryptToken } = await import("../config/tiktok.js");
  const names = { TIKTOK_APP_KEY: "test", TIKTOK_APP_SECRET: "test-secret", TIKTOK_SERVICE_ID: "test", TIKTOK_REDIRECT_URI: "https://example.test/callback", TIKTOK_TOKEN_ENCRYPTION_KEY: "a".repeat(64), TIKTOK_API_BASE_URL: "https://example.test" };
  const prior = Object.fromEntries(Object.keys(names).map(k => [k, process.env[k]]));
  Object.assign(process.env, names);
  t.after(() => { for (const [k, v] of Object.entries(prior)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
  const shop = { status: "connected", shopId: "shop", shopCipher: "cipher", accessToken: encryptToken("fake-token"), accessTokenExpiresAt: new Date(Date.now() + 3600000) };
  t.mock.method(Shop, "findOne", () => ({ then: resolve => Promise.resolve(shop).then(resolve), select: async () => shop }));
  t.mock.method(Shop, "findOneAndUpdate", async () => shop);
  const shopUpdates = []; t.mock.method(Shop, "updateOne", async (...args) => { shopUpdates.push(args); return { matchedCount: 1 }; });
  const snapshots = []; t.mock.method(Mapping, "bulkWrite", async operations => { snapshots.push(...operations.filter(row => row.updateOne).map(row => row.updateOne)); return { matchedCount: 0 }; });
  t.mock.method(Mapping, "updateMany", async () => ({ modifiedCount: 0 }));
  t.mock.method(Mapping, "find", () => ({ lean: async () => [], select: () => ({ lean: () => ({ cursor: async function* () {} }) }) }));
  t.mock.method(ProductSyncLog, "create", async row => ({ ...row, save: async () => {} }));
  let searches = 0; let details = 0;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url.origin, "https://example.test");
    if (url.pathname.includes("authorization")) return reply({ code: 0, data: { shops: [{ id: "shop", name: "PH shop", region: "PH", cipher: "cipher" }] } });
    if (url.pathname.endsWith("search")) {
      searches++; assert.equal(options.method, "POST");
      assert.equal(url.searchParams.get("page_token"), searches === 1 ? null : "next");
      return reply({ code: 0, data: { products: [{ id: String(searches), title: "Test" }], next_page_token: searches === 1 ? "next" : "" } });
    }
    details++; return reply({ code: 0, data: { id: String(details), title: "Test", skus: [{ id: `sku${details}`, seller_sku: "ABC" }] } });
  });
  const result = await syncProducts();
  assert.equal(searches, 2); assert.equal(details, 2); assert.equal(result.count, 2);
  assert.equal(snapshots.length, 2); assert.equal(snapshots[0].upsert, true);
  assert.equal(snapshots[0].update.$set.capitalCostMinor, undefined);
  assert.ok(shopUpdates.at(-1)[1].$unset.syncOwner);
});

test("parameter validation failures identify safe fields and endpoints without exposing upstream messages", async () => {
  await assert.rejects(tiktokRequest("/finance/202309/withdrawals", {}, { ...deps, fetch: async () => reply({ code: 36009004, message: "CreateTimeGe is invalid, check validation rule is: $this > 0. private-token secret", request_id: "abcdef0123456789" }, 400) }), error => error.message.includes("create_time_ge") && error.message.includes("/finance/202309/withdrawals") && !error.message.includes("private-token") && !error.message.includes("secret") && error.apiDiagnostics.requestId === "abcdef0123456789");
});
