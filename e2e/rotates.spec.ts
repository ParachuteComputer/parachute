// The tests that sign in again or rotate the sign-in. A new sign-in replaces the hub's grant to this app, which retires the
// tokens the other tests share (a refresh rotates them too, and e2e/test.ts keeps that). So these run in their own
// project, after all the others (playwright.config.ts), the one that uses the shared sign-in first.
import { expect, test, type Page } from "./test";
import { signIn, ui } from "./helpers";
import { api, hubState, VAULT } from "./hub";

const frame = (page: Page) => page.frameLocator("iframe.applet-frame");
async function selfTestDone(page: Page) {
  await page.goto("/settings");
  await expect(page.getByRole("status").filter({ hasText: /approved code only|run sealed/ })).toBeVisible({ timeout: 45_000 });
}
async function allow(page: Page) {
  await page.goto(`/v/${VAULT}?with=vault`);
  await ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name: /Recipe box/ }).click();
  await page.getByRole("button", { name: "Allow" }).click();
  await expect(frame(page).getByRole("heading", { name: "Recipe box" })).toBeVisible();
}

test.describe("signed in, self-test passed", () => {
test.use({ storageState: "e2e/.signed-in.json" });

test("an applet's call that needs a fresh token still gets its answer", async ({ page }) => {
  await allow(page);
  // the access token runs out while the applet runs: its next call is refused, the app refreshes the token, and the
  // call is answered (the refresh must not take the applet's session down with it)
  await page.evaluate(() => {
    const list = JSON.parse(localStorage.getItem("parachute.vaults.v1") ?? "[]");
    list[0].accessToken = "expired";
    localStorage.setItem("parachute.vaults.v1", JSON.stringify(list));
  });
  await frame(page).getByRole("button", { name: "Add a recipe" }).click();
  await expect(frame(page).locator("#said")).toContainText("added Recipes/Added", { timeout: 15_000 });
  const path = (await frame(page).locator("#said").textContent())!.replace("added ", "");
  const note = await api(hubState(), "GET", `notes?id=${encodeURIComponent(path)}`);
  await api(hubState(), "DELETE", `notes/${note.id}`);
});

});

test("the self-test runs by itself on a new device, and Settings says how applets run here", async ({ page }) => {
  await signIn(page);
  await selfTestDone(page);
  // Chromium has WebRTC and no way to switch it off: approved code only
  await expect(page.getByRole("status").filter({ hasText: "approved code only" })).toBeVisible();
});
