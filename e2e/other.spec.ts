// Another Parachute in yours (docs/OTHER-PARACHUTES.md): the org's hub, signed in to with the person's key.
import { expect, test } from "@playwright/test";
import { ORG_VAULT, techneState } from "./hub";
import { signInWithKey, ui } from "./helpers";

test.use({ storageState: "e2e/.signed-in.json" });

test("the org's vault is added with the person's key, and the launcher marks it as another Parachute", async ({ page }) => {
  await signInWithKey(page, techneState(), ORG_VAULT);
  await page.goto("/");
  await expect(ui(page).getByRole("region", { name: ORG_VAULT })).toBeVisible();
});
