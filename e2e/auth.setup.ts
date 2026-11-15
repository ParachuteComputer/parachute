// Sign in once, two ways, and keep the result for the tests (the hub rate-limits password sign-ins, as it should):
//   e2e/.hub-session.json: signed in on the hub's own page only (the app holds nothing yet);
//   e2e/.signed-in.json:   also the app, with the e2e vault added and the self-test passed.
import { expect, test as setup } from "@playwright/test";
import { hubState } from "./hub";
import { signIn } from "./helpers";

export const HUB_SESSION = "e2e/.hub-session.json";
export const SIGNED_IN = "e2e/.signed-in.json";

setup("sign in on the hub with a password, then add the vault in the app", async ({ page }) => {
  const hub = hubState();
  await page.goto(`${hub.origin}/login`);
  await page.locator('input[name="username"]').fill("owner");
  await page.locator('input[type="password"]').fill(hub.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((u) => u.origin === hub.origin && u.pathname !== "/login");
  await page.waitForLoadState("networkidle");
  await page.context().storageState({ path: HUB_SESSION });
  await signIn(page);
  await page.goto("/settings");
  await expect(page.getByRole("status").filter({ hasText: /approved code only|run sealed/ })).toBeVisible({ timeout: 45_000 });
  await page.context().storageState({ path: SIGNED_IN });
});
