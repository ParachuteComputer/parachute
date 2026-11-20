// A bundle is a record (docs/design/APP-RECORD.md): Parachute/Bundles/<id> in the home vault says which applets the launcher
// offers (one applet, a whole vault, a whole hub), and its bar. Listing runs nothing: an offered applet still asks.
// The settings note's `bundle` (and `app`, its older name) names the one a device opens; a pin made in it goes to the record.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
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
  await entries.getByRole("link", { name: /Recipe box/ }).click({ button: "right" });
  await ui(page).getByRole("button", { name: "Unpin" }).click();
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
  const choice = page.getByRole("region", { name: "Your bundle" }).or(page.locator("section", { has: page.getByRole("heading", { name: "Your bundle" }) }));
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

test("with no bundle record, a pin still lands in the settings note, as before", async ({ page }) => {
  await start(page);
  await ui(page).getByRole("link", { name: /Recipe box/ }).click({ button: "right" });
  await ui(page).getByRole("button", { name: "Pin to the bar" }).click();
  await expect(bar(page).getByRole("link", { name: /Recipe box/ })).toBeVisible();
  expect((await tagged("parachute-settings"))[0].metadata.parachute.bar).toEqual([{ vault: VAULT, applet: "Applets/Recipes" }]);
  expect(await tagged("parachute-bundle")).toEqual([]);
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
  await entries.getByRole("link", { name: /Recipe box/ }).click({ button: "right" });
  await ui(page).getByRole("button", { name: "Unpin" }).click();
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
  // the settings note's older `app` goes with the first choice made: one name for it
  await page.goto("/settings");
  await page.locator("section", { has: page.getByRole("heading", { name: "Your bundle" }) }).getByRole("radio", { name: /Everything/ }).check();
  await expect.poll(async () => (await tagged("parachute-settings"))[0]?.metadata.parachute.bundle).toBe("everything");
  // and under its older name, for the builds before 11-20
  expect((await tagged("parachute-settings"))[0].metadata.parachute.app).toBe("everything");
});

test("scripts/migrate-bundles.ts: shows first, then moves each older record and the settings note's choice, backed up", async () => {
  const old = await api(hubState(), "POST", "notes", { path: "Parachute/Apps/kitchen-table", content: "an app", tags: ["parachute-app"], metadata: { app: {
    contract: 1, id: "kitchen-table", name: "Kitchen table", sources: [{ vault: VAULT, applet: "*" }] } } });
  await api(hubState(), "POST", "notes", { path: "Parachute/Settings", content: "settings", tags: ["parachute-settings"], metadata: { parachute: { app: "kitchen-table", bar: [] } } });
  const dir = mkdtempSync(join(tmpdir(), "migrate-bundles-"));
  writeFileSync(join(dir, "token"), hubState().token);
  const run = (...more: string[]) => execFileSync("node", ["scripts/migrate-bundles.ts", "--hub", hubState().origin, "--vault", VAULT, "--token-file", join(dir, "token"), "--backup", join(dir, "backup"), ...more]).toString();
  expect(run()).toContain("(would) move Parachute/Apps/kitchen-table → Parachute/Bundles/kitchen-table");
  expect((await tagged("parachute-app")).map((n) => n.id)).toEqual([old.id]);
  run("--apply");
  const [moved] = await tagged("parachute-bundle");
  expect([moved.id, moved.path.replace(/\.md$/, ""), moved.metadata.bundle.name, moved.metadata.app]).toEqual([old.id, "Parachute/Bundles/kitchen-table", "Kitchen table", undefined]);
  expect(await tagged("parachute-app")).toEqual([]);
  const settings = (await tagged("parachute-settings"))[0].metadata.parachute;
  expect([settings.bundle, settings.app]).toEqual(["kitchen-table", undefined]);
  expect(readdirSync(join(dir, "backup")).sort()).toEqual(["Parachute_Apps_kitchen-table.json", "Parachute_Settings.json"]);
  expect(run()).toContain("Nothing to move.");
});

test("scripts/install-applets.ts: --bar and --start go in the bundle record (only what changes, for one the app ships), never in the settings note", async () => {
  await api(hubState(), "POST", "notes", { path: "Parachute/Settings", content: "settings", tags: ["parachute-settings"], metadata: { parachute: { bundle: "simple" } } });
  const hadCapture = (await tagged("applet")).some((n) => n.path.startsWith("Applets/Capture"));
  const dir = mkdtempSync(join(tmpdir(), "install-applets-"));
  writeFileSync(join(dir, "token"), hubState().token);
  const out = execFileSync("node", ["scripts/install-applets.ts", "--hub", hubState().origin, "--vault", VAULT, "--token-file", join(dir, "token"), "--applet", "capture", "--bar", "capture", "--start", "capture", "--apply"]).toString();
  expect(out).toContain("add the bundle simple at Parachute/Bundles/simple");
  const [rec] = await tagged("parachute-bundle");
  expect(rec.metadata.bundle).toEqual({ contract: 1, id: "simple", bar: [{ vault: VAULT, applet: "Applets/Capture" }], start: { vault: VAULT, applet: "Applets/Capture" } });
  const settings = (await tagged("parachute-settings"))[0].metadata.parachute;
  expect([settings.bar, settings.start]).toEqual([undefined, undefined]);
  if (!hadCapture) for (const n of await tagged("applet")) if (n.path.startsWith("Applets/Capture")) await api(hubState(), "DELETE", `notes/${n.id}`);
});
