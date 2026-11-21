// The phone's keyboard: Android marks the page's root `keyboard-up` from the keyboard's own inset (MainActivity.kt);
// then the bar steps aside and the applet's frame reaches the foot (styles.css), and both come back when it goes.
import { expect, test } from "@playwright/test";

test.use({ storageState: "e2e/.signed-in.json" });

test("while the keyboard is up the bar steps aside and the applet reaches the foot", async ({ page }) => {
  await page.goto("/journal");
  const bar = page.getByRole("navigation", { name: "Bar" });
  await expect(bar).toBeVisible();
  const frame = page.locator("iframe.applet-frame");
  await expect(frame).toBeVisible();
  const foot = async () => { const b = await frame.boundingBox(); return Math.round(b!.y + b!.height); };
  const height = page.viewportSize()!.height;
  const before = await foot();
  expect(before).toBeLessThan(height);
  const mark = (up: boolean) => page.evaluate((u) => document.documentElement.classList.toggle("keyboard-up", u), up);
  await mark(true);
  await expect(bar).toBeHidden();
  await expect.poll(foot).toBeGreaterThanOrEqual(before + 50); // the bar's room (58 px) is the applet's
  await mark(false);
  await expect(bar).toBeVisible();
  await expect.poll(foot).toBe(before);
});
