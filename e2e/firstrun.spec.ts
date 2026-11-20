// The first sign-in on a device whose person already has a home applet in their settings (Aaron's Uni app: Home opens
// on start). Found on the emulator walk (T-476 dogfood): the app started with no vault, so it never decided the start;
// the sign-in landed on the list, Home was allowed from the bar, and the next start found it stopped ("Home is
// stopped. Open Home"). Now the first vault's arrival decides it as a start does: the card on the home's screen, and
// Allow there is the person's choice of it as home on this device.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { api, hubState, mintToken, MORE_VAULTS, VAULT } from "./hub";

type Row = { id: string };

/** Sign in on this new device with a password and the hub's consent, until the app is back: on the home's screen. At
 *  the pick, `home` is chosen; or, with `offered`, the test only checks the app offers it and takes what is offered. */
async function signInToHome(page: Page, home = VAULT, offered = false) {
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
    if (u.origin === app && u.pathname.startsWith(`/v/${home}/a/`)) return "home";
    if (u.origin === app && u.pathname === "/" && !(await pick.isVisible().catch(() => false))) return "list";
    if (u.origin === app && await pick.isVisible().catch(() => false)) return "pick";
    return u.origin === hub.origin && await approve.isVisible().catch(() => false) ? "asked" : "wait";
  };
  for (let i = 0; i < 6; i++) {
    await expect.poll(where, { timeout: 30_000 }).not.toBe("wait");
    const at = await where();
    if (at === "home" || at === "list") break;
    if (at === "pick") {
      const radio = page.getByRole("radio", { name: home, exact: true });
      if (offered) await expect(radio).toBeChecked();
      else if (await radio.count()) await radio.check();
      await pick.click();
    }
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

// Aaron's case on every new device (wknd audit, walk 1 rows 3 and 7): more than one vault of his own, and the one holding
// his settings isn't the first by name. Here `kitchen` is first by name and holds no settings; `pantry` holds them and
// the home applet. The pick offers pantry as home without a tap; the sign-in opens its home applet; Allow there (with
// the hub's page in between, as Home needs write) is the choice of it, so the next start opens it running.
test("several vaults: the one holding the settings is offered as home, and Allow on its home applet is the choice", async ({ page }) => {
  test.setTimeout(150_000);
  const hub = hubState();
  const home = MORE_VAULTS.find((m) => m.vault === "pantry")!.vault;
  const at = { origin: hub.origin, token: mintToken(`vault:${home}:write`) };
  for (const v of [VAULT, ...MORE_VAULTS.map((m) => m.vault)]) {
    const t = v === VAULT ? hub : { origin: hub.origin, token: mintToken(`vault:${v}:write`) };
    for (const n of await api(t, "GET", "notes?tag=parachute-settings", undefined, v) as Row[]) await api(t, "DELETE", `notes/${n.id}`, undefined, v);
  }
  const fixture = join(import.meta.dirname, "fixtures/vault/Applets/Recipes");
  const made: Row[] = [];
  try {
    made.push(await api(at, "POST", "notes", { path: "Applets/Recipes", extension: "html", tags: ["applet"], content: readFileSync(`${fixture}.html`, "utf8"), metadata: JSON.parse(readFileSync(`${fixture}.json`, "utf8")) }, home) as Row);
    made.push(await api(at, "POST", "notes", { path: "Parachute/Settings", tags: ["parachute-settings"], content: "settings",
      metadata: { parachute: { start: { vault: home, applet: "Applets/Recipes" }, bar: [{ vault: home, applet: "Applets/Recipes" }] } } }, home) as Row);
    await signInToHome(page, home, true);
    expect(await page.evaluate(() => (JSON.parse(localStorage.getItem("parachute.vaults.v1") ?? "[]") as { vault: string }[]).map((v) => v.vault))).toEqual([home]);
    await expect(page).toHaveURL(new RegExp(`/v/${home}/a/`));
    await expect(page.getByRole("region", { name: /asking for access/ })).toBeVisible({ timeout: 45_000 });
    await page.getByRole("button", { name: "Allow" }).click();
    await page.waitForURL((u) => u.origin === hub.origin);
    await page.getByRole("button", { name: "Approve" }).click();
    await expect(page.frameLocator("iframe.applet-frame").getByRole("heading", { name: "Recipe box" })).toBeVisible();
    // the second open: running, no "Recipe box is stopped. Open Recipe box"
    await page.goto("about:blank");
    await page.goto("/");
    await expect(page).toHaveURL(new RegExp(`/v/${home}/a/`));
    await expect(page.frameLocator("iframe.applet-frame").getByRole("heading", { name: "Recipe box" })).toBeVisible();
    await expect(page.getByText(/is stopped/)).toHaveCount(0);
  } finally {
    for (const n of made) await api(at, "DELETE", `notes/${n.id}`, undefined, home).catch(() => {});
  }
});
