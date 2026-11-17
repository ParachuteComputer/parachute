import { expect, test, type Page } from "@playwright/test";
import { signIn, ui } from "./helpers";
import { hubState, MORE_VAULTS, VAULT } from "./hub";

/** From the launcher into a vault, as a person does: its chapter's Open the vault. */
const openVault = (page: Page, vault = VAULT) => ui(page).getByRole("region", { name: vault, exact: true }).getByRole("link", { name: "Open the vault" }).click();

test("sign in to the Parachute on the hub, open a vault, and read a note", async ({ page }) => {
  await signIn(page);
  await openVault(page);
  const notes = ui(page).getByRole("list", { name: "Notes" });
  await expect(notes.getByRole("link", { name: /Tomato toast/ })).toBeVisible();
  await notes.getByRole("link", { name: "Welcome", exact: true }).click();
  await expect(ui(page).getByRole("heading", { level: 1, name: "Welcome" }).last()).toBeVisible();
  // a wikilink goes to the note it names
  await ui(page).getByRole("link", { name: "Recipes/Tomato toast" }).click();
  await expect(ui(page).locator(".prose-note h1")).toHaveText("Tomato toast");
  await expect(ui(page).locator(".note-where")).toContainText("#recipe");
});

test("search finds a note by its words", async ({ page }) => {
  await signIn(page);
  await openVault(page);
  await ui(page).getByRole("searchbox", { name: "Search this vault" }).fill("beans");
  const hits = ui(page).getByRole("list", { name: "Search results" });
  await expect(hits.getByRole("link")).toHaveCount(1);
  await expect(hits.getByRole("link")).toContainText("Rice and beans");
});

test("the vaults stay after a reload, and Sign out of the Parachute forgets them here and ends each on the hub", async ({ page }) => {
  await signIn(page);
  await page.reload();
  await expect(ui(page).getByRole("region", { name: VAULT, exact: true })).toBeVisible();
  const recs = await page.evaluate(() => JSON.parse(localStorage.getItem("parachute.vaults.v1") ?? "[]") as { vault: string; tokenEndpoint: string; refreshToken: string; clientId: string; revocationEndpoint: string }[]);
  expect(recs.map((r) => r.vault).sort()).toEqual([VAULT, ...MORE_VAULTS.map((m) => m.vault)].sort());
  await ui(page).getByRole("link", { name: "Settings" }).click();
  const revoked = page.waitForResponse((r) => r.url() === recs[0].revocationEndpoint);
  await page.getByRole("button", { name: `Sign out of ${new URL(hubState().origin).host}` }).click();
  await revoked;
  await expect(page.getByText("None yet.")).toBeVisible();
  await page.goto("/");
  await expect(page.getByLabel("Your Parachute's address")).toBeVisible();
  // the hub no longer takes any of the refresh tokens
  for (const rec of recs) {
    await expect.poll(async () => (await fetch(rec.tokenEndpoint, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: rec.refreshToken, client_id: rec.clientId }).toString() })).status).toBeGreaterThanOrEqual(400);
  }
});

test("an address in the clear is refused before going anywhere, and whose it is is asked first", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Your Parachute's address").fill("http://hub.example");
  await page.getByRole("radio", { name: "Mine" }).check();
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toContainText("starts with https://");
  await page.getByLabel("Your Parachute's address").fill("hub.example");
  await page.getByRole("radio", { name: "Mine" }).uncheck().catch(() => {});
  await expect(page).toHaveURL(/localhost/);
});
