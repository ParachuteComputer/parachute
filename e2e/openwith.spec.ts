import { expect, test, type Page } from "@playwright/test";
import { api, hubState, VAULT } from "./hub";
import { expectInVault, ui } from "./helpers";

test.use({ storageState: "e2e/.signed-in.json" });

const frame = (page: Page) => page.frameLocator("iframe.applet-frame");
const noteId = async (path: string) => (await api(hubState(), "GET", `notes?id=${encodeURIComponent(path)}`)).id as string;
const notes = (page: Page) => ui(page).getByRole("list", { name: /Notes|Search results/ });
async function allowApplet(page: Page, name: string) {
  await page.goto(`/v/${VAULT}?with=vault`);
  await ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name: new RegExp(name) }).click();
  await page.getByRole("button", { name: "Allow" }).click();
  await expect(frame(page).locator("#opened")).toBeVisible();
}
async function tapNote(page: Page, title: string) {
  await page.goto(`/v/${VAULT}?with=vault`);
  await notes(page).getByRole("link", { name: new RegExp(`^${title}(?: (?:Recipes|Applets) ·|$)`) }).click();
}

test("no applet allowed: a recipe opens plain, with a line naming both that could; the line offers them, Allow first, and Allow opens it with that recipe", async ({ page }) => {
  await tapNote(page, "Tomato toast");
  const line = ui(page).locator(".open-line");
  await expect(line).toContainText("Cook mode or Recipe box can open this.");
  await expect(ui(page).locator(".prose-note h1")).toHaveText("Tomato toast");
  await line.getByRole("button").click();
  const sheet = ui(page).getByRole("dialog", { name: "Open with" });
  await expect(sheet.getByRole("button", { name: /Recipe box/ })).toContainText("Allow first");
  await sheet.getByRole("button", { name: /Recipe box/ }).click();
  await page.getByRole("button", { name: "Allow" }).click();
  await expect(frame(page).locator("#opened")).toHaveText("Opened: Recipes/Tomato toast");
});

test("one applet allowed and since changed, the other never allowed: the sheet says which changed", async ({ page }) => {
  await allowApplet(page, "Recipe box");
  const st = hubState();
  const cur = await api(st, "GET", `notes?id=${encodeURIComponent("Applets/Recipes")}`);
  await api(st, "PATCH", `notes/${cur.id}`, { content: `${cur.content}\n<!-- changed -->`, if_updated_at: cur.updatedAt });
  try {
    await tapNote(page, "Tomato toast");
    await ui(page).locator(".open-line").getByRole("button").click();
    await expect(ui(page).getByRole("dialog", { name: "Open with" }).getByRole("button", { name: /Recipe box/ })).toContainText("changed since you allowed it");
  } finally {
    const now = await api(st, "GET", `notes?id=${cur.id}`);
    await api(st, "PATCH", `notes/${cur.id}`, { content: cur.content, if_updated_at: now.updatedAt });
  }
});

