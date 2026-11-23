// A home vault the app can't reach, and the way out in one tap (T-476, Aaron 11-23 via Uni: "I would love to be using
// the Uni bundle on my device ... right now I don't see Uni bundle as an option in settings"). His Mac kept a home from an
// older install that it can't reach; every one of Parachute's own applets runs there, and Your bundle lists the home's
// bundles only. Where the app says it can't reach the home (an applet, Settings, the list), it offers the person's other
// vaults it can reach, one tap each to make that one home.
import { expect, test } from "@playwright/test";
import { ui } from "./helpers";
import { hubState, VAULT } from "./hub";

test.use({ storageState: "e2e/.signed-in.json" });

test("a home the app can't reach: Journal, Settings and the list offer the vaults it can reach, and one tap makes that home", async ({ page }) => {
  // the home's Parachute doesn't answer for it; the person's other vaults (letters, pantry) do
  await page.route(`${hubState().origin}/vault/${VAULT}/**`, (r) => r.abort("connectionrefused"));
  await page.goto("/");
  // the list: the home's line says so, and where to go
  const list = ui(page).getByRole("list", { name: "Applets" });
  await expect(list.getByText(`Can't reach ${VAULT}, your home vault, just now.`)).toBeVisible({ timeout: 20_000 });
  await expect(list.getByRole("link", { name: "Choose another home" })).toBeVisible();

  // Settings: said at the top, with the vaults it can reach
  await page.goto("/settings");
  const home = page.getByRole("region", { name: "Your home vault" });
  await expect(home).toContainText(`Parachute can't reach ${VAULT}, your home vault.`);
  await expect(home.getByRole("button", { name: "Make letters your home" })).toBeVisible();
  await expect(home.getByRole("button", { name: "Make pantry your home" })).toBeVisible();

  // Journal: the same offer on its card; one tap and it runs in the new home
  await page.goto(`/v/${VAULT}/a/parachute:journal`);
  const said = page.getByRole("alert");
  await expect(said).toContainText(`Parachute can't reach ${VAULT}, your home vault, just now.`, { timeout: 30_000 });
  await said.getByRole("button", { name: "Make pantry your home" }).click();
  await expect(page).toHaveURL(/\/v\/pantry\/a\/parachute%3Ajournal/);
  await expect(page.frameLocator("iframe.applet-frame").getByRole("heading", { name: "Journal" })).toBeVisible({ timeout: 30_000 });
  await page.goto("/settings");
  await expect(page.getByRole("radio", { name: "pantry", exact: true })).toBeChecked();
  await expect(page.getByRole("region", { name: "Your home vault" })).toHaveCount(0);
});
