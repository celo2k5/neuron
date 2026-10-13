import { expect, test, type Browser, type Page } from "@playwright/test";

/**
 * /admin end to end: an admin wallet edits settings and a second, unrelated visitor sees them
 * change on an already-open page, without reloading (SSE → config refetch).
 * The server must run with ADMIN_WALLETS containing ADMIN below (see README, "Admin").
 */
const ADMIN = "14BGX7Knx1pJrMnQGdmxDykxFEzkMghYVqsBSTzppbFX"; // deterministic test-only dev key, localnet
const ADMIN_SECRET = "99uqd56BHxksGD8TMFFMLMQdt2aHjfQS8wDVYbbNT3kvgBD1HQuyaf6YfexbNxfk9PKM7T1qViU7QdWaS78pHeH";
test.describe.configure({ mode: "serial" });

async function adminPage(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await ctx.addInitScript(([k]) => {
    try { sessionStorage.setItem("neuron.booted", "1"); localStorage.setItem("neuron.devwallet.v1", k); } catch { /* */ }
  }, [ADMIN_SECRET]);
  const page = await ctx.newPage();
  await page.goto("/admin");
  await page.getByTestId("wallet-button").click();
  await page.getByTestId("dev-wallet").click();
  await page.getByTestId("sign-in").click();
  await expect(page.getByTestId("credits-available")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.reload();
  return page;
}
const field = (p: Page, key: string) => p.getByTestId(`setting-${key}`);

test("admin edits apply live for every visitor, are audited, and mainnet stays gated", async ({ browser }) => {
  const admin = await adminPage(browser);
  await expect(admin.getByRole("heading", { name: "Control room." })).toBeVisible();
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
  await expect(page.getByText("Connect an admin wallet")).toBeVisible();
  const r = await page.request.patch("/api/admin/settings", { data: { key: "SITE_BANNER", value: "x" } });
  expect(r.status()).toBe(401);
});
