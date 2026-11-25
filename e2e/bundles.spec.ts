// A bundle is a record (docs/design/APP-RECORD.md): Parachute/Bundles/<id> in the home vault says which applets the launcher
// offers (one applet, a whole vault, a whole hub), and its bar. Listing runs nothing: an offered applet still asks.
// The settings note's `bundle` (and `app`, its older name) names the one a device opens; a pin made in it goes to the record.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "./test";
import { ui } from "./helpers";
import { api, hubState, VAULT } from "./hub";

test.use({ storageState: "e2e/.signed-in.json" });

const bar = (page: Page) => page.getByRole("navigation", { name: "Bar" });
type Row = { id: string; path: string; metadata: Record<string, any> };
const tagged = async (tag: string) => { const r = await api(hubState(), "GET", `notes?tag=${tag}&include_metadata=true`); return (Array.isArray(r) ? r : r.notes ?? []) as Row[]; };
test.afterEach(async () => { for (const t of ["parachute-settings", "parachute-bundle", "parachute-app"]) for (const n of await tagged(t)) await api(hubState(), "DELETE", `notes/${n.id}`); });
async function start(page: Page) { await page.goto("about:blank"); await page.goto("/"); }

test("a bundle record offers only its sources; its bar is its own; a pin in it goes to the record", async ({ page }) => {
  await api(hubState(), "POST", "notes", { path: "Parachute/Bundles/kitchen-table", content: "an app", tags: ["parachute-bundle"], metadata: { bundle: {
    contract: 1, id: "kitchen-table", name: "Kitchen table", sources: [{ vault: VAULT, applet: "Applets/Recipes" }], bar: [{ vault: VAULT, applet: "Applets/Recipes" }] } } });
  await api(hubState(), "POST", "notes", { path: "Parachute/Settings", content: "settings", tags: ["parachute-settings"], metadata: { parachute: { bundle: "kitchen-table", bar: [] } } });
  await start(page);
  const entries = ui(page).getByRole("list", { name: "Applets" });
  await expect(entries.getByRole("link", { name: /Recipe box/ })).toBeVisible();
  await expect(entries.getByRole("link", { name: /Cook mode/ })).toHaveCount(0);
  await expect(bar(page).getByRole("link", { name: /Recipe box/ })).toBeVisible();
  // listed is not allowed: it still asks
  await bar(page).getByRole("link", { name: /Recipe box/ }).click();
  await expect(page.getByRole("region", { name: /asking for access/ })).toBeVisible();

  // a pin made here is the record's; the settings note's bar is untouched
  await start(page);
  await entries.getByRole("button", { name: "Pin Recipe box to the bar" }).click();
  await expect(bar(page).getByRole("link", { name: /Recipe box/ })).toHaveCount(0);
  const [app] = await tagged("parachute-bundle");
  expect(app.metadata.bundle.bar).toEqual([]);
  expect((await tagged("parachute-settings"))[0].metadata.parachute.bar).toEqual([]);

  // Everything (the settings note naming no app) offers every applet, as before
  const [s] = await tagged("parachute-settings");
  await api(hubState(), "PATCH", `notes/${s.id}`, { metadata: { parachute: { bar: [] } }, if_updated_at: (await api(hubState(), "GET", `notes/${s.id}`)).updatedAt });
  await start(page);
  await expect(entries.getByRole("link", { name: /Cook mode/ })).toBeVisible();
});

test("hostile: a record can't widen its sources with every hub or a star inside a name", async ({ page }) => {
  await api(hubState(), "POST", "notes", { path: "Parachute/Bundles/wide", content: "an app", tags: ["parachute-bundle"], metadata: { bundle: {
    contract: 1, id: "wide", name: "Wide", sources: [{ vault: "*", applet: "*" }, { vault: VAULT, applet: "Applets/*" }] } } });
  await api(hubState(), "POST", "notes", { path: "Parachute/Settings", content: "settings", tags: ["parachute-settings"], metadata: { parachute: { bundle: "wide" } } });
  await start(page);
  // neither source parses: nothing in it is offered
  await expect(ui(page).getByRole("link", { name: /Recipe box/ })).toHaveCount(0);
  await expect(ui(page).getByRole("link", { name: /Cook mode/ })).toHaveCount(0);
});

