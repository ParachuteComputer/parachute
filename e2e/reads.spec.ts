// Reads at once (T-476, "it keeps taking very long to load things"). An applet opened again shows what it read before at
// once, from the copy the app kept of those reads (src/vault/readCache.ts), while the hub is asked behind it; when the
// hub's answer differs, the applet draws it (the kit's Page, onRefresh). And a folder's records with their words are one
// ask, not one per record in a line (modules/vault.ts `list`).
import { expect, test } from "./test";
import { api, hubState, record, VAULT } from "./hub";
import { ui } from "./helpers";
import { appletRecord } from "../applets/record.ts";

test.use({ storageState: "e2e/.signed-in.json" });

/** How long every read of the hub is held, once the hub is "slow". */
const HELD_MS = 4000;

test("an applet opened again draws what it read before at once, then the hub's newer answer; a folder's words are one ask", async ({ page }) => {
  const stamp = Date.now().toString(36);
  const made: string[] = [];
  const note = await record(hubState(), "create", appletRecord("journal"));
  made.push(note.id);
  const entries: { id: string }[] = [];
  for (let i = 0; i < 6; i++) entries.push(await api(hubState(), "POST", "notes", { path: `Journal/2026/11-0${i + 1}/07-1${i} Entry ${i} ${stamp}`, tags: ["journal"], content: `Entry ${i} ${stamp}: the words of the day.` }));
  made.push(...entries.map((e) => e.id));
  try {
    // the first open: the hub is asked. Journal's entries with their words come in one ask, never one per entry
    const perEntry: string[] = [];
    page.on("request", (r) => { if (r.method() === "GET" && entries.some((e) => r.url().includes(e.id))) perEntry.push(r.url()); });
    await page.goto(`/v/${VAULT}?with=vault`);
    await ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name: /Journal/ }).click();
    await page.getByRole("button", { name: "Allow" }).click();
    const app = page.frameLocator("iframe.applet-frame");
    await expect(app.getByText(`Entry 5 ${stamp}: the words of the day.`)).toBeVisible();
    await expect(app.getByText(`Entry 0 ${stamp}: the words of the day.`)).toBeVisible();
    expect(perEntry, "each entry read on its own").toEqual([]);

    // someone (an agent) changes an entry; then the hub is slow: every read waits HELD_MS
    await api(hubState(), "PATCH", `notes/${entries[5].id}`, { content: `Entry 5 ${stamp}: changed by an agent.`, force: true });
    const hub = hubState().origin;
    await page.route(`${hub}/**`, async (route) => {
      if (route.request().method() === "GET") await new Promise((r) => setTimeout(r, HELD_MS));
      await route.continue().catch(() => {});
    });
    // the app opened again: Journal waits for its Open (a start without a tap runs nothing), drawn from the copies
    const t0 = Date.now();
    await page.reload();
    await page.getByRole("button", { name: /^Open Journal/ }).click({ timeout: HELD_MS - 500 });
    await expect(app.getByText(`Entry 0 ${stamp}: the words of the day.`)).toBeVisible({ timeout: HELD_MS - 500 - (Date.now() - t0) });
    // what it read before, while the hub is asked
    await expect(app.getByText(`Entry 5 ${stamp}: the words of the day.`)).toBeVisible();
    // the hub's answer comes, and differs: Journal draws it
    await expect(app.getByText(`Entry 5 ${stamp}: changed by an agent.`)).toBeVisible({ timeout: 4 * HELD_MS });
    await expect(app.getByText(`Entry 5 ${stamp}: the words of the day.`)).toHaveCount(0);
  } finally {
    await page.unrouteAll({ behavior: "ignoreErrors" });
    for (const id of made) await api(hubState(), "DELETE", `notes/${id}`).catch(() => {});
  }
});

test("a record opened again in Vault draws what it read before at once, then the hub's newer answer", async ({ page }) => {
  const stamp = Date.now().toString(36);
  const note = await api(hubState(), "POST", "notes", { path: `Shelf notes/Read once ${stamp}`, content: `First words ${stamp}.` });
  try {
    // the record opened in Vault once (Parachute's own: no card, it runs at once)
    await page.goto(`/v/${VAULT}/n/${note.id}`);
    await expect(page).toHaveURL(new RegExp(`/a/[^/?]+\\?vault=${VAULT}&record=${note.id}`));
    const app = page.frameLocator("iframe.applet-frame");
    await expect(app.getByText(`First words ${stamp}.`)).toBeVisible();
    const at = page.url();
    // an agent changes it; the hub is slow
    await api(hubState(), "PATCH", `notes/${note.id}`, { content: `Second words ${stamp}.`, force: true });
    await page.route(`${hubState().origin}/**`, async (route) => {
      if (route.request().method() === "GET") await new Promise((r) => setTimeout(r, HELD_MS));
      await route.continue().catch(() => {});
    });
    const t0 = Date.now();
    await page.goto(at);
    await expect(app.getByText(`First words ${stamp}.`)).toBeVisible({ timeout: HELD_MS - 500 - (Date.now() - t0) });
    await expect(app.getByText(`Second words ${stamp}.`)).toBeVisible({ timeout: 4 * HELD_MS });
  } finally {
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await api(hubState(), "DELETE", `notes/${note.id}`).catch(() => {});
  }
});
