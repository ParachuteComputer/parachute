// A vault made on the person's Parachute after this device signed in there comes to Settings as one quiet line,
// "Open <vault>" (src/vault/newVaults.ts; the same line as every vault the sign-in didn't read), asked when the app
// opens and when the list or Settings shows again, at most once a minute per hub. A tap goes through the hub's consent to read
// it, once; Not now keeps it away. It signs in
// itself (the shared sign-in would be retired by it), so it runs with the sign-in specs, last.
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { approveUntilBack, moreVaults, openMore, signIn, ui } from "./helpers";
import { api, cli, hubState, mintToken } from "./hub";

/** Where a walkthrough keeps its pictures, when one is being made (WALKTHROUGH_DIR); CI takes none. */
const SHOT = process.env.WALKTHROUGH_DIR ? `${process.env.WALKTHROUGH_DIR}/03-new-vault.png` : null;

/** A new vault on the home hub, with one applet in it, as Uni made `playground` with its Ideas. */
async function makeVault(vault: string, applet: string) {
  const hub = hubState();
  cli(hub, ["vault", "create", vault, "--json", "--no-mirror"]);
  await api({ origin: hub.origin, token: mintToken(`vault:${vault}:write`) }, "POST", "notes", { path: `Applets/${applet}`, extension: "html", tags: ["applet"],
    content: `<!doctype html><h1>${applet}</h1><p>In ${vault}.</p>`, metadata: { applet: { contract: 2, id: applet.toLowerCase(), name: applet, glyph: "✦", access: [] } } }, vault);
}
const dropVault = (vault: string) => { try { cli(hubState(), ["vault", "remove", vault, "--yes"]); } catch { /* gone already */ } };

/** A vault on offer: one line in Settings, under its Parachute. */
const newLine = (page: Page, vault: string) => page.getByRole("button", { name: `Open ${vault}`, exact: true });

test.afterAll(() => { dropVault("garden"); dropVault("attic"); dropVault("shelf"); });

test("a vault made after signing in is offered in Settings, and a tap adds it through the hub's consent", async ({ page }) => {
  // the app's clock, to come back to Settings a minute later (the hub is asked at most once a minute)
  await page.clock.install();
  await signIn(page);
  await makeVault("garden", "Seeds");
  // within the minute, Settings doesn't ask again
  await page.getByRole("navigation", { name: "Bar" }).getByRole("link", { name: "Settings" }).click();
  await expect(page.getByRole("link", { name: "Open kitchen", exact: true })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await openMore(page);
  await expect(newLine(page, "garden")).toHaveCount(0);
  // a minute on, Settings again: asked again, and the new vault is offered
  await page.getByRole("button", { name: "Back" }).first().click();
  await page.clock.fastForward("01:05");
  await page.getByRole("navigation", { name: "Bar" }).getByRole("link", { name: "Settings" }).click();
  await moreVaults(page, undefined, 15_000);
  await expect(page.locator("details.parachute-more summary")).toContainText(/more vaults? there, not open here/);
  await expect(newLine(page, "garden")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open garden", exact: true })).toHaveCount(0);
  if (SHOT) { mkdirSync(dirname(SHOT), { recursive: true }); await page.screenshot({ path: SHOT }); }

  // the tap: the hub asks once (this vault isn't in what the person approved before), then the vault and its applet
  const app = new URL(page.url()).origin;
  await newLine(page, "garden").click();
  await page.waitForURL((u) => u.origin === hubState().origin);
  expect(await approveUntilBack(page, hubState().origin, app)).toBe(1);
  await expect(ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name: /Seeds/ })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("navigation", { name: "Bar" }).getByRole("link", { name: "Settings" }).click();
  await expect(page.getByRole("link", { name: "Open garden", exact: true })).toBeVisible();
  await openMore(page);
  await expect(newLine(page, "garden")).toHaveCount(0);
  const recs = await page.evaluate(() => (JSON.parse(localStorage.getItem("parachute.vaults.v1") ?? "[]") as { vault: string; scope: string }[]));
  // a token for that vault alone, read only, as the hub granted it
  expect(recs.find((r) => r.vault === "garden")?.scope).toBe("vault:garden:read");
});

test("Not now keeps a new vault out of Settings, also after the app opens again", async ({ page }) => {
  await signIn(page);
  await makeVault("attic", "Boxes");
  // the app opens again: asked at once
  await page.goto("/settings");
  await moreVaults(page, undefined, 15_000);
  await expect(newLine(page, "attic")).toBeVisible();
  await page.getByRole("button", { name: "Not now: attic" }).click();
  await openMore(page);
  await expect(newLine(page, "attic")).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("link", { name: "Open kitchen", exact: true })).toBeVisible();
  // the hub was asked again (the app opened) and still lists it: it stays away
  await page.waitForLoadState("networkidle");
  await openMore(page);
  await expect(newLine(page, "attic")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Open attic", exact: true })).toHaveCount(0);
});

// T-476 (Aaron 11-24: "I dont see the Library applet yet"): his Library lives in a second vault the sign-in didn't read,
// and the list, where he looks for it, said nothing of that vault; only a folded line deep in Settings did. The list
// now ends with the vaults of his its bundle draws from that this device doesn't read, a tap each.
test("a vault of yours this device doesn't read is offered at the foot of the list, and its applets come into the list", async ({ page }) => {
  await signIn(page);
  await makeVault("shelf", "Books");
  // the app opens again: the hub is asked which vaults are the person's
  await page.goto("/");
  const list = ui(page).getByRole("list", { name: "Applets" });
  await expect(list.getByRole("link").first()).toBeVisible();
  const toOpen = ui(page).getByRole("region", { name: "Your vaults not open here" });
  await expect(toOpen).toContainText("Their applets show here once you open them.");
  const open = toOpen.getByRole("button", { name: "Open shelf", exact: true });
  await expect(open).toBeVisible({ timeout: 15_000 });
  await expect(list.getByRole("link", { name: /Books/ })).toHaveCount(0);
  const app = new URL(page.url()).origin;
  await open.click();
  await page.waitForURL((u) => u.origin === hubState().origin);
  expect(await approveUntilBack(page, hubState().origin, app)).toBe(1);
  await expect(list.getByRole("link", { name: /Books/ })).toBeVisible({ timeout: 20_000 });
  await expect(toOpen.getByRole("button", { name: "Open shelf", exact: true })).toHaveCount(0);
});
