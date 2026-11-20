// The thin shell (docs/NAVIGATION.md, docs/design/APP-RECORD.md): the app does what the open app's record says and
// little else. It opens on the record's home, the bar is the record's pins (then Applets, the app's one way to the
// rest), and the list at `/` is the app's applets, not the vaults. A record that doesn't load, or a home that throws,
// never locks the person out: the plain list, a calm line, and Settings.
import { expect, test, type Page } from "@playwright/test";
import { ui } from "./helpers";
import { api, hubState, record, VAULT } from "./hub";

test.use({ storageState: "e2e/.signed-in.json" });

const bar = (page: Page) => page.getByRole("navigation", { name: "Bar" });
const applet = (page: Page) => page.frameLocator("iframe.applet-frame");
type Row = { id: string; path: string; metadata: Record<string, any> };
const tagged = async (tag: string) => { const r = await api(hubState(), "GET", `notes?tag=${tag}&include_metadata=true`); return (Array.isArray(r) ? r : r.notes ?? []) as Row[]; };
const made: string[] = [];
const tidy = async () => {
  for (const t of ["parachute-settings", "parachute-bundle", "parachute-app"]) for (const n of await tagged(t)) await api(hubState(), "DELETE", `notes/${n.id}`);
  for (const id of made.splice(0)) await api(hubState(), "DELETE", `notes/${id}`).catch(() => {});
};
// before too: a spec before this one may have left a settings note (each test writes its own)
test.beforeEach(tidy);
test.afterEach(tidy);
async function start(page: Page) { await page.goto("about:blank"); await page.goto("/"); }
async function app(fields: Record<string, unknown>, id = "table") {
  await api(hubState(), "POST", "notes", { path: `Parachute/Bundles/${id}`, content: "an app", tags: ["parachute-bundle"], metadata: { bundle: { contract: 1, id, name: "Table", ...fields } } });
  await api(hubState(), "POST", "notes", { path: "Parachute/Settings", content: "settings", tags: ["parachute-settings"], metadata: { parachute: { bundle: id } } });
}
const RECIPES = { vault: VAULT, applet: "Applets/Recipes" }, COOK = { vault: VAULT, applet: "Applets/Cook mode" };

test("a bundle record naming a home opens on it", async ({ page }) => {
  await app({ sources: [{ vault: VAULT, applet: "*" }], start: COOK, bar: [RECIPES] });
  await start(page);
  await expect(page).toHaveURL(new RegExp(`/v/${VAULT}/a/`));
  // its card: a home named only by a record runs nothing by itself
  await expect(page.getByRole("region", { name: /asking for access/ })).toContainText("Cook mode");
});

test("the bar is the record's pins, in its order, then Applets: nothing else of the shell's", async ({ page }) => {
  await app({ sources: [{ vault: VAULT, applet: "*" }], start: RECIPES, bar: [COOK] });
  await page.goto("/settings");
  const names = async () => (await bar(page).getByRole("link").allInnerTexts()).map((n) => n.split("\n").map((x) => x.trim()).filter(Boolean)[1]);
  await expect.poll(names).toEqual(["Cook mode", "Applets"]);
  // pinned in the other order: the bar follows
  const [rec] = await tagged("parachute-bundle");
  await api(hubState(), "PATCH", `notes/${rec.id}`, { metadata: { bundle: { ...rec.metadata.bundle, bar: [COOK, RECIPES] } }, if_updated_at: (await api(hubState(), "GET", `notes/${rec.id}`)).updatedAt });
  await page.goto("/settings");
  await expect.poll(names).toEqual(["Cook mode", "Recipe box", "Applets"]);
});

test("the list is the app's applets, not the vaults: no chapters, no vault links; vaults are in Settings", async ({ page }) => {
  await app({ sources: [{ vault: VAULT, applet: "Applets/Recipes" }] });
  await page.goto("/settings");
  await bar(page).getByRole("link", { name: /Applets/ }).click();
  await expect(page).toHaveURL(/\/$/);
  const list = ui(page).getByRole("list", { name: "Applets" });
  await expect(list.getByRole("link", { name: /Recipe box/ })).toBeVisible();
  await expect(list.getByRole("link", { name: /Cook mode/ })).toHaveCount(0);
  await expect(ui(page).getByRole("region", { name: VAULT, exact: true })).toHaveCount(0);
  await expect(ui(page).getByRole("link", { name: "Open the vault" })).toHaveCount(0);
  // the vault itself: from Settings
  await ui(page).getByRole("link", { name: "Settings" }).click();
  await page.getByRole("link", { name: `Open ${VAULT}` }).click();
  await expect(page).toHaveURL(new RegExp(`/v/${VAULT}$`));
});