test("one applet allowed: a tap on a recipe opens it there, with the recipe, and Back skips the note's route", async ({ page }) => {
  await allowApplet(page, "Recipe box");
  await tapNote(page, "Tomato toast");
  await expect(page).toHaveURL(/\/a\//);
  await expect(frame(page).locator("#opened")).toHaveText("Opened: Recipes/Tomato toast");
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/v/${VAULT}\\?with=vault$`));
});

test("a note no applet opens opens in Vault with no card, even with applets allowed", async ({ page }) => {
  await allowApplet(page, "Recipe box");
  await tapNote(page, "Welcome");
  await expectInVault(page, VAULT, await noteId("Welcome"), "Welcome");
  await expect(page.getByRole("button", { name: "Allow" })).toHaveCount(0);
});

test("a link inside a note's text goes through the note's route like any other", async ({ page }) => {
  await allowApplet(page, "Recipe box");
  // the plain note view, where the note's text is links
  await page.goto(`/v/${VAULT}/n/${await noteId("Welcome")}?with=vault`);
  await ui(page).getByRole("link", { name: "Recipes/Tomato toast" }).click();
  await expect(frame(page).locator("#opened")).toHaveText("Opened: Recipes/Tomato toast");
});

test("a search hit opens in the applet and starts it", async ({ page }) => {
  await allowApplet(page, "Recipe box");
  await page.goto(`/v/${VAULT}?with=vault`);
  await ui(page).getByRole("searchbox").fill("beans");
  await ui(page).getByRole("list", { name: "Search results" }).getByRole("link").first().click();
  await expect(frame(page).locator("#opened")).toHaveText("Opened: Recipes/Rice and beans");
});

test("two applets allowed: it asks once, Always ticked, and then opens straight away", async ({ page }) => {
  await allowApplet(page, "Recipe box");
  await allowApplet(page, "Cook mode");
  await tapNote(page, "Tomato toast");
  const sheet = ui(page).getByRole("dialog", { name: "Open with" });
  await expect(sheet.getByRole("checkbox")).toBeChecked();
  await expect(sheet.getByRole("button")).toContainText([/Cook mode/, /Recipe box/, /Vault/, /Cancel/]);
  await sheet.getByRole("button", { name: /Recipe box/ }).click();
  await expect(frame(page).locator("#opened")).toHaveText("Opened: Recipes/Tomato toast");
  await tapNote(page, "Rice and beans");
  await expect(frame(page).locator("#opened")).toHaveText("Opened: Recipes/Rice and beans");
  await expect(ui(page).getByRole("dialog")).toHaveCount(0);
});

test("with Always unticked, nothing is kept: the next tap asks again", async ({ page }) => {
  await allowApplet(page, "Recipe box");
  await allowApplet(page, "Cook mode");
  await tapNote(page, "Tomato toast");
  const sheet = ui(page).getByRole("dialog", { name: "Open with" });
  await sheet.getByRole("checkbox").uncheck();
  await sheet.getByRole("button", { name: /Cook mode/ }).click();
  await expect(frame(page).locator("#opened")).toHaveText("Cooking: Recipes/Tomato toast");
  expect(await page.evaluate(() => localStorage.getItem("parachute.openwith.v1"))).toBeNull();
  await tapNote(page, "Tomato toast");
  await expect(ui(page).getByRole("dialog", { name: "Open with" })).toBeVisible();
});

test("a long-press offers Open with: Vault with Always opens plain from then on, until Clear in Settings", async ({ page }) => {
  await allowApplet(page, "Recipe box");
  await page.goto(`/v/${VAULT}?with=vault`);
  // a long-press on a phone and a right-click on desktop are both a contextmenu on the link
  await notes(page).getByRole("link", { name: /^Tomato toast/ }).click({ button: "right" });
  const sheet = ui(page).getByRole("dialog", { name: "Open with" });
  await expect(sheet.getByRole("checkbox")).toBeChecked();
  await sheet.getByRole("button", { name: /Vault/ }).click();
  await expect(ui(page).locator(".prose-note h1")).toHaveText("Tomato toast");
  // Always: Vault means no applet's: the tap now carries on to Vault (not Recipe box), with no card
  await tapNote(page, "Tomato toast");
  await expectInVault(page, VAULT, await noteId("Recipes/Tomato toast"), "Tomato toast");
  await expect(page.locator('iframe.applet-frame[title="Recipe box"]')).toHaveCount(0);
  await page.goto("/settings");
  await page.getByRole("list", { name: "Defaults" }).getByRole("button", { name: "Clear" }).click();
  await tapNote(page, "Tomato toast");
  await expect(frame(page).locator("#opened")).toHaveText("Opened: Recipes/Tomato toast");
});

test("changed code is seen at the tap: the recipe opens plain with a line, and nothing runs", async ({ page }) => {
  await allowApplet(page, "Recipe box");
  const st = hubState();
  const cur = await api(st, "GET", `notes?id=${encodeURIComponent("Applets/Recipes")}`);
  await api(st, "PATCH", `notes/${cur.id}`, { content: `${cur.content}\n<!-- changed -->`, if_updated_at: cur.updatedAt });
  try {
    await tapNote(page, "Tomato toast");
    await expect(ui(page).locator(".open-line")).toContainText("Recipe box or Cook mode can open this.");
    await expect(page.locator("iframe.applet-frame")).toHaveCount(0);
  } finally {
    const now = await api(st, "GET", `notes?id=${cur.id}`);
    await api(st, "PATCH", `notes/${cur.id}`, { content: cur.content, if_updated_at: now.updatedAt });
  }
});

test("if reading the applets fails at the tap, the note opens in Vault: never in an applet on a list read before", async ({ page }) => {
  await allowApplet(page, "Recipe box");
  const st = hubState();
  const cur = await api(st, "GET", `notes?id=${encodeURIComponent("Applets/Recipes")}`);
  await page.goto(`/v/${VAULT}?with=vault`);
  await expect(ui(page).getByRole("list", { name: "Applets" })).toBeVisible();
  // the app has read the applets; now the applet's code changes, and the vault won't list its applets again
  await api(st, "PATCH", `notes/${cur.id}`, { content: `${cur.content}\n<!-- changed -->`, if_updated_at: cur.updatedAt });
  await page.route((u) => u.searchParams.get("tag") === "applet", (r) => r.abort());
  try {
    await notes(page).getByRole("link", { name: /^Tomato toast/ }).click();
    await expectInVault(page, VAULT, await noteId("Recipes/Tomato toast"), "Tomato toast");
    await expect(page.locator('iframe.applet-frame[title="Recipe box"]')).toHaveCount(0);
  } finally {
    const now = await api(st, "GET", `notes?id=${cur.id}`);
    await api(st, "PATCH", `notes/${cur.id}`, { content: cur.content, if_updated_at: now.updatedAt });
  }
});

test("Back from a note's sheet closes it", async ({ page }) => {
  await allowApplet(page, "Recipe box");
  await allowApplet(page, "Cook mode");
  await tapNote(page, "Tomato toast");
  await expect(ui(page).getByRole("dialog", { name: "Open with" })).toBeVisible();
  await page.goBack();
  await expect(ui(page).getByRole("dialog")).toHaveCount(0);
});

test("a tag the vault's settings give a role to is no applet's: a note with it opens in Vault, with no line and no card", async ({ page }) => {
  await allowApplet(page, "Recipe box");
  const st = hubState();
  // as Parachute's web app writes it: the vault's settings note, metadata.notes.tagRoles
  const settings = await api(st, "POST", "notes", { path: ".parachute/notes/settings", content: "", metadata: { notes: { schemaVersion: 1, tagRoles: { pinned: "recipe" } } } });
  try {
    await tapNote(page, "Tomato toast");
    await expectInVault(page, VAULT, await noteId("Recipes/Tomato toast"), "Tomato toast");
    await expect(page.getByRole("button", { name: "Allow" })).toHaveCount(0);
    await expect(page.locator('iframe.applet-frame[title="Recipe box"]')).toHaveCount(0);
  } finally {
    await api(st, "DELETE", `notes/${settings.id}`);
  }
});

test("an applet's own note opens in Vault as a note and never starts it", async ({ page }) => {
  await allowApplet(page, "Recipe box");
  await tapNote(page, "Recipes");
  await expectInVault(page, VAULT, await noteId("Applets/Recipes"), "Recipes");
  await expect(page.locator('iframe.applet-frame[title="Recipe box"]')).toHaveCount(0);
});

test("Back from an applet the note's line led to lands on the note, and decides nothing again", async ({ page }) => {
  const st = hubState();
  const applet = await api(st, "POST", "notes", { path: "Applets/Solo", extension: "html", tags: ["applet"], content: "<h1 id=solo>Solo</h1>",
    metadata: { applet: { contract: 2, id: "solo", name: "Solo", access: [{ vault: "here", allow: [{ path: "Recipes/", verbs: ["read"] }] }] }, opens: [{ type: "solo", path: "Recipes/" }] } });
  const note = await api(st, "POST", "notes", { path: "Recipes/Solo dish", content: "# Solo dish", tags: ["solo"] });
  try {
    await tapNote(page, "Solo dish");
    await ui(page).locator(".open-line").getByRole("link", { name: /Solo can open this/ }).click();
    await page.getByRole("button", { name: "Allow" }).click();
    await expect(frame(page).locator("#solo")).toBeVisible();
    await page.goBack();
    await expect(ui(page).locator(".prose-note h1")).toHaveText("Solo dish");
    await expect(page).toHaveURL(/\/n\//);
    await page.waitForTimeout(1000);
    await expect(page).toHaveURL(/\/n\//);
  } finally {
    await api(st, "DELETE", `notes/${note.id}`);
    await api(st, "DELETE", `notes/${applet.id}`);
  }
});
