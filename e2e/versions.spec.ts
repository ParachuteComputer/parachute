// An older app opening records written for a newer one (docs/design/VERSIONS.md): install order must not matter. Each
// record here is one a newer Parachute would write; this build is the older app. It says "Update Parachute to use …"
// and runs nothing of them, where it used to ask for and run code it couldn't draw, or hide the applet.
import { expect, test, type Page } from "@playwright/test";
import { api, hubState, record, VAULT } from "./hub";
import { installApplet, ui } from "./helpers";

test.use({ storageState: "e2e/.signed-in.json" });
const frame = (page: Page) => page.frameLocator("iframe.applet-frame");
const openChip = async (page: Page, name: RegExp) => {
  await page.goto(`/v/${VAULT}`);
  await ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name }).click();
};
const card = (page: Page) => page.getByRole("region", { name: /asking for access/ });

test("a record that needs a newer app is listed, and says to update instead of asking or running", async ({ page }) => {
  const later = await installApplet("journal", {}, (r) => ({ ...r, path: "Applets/Later journal", fields: { ...r.fields, needs: 99, applet: { ...(r.fields.applet as object), id: "later-journal", name: "Later journal" } } }));
  try {
    await openChip(page, /Later journal/);
    await expect(page.getByText("Update Parachute to use Later journal.")).toBeVisible();
    await expect(card(page)).toHaveCount(0);
    await expect(page.locator("iframe.applet-frame")).toHaveCount(0);
  } finally { await later.remove(); }
});

test("a manifest with a key this app doesn't know is listed and says to update, not hidden or refused", async ({ page }) => {
  const later = await installApplet("journal", {}, (r) => ({ ...r, path: "Applets/Later notes", fields: { ...r.fields, applet: { ...(r.fields.applet as object), id: "later-notes", name: "Later notes", later: { anything: true } } } }));
  try {
    await openChip(page, /Later notes/);
    await expect(page.getByText("Update Parachute to use Later notes.")).toBeVisible();
    await expect(card(page)).toHaveCount(0);
  } finally { await later.remove(); }
});

test("code that uses a part of the kit this app doesn't have says to update, not that it broke", async ({ page }) => {
  const body = `import { Page, Timeline } from "parachute";\nexport default function App() {\n  return <Page title="Later page"><Timeline /></Page>;\n}\n`;
  const note = await record(hubState(), "create", { path: "Applets/Later page", extension: "tsx", tags: ["applet"], body, fields: { applet: { contract: 2, id: "later-page", name: "Later page" } } });
  try {
    await openChip(page, /Later page/);
    await page.getByRole("button", { name: "Allow" }).click();
    await expect(frame(page).getByText("Update Parachute to use Later page. It uses Timeline, which this Parachute doesn't have.")).toBeVisible();
    await expect(frame(page).getByText(/This applet stopped/)).toHaveCount(0);
  } finally { await api(hubState(), "DELETE", `notes/${note.id}`); }
});
