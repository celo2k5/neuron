import { expect, test, type Page } from "@playwright/test";

/**
 * Acceptance flow on a live localnet stack. Each step uses the real UI, real API, real
 * Postgres, real worker and a real solana-test-validator. Nothing is mocked.
 */
test.describe.configure({ mode: "serial" });

let page: Page;
const errors: string[] = [];
const state: { modelId?: string; experimentId?: string; localOutput?: string[] } = {};

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await ctx.addInitScript(() => { try { sessionStorage.setItem("neuron.booted", "1"); } catch { /* */ } });
  page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
});

test("1. app loads with the live hero computation", async () => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /INTELLIGENCE/ })).toBeVisible();
  await expect(page.locator("main canvas").first()).toBeVisible();
  await expect(page.getByText(/^#000[1-9]/)).toBeVisible();
  expect(errors).toEqual([]);
});

test("2–3. seeded generation is deterministic, a different seed is distinct", async () => {
  const hashOf = async () => (await page.getByTestId("generator-hashes").locator("button").nth(1).getAttribute("title"))!;
  const shape = async () => (await page.getByTestId("config-form").getByText(/^resolved/).textContent())!;
  await page.goto("/generator");
  const seed = page.getByTestId("seed-input");
  await seed.fill("acceptance-A");
  const a1 = await hashOf(); const s1 = await shape();
  await seed.fill("acceptance-B");
  const b = await hashOf(); const sb = await shape();
  await page.reload();
  await page.getByTestId("seed-input").fill("acceptance-A");
  const a2 = await hashOf();
  expect(a1).toMatch(/^[0-9a-f]{64}$/);
  expect(a2).toBe(a1);
  expect(b).not.toBe(a1);
  expect(sb).not.toBe(s1); // different seed → different topology, not just weights
});

test("7. connect the dev wallet and sign in with a signed challenge", async () => {
  await page.goto("/lab");
  await page.getByTestId("wallet-button").click();
  await page.getByTestId("dev-wallet").click();
  await page.getByTestId("sign-in").click();
  await expect(page.getByTestId("credits-available")).toBeVisible();
  await page.getByTestId("wallet-button").click();
});

test("4–5. inspect a neuron and an edge; inference output equals the server's", async () => {
  await page.goto("/lab");
  await page.getByTestId("seed-input").fill("acceptance-lab");
  await page.getByTestId("save-model").click();
  await page.waitForURL(/\/lab\?model=M-/);
  state.modelId = new URL(page.url()).searchParams.get("model")!;
  await expect(page.getByTestId("network-facts")).toContainText(state.modelId);
  // keyboard inspection on the canvas
  const canvas = page.locator("[data-testid=lab] canvas").first();
  await canvas.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("neuron-detail")).toContainText(":1.");
  await page.getByTestId("experiment-panel").getByRole("button", { name: "manual", exact: true }).click();
  await page.getByTestId("manual-input").fill("0.25, -0.75");
  await page.getByTestId("save-experiment").check();
  await page.getByTestId("run-experiment").click();
  await expect(page.getByTestId("output-values").locator("li").first()).toBeVisible();
  const local = await page.getByTestId("output-values").locator("li span:last-child").allTextContents();
  expect(local.length).toBeGreaterThan(0);
  state.localOutput = local;
  await page.getByTestId("saved-run").getByText("completed").waitFor();
  await page.getByTestId("saved-run").getByRole("link", { name: /open experiment/ }).click();
  await page.waitForURL(/\/experiments\//);
  state.experimentId = page.url().split("/").pop()!;
  const server = await page.getByTestId("server-output").locator("li span:last-child").allTextContents();
  expect(server).toEqual(local); // browser engine and server worker computed identical values
});

test("reproduce: the same pinned version on the same input matches", async () => {
  await page.getByTestId("reproduce").click();
  await page.waitForURL((u) => !u.pathname.endsWith(state.experimentId!));
  await expect(page.getByTestId("repro-result")).toContainText(/Bit-identical|within tolerance/);
});

test("8. buy credits with local-validator test tokens; credits reconcile once", async () => {
  await page.goto("/token");
  await page.getByTestId("wallet-button").click();
  await page.getByRole("button", { name: "airdrop 2 sol" }).click();
  await expect(page.getByText("airdropped 2 SOL")).toBeVisible();
  await page.getByRole("button", { name: "mint test $NEURON" }).click();
  await expect(page.getByText(/minted 1000 test \$NEURON/)).toBeVisible();
  await page.getByTestId("wallet-button").click();
  await page.reload();
  await expect(page.getByTestId("token-balance")).toContainText("1000");
  await page.getByTestId("create-intent").click();
  await expect(page.getByTestId("payment-review")).toContainText("10 credits");
  await page.getByTestId("approve-payment").click();
  await expect(page.getByTestId("intents")).toContainText("confirmed", { timeout: 60_000 });
  await expect(page.getByTestId("token-balance")).toContainText("990");
});

test("register a community neuron (credits consumed, new network version)", async () => {
  await page.goto("/community");
  const before = Number((await page.getByTestId("community-facts").locator("dd").first().textContent())!.match(/v(\d+)/)![1]);
  await page.getByTestId("register-neuron").getByRole("button", { name: "register…" }).click();
  await page.getByTestId("confirm-register").click();
  await expect(page.getByText(/Registered nrn_/)).toBeVisible();
  await expect(page.getByTestId("community-facts")).toContainText(`v${before + 1}`);
  await page.getByTestId("community-run").click();
});

test("6. train on the server: weights change, metrics and checkpoints recorded", async () => {
  await page.goto(`/lab?model=${state.modelId}`);
  await page.getByRole("button", { name: "training" }).click();
  await page.getByTestId("training-panel").getByRole("button", { name: "train on neuron", exact: true }).click();
  await page.getByTestId("training-panel").getByLabel("epochs").fill("60");
  await page.getByTestId("server-train").click();
  await page.getByTestId("confirm-train").click();
  await expect(page.getByTestId("training-panel").getByText("completed")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId("checkpoints")).toContainText("v2");
  const delta = await page.getByTestId("training-metrics").locator("dd").last().textContent();
  expect(Number(delta!.replace("%", ""))).toBeLessThan(0); // validation loss went down vs. before training
  await page.getByTestId("checkpoints").getByRole("button", { name: "load" }).last().click();
  await expect(page.getByTestId("network-facts")).toContainText(/v[2-9]/);
});

test("9. commit the experiment on-chain and verify it", async () => {
  await page.goto(`/experiments/${state.experimentId}`);
  await page.getByTestId("commit").click();
  await expect(page.getByTestId("verification")).toContainText("verified", { timeout: 60_000 });
  await expect(page.getByTestId("verification")).toContainText("stored hashes recompute");
  await page.goto("/ledger");
  await expect(page.getByTestId("ledger-table")).toContainText(state.experimentId!.slice(0, 8));
});

test("10. state survives a reload (persisted models, versions, history)", async () => {
  await page.goto(`/networks/${state.modelId}`);
  await expect(page.getByText("checkpoint").first()).toBeVisible();
  await page.goto("/experiments");
  await expect(page.getByTestId("experiments-table")).toContainText(state.experimentId!.slice(0, 8));
  expect(errors).toEqual([]);
});
