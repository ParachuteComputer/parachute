// The first sign-in on a device whose person already has a home applet in their settings (Aaron's Uni app: Home opens
// on start). Found on the emulator walk (T-476 dogfood): the app started with no vault, so it never decided the start;
// the sign-in landed on the list, Home was allowed from the bar, and the next start found it stopped ("Home is
// stopped. Open Home"). Now the first vault's arrival decides it as a start does: the card on the home's screen, and
// Allow there is the person's choice of it as home on this device.
import { expect, test, type Page } from "@playwright/test";
import { api, hubState, VAULT } from "./hub";

type Row = { id: string };

/** Sign in on this new device with a password and the hub's consent, until the app is back: on the home's screen. */
async function signInToHome(page: Page) {
  const hub = hubState();
  await page.goto("/");
  const app = new URL(page.url()).origin;
  await page.getByLabel("Your Parachute's address").fill(hub.origin);
  await page.getByRole("radio", { name: "Mine" }).check();
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => u.origin === hub.origin);
  if (await page.locator('input[type="password"]').isVisible().catch(() => false)) {
    await page.locator('input[name="username"]').fill("owner");
    await page.locator('input[type="password"]').fill(hub.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  }
  // the vaults to pick (home: the e2e vault), then the hub's consent, until the app is back: on the home's screen
  const approve = page.getByRole("button", { name: "Approve" }), pick = page.getByRole("button", { name: "Continue" });
  const where = async () => {
    const u = new URL(page.url());
    if (u.origin === app && u.pathname.startsWith(`/v/${VAULT}/a/`)) return "home";
    if (u.origin === app && u.pathname === "/" && !(await pick.isVisible().catch(() => false))) return "list";
    if (u.origin === app && await pick.isVisible().catch(() => false)) return "pick";
    return u.origin === hub.origin && await approve.isVisible().catch(() => false) ? "asked" : "wait";
  };
  for (let i = 0; i < 6; i++) {
    await expect.poll(where, { timeout: 30_000 }).not.toBe("wait");
    const at = await where();
    if (at === "home" || at === "list") break;
    if (at === "pick") { const home = page.getByRole("radio", { name: VAULT, exact: true }); if (await home.count()) await home.check(); await pick.click(); }
    else await approve.click();
    await page.waitForTimeout(500);
  }
}

test("first sign-in with a home in the settings: its card first, and after Allow the next start opens it running", async ({ page }) => {
  test.setTimeout(120_000);
  const hub = hubState();
  for (const n of await api(hub, "GET", "notes?tag=parachute-settings") as Row[]) await api(hub, "DELETE", `notes/${n.id}`);
  const settings = await api(hub, "POST", "notes", { path: "Parachute/Settings", tags: ["parachute-settings"], content: "settings",
    metadata: { parachute: { start: { vault: VAULT, applet: "Applets/Recipes" }, bar: [{ vault: VAULT, applet: "Applets/Recipes" }] } } }) as Row;
  try {
    await signInToHome(page);
    // the home's screen, not the list: its card once this new device's self-test has passed, nothing running
    await expect(page).toHaveURL(new RegExp(`/v/${VAULT}/a/`));
    await expect(page.getByText("Your settings open Recipe box when the app starts.")).toBeVisible();
    await expect(page.getByRole("region", { name: /asking for access/ })).toBeVisible({ timeout: 45_000 });
    await expect(page.locator("iframe.applet-frame")).toHaveCount(0);
    await page.getByRole("button", { name: "Allow" }).click();
    const approve = page.getByRole("button", { name: "Approve" });
    // the sign-in read the home only: the hub asks to let Parachute change notes there, then back to the home, running
    await page.waitForURL((u) => u.origin === hub.origin);
    await approve.click();
    await expect(page.frameLocator("iframe.applet-frame").getByRole("heading", { name: "Recipe box" })).toBeVisible();
    // the next start opens it running: no card, no "stopped", no tap
    await page.goto("about:blank");
    await page.goto("/");
    await expect(page.frameLocator("iframe.applet-frame").getByRole("heading", { name: "Recipe box" })).toBeVisible();
    await expect(page.getByText(/is stopped/)).toHaveCount(0);
  } finally {
    await api(hub, "DELETE", `notes/${settings.id}`).catch(() => {});
  }
});

test("a Deny on the hub after Allow on the first start's home records no choice of it", async ({ page }) => {
  test.setTimeout(120_000);
  const hub = hubState();
  for (const n of await api(hub, "GET", "notes?tag=parachute-settings") as Row[]) await api(hub, "DELETE", `notes/${n.id}`);
  const settings = await api(hub, "POST", "notes", { path: "Parachute/Settings", tags: ["parachute-settings"], content: "settings",
    metadata: { parachute: { start: { vault: VAULT, applet: "Applets/Recipes" } } } }) as Row;
  try {
    await signInToHome(page);
    await expect(page.getByRole("region", { name: /asking for access/ })).toBeVisible({ timeout: 45_000 });
    await page.getByRole("button", { name: "Allow" }).click();
    await page.waitForURL((u) => u.origin === hub.origin);
    await page.getByRole("button", { name: "Deny" }).click();
    await page.waitForURL((u) => u.origin !== hub.origin);
    await expect(page.getByText("You said no on the hub. Nothing changed.")).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("parachute.start.v1"))).toBeNull();
  } finally {
    await api(hub, "DELETE", `notes/${settings.id}`).catch(() => {});
  }
});
