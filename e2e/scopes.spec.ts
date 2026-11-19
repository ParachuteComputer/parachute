// The app asks a hub only for what something the person allowed needs (docs/design/SCOPES.md), checked at the hub:
//   a fresh sign-in asks to see which vaults are theirs, then to read their home: nothing else, no other vault, no write;
//   opening another vault asks to read that one; allowing Journal there asks to change notes in that vault alone, and
//   the Allow counts only once the hub said yes; revoking Journal gives that back: the token that could write is dead
//   at the hub, and what the app holds reads only.
// Runs last (signs-in project): signing in again retires the shared sign-in.
import { expect, test, type Page } from "@playwright/test";
import { api, hubState, MORE_VAULTS, mintToken, record, VAULT } from "./hub";
import { approveUntilBack, fromAppletMenu, held, openVault, ui } from "./helpers";
import { appletRecord } from "../applets/record.ts";

const OTHER = MORE_VAULTS[0].vault; // letters

/** Every scope the app sends the hub's authorize, in order. */
function asksOf(page: Page): string[] {
  const asks: string[] = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.pathname === "/oauth/authorize" && r.method() === "GET" && u.searchParams.get("scope")) asks.push(u.searchParams.get("scope")!);
  });
  return asks;
}

/** What the hub's consent page names, as plain text. */
const consentText = async (page: Page) => (await page.locator("body").innerText()).replace(/\s+/g, " ");

