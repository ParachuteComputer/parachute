// docs/ACCESS.md proposal 5: an applet that reaches across vaults reaches only the vaults the person ticks for it. On
// the real hub's three vaults (kitchen, the home; letters; pantry), in the web build: Parachute's own Vault with its line
// and sheet, on a device without the key (the pick kept there) and on two devices with one key (the pick signed into the
// home vault, so the second follows it); and a test applet with a card, whose ticks decide what it reaches, and which
// is refused pantry through `vaults` and `sharing`. The second lock (every word, each call) is src/shell/vaultPick.test.ts.
import { readFileSync } from "node:fs";
import { devices, expect, test, type Browser, type Page } from "@playwright/test";
import { api, hubState, record, VAULT } from "./hub";
import { newKey } from "./keys";

test.use({ storageState: "e2e/.signed-in.json" });
const REACH = readFileSync(new URL("./fixtures/pick/Reach.tsx", import.meta.url), "utf8");
const { defaultBrowserType: _b, ...phone } = devices["Pixel 7"];
const vaultApplet = `/v/${VAULT}/a/parachute%3Avault`;
const frame = (page: Page) => page.frameLocator('iframe.applet-frame');
const line = (page: Page) => page.locator("p.pick-line");
const sheet = (page: Page) => page.getByRole("dialog", { name: /^Vaults .* reaches$/ });

/** A device with no picks kept on it (the shared start ticked every vault for Parachute's own): `key`, the person's. */
async function device(browser: Browser, key?: string): Promise<Page> {
  const ctx = await browser.newContext({ ...phone, storageState: "e2e/.signed-in.json" });
  await ctx.addInitScript(() => { if (window === window.top && !sessionStorage.getItem("picks-cleared")) { localStorage.removeItem("parachute.picks.v1"); sessionStorage.setItem("picks-cleared", "1"); } });
  if (key) await ctx.addInitScript((k) => { if (window === window.top) (window as unknown as { __parachuteE2EKey: string }).__parachuteE2EKey = k; }, key);
  const page = await ctx.newPage();
  // applets run once this device's self-test has passed (a new device runs it first)
  await page.goto("/settings");
  await expect(page.getByRole("status").filter({ hasText: /approved code only|run sealed/ })).toBeVisible({ timeout: 45_000 });
  return page;
}

/** Tick (or untick) vaults on the shell's sheet, then Save: a press counts only once the sheet has settled. */
async function pick(page: Page, set: Record<string, boolean>) {
  await expect(sheet(page)).toBeVisible();
  for (const [vault, on] of Object.entries(set)) await sheet(page).getByRole("checkbox", { name: new RegExp(`^${vault}\\b`) }).setChecked(on);
  await page.waitForTimeout(800);
  await sheet(page).getByRole("button", { name: "Save" }).click();
  await expect(sheet(page)).toHaveCount(0);
}

/** The vault list Vault shows (one vault: it opens straight into it, so there is no list). */
const vaultList = (page: Page) => frame(page).getByRole("region", { name: "Vaults" });

const tagged = async (tag: string) => { const r = await api(hubState(), "GET", `notes?tag=${tag}&include_metadata=true`); return (Array.isArray(r) ? r : r.notes ?? []) as { id: string; path: string }[]; };
test.afterEach(async () => {
  for (const n of await tagged("parachute-approval")) if (/\/parachute:|\/Reach|Approvals\/[^/]+\/kitchen\/[0-9A-Z]{26}$/.test(n.path)) await api(hubState(), "DELETE", `notes/${n.id}`);
});

test("Vault, on a device without the key, reaches the home only, says so on one line, and reaches letters once it is ticked there, never pantry", async ({ browser }) => {
  test.setTimeout(120_000);
  const page = await device(browser);
  await page.goto(vaultApplet);
  // the line, over Vault: what it reaches, and Change; it doesn't block Vault, which opens on the home
  await expect(line(page)).toContainText(`Vault reaches ${VAULT}`);
  await expect(frame(page).getByRole("heading", { name: VAULT }).first()).toBeVisible();
  await expect(vaultList(page)).toHaveCount(0);
  await line(page).getByRole("button", { name: "Change" }).click();
  // every vault on the hub is offered; the home is ticked
  await expect(sheet(page).getByRole("checkbox", { name: new RegExp(`^${VAULT}\\b`) })).toBeChecked();
  await expect(sheet(page).getByRole("checkbox", { name: /^pantry\b/ })).not.toBeChecked();
  await pick(page, { letters: true });
  // Vault starts again on its pick: kitchen and letters, not pantry
  await expect(vaultList(page).getByRole("listitem")).toHaveCount(2);
  await expect(vaultList(page)).toContainText("letters");
  await expect(vaultList(page)).not.toContainText("pantry");
  await expect(line(page)).toHaveCount(0);
  // kept on this device: a reload keeps it
  await page.reload();
  await expect(vaultList(page).getByRole("listitem")).toHaveCount(2);
  // a way in to a vault it wasn't given (Home's count of changes leads there) says so, and offers to add it
  await page.goto(`${vaultApplet}?vault=pantry&show=changes`);
  await expect(line(page)).toContainText("pantry isn't one of Vault's vaults");
  await expect(line(page).getByRole("button", { name: "Add" })).toBeVisible();
  await page.context().close();
});

