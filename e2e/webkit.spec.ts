// The applet frame in WebKit, the engine of the Mac app (WKWebView) and of Safari, at a Mac's width (T-476, Aaron 11-23:
// "when I click various Applets, such as Journal it just says couldn't load this applet"). Every other spec runs in
// Chromium (Android's webview); these run the same build in WebKit: Parachute's own Journal and Connect, a vault's
// applet (HTML, today's tsx and an older next's tsx), and a home vault the app can't reach, which is what Aaron's Mac
// showed (docs/INSTALL-MAC.md, "If something goes wrong").
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { installApplet, ui } from "./helpers";
import { hubState, VAULT } from "./hub";

test.use({ storageState: "e2e/.signed-in.json" });

test("Parachute's own Journal and Connect open in WebKit", async ({ page }) => {
  await page.goto(`/v/${VAULT}/a/parachute:journal`);
  const journal = page.frameLocator("iframe.applet-frame");
  await expect(journal.getByRole("heading", { name: "Journal" })).toBeVisible({ timeout: 30_000 });
  await expect(journal.getByLabel("Write in your journal")).toBeVisible();
  await page.goto("/connect");
  await expect(page.frameLocator("iframe.applet-frame").getByRole("heading", { name: "Connect an AI" })).toBeVisible();
  await expect(page.frameLocator("iframe.applet-frame").getByText(`${hubState().origin}/account/mcp`)).toBeVisible();
});

for (const [which, change] of [
  ["today's Journal", undefined],
  ["Journal as an older vault keeps it (6d4828b)", (r: { body?: unknown }) => ({ ...r, body: readFileSync(new URL("./fixtures/older-journal/journal.tsx", import.meta.url), "utf8") })],
] as const) test(`a vault's applet opens in WebKit: ${which}, and the vault's HTML applet`, async ({ page }) => {
  const made = await installApplet("journal", {}, change as never);
  try {
    await page.goto(`/v/${VAULT}/a/${made.id}`);
    await page.getByRole("button", { name: "Allow" }).click();
    const app = page.frameLocator("iframe.applet-frame");
    await expect(app.getByRole("heading", { name: "Journal" })).toBeVisible();
    await expect(app.getByLabel("Write in your journal")).toBeVisible();
  } finally { await made.remove(); }
  await page.goto("/");
  await ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name: /Recipe box/ }).click();
  await page.getByRole("button", { name: "Allow" }).click();
  await expect(page.frameLocator("iframe.applet-frame").getByRole("heading").first()).toBeVisible();
});

test("a home vault Parachute can't reach: the list and Journal say so in plain words, with what to do", async ({ page }) => {
  // the hub doesn't answer for the home vault (a Parachute that is off, an address that went away): every read of it fails
  // as a browser fails a request that reached no one ("Load failed", WebKit says)
  const home = `${hubState().origin}/vault/${VAULT}/**`;
  await page.route(home, (r) => r.abort("connectionrefused"));
  await page.goto("/");
  const list = ui(page).getByRole("list", { name: "Applets" });
  await expect(list.getByText(`Can't reach ${VAULT} just now.`)).toBeVisible();
  await expect(list.getByText(/couldn't be read/)).toHaveCount(0);
  // the other vaults' applets are listed as ever
  await expect(list.getByRole("link", { name: /Post/ })).toBeVisible();

  await page.goto(`/v/${VAULT}/a/parachute:journal`);
  const said = page.getByRole("alert");
  await expect(said).toContainText(`Parachute can't reach ${VAULT}, your home vault, just now. Journal runs there.`, { timeout: 30_000 });
  await expect(said).toContainText("In Settings you can sign in to it again or make another vault your home.");
  await expect(said.getByRole("link", { name: "Settings" })).toBeVisible();
  await expect(page.getByText("Couldn't open this applet")).toHaveCount(0);

  // reached again: Try again opens it
  await page.unroute(home);
  await said.getByRole("button", { name: "Try again" }).click();
  await expect(page.frameLocator("iframe.applet-frame").getByRole("heading", { name: "Journal" })).toBeVisible();
});
