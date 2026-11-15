import { expect, test, type Page } from "@playwright/test";
import { api, hubState, VAULT } from "./hub";

test.use({ storageState: "e2e/.signed-in.json" });

const frame = (page: Page) => page.frameLocator("iframe.applet-frame");
const notes = (page: Page) => page.getByRole("list", { name: /Notes|Search results/ });
async function allowApplet(page: Page, name: string) {
  await page.goto(`/v/${VAULT}`);
  await page.getByRole("list", { name: "Applets" }).getByRole("link", { name: new RegExp(name) }).click();
  await page.getByRole("button", { name: "Allow" }).click();
  await expect(frame(page).locator("#opened")).toBeVisible();
}
async function tapNote(page: Page, title: string) {
  await page.goto(`/v/${VAULT}`);
  await notes(page).getByRole("link", { name: new RegExp(`^${title}(?: (?:Recipes|Applets) ·|$)`) }).click();
}

test("no applet allowed: a recipe opens plain, with a line naming both that could; the line offers them, Allow first, and Allow opens it with that recipe", async ({ page }) => {
  await tapNote(page, "Tomato toast");
  const line = page.locator(".open-line");
  await expect(line).toContainText("Cook mode or Recipe box can open this.");
  await expect(page.locator(".prose-note h1")).toHaveText("Tomato toast");
  await line.getByRole("button").click();
  const sheet = page.getByRole("dialog", { name: "Open with" });
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
    await page.locator(".open-line").getByRole("button").click();
    await expect(page.getByRole("dialog", { name: "Open with" }).getByRole("button", { name: /Recipe box/ })).toContainText("changed since you allowed it");
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
  await expect(page).toHaveURL(new RegExp(`/v/${VAULT}$`));
});

test("a plain note opens plain, even with applets allowed", async ({ page }) => {
  await allowApplet(page, "Recipe box");
  await tapNote(page, "Welcome");
  await expect(page.locator(".prose-note h1")).toHaveText("Welcome");
  await expect(page.locator(".open-line")).toHaveCount(0);
});

test("a link inside a note's text goes through the note's route like any other", async ({ page }) => {
  await allowApplet(page, "Recipe box");
  await tapNote(page, "Welcome");
  await page.getByRole("link", { name: "Recipes/Tomato toast" }).click();
  await expect(frame(page).locator("#opened")).toHaveText("Opened: Recipes/Tomato toast");
});

test("a search hit opens in the applet and starts it", async ({ page }) => {
  await allowApplet(page, "Recipe box");
  await page.goto(`/v/${VAULT}`);
  await page.getByRole("searchbox").fill("beans");
  await page.getByRole("list", { name: "Search results" }).getByRole("link").first().click();
  await expect(frame(page).locator("#opened")).toHaveText("Opened: Recipes/Rice and beans");
});

test("two applets allowed: it asks once, Always ticked, and then opens straight away", async ({ page }) => {
  await allowApplet(page, "Recipe box");
  await allowApplet(page, "Cook mode");
  await tapNote(page, "Tomato toast");
  const sheet = page.getByRole("dialog", { name: "Open with" });
  await expect(sheet.getByRole("checkbox")).toBeChecked();
  await expect(sheet.getByRole("button")).toContainText([/Cook mode/, /Recipe box/, /Vault/, /Cancel/]);
  await sheet.getByRole("button", { name: /Recipe box/ }).click();
  await expect(frame(page).locator("#opened")).toHaveText("Opened: Recipes/Tomato toast");
  await tapNote(page, "Rice and beans");
  await expect(frame(page).locator("#opened")).toHaveText("Opened: Recipes/Rice and beans");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("with Always unticked, nothing is kept: the next tap asks again", async ({ page }) => {
  await allowApplet(page, "Recipe box");
  await allowApplet(page, "Cook mode");
  await tapNote(page, "Tomato toast");
  const sheet = page.getByRole("dialog", { name: "Open with" });
  await sheet.getByRole("checkbox").uncheck();
  await sheet.getByRole("button", { name: /Cook mode/ }).click();
  await expect(frame(page).locator("#opened")).toHaveText("Cooking: Recipes/Tomato toast");
  expect(await page.evaluate(() => localStorage.getItem("parachute.openwith.v1"))).toBeNull();
  await tapNote(page, "Tomato toast");
  await expect(page.getByRole("dialog", { name: "Open with" })).toBeVisible();
});

test("a long-press offers Open with: Vault with Always opens plain from then on, until Clear in Settings", async ({ page }) => {
  await allowApplet(page, "Recipe box");
  await page.goto(`/v/${VAULT}`);
  // a long-press on a phone and a right-click on desktop are both a contextmenu on the link
  await notes(page).getByRole("link", { name: /^Tomato toast/ }).click({ button: "right" });
  const sheet = page.getByRole("dialog", { name: "Open with" });
  await expect(sheet.getByRole("checkbox")).toBeChecked();
  await sheet.getByRole("button", { name: /Vault/ }).click();
  await expect(page.locator(".prose-note h1")).toHaveText("Tomato toast");
  await tapNote(page, "Tomato toast");
  await expect(page.locator(".prose-note h1")).toHaveText("Tomato toast");
  await expect(page.locator("iframe")).toHaveCount(0);
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
    await expect(page.locator(".open-line")).toContainText("Recipe box or Cook mode can open this.");
    await expect(page.locator("iframe")).toHaveCount(0);
  } finally {
    const now = await api(st, "GET", `notes?id=${cur.id}`);
    await api(st, "PATCH", `notes/${cur.id}`, { content: cur.content, if_updated_at: now.updatedAt });
  }
});

test("if reading the applets fails at the tap, the note opens plain: never on a list read before", async ({ page }) => {
  await allowApplet(page, "Recipe box");
  const st = hubState();
  const cur = await api(st, "GET", `notes?id=${encodeURIComponent("Applets/Recipes")}`);
  await page.goto(`/v/${VAULT}`);
  await expect(page.getByRole("list", { name: "Applets" })).toBeVisible();
  // the app has read the applets; now the applet's code changes, and the vault won't list its applets again
  await api(st, "PATCH", `notes/${cur.id}`, { content: `${cur.content}\n<!-- changed -->`, if_updated_at: cur.updatedAt });
  await page.route((u) => u.searchParams.get("tag") === "applet", (r) => r.abort());
  try {
    await notes(page).getByRole("link", { name: /^Tomato toast/ }).click();
    await expect(page.locator(".prose-note h1")).toHaveText("Tomato toast");
    await expect(page).toHaveURL(/\/n\//);
    await expect(page.locator("iframe")).toHaveCount(0);
  } finally {
    const now = await api(st, "GET", `notes?id=${cur.id}`);
    await api(st, "PATCH", `notes/${cur.id}`, { content: cur.content, if_updated_at: now.updatedAt });
  }
});

test("Back from a note's sheet closes it", async ({ page }) => {
  await allowApplet(page, "Recipe box");
  await allowApplet(page, "Cook mode");
  await tapNote(page, "Tomato toast");
  await expect(page.getByRole("dialog", { name: "Open with" })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("an applet's own note opens as text and never starts it", async ({ page }) => {
  await allowApplet(page, "Recipe box");
  await tapNote(page, "Recipes");
  await expect(page.getByLabel("The note's text")).toContainText("<!doctype html>");
  await expect(page.locator("iframe")).toHaveCount(0);
});
