// Settings in a few plain groups, and what Parachute holds of each vault in words (T-476, Aaron 11-22: "it's still
// talking about how we have access to all of these vaults"): one line a vault, what it holds and what for; why, whose it
// is and its actions behind a tap on it (src/views/reachWords.ts, docs/ACCESS.md).
import { expect, test, type Page } from "@playwright/test";
import { api, hubState, mintToken, MORE_VAULTS } from "./hub";
import { vaultRow } from "./helpers";

test.use({ storageState: "e2e/.signed-in.json" });

const line = (page: Page, vault: string) => page.locator("details.vault-more").filter({ has: page.locator(".vault-name", { hasText: new RegExp(`^${vault}$`) }) }).locator(".vault-reach");

test("Settings is a few groups; each vault is one line of what Parachute holds and why, the rest behind a tap", async ({ page }) => {
  await page.goto("/settings");
  // the groups, in order; one none of whose sections shows (This device, on the web) isn't drawn
  await expect(page.locator("main.settings h2:visible")).toHaveText(["You", "Your Parachutes", "Updates"]);
  await expect(page.getByText("Parachute reaches your home vault, and another vault only when you open it or allow an applet there.")).toBeVisible();
  await expect(page.locator(".settings-parachute").first()).toContainText("Parachute reaches 3 vaults here.");
  // the home, and a vault held for a change of the person's own (the sign-in the tests share wrote a note in each)
  await expect(line(page, "kitchen")).toHaveText("reads and changes notes · your home");
  await expect(line(page, "pantry")).toHaveText("reads and changes notes · for your own changes");
  // whose it is and Sign out are behind the tap, not on the line
  await expect(page.getByRole("combobox", { name: "Whose pantry is" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Sign out of pantry" })).toBeHidden();
  const row = await vaultRow(page, "pantry");
  await expect(row).toContainText("You let Parachute change notes here for a change of your own.");
  await expect(row.getByRole("combobox", { name: "Whose pantry is" })).toHaveValue("mine");
  await expect(row.getByRole("button", { name: "Sign out of pantry" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open pantry", exact: true })).toBeVisible();

  // an applet allowed in letters: its line says it is for that applet
  const post = MORE_VAULTS.find((m) => m.vault === "letters")!;
  const [rec] = (await api({ origin: hubState().origin, token: mintToken("vault:letters:read") }, "GET", `notes?path_prefix=${encodeURIComponent(`Applets/${post.applet}`)}`, undefined, "letters")) as { id: string }[];
  await page.goto(`/v/letters/a/${rec.id}`);
  await page.getByRole("button", { name: "Allow" }).click();
  await expect(page.frameLocator("iframe.applet-frame").getByRole("heading", { name: post.applet })).toBeVisible();
  await page.goto("/settings");
  await expect(line(page, "letters")).toHaveText(`reads and changes notes · for ${post.applet}`);
  await expect(await vaultRow(page, "letters")).toContainText(`${post.applet} reaches it, as you allowed on its card.`);
  // revoked in Applets, on this screen: the line says so at once
  await page.getByRole("list", { name: "Allowed applets" }).getByRole("listitem").filter({ hasText: post.applet }).getByRole("button", { name: "Revoke" }).click();
  await expect(line(page, "letters")).toHaveText("reads and changes notes · for your own changes");
});
