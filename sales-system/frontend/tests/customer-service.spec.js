import { test, expect } from "@playwright/test";
const id = "7494560109732334261";
const base = "/api/tiktok/customer-service";
async function fixture(page, { scope = "granted", role = "admin", uncertain = false, theme } = {}) {
  const user = { _id: "fixture-agent", name: "Test Agent", role };
  const conversation = { _id: "000000000000000000000001", conversationId: id, buyerName: "Maria Santos", preview: "Magkano po ito?", mode: "human", canSendMessage: true, unreadCount: 1, lastMessageAt: "2026-11-02T02:00:00Z" };
  let outbounds = uncertain ? [{ clientId: "fixture-uncertain", state: "unknown", text: "Hello buyer", createdAt: "2026-11-02T02:00:00Z", error: "Delivery is uncertain." }] : [];
  const messages = [{ messageId: "123", senderRole: "BUYER", type: "TEXT", text: "Magkano po ito?", sentAt: "2026-11-02T02:00:00Z" }];
  let verified = false; let sent = 0;
  await page.addInitScript(({ user, theme }) => { localStorage.setItem("rje_auth_token", "fixture"); localStorage.setItem("rje_auth_user", JSON.stringify(user)); if (theme) localStorage.setItem("rje-appearance", theme); }, { user, theme });
  await page.route("**/api/**", async route => {
    const req = route.request(); const path = new URL(req.url()).pathname;
    const status = { scope, readVerifiedAt: scope === "granted" ? "2026-11-02T02:00:00Z" : null, manualVerifiedAt: verified ? "2026-11-02T02:30:00Z" : null, settings: { enabled: false, productReplies: false, orderReplies: false, faqs: [] } };
    let json;
    if (path === "/api/auth/me") json = user;
    else if (path === "/api/settings") json = { currency: "PHP", timezone: "Asia/Manila", dateFormat: "DD/MM/YYYY" };
    else if (path === `${base}/status`) json = status;
    else if (path === `${base}/conversations`) json = { items: [conversation] };
    else if (path.endsWith("/messages")) json = { conversation, messages, outbounds };
    else if (path.endsWith("/replies")) {
      const body = req.postDataJSON(); sent++; outbounds = [{ ...body, state: "sent", messageId: "456" }]; json = outbounds[0];
    } else if (path.endsWith(`/${id}/sync`)) { if (outbounds[0]?.state === "sent") { verified = true; messages.push({ messageId: "456", text: outbounds[0].text, senderRole: "CUSTOMER_SERVICE", type: "TEXT", sentAt: "2026-11-02T02:30:00Z" }); } json = { nextPageToken: "" }; }
    else if (path === `${base}/settings`) json = req.postDataJSON();
    else json = {};
    await route.fulfill({ json });
  });
  return { sends: () => sent };
}

for (const width of [1440, 390]) for (const theme of ["light", "dark"]) {
  test(`customer service inbox, chat and settings at ${width}px in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 950 }); const api = await fixture(page, { theme });
    const errors = []; page.on("pageerror", e => errors.push(e.message));
    await page.goto("/tiktok/customer-service");
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(page.getByRole("heading", { name: "Customer Service", exact: true })).toBeVisible();
    await expect(page.getByText("Automation off", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: /Maria Santos/ }).click();
    await expect(page.getByLabel("Manual reply", { exact: false }).first()).toBeVisible();
    await page.locator("#cs-reply").fill("Salamat po! We can help with your inquiry.");
    await page.getByRole("button", { name: "Send reply", exact: true }).click();
    await expect(page.getByText("Salamat po! We can help with your inquiry.", { exact: true }).first()).toBeVisible();
    expect(api.sends()).toBe(1);
    await expect(page.getByRole("button", { name: "Send reply", exact: true })).toBeDisabled();
    await page.screenshot({ path: `test-results/customer-service-${theme}-${width}.png`, fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.getByRole("button", { name: "Automation settings", exact: true }).click();
    await expect(page.getByLabel("Enable automatic replies")).not.toBeChecked();
    await expect(page.getByLabel("Send a delivered-order follow-up", { exact: false })).not.toBeChecked();
    await expect(page.getByLabel("Send a delivered-order follow-up", { exact: false })).toBeDisabled();
    await expect(page.locator(".cs-followup-preview")).toContainText("honest review");
    await page.getByLabel("Enable automatic replies").check();
    await page.getByLabel("Send a delivered-order follow-up", { exact: false }).check();
    await page.getByRole("button", { name: "Add FAQ" }).click();
    await page.getByLabel("Keywords or phrases, separated by commas").fill("opening hours, oras");
    await page.getByLabel("English", { exact: true }).fill("Open daily.");
    await page.getByLabel("Tagalog", { exact: true }).fill("Bukas araw-araw.");
    await page.getByRole("button", { name: "Save settings", exact: true }).click();
    await expect(page.getByText("Automation settings saved.")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    expect(errors).toEqual([]);
  });
}

test("missing scope offers reauthorization and locks verification/automation", async ({ page }) => {
  await fixture(page, { scope: "missing" }); await page.goto("/tiktok/customer-service");
  await expect(page.getByText("Seller authorization needs updating")).toBeVisible();
  await expect(page.getByRole("button", { name: "Reauthorize shop" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Verify access" })).toBeDisabled();
  await page.getByRole("button", { name: "Automation settings", exact: true }).click();
  await expect(page.getByLabel("Enable automatic replies")).toBeDisabled();
  await expect(page.getByLabel("Send a delivered-order follow-up", { exact: false })).toBeDisabled();
});

test("uncertain delivery disables the composer and never triggers a resend", async ({ page }) => {
  const api = await fixture(page, { uncertain: true }); await page.goto("/tiktok/customer-service");
  await page.getByRole("button", { name: /Maria Santos/ }).click();
  await expect(page.getByText("Delivery uncertain · automatic resend blocked")).toBeVisible();
  await expect(page.locator("#cs-reply")).toBeDisabled(); expect(api.sends()).toBe(0);
});

test("staff can inspect message history but cannot send replies", async ({ page }) => {
  await fixture(page, { role: "staff" }); await page.goto("/tiktok/customer-service");
  await page.getByRole("button", { name: /Maria Santos/ }).click();
  await expect(page.getByText("Your account has read-only access.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send reply", exact: true })).toHaveCount(0);
});
