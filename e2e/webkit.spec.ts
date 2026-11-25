// The applet frame in WebKit, the engine of the Mac app (WKWebView) and of Safari, at a Mac's width (T-476, Aaron 11-23:
// "when I click various Applets, such as Journal it just says couldn't load this applet"). Every other spec runs in
// Chromium (Android's webview); these run the same build in WebKit: Parachute's own Journal and Connect, a vault's
// applet (HTML, today's tsx and an older next's tsx), and a home vault the app can't reach, which is what Aaron's Mac
// showed (docs/INSTALL-MAC.md, "If something goes wrong").
import { readFileSync } from "node:fs";
import { expect, test } from "./test";
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

test("a Parachute that doesn't answer: the list and Journal say so in plain words, with what to do", async ({ page }) => {
  // the hub doesn't answer (it is off, or this device kept an address that went away): every request to it fails as a
  // browser fails one that reached no one ("Load failed", WebKit says)
  // (a device that has read nothing of it yet: one that has draws from the copies it kept)
  const hub = `${hubState().origin}/**`;
  await page.route(hub, (r) => r.abort("connectionrefused"));
  await page.goto("/");
  const list = ui(page).getByRole("list", { name: "Applets" });
  await expect(list.getByText(`Can't reach ${VAULT}, your home vault, just now.`)).toBeVisible({ timeout: 30_000 });
  await expect(list.getByText(/couldn't be read/)).toHaveCount(0);

  await page.goto(`/v/${VAULT}/a/parachute:journal`);
  const said = page.getByRole("alert");
  await expect(said).toContainText(`Parachute can't reach ${VAULT}, your home vault, just now. Journal runs there.`, { timeout: 30_000 });
  await expect(said).toContainText(`Its Parachute is 127.0.0.1. In Settings you can make another vault your home.`);
  await expect(said.getByRole("link", { name: "Settings" })).toBeVisible();
  await expect(page.getByText("Couldn't open this applet")).toHaveCount(0);

  // answering again: Try again opens it
  await page.unroute(hub);
  await said.getByRole("button", { name: "Try again" }).click();
  await expect(page.frameLocator("iframe.applet-frame").getByRole("heading", { name: "Journal" })).toBeVisible();
});

// last: it ends this browser's sign-in, as a hub that refused it would
test("a Parachute that refuses this device's sign-in: Journal says to sign in again", async ({ page }) => {
  const origin = hubState().origin;
  await page.route(`${origin}/vault/${VAULT}/**`, (r) => r.fulfill({ status: 401, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: '{"error":"invalid_token"}' }));
  await page.route(`${origin}/oauth/token`, (r) => r.fulfill({ status: 400, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: '{"error":"invalid_grant"}' }));
  await page.goto(`/v/${VAULT}/a/parachute:journal`);
  const said = page.getByRole("alert");
  await expect(said).toContainText(`${VAULT} on 127.0.0.1 wants you to sign in again. Journal runs there.`, { timeout: 30_000 });
  await expect(said.getByRole("link", { name: "Sign in again" })).toHaveAttribute("href", `/add?hub=${encodeURIComponent(origin)}`);
});
