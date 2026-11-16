// The launcher, the bar and open on start (docs/NAVIGATION.md), against the real hub. The bar's pins and the home are
// one settings note in the home vault: the person changes them by long-press, their agent by writing that note. A home
// applet set only by a write opens on start after the person's own tap, never by itself.
import { expect, test, type Page } from "@playwright/test";
import { ui } from "./helpers";
import { api, hubState, VAULT } from "./hub";

test.use({ storageState: "e2e/.signed-in.json" });

const idOf = async (path: string) => (await api(hubState(), "GET", `notes?id=${encodeURIComponent(path)}`)).id as string;
const appletFrame = (page: Page) => page.frameLocator("iframe.applet-frame");
const bar = (page: Page) => page.getByRole("navigation", { name: "Bar" });
async function settingsNotes() {
  const rows = await api(hubState(), "GET", "notes?tag=parachute-settings&include_metadata=true");
  return (Array.isArray(rows) ? rows : rows.notes ?? []) as { id: string; path: string; metadata: { parachute?: { bar?: unknown[]; start?: unknown } } }[];
}
/** What a chat AI with the Parachute MCP would write: the settings note, created or replaced. */
async function writeSettings(parachute: Record<string, unknown>) {
  const [n] = await settingsNotes();
  if (n) await api(hubState(), "PATCH", `notes/${n.id}`, { metadata: { parachute }, if_updated_at: (await api(hubState(), "GET", `notes/${n.id}`)).updatedAt });
  else await api(hubState(), "POST", "notes", { path: "Parachute/Settings", content: "settings", tags: ["parachute-settings"], metadata: { parachute } });
}
test.afterEach(async () => { for (const n of await settingsNotes()) await api(hubState(), "DELETE", `notes/${n.id}`); });

/** A start of the app: a new tab's first entry, on the launcher's address. */
async function start(page: Page) {
  await page.goto("about:blank");
  await page.goto("/");
}

test("with no home set, the app opens on the launcher: every applet, with what changed lately", async ({ page }) => {
  await start(page);
  await expect(page).toHaveURL(/\/$/);
  const entries = ui(page).getByRole("list", { name: `Applets in ${VAULT}` });
  await expect(entries.getByRole("link", { name: /Recipe box/ })).toBeVisible();
  // the newest recipe it opens, and when
  await expect(entries.getByRole("link", { name: /Recipe box/ })).toContainText(/(Rice and beans|Tomato toast), today/);
  await expect(bar(page).getByRole("link", { name: /Launcher/ })).toHaveAttribute("aria-current", "page");
});

test("a long-press pins an applet to the bar; the pin is the settings note's, survives a restart, and taps start it", async ({ page }) => {
  await start(page);
  await ui(page).getByRole("link", { name: /Recipe box/ }).click({ button: "right" });
  await ui(page).getByRole("button", { name: "Pin to the bar" }).click();
  await expect(bar(page).getByRole("link", { name: /Recipe box/ })).toBeVisible();
  const [n] = await settingsNotes();
  expect(n.path).toBe("Parachute/Settings");
  expect(n.metadata.parachute?.bar).toEqual([{ vault: VAULT, applet: "Applets/Recipes" }]);
  await expect(ui(page).getByRole("link", { name: /Recipe box/ })).toContainText("pinned");
  // a restart: still there
  await start(page);
  await expect(bar(page).getByRole("link", { name: /Recipe box/ })).toBeVisible();
  // a tap on it opens the applet, with the bar still at the foot; it asks first, as any applet does
  await bar(page).getByRole("link", { name: /Recipe box/ }).click();
  await expect(page.getByRole("region", { name: /asking for access/ })).toBeVisible();
  await page.getByRole("button", { name: "Allow" }).click();
  await expect(appletFrame(page).getByRole("heading", { name: "Recipe box" })).toBeVisible();
  await expect(bar(page).getByRole("link", { name: /Recipe box/ })).toHaveAttribute("aria-current", "page");
  // Back returns where the person came from: the launcher
  await page.getByRole("button", { name: "Back" }).click();
  await expect(ui(page).getByRole("list", { name: `Applets in ${VAULT}` })).toBeVisible();
});

test("the agent changes the bar by writing the settings note; the bar's long-press moves and unpins", async ({ page }) => {
  await writeSettings({ bar: [{ vault: VAULT, applet: "Applets/Cook mode" }, { vault: VAULT, applet: await idOf("Applets/Recipes") }, { vault: VAULT, applet: "Applets/Gone" }] });
  await start(page);
  // in the note's order; a place this device can't find is left out
  await expect(bar(page).getByRole("link")).toHaveText([/Launcher/, /Cook mode/, /Recipe box/]);
  await bar(page).getByRole("link", { name: /Recipe box/ }).click({ button: "right" });
  await page.getByRole("button", { name: "Move left" }).click();
  await expect(bar(page).getByRole("link")).toHaveText([/Launcher/, /Recipe box/, /Cook mode/]);
  await bar(page).getByRole("link", { name: /Cook mode/ }).click({ button: "right" });
  await page.getByRole("button", { name: "Unpin" }).click();
  await expect(bar(page).getByRole("link")).toHaveText([/Launcher/, /Recipe box/]);
  const [n] = await settingsNotes();
  expect((n.metadata.parachute?.bar as { applet: string }[]).map((p) => p.applet)).toEqual([await idOf("Applets/Recipes"), "Applets/Gone"]);
});

