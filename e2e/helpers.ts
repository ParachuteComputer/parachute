import { expect, type Page } from "@playwright/test";
import { hubState, VAULT } from "./hub";
import { keyDoor } from "./keys";

/** Add the e2e vault and sign in through the hub's own pages: its sign-in, then its one Approve. */
export async function signIn(page: Page, vault = VAULT) {
  const hub = hubState();
  await page.goto("/");
  await page.getByLabel("Vault address").fill(`${hub.origin}/vault/${vault}`);
  await page.getByRole("radio", { name: "Mine" }).check();
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
  await expect(ui(page).getByRole("list", { name: "Notes" })).toBeVisible();
}

/** The frame: the vault list, a vault, a note and open-with, in their sealed iframe. The shell's own screens (signing in,
 *  an applet and its card, Settings) are on the page itself. */
export const ui = (page: Page) => page.frameLocator("iframe.app-frame");

/** Add another Parachute's vault (the org's) and sign in there with the person's key: the hub's key door (signed by the
 *  test, as the app's native side signs it), then the hub's own Approve. */
export async function signInWithKey(page: Page, hub: { origin: string }, vault: string) {
  const cookies = await keyDoor(hub.origin, hubState().key);
  await page.context().addCookies(cookies.map((c) => ({ ...c, url: hub.origin })));
  await page.goto("/add");
  await page.getByLabel("Vault address").fill(`${hub.origin}/vault/${vault}`);
  await page.getByRole("radio", { name: /Someone else's/ }).check();
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => u.origin === hub.origin);
  const approve = page.getByRole("button", { name: "Approve" });
  await Promise.race([approve.waitFor(), page.waitForURL(`**/v/${vault}`)]);
  if (await approve.isVisible().catch(() => false)) await approve.click();
  await page.waitForURL(`**/v/${vault}`);
  await expect(ui(page).getByRole("list", { name: "Notes" })).toBeVisible();
}