test("with the person's key: a pick is signed into the home vault, a second device follows it, and taking a vault out holds at once", async ({ browser }) => {
  test.setTimeout(150_000);
  const key = newKey();
  const a = await device(browser, key);
  await a.goto(vaultApplet);
  // a device with the key reads only signed picks: none yet, so the home only (whatever this device kept before)
  await expect(line(a)).toContainText(`Vault reaches ${VAULT}`);
  await line(a).getByRole("button", { name: "Change" }).click();
  await pick(a, { letters: true });
  await expect(vaultList(a).getByRole("listitem")).toHaveCount(2);
  // signed after the device unlock, and kept in the home vault beside the applets' approvals
  expect(await a.evaluate(() => (window as unknown as { __parachuteE2EApprovals?: string[] }).__parachuteE2EApprovals)).toContain("Vault");
  await expect.poll(async () => (await tagged("parachute-approval")).some((n) => n.path.endsWith("/parachute:vault"))).toBe(true);

  // a second device with the same key: Vault on kitchen and letters, with no line
  const b = await device(browser, key);
  await b.goto(vaultApplet);
  await expect(vaultList(b).getByRole("listitem")).toHaveCount(2);
  await expect(vaultList(b)).toContainText("letters");
  await expect(line(b)).toHaveCount(0);

  // someone without the key (an AI with a write key to the home) deletes the approval: the second device, which saw it,
  // doesn't fall back to the home; it reaches nothing until a pick is signed again. The first keeps its own signed copy
  for (const n of await tagged("parachute-approval")) if (n.path.endsWith("/parachute:vault")) await api(hubState(), "DELETE", `notes/${n.id}`);
  await b.reload();
  await expect(line(b)).toContainText("Vault reaches no vault here: the vaults you gave it couldn't be confirmed");
  await expect(frame(b).getByRole("heading", { name: VAULT })).toHaveCount(0);
  await a.reload();
  await expect(vaultList(a).getByRole("listitem")).toHaveCount(2);

  // the first takes letters out: it leaves the open Vault at once
  await a.locator("header.bar").getByRole("button", { name: "Menu" }).click();
  await a.getByRole("button", { name: "Vaults it reaches" }).click();
  await pick(a, { letters: false });
  await expect(vaultList(a)).toHaveCount(0);
  await expect(frame(a).getByRole("heading", { name: VAULT }).first()).toBeVisible();
  // and the second, opened again, follows the newest approval
  await b.reload();
  await expect(frame(b).getByRole("heading", { name: VAULT }).first()).toBeVisible();
  await expect(vaultList(b)).toHaveCount(0);
  await a.context().close(); await b.context().close();
});

test("an applet with a card: ticks on its card decide what it reaches; pantry, unticked, is refused through vaults and sharing, and recent reads only what was ticked", async ({ browser }) => {
  test.setTimeout(150_000);
  const made = await record(hubState(), "create", { path: "Applets/Reach", extension: "tsx", body: REACH, tags: ["applet"],
    fields: { applet: { contract: 2, id: "reach-test", name: "Reach", glyph: "◇", access: [{ vault: "here", allow: [{ path: "Reach/", verbs: ["read"] }] }] }, app: ["vaults", "sharing", "recent"] } });
  const page = await device(browser);
  try {
    await page.goto(`/v/${VAULT}/a/${made.id}`);
    const card = page.getByRole("region", { name: /is asking for access/ });
    await expect(card).toBeVisible();
    // its card says it reaches only the vaults you give it, and asks which: the home (its own vault too) ticked
    await expect(card).toContainText("the vaults you give it");
    await expect(card.getByRole("group", { name: "Which vaults may it reach?" })).toBeVisible();
    await expect(card.getByRole("checkbox", { name: new RegExp(`^${VAULT}\\b`) })).toBeChecked();
    await card.getByRole("checkbox", { name: /^letters\b/ }).check();
    await card.getByRole("button", { name: "Allow" }).click();
    const reached = frame(page).getByRole("list", { name: "What it reached" });
    await expect(reached).toContainText(`given: ${VAULT}, letters`);
    await expect(reached).toContainText("pantry query: refused (not one of the vaults you gave it)");
    await expect(reached).toContainText("pantry access: refused (not one of the vaults you gave it)");
    await expect(reached).toContainText(/recent from: (kitchen|letters)/);
    await expect(reached).not.toContainText(/recent from: .*pantry/);
  } finally {
    await api(hubState(), "DELETE", `notes/${made.id}`).catch(() => {});
    await page.context().close();
  }
});
