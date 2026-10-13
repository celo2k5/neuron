import { expect, test, type Browser, type Page } from "@playwright/test";

/**
 * /admin end to end: an admin wallet edits settings and a second, unrelated visitor sees them
 * change on an already-open page, without reloading (SSE → config refetch).
 * The server must run with ADMIN_PASSWORD = E2E_ADMIN_PASSWORD (default "test-admin-password").
 */
test.describe.configure({ mode: "serial" });

async function adminPage(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await ctx.addInitScript(() => { try { sessionStorage.setItem("neuron.booted", "1"); } catch { /* */ } });
  const page = await ctx.newPage();
  await page.goto("/admin");
  await page.locator("#admin-pw").fill("wrong-password");
  await page.getByRole("button", { name: "Enter" }).click();
  await expect(page.getByText("Wrong password.")).toBeVisible();
  await page.locator("#admin-pw").fill(process.env.E2E_ADMIN_PASSWORD ?? "test-admin-password");
  await page.getByRole("button", { name: "Enter" }).click();
  await expect(page.getByTestId("quick-launch")).toContainText("Go live on mainnet");
  await page.getByTestId("advanced").locator("summary").click();
  return page;
}
const field = (p: Page, key: string) => p.getByTestId(`setting-${key}`);

test("admin edits apply live for every visitor, are audited, and mainnet stays gated", async ({ browser }) => {
  const admin = await adminPage(browser);
  await expect(admin.getByRole("heading", { name: "Control room." })).toBeVisible();
  // the simple form refuses a non-mainnet RPC before changing anything
  await admin.getByTestId("ql-rpc").fill("http://127.0.0.1:1");
  await admin.getByTestId("ql-mint").fill("So11111111111111111111111111111111111111112");
  await admin.getByTestId("ql-treasury").fill("So11111111111111111111111111111111111111112");
  await admin.getByTestId("ql-go").click();
  await expect(admin.getByTestId("quick-launch")).toContainText("https://");
  await expect(admin.getByTestId("readiness")).toContainText("$NEURON mint set and exists on chain");

  // a visitor with /credits already open
  const vctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await vctx.addInitScript(() => { try { sessionStorage.setItem("neuron.booted", "1"); } catch { /* */ } });
  const visitor = await vctx.newPage();
  await visitor.goto("/credits");
  await expect(visitor.getByRole("status")).toHaveCount(0);

  const banner = `Scheduled maintenance at 21:00 UTC (${Date.now() % 10000})`;
  await field(admin, "SITE_BANNER").getByRole("textbox").fill(banner);
  await expect(field(admin, "SITE_BANNER")).toContainText("Saved · live everywhere");
  await expect(visitor.getByRole("status")).toContainText(banner, { timeout: 8000 }); // no reload

  await field(admin, "DAILY_CLAIM_CREDITS").getByRole("textbox").fill("42");
  await expect(field(admin, "DAILY_CLAIM_CREDITS")).toContainText("Saved · live everywhere");
  await expect(visitor.getByText(/claim 42 free credits a day/)).toBeVisible({ timeout: 8000 });

  // validation happens before anything is saved
  await field(admin, "NEURON_MINT").getByRole("textbox").fill("not-an-address");
  await expect(field(admin, "NEURON_MINT")).toContainText("Not a Solana address.");

  // change log records who changed what
  await expect(admin.getByTestId("admin-audit")).toContainText("DAILY_CLAIM_CREDITS");
  // go-live refuses while checks fail
  await admin.locator("#golive").fill("GO MAINNET");
  await expect(admin.getByTestId("go-live")).toBeDisabled();

  // restore defaults
  await field(admin, "NEURON_MINT").getByRole("textbox").fill("");
  for (const k of ["SITE_BANNER", "DAILY_CLAIM_CREDITS"]) {
    await field(admin, k).getByRole("button", { name: "reset" }).click();
    await expect(field(admin, k)).toContainText("Saved · live everywhere");
  }
  await expect(visitor.getByRole("status")).toHaveCount(0, { timeout: 8000 });
});

test("non-admins are kept out", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/admin");
  await expect(page.getByTestId("admin-login")).toBeVisible();
  const r = await page.request.patch("/api/admin/settings", { data: { key: "SITE_BANNER", value: "x" } });
  expect(r.status()).toBe(401);
});
