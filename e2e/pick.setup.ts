// A sign-in of the pick walks' own (e2e/vaultpick.spec.ts), last in the run, through the hub's key door: no password
// (a fourth password sign-in in one run meets the hub's limit), and the sign-ins the specs before it shared are left as
// they were. The person's own vaults, each opened and let write, as the shared start does.
import { expect, test as setup } from "./test";
import { hubState, MORE_VAULTS, VAULT } from "./hub";
import { letWrite, openVault, signInWithKey } from "./helpers";

export const PICK_SIGNED_IN = "e2e/.pick-signed-in.json";

setup("the pick walks' own sign-in, with the person's key", async ({ page }) => {
  setup.setTimeout(180_000);
  await signInWithKey(page, hubState(), VAULT, "Mine");
  for (const v of MORE_VAULTS) await openVault(page, v.vault);
  for (const v of MORE_VAULTS.map((m) => m.vault)) await letWrite(page, v);
  await page.goto("/settings");
  await expect(page.getByRole("status").filter({ hasText: /approved code only|run sealed/ })).toBeVisible({ timeout: 45_000 });
  await page.context().storageState({ path: PICK_SIGNED_IN });
});
