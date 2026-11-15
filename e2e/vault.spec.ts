import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("add a vault by its address, sign in on the hub, and read a note", async ({ page }) => {
  await signIn(page);
  const notes = page.getByRole("list", { name: "Notes" });
  await expect(notes.getByRole("link", { name: /Tomato toast/ })).toBeVisible();
  await notes.getByRole("link", { name: "Welcome", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Welcome" }).last()).toBeVisible();
  // a wikilink goes to the note it names
  await page.getByRole("link", { name: "Recipes/Tomato toast" }).click();
  await expect(page.locator(".prose-note h1")).toHaveText("Tomato toast");
  await expect(page.locator(".note-where")).toContainText("#recipe");
});

test("search finds a note by its words", async ({ page }) => {
  await signIn(page);
  await page.getByRole("searchbox", { name: "Search this vault" }).fill("beans");
  const hits = page.getByRole("list", { name: "Search results" });
  await expect(hits.getByRole("link")).toHaveCount(1);
  await expect(hits.getByRole("link")).toContainText("Rice and beans");
});

test("the vault stays after a reload, and Sign out forgets it here and ends it on the hub", async ({ page }) => {
  await signIn(page);
  await page.reload();
  await expect(page.getByRole("list", { name: "Notes" })).toBeVisible();
  const rec = await page.evaluate(() => JSON.parse(localStorage.getItem("parachute.vaults.v1") ?? "[]")[0]);
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByText("None yet.")).toBeVisible();
  await page.goto("/");
  await expect(page.getByLabel("Vault address")).toBeVisible();
  // the hub no longer takes the refresh token
  const res = await fetch(rec.tokenEndpoint, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: rec.refreshToken, client_id: rec.clientId }).toString() });
  expect(res.status).toBeGreaterThanOrEqual(400);
});

test("an address that names no vault is refused before going anywhere", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Vault address").fill("https://hub.example");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toContainText("Add the vault's name");
  await expect(page).toHaveURL(/localhost/);
});
