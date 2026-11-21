// The on-screen keyboard (src/shell/keyboard.ts): on a phone the window gets much shorter while one types; the bar steps
// aside then, and comes back when the keyboard goes. A window made shorter while nothing is being typed keeps it.
import { expect, test } from "@playwright/test";

test.use({ storageState: "e2e/.signed-in.json" });

test("the bar steps aside while the keyboard is up, and only then", async ({ page }) => {
  await page.goto("/journal");
  const bar = page.getByRole("navigation", { name: "Bar" });
  await expect(bar).toBeVisible();
  const size = page.viewportSize()!;
  const keyboard = { width: size.width, height: size.height - 320 };
  // shorter with nothing being typed (a window resized): the bar stays
  await page.setViewportSize(keyboard);
  await expect(bar).toBeVisible();
  await page.setViewportSize(size);
  // a field in focus (inside the applet's frame) and the window shorter, as a phone's keyboard makes it: the bar steps aside
  await page.frameLocator("iframe.applet-frame").locator("textarea").first().focus();
  await page.setViewportSize(keyboard);
  await expect(bar).toBeHidden();
  // the keyboard goes: the bar is back
  await page.setViewportSize(size);
  await expect(bar).toBeVisible();
});
