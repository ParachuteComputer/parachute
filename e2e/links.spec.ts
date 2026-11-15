import { expect, test, type Page } from "@playwright/test";
import { api, hubState, VAULT } from "./hub";

test.use({ storageState: "e2e/.signed-in.json" });

const link = (address: string) => `parachute://open?url=${encodeURIComponent(address)}`;
// what the shell does with a link it is opened with: every link goes through this one screen
const arrive = (page: Page, raw: string) => page.goto(`/open-link?url=${encodeURIComponent(raw)}`);
const noteId = async (path: string) => (await api(hubState(), "GET", `notes?id=${encodeURIComponent(path)}`)).id as string;

test("a link to a note in a vault this device holds opens that note", async ({ page }) => {
  const id = await noteId("Welcome");
  await arrive(page, link(`${hubState().origin}/surface/parachute/v/${VAULT}/n/${id}`));
  await expect(page.locator(".prose-note h1")).toHaveText("Welcome");
});

test("a link from outside never starts an applet: it waits with Open, and one tap shows the recipe", async ({ page }) => {
  await page.goto(`/v/${VAULT}`);
  await page.getByRole("list", { name: "Applets" }).getByRole("link", { name: /Recipe box/ }).click();
  await page.getByRole("button", { name: "Allow" }).click();
  const id = await noteId("Recipes/Tomato toast");
  await arrive(page, link(`${hubState().origin}/surface/parachute/v/${VAULT}/n/${id}`));
  await expect(page.getByRole("button", { name: /^Open Recipe box$/ })).toBeVisible();
  await expect(page.locator("iframe")).toHaveCount(0);
  await page.getByRole("button", { name: /^Open Recipe box$/ }).click();
  await expect(page.frameLocator("iframe.applet-frame").locator("#opened")).toHaveText("Opened: Recipes/Tomato toast");
});

test("a link to a vault this device doesn't hold is shown, not followed, with Copy", async ({ page }) => {
  const raw = link(`${hubState().origin}/surface/parachute/v/journal/n/01ABCDEF`);
  await arrive(page, raw);
  await expect(page.getByRole("alert")).toContainText("This device doesn't hold the journal vault");
  await expect(page.getByRole("button", { name: "Copy" })).toBeVisible();
  // nothing on the page leads out to the link
  expect(await page.locator(`a[href*="journal"]`).count()).toBe(0);
});

test("a link to a hub this device isn't signed in to is shown, not followed", async ({ page }) => {
  await arrive(page, link(`https://hub.example/surface/parachute/v/${VAULT}/n/01ABCDEF`));
  await expect(page.getByRole("alert")).toContainText(`This device doesn't hold the ${VAULT} vault on hub.example`);
});

test("a malformed link is refused with its reason", async ({ page }) => {
  await arrive(page, `parachute://open?url=${encodeURIComponent("javascript:alert(1)")}`);
  await expect(page.getByRole("alert")).toContainText("isn't a secure web address");
});

test("a note's Copy link makes the link that opens it here", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const id = await noteId("Welcome");
  await page.goto(`/v/${VAULT}/n/${id}`);
  await page.getByRole("button", { name: "Copy link" }).click();
  await expect(page.getByRole("button", { name: "Link copied" })).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toMatch(/^parachute:\/\/open\?url=/);
  await arrive(page, copied);
  await expect(page.locator(".prose-note h1")).toHaveText("Welcome");
});
