// docs/ACCESS.md proposal 5: an applet that reaches across vaults reaches only the vaults the person ticks for it. On
// the real hub's three vaults (kitchen, the home; letters; pantry), in the web build: Parachute's own Vault with its line
// and sheet, on a device without the key (the pick kept there) and on two devices with one key (the pick signed into the
// home vault, so the second follows it); and a test applet with a card, whose ticks decide what it reaches, and which
// is refused pantry through `vaults` and `sharing`. The second lock (every word, each call) is src/shell/vaultPick.test.ts.
import { readFileSync } from "node:fs";
import { devices, expect, test, type Browser, type Page } from "@playwright/test";
import { api, hubState, mintToken, record, VAULT } from "./hub";
import { newKey } from "./keys";

test.use({ storageState: "e2e/.signed-in.json" });
const REACH = readFileSync(new URL("./fixtures/pick/Reach.tsx", import.meta.url), "utf8");
const { defaultBrowserType: _b, ...phone } = devices["Pixel 7"];
const vaultApplet = `/v/${VAULT}/a/parachute%3Avault`;
const frame = (page: Page) => page.frameLocator('iframe.applet-frame');
const line = (page: Page) => page.locator("p.pick-line");
const sheet = (page: Page) => page.getByRole("dialog", { name: /^Which vaults may .* reach\?$|^Where does .* keep its notes\?$/ });

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
  for (const [vault, on] of Object.entries(set)) await sheet(page).getByRole("checkbox", { name: new RegExp(`^${vault}\\b`) }).or(sheet(page).getByRole("radio", { name: new RegExp(`^${vault}\\b`) })).setChecked(on);
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
  await expect(line(b)).toContainText("Vault reaches no vault here until you pick its vaults again");
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

test("an applet allowed with a pick and a section of Settings stays allowed when Settings reads its approval (review: Settings hashed without the pick)", async ({ browser }) => {
  test.setTimeout(150_000);
  const page = await device(browser, newKey());
  const made = await record(hubState(), "create", { path: "Applets/Glancer", extension: "tsx", tags: ["applet"], body: "export default function G() { return <main><p id=\"g\">glancing</p></main>; }\n",
    fields: { applet: { contract: 2, id: "glancer-test", name: "Glancer", glyph: "◇", note: "a test applet", access: [], screens: [{ id: "home", name: "Glancer" }] }, app: ["vaults"], settings: { name: "A glance across", screen: "home" } } });
  try {
    await page.goto(`/v/${VAULT}/a/${made.id}`);
    const card = page.getByRole("region", { name: /is asking for access/ });
    await card.getByRole("checkbox", { name: /^letters\b/ }).check();
    await card.getByRole("button", { name: "Allow" }).click();
    await expect(frame(page).locator("#g")).toHaveText("glancing");
    // the pick changed afterwards (a newer approval than this device's grant): pantry too
    await page.locator("header.bar").getByRole("button", { name: "Menu" }).click();
    await page.getByRole("button", { name: "Vaults it reaches" }).click();
    await pick(page, { pantry: true });
    await expect(frame(page).locator("#g")).toHaveText("glancing");
    // Settings checks the signed approval, with the pick in its hash: its section shows, and the grant stays
    await page.goto("/settings");
    await expect(page.getByRole("region", { name: "A glance across" }).frameLocator("iframe").locator("#g")).toHaveText("glancing", { timeout: 20_000 });
    await page.waitForTimeout(2000);
    await page.goto(`/v/${VAULT}/a/${made.id}`);
    // still allowed: no card, only the Open a load (not a tap) waits behind
    await page.getByRole("button", { name: "Open Glancer" }).click();
    await expect(page.getByRole("region", { name: /is asking for access/ })).toHaveCount(0);
    await expect(frame(page).locator("#g")).toHaveText("glancing");
  } finally {
    await api(hubState(), "DELETE", `notes/${made.id}`).catch(() => {});
    await page.context().close();
  }
});