test("Settings → Your bundle: choose between Parachute Simplified, Everything and a bundle record; this device opens it, and a new one does too", async ({ page }) => {
  await api(hubState(), "POST", "notes", { path: "Parachute/Bundles/kitchen-table", content: "an app", tags: ["parachute-bundle"], metadata: { bundle: {
    contract: 1, id: "kitchen-table", name: "Kitchen table", note: "just the recipes", sources: [{ vault: VAULT, applet: "Applets/Recipes" }] } } });
  await start(page);
  await page.goto("/settings");
  const choice = page.getByRole("group", { name: "Which bundle opens" });
  await expect(choice.getByRole("radio")).toHaveCount(3);
  await expect(choice.getByRole("radio", { name: /Everything/ })).toBeChecked();
  await choice.getByRole("radio", { name: /Parachute Simplified/ }).check();
  await expect.poll(async () => (await tagged("parachute-settings"))[0]?.metadata.parachute.bundle).toBe("simple");
  await page.goto("/");
  await expect(bar(page).getByRole("link", { name: /Notes/ })).toBeVisible();
  await expect(bar(page).getByRole("link", { name: /Connect/ })).toBeVisible();
  await page.goto("/settings");
  await choice.getByRole("radio", { name: /Kitchen table/ }).check();
  await expect.poll(async () => (await tagged("parachute-settings"))[0]?.metadata.parachute.bundle).toBe("kitchen-table");
  await page.goto("/");
  const entries = ui(page).getByRole("list", { name: "Applets" });
  await expect(entries.getByRole("link", { name: /Recipe box/ })).toBeVisible();
  await expect(entries.getByRole("link", { name: /Cook mode/ })).toHaveCount(0);
  await page.goto("/settings");
  await choice.getByRole("radio", { name: /Everything/ }).check();
  await expect.poll(async () => (await tagged("parachute-settings"))[0]?.metadata.parachute.bundle).toBe("everything");
  await page.goto("/");
  await expect(entries.getByRole("link", { name: /Cook mode/ })).toBeVisible();
});

test("the first screen: the bundle record names it, and Settings → Opens on changes it to the list or another applet on the bar", async ({ page }) => {
  // Aaron's own opens on Rooms ("My old Uni app just had Rooms as its first screen"); here, the record names Recipe box
  await api(hubState(), "POST", "notes", { path: "Parachute/Bundles/kitchen-table", content: "an app", tags: ["parachute-bundle"], metadata: { bundle: {
    contract: 1, id: "kitchen-table", name: "Kitchen table", sources: [{ vault: VAULT, applet: "*" }],
    bar: [{ vault: VAULT, applet: "Applets/Recipes" }, { vault: VAULT, applet: "Applets/Cook mode" }], start: { vault: VAULT, applet: "Applets/Recipes" } } } });
  await api(hubState(), "POST", "notes", { path: "Parachute/Settings", content: "settings", tags: ["parachute-settings"], metadata: { parachute: { bundle: "kitchen-table" } } });
  const record = async () => (await tagged("parachute-bundle")).find((n) => n.metadata.bundle?.id === "kitchen-table")!.metadata.bundle;
  await start(page);
  // the record alone starts no code: the app opens at Recipe box, which asks (its card) before it runs
  await expect(page).toHaveURL(/\/a\/[^/?]+$/);
  await expect(page.getByRole("region", { name: /asking for access/ })).toContainText("Recipe box");
  await page.goto("/settings");
  const opens = page.getByRole("group", { name: "Opens on" });
  await expect(opens.getByRole("radio")).toHaveCount(3);
  await expect(opens.getByRole("radio", { name: /Recipe box/ })).toBeChecked();
  // the list
  await opens.getByRole("radio", { name: /Applets/ }).check();
  await expect.poll(async () => (await record()).start).toBeNull();
  await start(page);
  await expect(ui(page).getByRole("list", { name: "Applets" })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  expect(await page.evaluate(() => localStorage.getItem("parachute.start.v1"))).toBeNull();
  // another applet on the bar: a tap here is this device's choice, so it is the screen the app opens on
  await page.goto("/settings");
  await opens.getByRole("radio", { name: /Cook mode/ }).check();
  await expect.poll(async () => (await record()).start).toEqual({ vault: VAULT, applet: "Applets/Cook mode" });
  await expect(opens.getByRole("radio", { name: /Cook mode/ })).toBeChecked();
  const chosen = JSON.parse(await page.evaluate(() => localStorage.getItem("parachute.start.v1") ?? "null"));
  expect(chosen?.vault).toBe(VAULT);
  expect(chosen?.noteId).toBe(((await api(hubState(), "GET", `notes?path_prefix=${encodeURIComponent("Applets/Cook mode")}`)) as { id: string }[])[0]?.id);
  await start(page);
  await expect(page.getByRole("region", { name: /asking for access/ })).toContainText("Cook mode");
  // and back to the list: the record says none, and this device's choice is let go
  await page.goto("/settings");
  await opens.getByRole("radio", { name: /Applets/ }).check();
  await expect.poll(async () => (await record()).start).toBeNull();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("parachute.start.v1"))).toBeNull();
  // the settings note is left as it was
  expect((await tagged("parachute-settings"))[0].metadata.parachute.start).toBeUndefined();
});

