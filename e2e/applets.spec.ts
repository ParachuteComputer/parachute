import { expect, test, type Page } from "@playwright/test";
import { fromAppletMenu, ui } from "./helpers";
import { api, hubState, VAULT } from "./hub";

const idOf = async (path: string) => (await api(hubState(), "GET", `notes?id=${encodeURIComponent(path)}`)).id as string;
const frame = (page: Page) => page.frameLocator("iframe.applet-frame");

async function openFromStrip(page: Page) {
  await page.goto(`/v/${VAULT}`);
  await ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name: /Recipe box/ }).click();
}
async function allow(page: Page) {
  await openFromStrip(page);
  await page.getByRole("button", { name: "Allow" }).click();
  await expect(frame(page).getByRole("heading", { name: "Recipe box" })).toBeVisible();
}

test.describe("signed in, self-test passed", () => {
test.use({ storageState: "e2e/.signed-in.json" });

test("an applet shows its card first, and runs after Allow, reading only its own folder", async ({ page }) => {
  await openFromStrip(page);
  const card = page.getByRole("region", { name: /asking for access/ });
  await expect(card).toContainText("Read, add and change notes in Recipes/");
  await expect(card).toContainText("Open recipe notes in Recipes/ when you tap one");
  await expect(card).toContainText("Tag the notes it adds in Recipes/ as recipe");
  await expect(page.locator("iframe.applet-frame")).toHaveCount(0);
  await page.getByRole("button", { name: "Allow" }).click();
  const list = frame(page).locator("#list li");
  await expect(list).toHaveCount(2);
  await expect(list).toHaveText([/Recipes\/(Rice and beans|Tomato toast)/, /Recipes\/(Rice and beans|Tomato toast)/]);
});

test("a note it adds gets the tag of the type it opens", async ({ page }) => {
  await allow(page);
  await frame(page).getByRole("button", { name: "Add a recipe" }).click();
  await expect(frame(page).locator("#said")).toContainText("added Recipes/Added");
  const path = (await frame(page).locator("#said").textContent())!.replace("added ", "");
  const note = await api(hubState(), "GET", `notes?id=${encodeURIComponent(path)}`);
  expect(note.tags).toEqual(["recipe"]);
  await api(hubState(), "DELETE", `notes/${note.id}`);
});

test("a vault's role tag is no applet's to open: the card leaves it out", async ({ page }) => {
  const st = hubState();
  const cur = await api(st, "GET", `notes?id=${encodeURIComponent("Applets/Recipes")}`);
  const opens = [...cur.metadata.opens, { type: "pinned", path: "Recipes/" }];
  await api(st, "PATCH", `notes/${cur.id}`, { metadata: { opens }, if_updated_at: cur.updatedAt });
  try {
    await openFromStrip(page);
    const card = page.getByRole("region", { name: /asking for access/ });
    await expect(card).toContainText("Open recipe notes in Recipes/ when you tap one");
    await expect(card).not.toContainText("pinned");
  } finally {
    const now = await api(st, "GET", `notes?id=${cur.id}`);
    await api(st, "PATCH", `notes/${cur.id}`, { metadata: { opens: cur.metadata.opens }, if_updated_at: now.updatedAt });
  }
});

test("Stop and Revoke are in the bar's menu (⋯), not over the applet: two taps each, and Escape closes it", async ({ page }) => {
  await allow(page);
  // nothing above the frame but the bar
  await expect(page.getByRole("button", { name: "Stop" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Revoke" })).toHaveCount(0);
  const barFoot = await page.locator("header.bar").evaluate((b) => b.getBoundingClientRect().bottom);
  const frameTop = await page.locator("iframe.applet-frame").evaluate((f) => f.getBoundingClientRect().top);
  expect(frameTop - barFoot).toBeLessThan(16);
  // ⋯ opens the applet's menu: how it runs, Stop, Revoke and Settings
  await page.locator("header.bar").getByRole("button", { name: "Menu" }).click();
  const menu = page.getByRole("dialog", { name: "Recipe box menu" });
  await expect(menu).toContainText(/Approved code only|Sealed/);
  await expect(menu.getByRole("button", { name: "Stop" })).toBeVisible();
  await expect(menu.getByRole("button", { name: "Revoke" })).toBeVisible();
  await expect(menu.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  // to Settings from the menu and back: the applet as it was, the menu closed
  await page.locator("header.bar").getByRole("button", { name: "Menu" }).click();
  await menu.getByRole("link", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await page.goBack();
  await expect(frame(page).getByRole("heading", { name: "Recipe box" })).toBeVisible();
  await expect(menu).toBeHidden();
  await expect(frame(page).getByRole("heading", { name: "Recipe box" })).toBeVisible();
  // Stop, from the menu
  await fromAppletMenu(page, "Stop");
  await expect(page.getByRole("button", { name: /^Open Recipe box$/ })).toBeVisible();
  await expect(page.locator("iframe.applet-frame")).toHaveCount(0);
  // stopped, ⋯ is the way to Settings again
  await expect(page.locator("header.bar").getByRole("link", { name: "Settings" })).toBeVisible();
});

test("Revoke takes it back: the card shows again", async ({ page }) => {
  await allow(page);
  await fromAppletMenu(page, "Revoke");
  await expect(page.getByRole("button", { name: "Allow" })).toBeVisible();
  await expect(page.locator("iframe.applet-frame")).toHaveCount(0);
});

test("changed code asks again (approved code only)", async ({ page }) => {
  await allow(page);
  const st = hubState();
  const id = await idOf("Applets/Recipes");
  const cur = await api(st, "GET", `notes?id=${id}`);
  await api(st, "PATCH", `notes/${id}`, { content: `${cur.content}\n<!-- changed -->`, if_updated_at: cur.updatedAt });
  try {
    await openFromStrip(page);
    await expect(page.getByText("code changed since you allowed it")).toBeVisible();
    await expect(page.getByRole("button", { name: "Allow this version" })).toBeVisible();
    await expect(page.locator("iframe.applet-frame")).toHaveCount(0);
  } finally {
    const now = await api(st, "GET", `notes?id=${id}`);
    await api(st, "PATCH", `notes/${id}`, { content: cur.content, if_updated_at: now.updatedAt });
  }
});

test("with no tap, it doesn't start: an address typed or restored waits with Open", async ({ page }) => {
  await allow(page);
  const url = page.url();
  await page.goto(url);
  await expect(page.getByRole("button", { name: /^Open Recipe box$/ })).toBeVisible();
  await expect(page.locator("iframe.applet-frame")).toHaveCount(0);
  await page.getByRole("button", { name: /^Open Recipe box$/ }).click();
  await expect(frame(page).getByRole("heading", { name: "Recipe box" })).toBeVisible();
});

test("a link that isn't a tap doesn't start it, even right after a tap on the same applet", async ({ page }) => {
  await allow(page);
  const url = new URL(page.url()).pathname;
  await page.goto(`/v/${VAULT}`);
  // tap the applet, then come straight back. It may already run (it opens from what was read before, T-476): then it
  // is kept running, and a link back to it finds that same document, never a new start
  await ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name: /Recipe box/ }).click();
  await expect(frame(page).getByRole("heading", { name: "Recipe box" })).toBeVisible();
  const doc = page.locator("iframe.applet-frame").contentFrame().locator("body");
  await doc.evaluate(() => { (window as unknown as { __here: number }).__here = 1; });
  await page.goBack();
  // a navigation that is not a tap, to the same applet
  const link = () => page.evaluate((u) => { history.pushState({}, "", u); dispatchEvent(new PopStateEvent("popstate")); }, url);
  await link();
  await expect(page.locator("iframe.applet-frame")).toHaveCount(1);
  expect(await doc.evaluate(() => (window as unknown as { __here?: number }).__here)).toBe(1);
  // stopped, and left: the tap that started it before starts nothing now
  await fromAppletMenu(page, "Stop");
  await page.goBack();
  await link();
  await expect(page.getByRole("button", { name: /^Open Recipe box$/ })).toBeVisible();
  await expect(page.locator("iframe.applet-frame")).toHaveCount(0);
});

test("a link that arrives while the applet runs doesn't inherit its start", async ({ page }) => {
  await allow(page);
  const tomato = await idOf("Recipes/Tomato toast");
  await page.evaluate((u) => { history.pushState({}, "", u); dispatchEvent(new PopStateEvent("popstate")); }, `${new URL(page.url()).pathname}?note=${tomato}`);
  await expect(page.getByRole("button", { name: /^Open Recipe box$/ })).toBeVisible();
  await expect(page.locator("iframe.applet-frame")).toHaveCount(0);
});

// Back and Forward start nothing. Since applets are kept running while the person is elsewhere (src/shell/kept.tsx), a
// screen still running comes back as it was (the same document, nothing started again); one that was stopped waits
// with Open, as before.
test("Back and Forward never start it: a screen still running is as it was, a stopped one waits with Open", async ({ page }) => {
  await allow(page);
  const doc = page.locator("iframe.applet-frame").contentFrame().locator("body");
  await doc.evaluate(() => { (window as unknown as { __here: number }).__here = 1; });
  await page.goBack();
  await page.goForward();
  await expect(page.locator("iframe.applet-frame")).toHaveCount(1);
  expect(await doc.evaluate(() => (window as unknown as { __here?: number }).__here)).toBe(1);
  await fromAppletMenu(page, "Stop");
  await page.goBack();
  await page.goForward();
  await expect(page.getByRole("button", { name: /^Open Recipe box$/ })).toBeVisible();
  await expect(page.locator("iframe.applet-frame")).toHaveCount(0);
});

test("Stop holds: leaving and coming Back doesn't start it again", async ({ page }) => {
  await openFromStrip(page);
  await page.getByRole("button", { name: "Allow" }).click();
  await expect(frame(page).getByRole("heading", { name: "Recipe box" })).toBeVisible();
  await fromAppletMenu(page, "Stop");
  // Back returns where the person came from: the vault
  await page.getByRole("button", { name: "Back" }).click();
  // the vault view drawn first, so the applet's screen is really left
  await expect(ui(page).getByRole("list", { name: "Applets" })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole("button", { name: /^Open Recipe box$/ })).toBeVisible();
  await expect(page.locator("iframe.applet-frame")).toHaveCount(0);
});

test("signing out of a vault ends its applets' grants on this device", async ({ page }) => {
  await allow(page);
  // this test is about grants: the hub's revoke is answered here, so the sign-in the other tests share stays good
  // (the vault tests prove the revoke itself, on a sign-in of their own)
  let revoked = false;
  await page.route((u) => u.pathname === "/oauth/revoke", (r) => { revoked = true; return r.fulfill({ status: 200, body: "" }); });
  await page.goto("/settings");
  await expect(page.getByRole("list", { name: "Allowed applets" }).getByRole("listitem")).toHaveCount(1);
  await page.getByRole("button", { name: "Sign out of kitchen" }).click();
  expect(await page.evaluate(() => localStorage.getItem("parachute.applets.grants.v1"))).toBe("{}");
  await expect.poll(() => revoked).toBe(true);
});

test("it is handed a note only when it claims that note", async ({ page }) => {
  await allow(page);
  const base = new URL(page.url()).pathname;
  const tomato = await idOf("Recipes/Tomato toast");
  const welcome = await idOf("Welcome");
  await page.goto(`${base}?note=${welcome}`);
  await page.getByRole("button", { name: /^Open Recipe box$/ }).click();
  await expect(frame(page).locator("#opened")).toHaveText("No recipe opened.");
  await page.goto(`${base}?note=${tomato}`);
  await page.getByRole("button", { name: /^Open Recipe box$/ }).click();
  await expect(frame(page).locator("#opened")).toHaveText("Opened: Recipes/Tomato toast");
});
});
