// An app is a record (docs/design/APP-RECORD.md): Parachute/Apps/<id> in the home vault says which applets the launcher
// offers (one applet, a whole vault, a whole hub), and its bar. Listing runs nothing: an offered applet still asks.
// The settings note's `app` names the one a device opens; a pin made in it goes to the record, not the settings note.
import { expect, test, type Page } from "@playwright/test";
import { ui } from "./helpers";
import { api, hubState, VAULT } from "./hub";

test.use({ storageState: "e2e/.signed-in.json" });

const bar = (page: Page) => page.getByRole("navigation", { name: "Bar" });
type Row = { id: string; path: string; metadata: Record<string, any> };
const tagged = async (tag: string) => { const r = await api(hubState(), "GET", `notes?tag=${tag}&include_metadata=true`); return (Array.isArray(r) ? r : r.notes ?? []) as Row[]; };
test.afterEach(async () => { for (const t of ["parachute-settings", "parachute-app"]) for (const n of await tagged(t)) await api(hubState(), "DELETE", `notes/${n.id}`); });
async function start(page: Page) { await page.goto("about:blank"); await page.goto("/"); }

test("an app record offers only its sources; its bar is its own; a pin in it goes to the record", async ({ page }) => {
  await api(hubState(), "POST", "notes", { path: "Parachute/Apps/kitchen-table", content: "an app", tags: ["parachute-app"], metadata: { app: {
    contract: 1, id: "kitchen-table", name: "Kitchen table", sources: [{ vault: VAULT, applet: "Applets/Recipes" }], bar: [{ vault: VAULT, applet: "Applets/Recipes" }] } } });
  await api(hubState(), "POST", "notes", { path: "Parachute/Settings", content: "settings", tags: ["parachute-settings"], metadata: { parachute: { app: "kitchen-table", bar: [] } } });
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
  const [app] = await tagged("parachute-app");
  expect(app.metadata.app.bar).toEqual([]);
  expect((await tagged("parachute-settings"))[0].metadata.parachute.bar).toEqual([]);

  // Everything (the settings note naming no app) offers every applet, as before
  const [s] = await tagged("parachute-settings");
  await api(hubState(), "PATCH", `notes/${s.id}`, { metadata: { parachute: { bar: [] } }, if_updated_at: (await api(hubState(), "GET", `notes/${s.id}`)).updatedAt });
  await start(page);
  await expect(entries.getByRole("link", { name: /Cook mode/ })).toBeVisible();
});

test("hostile: a record can't widen its sources with every hub or a star inside a name", async ({ page }) => {
  await api(hubState(), "POST", "notes", { path: "Parachute/Apps/wide", content: "an app", tags: ["parachute-app"], metadata: { app: {
    contract: 1, id: "wide", name: "Wide", sources: [{ vault: "*", applet: "*" }, { vault: VAULT, applet: "Applets/*" }] } } });
  await api(hubState(), "POST", "notes", { path: "Parachute/Settings", content: "settings", tags: ["parachute-settings"], metadata: { parachute: { app: "wide" } } });
  await start(page);
  // neither source parses: nothing in it is offered
  await expect(ui(page).getByRole("link", { name: /Recipe box/ })).toHaveCount(0);
  await expect(ui(page).getByRole("link", { name: /Cook mode/ })).toHaveCount(0);
});

test("Settings → Your app: choose between Parachute Simplified, Everything and an app record; this device opens it, and a new one does too", async ({ page }) => {
  await api(hubState(), "POST", "notes", { path: "Parachute/Apps/kitchen-table", content: "an app", tags: ["parachute-app"], metadata: { app: {
    contract: 1, id: "kitchen-table", name: "Kitchen table", note: "just the recipes", sources: [{ vault: VAULT, applet: "Applets/Recipes" }] } } });
  await start(page);
  await page.goto("/settings");
  const choice = page.getByRole("region", { name: "Your app" }).or(page.locator("section", { has: page.getByRole("heading", { name: "Your app" }) }));
  await expect(choice.getByRole("radio")).toHaveCount(3);
  await expect(choice.getByRole("radio", { name: /Everything/ })).toBeChecked();
  await choice.getByRole("radio", { name: /Parachute Simplified/ }).check();
  await expect.poll(async () => (await tagged("parachute-settings"))[0]?.metadata.parachute.app).toBe("simple");
  await page.goto("/");
  await expect(bar(page).getByRole("link", { name: /Notes/ })).toBeVisible();
  await expect(bar(page).getByRole("link", { name: /Connect/ })).toBeVisible();
  await page.goto("/settings");
  await choice.getByRole("radio", { name: /Kitchen table/ }).check();
  await expect.poll(async () => (await tagged("parachute-settings"))[0]?.metadata.parachute.app).toBe("kitchen-table");
  await page.goto("/");
  const entries = ui(page).getByRole("list", { name: "Applets" });
  await expect(entries.getByRole("link", { name: /Recipe box/ })).toBeVisible();
  await expect(entries.getByRole("link", { name: /Cook mode/ })).toHaveCount(0);
  await page.goto("/settings");
  await choice.getByRole("radio", { name: /Everything/ }).check();
  await expect.poll(async () => (await tagged("parachute-settings"))[0]?.metadata.parachute.app).toBe("everything");
  await page.goto("/");
  await expect(entries.getByRole("link", { name: /Cook mode/ })).toBeVisible();
});

test("with no app record, a pin still lands in the settings note, as before", async ({ page }) => {
  await start(page);
  await ui(page).getByRole("link", { name: /Recipe box/ }).click({ button: "right" });
  await ui(page).getByRole("button", { name: "Pin to the bar" }).click();
  await expect(bar(page).getByRole("link", { name: /Recipe box/ })).toBeVisible();
  expect((await tagged("parachute-settings"))[0].metadata.parachute.bar).toEqual([{ vault: VAULT, applet: "Applets/Recipes" }]);
  expect(await tagged("parachute-app")).toEqual([]);
});