test("bar and home live in the bundle only: with no record, a pin makes the open bundle's, starting from the settings note's pins; that note is left as it was", async ({ page }) => {
  await api(hubState(), "POST", "notes", { path: "Parachute/Settings", content: "settings", tags: ["parachute-settings"], metadata: { parachute: { bar: [{ vault: VAULT, applet: "Applets/Cook mode" }] } } });
  await start(page);
  // the settings note's pins are read until 2026-12-20, after the bundle's own places
  await expect(bar(page).getByRole("link", { name: /Cook mode/ })).toBeVisible();
  await ui(page).getByRole("button", { name: "Pin Recipe box to the bar" }).click();
  await expect(bar(page).getByRole("link", { name: /Recipe box/ })).toBeVisible();
  // Everything's record, under the older names while the vault has none under the newer; only what changed and its name
  await expect.poll(async () => (await tagged("parachute-app")).map((n) => [n.path.replace(/\.md$/, ""), n.metadata.app])).toEqual([["Parachute/Apps/everything",
    { contract: 1, id: "everything", name: "Everything", bar: [{ vault: VAULT, applet: "Applets/Cook mode" }, { vault: VAULT, applet: "Applets/Recipes" }], start: null }]]);
  expect((await tagged("parachute-settings"))[0].metadata.parachute.bar).toEqual([{ vault: VAULT, applet: "Applets/Cook mode" }]);
  await start(page);
  await expect(bar(page).getByRole("link", { name: /Recipe box/ })).toBeVisible();
  await expect(bar(page).getByRole("link", { name: /Applets/ })).toBeVisible();
});

test("an older record (Parachute/Apps, parachute-app, fields.app) still opens, a change keeps it readable by older builds, and a bundle of its id wins", async ({ page }) => {
  // the older names, read for one release (until 2026-12-20)
  await api(hubState(), "POST", "notes", { path: "Parachute/Apps/kitchen-table", content: "an app", tags: ["parachute-app"], metadata: { app: {
    contract: 1, id: "kitchen-table", name: "Kitchen table", sources: [{ vault: VAULT, applet: "Applets/Recipes" }], bar: [{ vault: VAULT, applet: "Applets/Recipes" }] } } });
  await api(hubState(), "POST", "notes", { path: "Parachute/Settings", content: "settings", tags: ["parachute-settings"], metadata: { parachute: { app: "kitchen-table", bar: [] } } });
  await start(page);
  const entries = ui(page).getByRole("list", { name: "Applets" });
  await expect(entries.getByRole("link", { name: /Recipe box/ })).toBeVisible();
  await expect(entries.getByRole("link", { name: /Cook mode/ })).toHaveCount(0);
  await expect(bar(page).getByRole("link", { name: /Recipe box/ })).toBeVisible();

  // a change is written as the record is, under its older names, which the builds before 11-20 read (a device of the
  // person's may run one); scripts/migrate-bundles.ts moves it later
  await entries.getByRole("button", { name: "Pin Recipe box to the bar" }).click();
  await expect(bar(page).getByRole("link", { name: /Recipe box/ })).toHaveCount(0);
  await expect.poll(async () => (await tagged("parachute-app")).map((n) => [n.path.replace(/\.md$/, ""), n.metadata.app?.bar])).toEqual([["Parachute/Apps/kitchen-table", []]]);
  expect(await tagged("parachute-bundle")).toEqual([]);
  await start(page);
  await expect(entries.getByRole("link", { name: /Cook mode/ })).toHaveCount(0);

  // an older record beside a bundle of the same id: the bundle is the one read
  await api(hubState(), "POST", "notes", { path: "Parachute/Bundles/kitchen-table", content: "a bundle", tags: ["parachute-bundle"], metadata: { bundle: {
    contract: 1, id: "kitchen-table", name: "Kitchen table", sources: [{ vault: VAULT, applet: "Applets/Recipes" }] } } });
  const [was] = await tagged("parachute-app");
  await api(hubState(), "PATCH", `notes/${was.id}`, { metadata: { app: { ...was.metadata.app, sources: [{ vault: VAULT, applet: "*" }] } }, if_updated_at: (await api(hubState(), "GET", `notes/${was.id}`)).updatedAt });
  await start(page);
  await expect(entries.getByRole("link", { name: /Recipe box/ })).toBeVisible();
  await expect(entries.getByRole("link", { name: /Cook mode/ })).toHaveCount(0);
  // the choice is written under both names: `bundle`, and `app` for builds from before 11-20
  await page.goto("/settings");
  await page.locator("section", { has: page.getByRole("heading", { name: "Your bundle" }) }).getByRole("radio", { name: /Everything/ }).check();
  await expect.poll(async () => (await tagged("parachute-settings"))[0]?.metadata.parachute.bundle).toBe("everything");
  // and under its older name, for the builds before 11-20
  expect((await tagged("parachute-settings"))[0].metadata.parachute.app).toBe("everything");
});

