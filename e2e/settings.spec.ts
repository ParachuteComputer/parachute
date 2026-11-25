// Settings shows only what a person uses, in the shared app's words. Security, Approving code (with Root key) and Frame
// appear only when they can matter on this device: the person's key here and an applet whose Allow that key would sign;
// for Frame, a frame of their own in the home vault (src/views/settingsShown.ts). The app names no one's agent and no
// one's network. At a phone's 390 px, a vault's line in Your Parachutes stays inside its card.
// Each test signs in fresh on a new device, as a newcomer does, so it runs with the specs that sign in again.
import { devices, expect, test, type Page } from "./test";
import { api, hubState, mcp } from "./hub";
import { signIn } from "./helpers";
import { newKey } from "./keys";

// a new device: nothing kept from another run, the hub's own sign-in page too
const PHONE = { viewport: { width: 390, height: 844 }, storageState: { cookies: [], origins: [] } };
test.use(PHONE);

const SECTIONS = ["Security", "Approving code", "Root key", "Frame"];
const heading = (page: Page, name: string) => page.getByRole("heading", { name, exact: true });
const shot = (page: Page, name: string) => page.screenshot({ path: test.info().outputPath(name), fullPage: true });
const NAMES = /\bUni\b|Hermes|WireGuard/;

/** Every vault line's buttons inside the card, each on one line, and nothing wider than the screen. */
async function staysInside(page: Page) {
  const card = page.locator("section[aria-labelledby=s-vaults]");
  // each vault's actions are behind a tap on its line
  for (const d of await card.locator("details.vault-more").all()) if ((await d.getAttribute("open")) === null) await d.locator("summary").click();
  const box = (await card.boundingBox())!;
  const again = card.getByRole("button", { name: /^Sign in again to / });
  await expect(again.first()).toBeVisible();
  await card.screenshot({ path: test.info().outputPath("signin-again.png") });
  for (const b of await again.all()) {
    const r = (await b.boundingBox())!;
    expect(r.x + r.width, "Sign in again ends inside its card").toBeLessThanOrEqual(box.x + box.width);
    expect(r.height, "Sign in again is one line").toBeLessThan(40);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
}

test("a newcomer (no key on this device, no frame of their own) sees none of the key sections, and no one's names", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page);
  await page.goto("/settings");
  // what every person has is there, and the applets were read (their section says how they run here)
  await expect(heading(page, "Your Parachutes")).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: /approved code only|run sealed/ })).toBeVisible({ timeout: 45_000 });
  await shot(page, "settings-newcomer-390.png");
  await staysInside(page);
  for (const s of SECTIONS) await expect(heading(page, s)).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText(NAMES);
  // the privacy policy is reachable from inside the app (Google Play and Apple ask it)
  await expect(page.getByRole("link", { name: "Privacy", exact: true })).toHaveAttribute("href", "https://parachute.computer/privacy/");
});

test("with the person's key here, an applet to approve and a frame of theirs, the sections show, in plain words", async ({ browser }) => {
  test.setTimeout(120_000);
  const hub = hubState();
  const { defaultBrowserType: _b, ...phone } = devices["Pixel 7"];
  const ctx = await browser.newContext({ ...phone, ...PHONE });
  await ctx.addInitScript((k) => { if (window === window.top) (window as unknown as { __parachuteE2EKey: string }).__parachuteE2EKey = k; }, newKey());
  const page = await ctx.newPage();
  const frame = await mcp(hub, "create-note", { path: "Parachute/Frame", extension: "tsx", tags: ["parachute-frame"], content: "export default function Frame() { return null; }" }) as { id: string };
  try {
    await signIn(page);
    await page.goto("/settings");
    for (const s of SECTIONS) await expect(heading(page, s)).toBeVisible({ timeout: 45_000 });
    await expect(page.getByText("your agent's approval cards", { exact: false })).toBeVisible();
    await expect(page.getByText("a private network", { exact: false })).toBeVisible();
    await shot(page, "settings-keyed-390.png");
    await expect(page.locator("main")).not.toContainText(NAMES);
  } finally {
    await api(hub, "DELETE", `notes/${frame.id}`).catch(() => {});
    await ctx.close();
  }
});
