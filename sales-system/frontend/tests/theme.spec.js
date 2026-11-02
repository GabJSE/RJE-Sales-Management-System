import { test, expect } from "@playwright/test";
const settings = { _id: "fixture-settings", businessName: "Test Shop", address: "", email: "", contactNumber: "", currency: "PHP", dateFormat: "DD/MM/YYYY", timezone: "Asia/Manila", defaultDashboardPeriod: "month", lowStockThreshold: 5, enableLowStockAlerts: true };
const user = { _id: "fixture-user", name: "Test Admin", role: "admin", email: "admin@example.test" };
const product = { _id: "fixture-product", title: "Test Helmet", sellerSku: "HELMET-1", status: "ACTIVE", stock: 3, capitalCost: 200, currency: "PHP", price: 450, variations: [] };
const earning = { _id: "fixture-earning", transactionId: "3748821283448915211", transactionDate: "2026-11-01T02:00:00Z", amount: 9360.29, type: "SETTLE", status: "SUCCESS", reconciliationStatus: "unmatched" };
const statement = { _id: "fixture-statement", statementId: "TEST-STATEMENT", settlementDate: "2026-11-01T02:00:00Z", netSettlement: 500, totalCapitalCost: 300, calculatedProfit: 200, orderCount: 1, reconciliationStatus: "reconciled", sourceTotals: { paymentStatus: "PAID" } };
async function fixtures(page, authenticated = true) {
  await page.addInitScript(({ authenticated, user }) => { if (authenticated) { localStorage.setItem("rje_auth_token", "fixture-token"); localStorage.setItem("rje_auth_user", JSON.stringify(user)); } }, { authenticated, user });
  await page.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() !== "GET") return route.fulfill({ status: 405, json: { message: "Read-only fixture: mutations disabled" } });
    const data = path === "/api/auth/me" ? user : path === "/api/settings" ? settings
      : path === "/api/dashboard" ? { trend: [{ date: "2026-10-31", totalRevenue: 700, netProfit: 150 }, { date: "2026-11-01", totalRevenue: 1000, netProfit: 300 }] }
      : path === "/api/tiktok/finance/earnings" ? { earnings: [earning], total: 9360.29 }
      : path === "/api/tiktok/finance/earnings/fixture-earning" ? { earning, settlements: [] }
      : path === "/api/tiktok/finance/settlements" ? { settlements: [statement] }
      : path === "/api/tiktok/finance/settlements/fixture-statement" ? { settlement: statement, transactions: [] }
      : path === "/api/tiktok/finance/overview" ? { statementCount: 1, reconciledStatementCount: 1, netSettlement: 500, netProfit: 200, capitalCost: 300, profitMargin: 40 }
      : path === "/api/tiktok/products" ? { products: [product], page: 1, pages: 1, total: 1 }
      : path === "/api/tiktok/orders" ? { orders: [], statuses: [], pages: 1, total: 0 }
      : path === "/api/tiktok/reviews" ? { reviews: [], pages: 1, total: 0 }
      : path === "/api/tiktok/sync/jobs" ? { jobs: [] }
      : path === "/api/backups" ? { status: "No backup", collections: [], history: [], instructions: { backup: "Fixture instructions", restore: "Fixture instructions" } }
      : path === "/api/users" ? [user] : { logs: [], earnings: [], settlements: [], backups: [], collections: [] };
    return route.fulfill({ json: data });
  });
}
for (const width of [1440, 768, 390]) for (const theme of ["light", "dark"]) {
  test(`${theme} pages and drawers at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 950 }); await page.addInitScript(value => localStorage.setItem("rje-appearance", value), theme); await fixtures(page);
    const errors = []; page.on("pageerror", error => { errors.push(error.message); console.error(page.url(), error.message); });
    for (const path of ["/dashboard", "/tiktok/orders", "/tiktok/products", "/tiktok/settlements", "/reports", "/settings", "/tiktok/reviews", "/users", "/backup"]) {
      await page.goto(path);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(page.locator("h1").first()).toBeVisible();
      await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
      await page.evaluate(() => document.fonts.ready);
      await expect(page.locator("body")).toHaveCSS("background-color", theme === "dark" ? "rgb(11, 18, 32)" : "rgb(245, 247, 251)");
      expect(await page.evaluate(() => document.fonts.check('14px "Inter Variable"'))).toBe(true);
      const display = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth, background: getComputedStyle(document.body).backgroundColor, font: getComputedStyle(document.body).fontFamily }));
      expect(display.overflow, path).toBe(false); expect(display.font).toContain("Inter Variable");
      expect(display.background).toBe(theme === "dark" ? "rgb(11, 18, 32)" : "rgb(245, 247, 251)");
      if (["/dashboard", "/tiktok/products", "/tiktok/settlements", "/settings"].includes(path)) await page.screenshot({ path: `test-results/${theme}-${width}-${path.split("/").at(-1)}.png`, fullPage: true });
      if (theme === "dark") {
        const bright = await page.evaluate(() => [...document.querySelectorAll('main *, aside *')].filter(element => {
          if (!element.getClientRects().length || element.tagName === "IMG") return false;
          const bg = getComputedStyle(element).backgroundColor.match(/[\d.]+/g)?.map(Number);
          return bg && bg.length >= 3 && (bg[3] ?? 1) > .9 && Math.min(...bg.slice(0,3)) > 210;
        }).map(element => `${element.tagName}.${element.className}`).slice(0,10));
        expect(bright, path).toEqual([]);
      }
      if (path === "/tiktok/products") {
        await page.getByRole("button", { name: "View Test Helmet, Default variant" }).click();
        await expect(page.getByRole("dialog")).toBeVisible();
        await expect(page.getByRole("dialog")).toHaveCSS("background-color", theme === "dark" ? "rgb(23, 32, 51)" : "rgb(255, 255, 255)");
        const bg = await page.getByRole("dialog").evaluate(el => getComputedStyle(el).backgroundColor);
        expect(bg).toBe(theme === "dark" ? "rgb(23, 32, 51)" : "rgb(255, 255, 255)");
        await page.keyboard.press("Escape");
      }
      if (path === "/settings") {
        await expect(page.locator(".appearance-card .theme-switch")).toHaveAttribute("aria-checked", theme === "dark" ? "true" : "false");
        await page.getByLabel("Business name", { exact: true }).fill("Unsaved fixture draft");
        await page.getByRole("tab", { name: "Security", exact: true }).click();
        await expect(page.getByRole("dialog")).toHaveCSS("background-color", theme === "dark" ? "rgb(23, 32, 51)" : "rgb(255, 255, 255)");
        await page.getByRole("button", { name: "Discard Changes", exact: true }).click();
        for (const name of ["TikTok Shop Integration", "Security"]) await page.getByRole("tab", { name, exact: true }).click();
      }
      if (path === "/dashboard") {
        await page.locator(".drf-trigger").click();
        await expect(page.getByRole("dialog")).toHaveCSS("background-color", theme === "dark" ? "rgb(23, 32, 51)" : "rgb(255, 255, 255)");
        const bounds = await page.getByRole("dialog").boundingBox();
        expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
        await page.keyboard.press("Escape");
      }
      if (path === "/tiktok/settlements") {
        for (const index of [0, 1]) {
          await page.getByRole("button", { name: "View Details", exact: true }).nth(index).click();
          await expect(page.getByRole("dialog")).toBeVisible();
          await expect(page.getByRole("dialog")).toHaveCSS("background-color", theme === "dark" ? "rgb(23, 32, 51)" : "rgb(255, 255, 255)");
          await page.keyboard.press("Escape");
        }
      }
      if (path === "/tiktok/reviews") {
        await page.getByRole("button", { name: "Add review", exact: true }).click();
        await expect(page.getByRole("dialog")).toBeVisible();
      }
    }
    expect(errors).toEqual([]);
  });
}
test("sidebar and Settings switches sync immediately and persist after refresh", async ({ page }) => {
  await fixtures(page); await page.emulateMedia({ colorScheme: "light" }); await page.goto("/settings");
  const sidebar = page.locator(".sidebar .theme-switch"); const appearance = page.locator(".appearance-card .theme-switch");
  await expect(sidebar).toHaveAttribute("aria-checked", "false");
  await appearance.click(); await expect(sidebar).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("rje-appearance"))).toBe("dark");
  await page.reload(); await expect(sidebar).toHaveAttribute("aria-checked", "true");
  await sidebar.focus(); await page.keyboard.press("Space");
  await expect(appearance).toHaveAttribute("aria-checked", "false");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "Dashboard", exact: true }).click();
  await expect(sidebar).toHaveAttribute("aria-checked", "false");
});
test("sidebar header, scrolling footer and collapse control remain contained", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 700 }); await fixtures(page); await page.goto("/dashboard");
  const sidebar = page.locator(".sidebar"); const collapse = page.getByRole("button", { name: "Collapse sidebar" });
  await expect(collapse).toBeVisible();
  const [sideBox, collapseBox] = await Promise.all([sidebar.boundingBox(), collapse.boundingBox()]);
  expect(collapseBox.x).toBeGreaterThanOrEqual(sideBox.x); expect(collapseBox.x + collapseBox.width).toBeLessThanOrEqual(sideBox.x + sideBox.width);
  expect(collapseBox.width).toBeGreaterThanOrEqual(36); expect(collapseBox.height).toBeGreaterThanOrEqual(36);
  await expect(sidebar.locator(".sidebar-footer")).toBeVisible();
  expect(await sidebar.locator("nav").evaluate(node => getComputedStyle(node).overflowY)).toBe("auto");
  await collapse.click(); await expect(sidebar).toHaveClass(/collapsed/); await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
  await expect(sidebar.locator(".account-avatar")).toBeVisible(); await expect(sidebar.locator(".sidebar-logout")).toBeVisible();
});
test("initial document sets the saved theme before React executes", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("rje-appearance", "dark"));
  await page.emulateMedia({ colorScheme: "light" });
  await page.route("**/src/main.jsx", route => route.abort());
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("#root")).toBeEmpty();
});
test("semantic text and button colors maintain AA contrast", async ({ page }) => {
  await fixtures(page); await page.goto("/settings");
  for (const theme of ["light", "dark"]) {
    const current = await page.locator("html").getAttribute("data-theme");
    if (current !== theme) await page.locator(".appearance-card .theme-switch").click();
    const ratios = await page.evaluate(() => {
      const css = getComputedStyle(document.documentElement);
      const luminance = name => {
        const hex = css.getPropertyValue(`--rje-${name}`).trim();
        const rgb = hex.slice(1).match(/../g).map(value => parseInt(value,16)/255).map(value => value <= .04045 ? value/12.92 : ((value+.055)/1.055)**2.4);
        return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;
      };
      return [["ink","surface"],["muted","surface"],["muted","canvas"],["accent-text","selected"],["success","success-bg"],["warning","warning-bg"],["danger","danger-bg"],["on-accent","accent"]].map(([text,bg]) => {
        const [a,b] = [luminance(text),luminance(bg)].sort((x,y)=>y-x); return { text,bg,ratio:(a+.05)/(b+.05) };
      });
    });
    for (const pair of ratios) expect(pair.ratio, `${theme}: ${pair.text} on ${pair.bg}`).toBeGreaterThanOrEqual(4.5);
  }
});
test("login follows system theme; reduced motion disables transitions", async ({ page }) => {
  await fixtures(page, false); await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" }); await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await page.locator(".login-card").evaluate(el => getComputedStyle(el).backgroundColor)).toBe("rgb(23, 32, 51)");
  expect(await page.locator("input").first().evaluate(el => getComputedStyle(el).transitionDuration)).toBe("0s");
  await page.getByRole("switch", { name: "Switch to light mode" }).click(); await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});