test("a way back: a record that doesn't load gives the plain list, a calm line and Settings", async ({ page }) => {
  // the settings note names an app whose record is malformed (a contract that isn't a number)
  await api(hubState(), "POST", "notes", { path: "Parachute/Bundles/broken", content: "an app", tags: ["parachute-bundle"], metadata: { bundle: { contract: "one", id: "broken", name: "Broken", start: COOK } } });
  await api(hubState(), "POST", "notes", { path: "Parachute/Settings", content: "settings", tags: ["parachute-settings"], metadata: { parachute: { bundle: "broken" } } });
  await start(page);
  await expect(ui(page).getByText("Your bundle didn't load")).toBeVisible();
  const list = ui(page).getByRole("list", { name: "Applets" });
  await expect(list.getByRole("link", { name: /Recipe box/ })).toBeVisible();
  await expect(list.getByRole("link", { name: /Cook mode/ })).toBeVisible();
  await ui(page).getByRole("link", { name: "Settings" }).first().click();
  await expect(page.getByRole("heading", { name: "Your bundle" })).toBeVisible();
});

test("a record made for a newer Parachute gives the plain list and says to update (docs/design/VERSIONS.md)", async ({ page }) => {
  await api(hubState(), "POST", "notes", { path: "Parachute/Bundles/later", content: "an app", tags: ["parachute-bundle"], metadata: { bundle: { contract: 1, needs: 99, id: "later", name: "Later", start: COOK } } });
  await api(hubState(), "POST", "notes", { path: "Parachute/Settings", content: "settings", tags: ["parachute-settings"], metadata: { parachute: { bundle: "later" } } });
  await start(page);
  await expect(ui(page).getByText("Update Parachute to use Later.")).toBeVisible();
  await expect(ui(page).getByText("Your bundle didn't load")).toHaveCount(0);
  await expect(ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name: /Recipe box/ })).toBeVisible();
  // nothing of it started: no Cook mode at the start
  await expect(page.locator("iframe.applet-frame")).toHaveCount(0);
});

test("a way back: a home applet that throws still leaves the bar, the list and Settings", async ({ page }) => {
  const thrower = await record(hubState(), "create", { path: "Applets/Thrower", extension: "tsx", tags: ["applet"],
    fields: { applet: { contract: 2, id: "thrower", name: "Thrower", glyph: "!" } },
    body: "throw new Error(\"the home broke\");\nexport default function Thrower() { return null; }\n" }) as { id: string };
  made.push(thrower.id);
  await app({ sources: [{ vault: VAULT, applet: "*" }], start: { vault: VAULT, applet: "Applets/Thrower" }, bar: [{ vault: VAULT, applet: "Applets/Thrower" }] });
  await start(page);
  await page.getByRole("button", { name: "Allow" }).click();
  await expect(page.locator("iframe.applet-frame")).toHaveCount(1);
  await bar(page).getByRole("link", { name: /Applets/ }).click();
  await expect(ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name: /Thrower/ })).toBeVisible();
  await ui(page).getByRole("link", { name: "Settings" }).first().click();
  await expect(page.getByRole("heading", { name: "Your bundle" })).toBeVisible();
});

test("trust: an unsigned record grants nothing and runs nothing; only home, pins and the list change", async ({ page }) => {
  // what an agent might write: a home, plus fields that would grant, approve, lower the level or carry code
  await app({ sources: [{ vault: VAULT, applet: "*" }], start: RECIPES, bar: [RECIPES, COOK],
    security: { approve: "nothing" }, grants: [{ applet: "Applets/Recipes", allow: "all" }], approved: true,
    approvals: [{ record: "Applets/Recipes", approved: true }], code: "<script>alert(1)</script>", frame: "vault:Frames/Mine" });
  await start(page);
  // the home opens, and asks: the record's "grants" and "approved" are words it doesn't read
  await expect(page.getByRole("region", { name: /asking for access/ })).toContainText("Recipe box");
  await expect(page.locator("iframe.applet-frame")).toHaveCount(0);
  // the pin also asks, as any applet does
  await bar(page).getByRole("link", { name: /Cook mode/ }).click();
  await expect(page.getByRole("region", { name: /asking for access/ })).toContainText("Cook mode");
  await expect(page.locator("iframe.applet-frame")).toHaveCount(0);
  // nothing on this device was granted by it
  expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => /grant/i.test(k)).map((k) => localStorage.getItem(k)).join(""))).not.toMatch(/Recipes|Cook/);
  // the built-in frame shows the list: the record's "frame" ran nothing of its own
  await bar(page).getByRole("link", { name: /Applets/ }).click();
  await expect(ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name: /Recipe box/ })).toBeVisible();
  await expect(applet(page).locator("body")).toHaveCount(0);
});

test("a way back: an address that doesn't decode leaves the app working, Settings too", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Your bundle" })).toBeVisible();
  // in the app (a link, a deep link): the server never sees it
  const go = (to: string) => page.evaluate((u) => { history.pushState({}, "", u); dispatchEvent(new PopStateEvent("popstate")); }, to);
  await go("/v/%/a/x");
  await page.waitForTimeout(500);
  await go("/settings");
  await expect(page.getByRole("heading", { name: "Your bundle" })).toBeVisible();
  expect(errors.filter((m) => /URI/.test(m))).toEqual([]);
});