// Journal and Capture keep their notes in one vault: a pick of one, among the person's own vaults (the next step of
// proposal 5). Home's line into Inbox/ is Capture's inbox, so it follows Capture.
test("Journal keeps its notes in the vault you pick: the line names the home; picked letters, a line written lands there, and it opens there from then on", async ({ browser }) => {
  test.setTimeout(150_000);
  const stamp = Date.now().toString(36);
  const page = await device(browser);
  const letters = { origin: hubState().origin, token: mintToken("vault:letters:write") };
  const inLetters = async () => ((await api(letters, "GET", `notes?path_prefix=${encodeURIComponent("Journal/")}&include_content=true&limit=100`, undefined, "letters")) as { id: string; content?: string }[]).filter((n) => n.content?.includes(stamp));
  try {
    await page.goto(`/v/${VAULT}/a/parachute%3Ajournal`);
    await expect(line(page)).toContainText(`Journal keeps its notes in ${VAULT}`);
    await line(page).getByRole("button", { name: "Change" }).click();
    await expect(sheet(page)).toHaveAccessibleName("Where does Journal keep its notes?");
    await expect(sheet(page).getByRole("radio", { name: new RegExp(`^${VAULT}\\b`) })).toBeChecked();
    await pick(page, { letters: true });
    await expect(page).toHaveURL(/\/v\/letters\/a\/parachute%3Ajournal/);
    const app = frame(page);
    await app.getByLabel("Write in your journal").fill(`Kept in letters ${stamp}.`);
    await app.getByRole("button", { name: "Save" }).click();
    await expect(app.getByText(`Kept in letters ${stamp}.`)).toBeVisible();
    await expect.poll(async () => (await inLetters()).length).toBe(1);
    const inKitchen = ((await api(hubState(), "GET", `notes?path_prefix=${encodeURIComponent("Journal/")}&include_content=true&limit=100`)) as { content?: string }[]).filter((n) => n.content?.includes(stamp));
    expect(inKitchen).toEqual([]);
    // opened from the home's address (the bar, the list): it goes where its notes are
    await page.goto(`/v/${VAULT}/a/parachute%3Ajournal`);
    await expect(page).toHaveURL(/\/v\/letters\/a\/parachute%3Ajournal/);
    // an address naming another vault and a note that isn't there doesn't move it either (review: ?note= skipped the pick)
    await page.goto(`/v/pantry/a/parachute%3Ajournal?note=01KA3Z9V6B2W8XQJ4M7N5P0R1S`);
    await expect(page).toHaveURL(/\/v\/letters\/a\/parachute%3Ajournal/);
    // nor does a note there that isn't Journal's; a journal note there opens where it is (written before, it stays)
    const pantry = { origin: hubState().origin, token: mintToken("vault:pantry:write") };
    const recipe = await api(pantry, "POST", "notes", { path: `Recipes/Soup ${stamp}`, content: "soup" }, "pantry") as { id: string };
    const old = await api(pantry, "POST", "notes", { path: `Journal/2026/11-01/08-00 Older ${stamp}`, tags: ["journal"], content: `Older ${stamp}` }, "pantry") as { id: string };
    try {
      await page.goto(`/v/pantry/a/parachute%3Ajournal?note=${recipe.id}`);
      await expect(page).toHaveURL(/\/v\/letters\/a\/parachute%3Ajournal/);
      await page.goto(`/v/pantry/a/parachute%3Ajournal?note=${old.id}`);
      await expect(frame(page).getByRole("heading", { name: "Journal" })).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`/v/pantry/a/parachute%3Ajournal\\?note=${old.id}`));
    } finally {
      for (const id of [recipe.id, old.id]) await api(pantry, "DELETE", `notes/${id}`, undefined, "pantry").catch(() => {});
    }
  } finally {
    for (const n of await inLetters()) await api(letters, "DELETE", `notes/${n.id}`, undefined, "letters").catch(() => {});
    await page.context().close();
  }
});

test("Capture picked into letters: Home's line into Inbox/ lands in letters too", async ({ browser }) => {
  test.setTimeout(150_000);
  const stamp = Date.now().toString(36);
  const page = await device(browser);
  const at = (vault: string) => (vault === VAULT ? hubState() : { origin: hubState().origin, token: mintToken(`vault:${vault}:write`) });
  const inbox = async (vault: string) => ((await api(at(vault), "GET", `notes?path_prefix=${encodeURIComponent("Inbox/")}&include_content=true&limit=100`, undefined, vault)) as { id: string; content?: string }[]).filter((n) => n.content?.includes(stamp));
  try {
    // Home's line into Inbox/ adds in the home while Capture keeps its notes there
    await page.goto(`/v/${VAULT}/a/parachute%3Ahome`);
    await frame(page).getByLabel("Write something down").fill(`At home first ${stamp}`);
    await frame(page).getByRole("button", { name: "Save" }).click();
    await expect(frame(page).getByText(/Saved to Inbox|Not saved/)).toHaveText(/Saved to Inbox/);
    await expect.poll(async () => (await inbox(VAULT)).length).toBe(1);
    await page.goto(`/v/${VAULT}/a/parachute%3Acapture`);
    await line(page).getByRole("button", { name: "Change" }).click();
    await pick(page, { letters: true });
    await expect(page).toHaveURL(/\/v\/letters\/a\/parachute%3Acapture/);
    await page.goto(`/v/${VAULT}/a/parachute%3Ahome`);
    const app = frame(page);
    await app.getByLabel("Write something down").fill(`Into the inbox ${stamp}`);
    await app.getByRole("button", { name: "Save" }).click();
    await expect(app.getByText(/Saved to Inbox|Not saved/)).toHaveText(/Saved to Inbox/);
    await expect.poll(async () => (await inbox("letters")).length).toBe(1);
    // the one written before stays in the home; nothing new lands there
    expect((await inbox(VAULT)).length).toBe(1);
    // Capture's vault not on this device (kept here as a pick of a vault it doesn't hold): Capture says so, and Home's
    // line adds nowhere, never in the home meanwhile
    await page.evaluate((hub) => { const all = JSON.parse(localStorage.getItem("parachute.picks.v1") ?? "{}"); for (const k of Object.keys(all)) if (k.endsWith("|parachute:capture")) all[k] = [{ hub, vault: "attic" }]; localStorage.setItem("parachute.picks.v1", JSON.stringify(all)); }, new URL(hubState().origin).origin);
    await page.goto(`/v/${VAULT}/a/parachute%3Acapture`);
    await expect(page.getByText("Capture keeps its notes in attic, which isn't on this device yet.")).toBeVisible();
    await page.goto(`/v/${VAULT}/a/parachute%3Ahome`);
    await app.getByLabel("Write something down").fill(`Nowhere ${stamp}`);
    await app.getByRole("button", { name: "Save" }).click();
    await expect(app.getByText(/Saved to Inbox|Not saved/)).toHaveText(/Not saved/);
    expect((await inbox(VAULT)).length).toBe(1);
  } finally {
    for (const n of await inbox("letters")) await api(at("letters"), "DELETE", `notes/${n.id}`, undefined, "letters").catch(() => {});
    for (const n of await inbox(VAULT)) await api(hubState(), "DELETE", `notes/${n.id}`).catch(() => {});
    await page.context().close();
  }
});