test("a home written only into the note opens on start after the person's tap, and by itself from then on", async ({ page }) => {
  await writeSettings({ start: { vault: VAULT, applet: "Applets/Recipes" } });
  await start(page);
  // the applet's screen, not the launcher: never allowed here, so its card; nothing runs
  await expect(page).toHaveURL(new RegExp(`/v/${VAULT}/a/`));
  await expect(page.getByText("Your settings open Recipe box when the app starts.")).toBeVisible();
  await expect(page.getByRole("region", { name: /asking for access/ })).toBeVisible();
  await expect(page.locator("iframe.applet-frame")).toHaveCount(0);
  await expect(bar(page).getByRole("link", { name: /Home/ })).toHaveAttribute("aria-current", "page");
  await page.getByRole("button", { name: "Allow" }).click();
  await expect(appletFrame(page).getByRole("heading", { name: "Recipe box" })).toBeVisible();
  // the next start opens it, running, with no card and no tap
  await start(page);
  await expect(appletFrame(page).getByRole("heading", { name: "Recipe box" })).toBeVisible();
  await expect(page.getByText("Your settings open")).toHaveCount(0);
  // the first screen of a start: Back goes to the launcher, not out of the app
  await page.getByRole("button", { name: "Back" }).click();
  await expect(ui(page).getByRole("list", { name: `Applets in ${VAULT}` })).toBeVisible();
});

test("hostile: a home the note retargets to another allowed applet waits for a tap; changed code asks again", async ({ page }) => {
  // the person allowed Cook mode (an ordinary tap from the vault), and chose Recipe box as home here
  await page.goto(`/v/${VAULT}`);
  await ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name: /Cook mode/ }).click();
  await page.getByRole("button", { name: "Allow" }).click();
  await expect(page.locator("iframe.applet-frame")).toHaveCount(1);
  await writeSettings({ start: { vault: VAULT, applet: "Applets/Recipes" } });
  await start(page);
  await page.getByRole("button", { name: "Allow" }).click();
  await expect(appletFrame(page).getByRole("heading", { name: "Recipe box" })).toBeVisible();
  // the agent (or anyone who can write the note) points the home at Cook mode: allowed, but not chosen here
  await writeSettings({ start: { vault: VAULT, applet: "Applets/Cook mode" } });
  await start(page);
  await expect(page.getByText("Your settings open Cook mode when the app starts.")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Open Cook mode$/ })).toBeVisible();
  await expect(page.locator("iframe.applet-frame")).toHaveCount(0);
  // back to Recipe box, whose code then changes: its card again, nothing runs
  await writeSettings({ start: { vault: VAULT, applet: "Applets/Recipes" } });
  const id = await idOf("Applets/Recipes");
  const note = await api(hubState(), "GET", `notes/${id}`);
  await api(hubState(), "PATCH", `notes/${id}`, { content: `${note.content}\n<!-- changed -->`, if_updated_at: note.updatedAt });
  try {
    await start(page);
    await expect(page.getByRole("region", { name: /asking for access/ })).toBeVisible();
    await expect(page.locator("iframe.applet-frame")).toHaveCount(0);
  } finally {
    const now = await api(hubState(), "GET", `notes/${id}`);
    await api(hubState(), "PATCH", `notes/${id}`, { content: note.content, if_updated_at: now.updatedAt });
  }
});

test("hostile: a frame can't pin or set a home without a tap", async ({ page }) => {
  await start(page);
  await expect(ui(page).getByRole("list", { name: `Applets in ${VAULT}` })).toBeVisible();
  const id = await idOf("Applets/Recipes");
  // the built-in frame's bridge, called from its own window with no tap
  const said = await page.frameLocator("iframe.app-frame").locator("body").evaluate(async (_, id) => {
    const ask = (method: string, params: unknown) => new Promise((res) => {
      const rid = `x${Math.random()}`;
      addEventListener("message", (e) => { const m = e.data as { id?: string; error?: string }; if (m?.id === rid) res(m.error ?? "ok"); });
      parent.postMessage({ pf: 1, id: rid, method, params }, "*");
    });
    return [await ask("home.pin", { vault: "kitchen", noteId: id, on: true }), await ask("home.start", { vault: "kitchen", noteId: id })];
  }, id);
  expect(said).toEqual(["not_allowed", "not_allowed"]);
  expect(await settingsNotes()).toEqual([]);
});
