import { expect, type Page } from "@playwright/test";
import { hubState, VAULT } from "./hub";
import { keyDoor } from "./keys";

/** The app back from the hub with every vault kept: on the launcher, `vault`'s chapter shown. */
async function backOnTheLauncher(page: Page, vault: string) {
  await expect(ui(page).getByRole("region", { name: vault, exact: true })).toBeVisible({ timeout: 20_000 });
}

/** The hub's Approve, as many times as it asks (the app without a key asks twice: to see which vaults are the person's,
 *  then for all of them at once), until the app is back on its launcher. Returns how many times it asked. */
export async function approveUntilBack(page: Page, hubOrigin: string, appOrigin: string, onPick?: (page: Page) => Promise<void>): Promise<number> {
  const approve = page.getByRole("button", { name: "Approve" });
  // on a hub the person runs, the app asks which of its vaults are theirs before the consent: all ticked, Continue
  const pick = page.getByRole("button", { name: "Continue" });
  const where = async () => {
    const u = new URL(page.url());
    if (u.origin === appOrigin && u.pathname === "/") return "back";
    if (u.origin === appOrigin && await pick.isVisible().catch(() => false)) return "pick";
    return u.origin === hubOrigin && await approve.isVisible().catch(() => false) ? "asked" : "wait";
  };
  for (let asked = 0; ; ) {
    await expect.poll(where, { timeout: 30_000 }).not.toBe("wait");
    const at = await where();
    if (at === "back") return asked;
    const before = page.url();
    if (at === "pick") await (onPick ? onPick(page) : Promise.resolve());
    await (at === "pick" ? pick : approve).click();
    if (at === "asked") asked++;
    await page.waitForURL((u) => u.href !== before);
  }
}

/** Add the person's own Parachute (the e2e home hub) and sign in through the hub's own pages: its sign-in with the
 *  owner's password, then its Approves. Every vault there comes with it; the app opens on the launcher. */
export async function signIn(page: Page, vault = VAULT) {
  const hub = hubState();
  await page.goto("/");
  const app = new URL(page.url()).origin;
  await page.getByLabel("Your Parachute's address").fill(hub.origin);
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
  await approveUntilBack(page, hub.origin, app);
  await backOnTheLauncher(page, vault);
}

/** The frame: the vault list, a vault, a note and open-with, in their sealed iframe. The shell's own screens (signing in,
 *  an applet and its card, Settings) are on the page itself. */
export const ui = (page: Page) => page.frameLocator("iframe.app-frame");

/** Add another Parachute (the org's) and sign in there with the person's key: the hub's key door (signed by the test, as
 *  the app's native side signs it), then the hub's own Approves. Returns how many times the hub asked. */
export async function signInWithKey(page: Page, hub: { origin: string }, vault: string, whose: "Mine" | RegExp = /Someone else's/, onPick?: (page: Page) => Promise<void>): Promise<number> {
  const cookies = await keyDoor(hub.origin, hubState().key);
  await page.context().addCookies(cookies.map((c) => ({ ...c, url: hub.origin })));
  await page.goto("/add");
  const app = new URL(page.url()).origin;
  await page.getByLabel("Your Parachute's address").fill(hub.origin);
  await page.getByRole("radio", { name: whose }).check();
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => u.origin === hub.origin);
  const asked = await approveUntilBack(page, hub.origin, app, onPick);
  await backOnTheLauncher(page, vault);
  return asked;
}
