// Sign in once, two ways, and keep the result for the tests (the hub rate-limits password sign-ins, as it should):
//   e2e/.hub-session.json: signed in on the hub's own page only (the app holds nothing yet);
//   e2e/.signed-in.json:   also the app, with the e2e vault added and the self-test passed.
import { expect, test as setup } from "@playwright/test";
import { api, hubState } from "./hub";
import { held, letWrite, openVault, signIn } from "./helpers";
import { MORE_VAULTS, VAULT } from "./hub";

export const HUB_SESSION = "e2e/.hub-session.json";
export const SIGNED_IN = "e2e/.signed-in.json";

setup("sign in on the hub with a password, then add the vault in the app", async ({ page: onHub }) => {
  setup.setTimeout(180_000);
  const hub = hubState();
  await onHub.goto(`${hub.origin}/login`);
  await onHub.locator('input[name="username"]').fill("owner");
  await onHub.locator('input[type="password"]').fill(hub.password);
  await onHub.getByRole("button", { name: "Sign in", exact: true }).click();
  await onHub.waitForURL((u) => u.origin === hub.origin && u.pathname !== "/login");
  await onHub.waitForLoadState("networkidle");
  await onHub.context().storageState({ path: HUB_SESSION });
  // the app in a page of its own: the hub's page may still move itself on (to its vault admin) after it looked idle,
  // and on a busy machine that move lands on the app's first load and aborts it
  const page = await onHub.context().newPage();
  await onHub.close();
  await signIn(page);
  // the sign-in reads and writes the home only (docs/design/SCOPES.md; e2e/scopes.spec.ts checks that): the tests that
  // share this start were written for a person who has opened every vault and let the app change notes in each, so it
  // does that here, the way a person does
  expect((await held(page))[VAULT]).toContain(`vault:${VAULT}:write`);
  for (const v of MORE_VAULTS) await openVault(page, v.vault);
  for (const v of MORE_VAULTS.map((m) => m.vault)) await letWrite(page, v);
  // the sign-in put the hub on the person's list, in a settings note of the home vault; the tests that follow write
  // their own settings note, so the shared start has none (e2e/parachutes.spec.ts covers the list)
  for (const n of await api(hubState(), "GET", "notes?tag=parachute-settings")) await api(hubState(), "DELETE", `notes/${n.id}`);
  await page.goto("/settings");
  await expect(page.getByRole("status").filter({ hasText: /approved code only|run sealed/ })).toBeVisible({ timeout: 45_000 });
  await page.context().storageState({ path: SIGNED_IN });
});