test("scripts/migrate-bundles.ts: shows first, then moves each older record and the settings note's choice, backed up", async () => {
  const old = await api(hubState(), "POST", "notes", { path: "Parachute/Apps/kitchen-table", content: "an app", tags: ["parachute-app"], metadata: { app: {
    contract: 1, id: "kitchen-table", name: "Kitchen table", sources: [{ vault: VAULT, applet: "*" }] } } });
  await api(hubState(), "POST", "notes", { path: "Parachute/Settings", content: "settings", tags: ["parachute-settings"], metadata: { parachute: { app: "kitchen-table", bar: [{ vault: VAULT, applet: "Applets/Recipes" }], start: { vault: VAULT, applet: "Applets/Recipes" } } } });
  const dir = mkdtempSync(join(tmpdir(), "migrate-bundles-"));
  writeFileSync(join(dir, "token"), hubState().token);
  const run = (...more: string[]) => execFileSync("node", ["scripts/migrate-bundles.ts", "--hub", hubState().origin, "--vault", VAULT, "--token-file", join(dir, "token"), "--backup", join(dir, "backup"), ...more]).toString();
  expect(run()).toContain("(would) move Parachute/Apps/kitchen-table → Parachute/Bundles/kitchen-table");
  expect((await tagged("parachute-app")).map((n) => n.id)).toEqual([old.id]);
  run("--apply");
  const [moved] = await tagged("parachute-bundle");
  expect([moved.id, moved.path.replace(/\.md$/, ""), moved.metadata.bundle.name, moved.metadata.app]).toEqual([old.id, "Parachute/Bundles/kitchen-table", "Kitchen table", undefined]);
  // the settings note's bar and home now live in the bundle only
  expect([moved.metadata.bundle.bar, moved.metadata.bundle.start]).toEqual([[{ vault: VAULT, applet: "Applets/Recipes" }], { vault: VAULT, applet: "Applets/Recipes" }]);
  expect(await tagged("parachute-app")).toEqual([]);
  const settings = (await tagged("parachute-settings"))[0].metadata.parachute;
  // the note keeps them until 2026-12-20, for a device on another bundle with no bar of its own
  expect([settings.bundle, settings.app, settings.bar, settings.start]).toEqual(["kitchen-table", undefined, [{ vault: VAULT, applet: "Applets/Recipes" }], { vault: VAULT, applet: "Applets/Recipes" }]);
  expect(readdirSync(join(dir, "backup")).sort()).toEqual(["Parachute_Apps_kitchen-table.json", "Parachute_Bundles_kitchen-table.json", "Parachute_Settings.json"]);
  expect(run()).toContain("Nothing to move.");
});

test("scripts/install-applets.ts: --bar and --start go in the bundle record (only what changes, for one the app ships), never in the settings note", async () => {
  await api(hubState(), "POST", "notes", { path: "Parachute/Settings", content: "settings", tags: ["parachute-settings"], metadata: { parachute: { bundle: "simple" } } });
  const hadCapture = (await tagged("applet")).some((n) => n.path.startsWith("Applets/Capture"));
  const dir = mkdtempSync(join(tmpdir(), "install-applets-"));
  writeFileSync(join(dir, "token"), hubState().token);
  const install = () => execFileSync("node", ["scripts/install-applets.ts", "--hub", hubState().origin, "--vault", VAULT, "--token-file", join(dir, "token"), "--applet", "capture", "--bar", "capture", "--start", "capture", "--apply"]).toString();
  const out = install();
  // the vault holds no record under the newer names: the new one goes under the older, which builds from before 11-20 read
  expect(out).toContain("add the bundle simple at Parachute/Apps/simple");
  const [rec] = await tagged("parachute-app");
  expect(rec.metadata.app).toEqual({ contract: 1, id: "simple", name: "Parachute Simplified", bar: [{ screen: "home" }, { shipped: "journal" }, { shipped: "capture" }, { shipped: "vault" }, { screen: "connect" }, { vault: VAULT, applet: "Applets/Capture" }], start: { vault: VAULT, applet: "Applets/Capture" } });
  const settings = (await tagged("parachute-settings"))[0].metadata.parachute;
  expect([settings.bar, settings.start]).toEqual([undefined, undefined]);
  // again: nothing changes (Simplified's own places stay first)
  expect(install()).toContain("bundle simple: unchanged");
  if (!hadCapture) for (const n of await tagged("applet")) if (n.path.startsWith("Applets/Capture")) await api(hubState(), "DELETE", `notes/${n.id}`);
});
