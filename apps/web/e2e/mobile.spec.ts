import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => { await page.addInitScript(() => { try { sessionStorage.setItem("neuron.booted", "1"); } catch { /* */ } }); });

test("mobile: stacked layout, no horizontal scroll, touch graph", async ({ page }) => {
  for (const path of ["/", "/lab", "/networks", "/community", "/credits"]) {
    await page.goto(path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${path} scrolls sideways`).toBeLessThanOrEqual(1);
  }
  await page.goto("/lab");
  await expect(page.locator("[data-testid=lab] canvas").first()).toBeVisible();
  await page.getByRole("button", { name: "menu" }).click();
  await expect(page.getByRole("navigation", { name: "Mobile" })).toBeVisible();
});

test("reduced motion: boot sequence is skipped and reveals are static", async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: "reduce" });
  const p = await ctx.newPage();
  await p.goto("/");
  await expect(p.getByText("click or press any key to skip")).toHaveCount(0);
  expect(await p.locator('[data-reveal="pending"]').count()).toBe(0);
  await ctx.close();
});
