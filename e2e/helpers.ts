import { expect, type Page } from "@playwright/test";
import { hubState, VAULT } from "./hub";

/** Add the e2e vault and sign in through the hub's own pages: its sign-in, then its one Approve. */
export async function signIn(page: Page, vault = VAULT) {
  const hub = hubState();
  await page.goto("/");
  await page.getByLabel("Vault address").fill(`${hub.origin}/vault/${vault}`);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => u.origin === hub.origin);
  // a new registration is pending until the hub's owner approves it: the hub asks them to sign in first
  const approveFirst = page.getByText("Sign in as admin to approve");
  if (await approveFirst.isVisible().catch(() => false)) await approveFirst.click();
  if (await page.locator('input[type="password"]').isVisible().catch(() => false)) {
    await page.locator('input[name="username"]').fill("owner");
    await page.locator('input[type="password"]').fill(hub.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  }
  // the hub asks to approve this registration once; a hub that already holds the grant sends the person straight back
  const approve = page.getByRole("button", { name: "Approve" });
  await Promise.race([approve.waitFor(), page.waitForURL(`**/v/${vault}`)]);
  if (await approve.isVisible().catch(() => false)) await approve.click();
  await page.waitForURL(`**/v/${vault}`);
  await expect(page.getByRole("list", { name: "Notes" })).toBeVisible();
}