test("a fresh sign-in asks for the list of vaults and to read the home; Journal asks for its vault alone; revoking it ends the hub's write", async ({ page }) => {
  const hub = hubState();
  const asks = asksOf(page);
  const consents: string[] = [];
  const onConsent = async (p: Page) => { consents.push(await consentText(p)); };

  // ── sign in, fresh ──
  await page.goto("/");
  const app = new URL(page.url()).origin;
  await page.getByLabel("Your Parachute's address").fill(hub.origin);
  await page.getByRole("radio", { name: "Mine" }).check();
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => u.origin === hub.origin);
  const approveFirst = page.getByText("Sign in as admin to approve");
  if (await approveFirst.isVisible().catch(() => false)) await approveFirst.click();
  await approveUntilBack(page, hub.origin, app, async (p) => {
    // the person runs this hub: which vaults are theirs, and which is home (the first by name, kitchen, to begin with)
    await expect(p.getByRole("radio", { name: VAULT })).toBeChecked();
  }, "/", onConsent);
  await expect(ui(page).getByRole("region", { name: VAULT, exact: true })).toBeVisible({ timeout: 20_000 });

  expect(asks).toEqual(["account:vaults", `vault:${VAULT}:read`]);
  // the home's consent names the home, read only, and no other vault
  const home = consents.at(-1)!;
  expect(home).toContain(`vault:${VAULT}:read`);
  expect(home).not.toContain(`vault:${VAULT}:write`);
  for (const v of MORE_VAULTS) expect(home).not.toContain(v.vault);
  expect(await held(page)).toEqual({ [VAULT]: `vault:${VAULT}:read` });
  // the other vaults are one line each, not read
  for (const v of MORE_VAULTS) await expect(ui(page).getByRole("button", { name: `Open ${v.vault}`, exact: true })).toBeVisible();
  // a new device: applets run once the self-test has passed
  await page.goto("/settings");
  await expect(page.getByRole("status").filter({ hasText: /approved code only|run sealed/ })).toBeVisible({ timeout: 45_000 });

  // ── Journal, in another vault ──
  const there = { origin: hub.origin, token: mintToken(`vault:${OTHER}:write`) };
  const journal = await record(there, "create", appletRecord("journal"), OTHER);
  try {
    asks.length = 0; consents.length = 0;
    expect(await openVault(page, OTHER, onConsent)).toBe(1);
    expect(asks).toEqual([`vault:${OTHER}:read`]);
    expect(consents[0]).not.toContain(`vault:${OTHER}:write`);
    expect(await held(page)).toEqual({ [VAULT]: `vault:${VAULT}:read`, [OTHER]: `vault:${OTHER}:read` });

    await ui(page).getByRole("region", { name: OTHER, exact: true }).getByRole("link", { name: /Journal/ }).click();
    const card = page.getByRole("region", { name: /asking for access/ });
    await expect(card).toContainText("Read, add and change notes in Journal/");
    // the card says the hub asks next, and for what
    await expect(card.getByRole("note")).toContainText(`change notes in ${OTHER}`);
    asks.length = 0; consents.length = 0;
    await card.getByRole("button", { name: "Allow" }).click();
    await page.waitForURL((u) => u.origin === hub.origin);
    expect(await approveUntilBack(page, hub.origin, app, undefined, `/v/${OTHER}/a/${journal.id}`, onConsent)).toBe(1);
    expect(asks).toEqual([`vault:${OTHER}:read vault:${OTHER}:write`]);
    expect(consents[0]).toContain(`vault:${OTHER}:write`);
    expect(consents[0]).not.toContain(VAULT);
    const frame = page.frameLocator("iframe.applet-frame");
    await expect(frame.getByRole("heading", { name: "Journal" })).toBeVisible();
    // exactly its vault: the home is still read only
    expect(await held(page)).toEqual({ [VAULT]: `vault:${VAULT}:read`, [OTHER]: `vault:${OTHER}:read vault:${OTHER}:write` });
    const stamp = Date.now().toString(36);
    await frame.getByLabel("Write in your journal").fill(`Allowed by the hub ${stamp}`);
    await frame.getByRole("button", { name: "Save" }).click();
    await expect(frame.getByText(`Allowed by the hub ${stamp}`)).toBeVisible();
    const rows = await api(there, "GET", `notes?path_prefix=${encodeURIComponent("Journal/")}&include_content=true&limit=50`, undefined, OTHER) as { id: string; content?: string }[];
    const entry = rows.find((r) => r.content?.includes(stamp));
    expect(entry).toBeTruthy();
    await api(there, "DELETE", `notes/${entry!.id}`, undefined, OTHER).catch(() => {});

    // ── revoke: the write goes back to the hub ──
    const before = await page.evaluate((v) => (JSON.parse(localStorage.getItem("parachute.vaults.v1") ?? "[]") as { vault: string; accessToken: string; refreshToken: string; clientId: string; tokenEndpoint: string }[]).find((r) => r.vault === v)!, OTHER);
    asks.length = 0;
    await fromAppletMenu(page, "Revoke");
    // the app asks for read alone (the hub's grant covers it: no page) and comes back
    await expect.poll(() => held(page), { timeout: 20_000 }).toEqual({ [VAULT]: `vault:${VAULT}:read`, [OTHER]: `vault:${OTHER}:read` });
    expect(asks).toEqual([`vault:${OTHER}:read`]);
    // at the hub: the token that could write is ended, both halves
    const write = await fetch(`${hub.origin}/vault/${OTHER}/api/notes`, { method: "POST", headers: { authorization: `Bearer ${before.accessToken}`, "content-type": "application/json" }, body: JSON.stringify({ path: `Scratch/${stamp}`, content: "x" }) });
    expect(write.status).toBe(401);
    const again = await fetch(before.tokenEndpoint, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: before.refreshToken, client_id: before.clientId }) });
    expect(again.status).toBeGreaterThanOrEqual(400);
    // and what the app holds now can't write there
    const now = await page.evaluate((v) => (JSON.parse(localStorage.getItem("parachute.vaults.v1") ?? "[]") as { vault: string; accessToken: string }[]).find((r) => r.vault === v)!.accessToken, OTHER);
    const refused = await fetch(`${hub.origin}/vault/${OTHER}/api/notes`, { method: "POST", headers: { authorization: `Bearer ${now}`, "content-type": "application/json" }, body: JSON.stringify({ path: `Scratch/${stamp}`, content: "x" }) });
    expect(refused.status).toBe(403);
  } finally { await api(there, "DELETE", `notes/${journal.id}`, undefined, OTHER).catch(() => {}); }
});
