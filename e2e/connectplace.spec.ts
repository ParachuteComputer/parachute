// Connect an AI is a setting, not an applet (T-476, Aaron 11-23: "I even see 'Connect your AI' listed as an applet,
// which itself is a bit confusing to me"): the list of applets doesn't hold it; Settings has it, one tap away, and it
// opens the same Connect screen.
import { expect, test } from "./test";
import { ui } from "./helpers";

test.use({ storageState: "e2e/.signed-in.json" });

test("Connect an AI: not in the list of applets; in Settings, where a tap opens it", async ({ page }) => {
  await page.goto("/");
  const list = ui(page).getByRole("list", { name: "Applets" });
  await expect(list.getByRole("link", { name: /^Journal/ })).toBeVisible();
  await expect(list.getByRole("link", { name: /Connect/ })).toHaveCount(0);

  await page.goto("/settings");
  const ai = page.getByRole("region", { name: "Your AI" });
  await expect(ai).toContainText("Claude, ChatGPT and other AIs reach your vaults through one address.");
  await ai.getByRole("link", { name: "Connect an AI" }).click();
  await expect(page).toHaveURL(/\/connect$|parachute%3Aconnect$/);
  await expect(page.frameLocator("iframe.applet-frame").getByRole("heading", { name: "Connect an AI" })).toBeVisible();
});
