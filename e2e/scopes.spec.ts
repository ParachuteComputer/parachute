// The app asks a hub only for what something the person allowed needs (docs/design/SCOPES.md), checked at the hub:
//   a fresh sign-in asks to see which vaults are theirs, then to read their home: nothing else, no other vault, no write;
//   opening another vault asks to read that one; allowing Journal there asks to change notes in that vault alone, and
//   the Allow counts only once the hub said yes; revoking Journal gives that back: the token that could write is dead
//   at the hub, and what the app holds reads only.
// Runs last (signs-in project): signing in again retires the shared sign-in.
import { expect, test, type Page } from "@playwright/test";
import { api, cli, hubState, MORE_VAULTS, mintToken, ORG_VAULT, record, techneState, VAULT, type HubState } from "./hub";
import { approveUntilBack, fromAppletMenu, held, letWrite, openVault, signIn, signInWithKey, ui } from "./helpers";
import { appletRecord } from "../applets/record.ts";

const OTHER = MORE_VAULTS[0].vault; // letters
/** A token on another hub of the tests, as its operator. */
const cliToken = (h: HubState, scope: string) => cli(h, ["auth", "mint-token", "--scope", scope, "--json"]).token as string;

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
  test.setTimeout(180_000);
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
  await expect(ui(page).getByRole("list", { name: "Applets" })).toBeVisible({ timeout: 20_000 });

  expect(asks).toEqual(["account:vaults", `vault:${VAULT}:read`]);
  // the home's consent names the home, read only, and no other vault
  const home = consents.at(-1)!;
  expect(home).toContain(`vault:${VAULT}:read`);
  expect(home).not.toContain(`vault:${VAULT}:write`);
  for (const v of MORE_VAULTS) expect(home).not.toContain(v.vault);
  expect(await held(page)).toEqual({ [VAULT]: `vault:${VAULT}:read` });
  // the other vaults are one line each in Settings, not read
  await page.goto("/settings");
  for (const v of MORE_VAULTS) await expect(page.getByRole("button", { name: `Open ${v.vault}`, exact: true })).toBeVisible();
  // a new device: applets run once the self-test has passed
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

    await ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name: /Journal/ }).filter({ hasText: OTHER }).click();
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
    // (the page may be on its way to the hub and back while this reads: that read is just not yet)
    await expect.poll(() => held(page).catch(() => ({})), { timeout: 20_000 }).toEqual({ [VAULT]: `vault:${VAULT}:read`, [OTHER]: `vault:${OTHER}:read` });
    expect(asks).toEqual([`vault:${OTHER}:read`]);
    // at the hub: the token that could write is ended, both halves
    // (core 0.9 refuses it at once; 0.8's vault reads the hub's revocations within about a minute)
    const scratch: string[] = [];
    await expect.poll(async () => {
      const w = await fetch(`${hub.origin}/vault/${OTHER}/api/notes`, { method: "POST", headers: { authorization: `Bearer ${before.accessToken}`, "content-type": "application/json" }, body: JSON.stringify({ path: `Scratch/${stamp}-${scratch.length}`, content: "x" }) });
      if (w.status === 201) scratch.push(((await w.json()) as { id: string }).id);
      return w.status;
    }, { timeout: 90_000, intervals: [2_000, 5_000, 10_000] }).toBe(401);
    for (const id of scratch) await api(there, "DELETE", `notes/${id}`, undefined, OTHER).catch(() => {});
    const again = await fetch(before.tokenEndpoint, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: before.refreshToken, client_id: before.clientId }) });
    expect(again.status).toBeGreaterThanOrEqual(400);
    // and what the app holds now can't write there
    const now = await page.evaluate((v) => (JSON.parse(localStorage.getItem("parachute.vaults.v1") ?? "[]") as { vault: string; accessToken: string }[]).find((r) => r.vault === v)!.accessToken, OTHER);
    const refused = await fetch(`${hub.origin}/vault/${OTHER}/api/notes`, { method: "POST", headers: { authorization: `Bearer ${now}`, "content-type": "application/json" }, body: JSON.stringify({ path: `Scratch/${stamp}`, content: "x" }) });
    expect(refused.status).toBe(403);
  } finally { await api(there, "DELETE", `notes/${journal.id}`, undefined, OTHER).catch(() => {}); }
});

test("signing in again keeps what the person let the app do: the home stays writable", async ({ page }) => {
  const hub = hubState();
  await signIn(page);
  await letWrite(page, VAULT);
  expect((await held(page))[VAULT]).toBe(`vault:${VAULT}:read vault:${VAULT}:write`);
  // Settings → Sign in again on the Parachute: the hub's grant covers it, so no page; the home keeps write
  const asks = asksOf(page);
  await page.goto("/settings");
  const app = new URL(page.url()).origin;
  await page.getByRole("region", { name: `Parachute: ${new URL(hub.origin).host}` }).getByRole("link", { name: "Sign in again" }).click();
  await page.getByRole("radio", { name: "Mine" }).check();
  await page.getByRole("button", { name: "Sign in" }).click();
  await approveUntilBack(page, hub.origin, app);
  await expect.poll(() => held(page)).toEqual({ [VAULT]: `vault:${VAULT}:read vault:${VAULT}:write` });
  expect(asks.at(-1)).toBe(`vault:${VAULT}:read vault:${VAULT}:write`);
});

test("someone else's vault where the person may only read: an applet that writes there isn't allowed, and says why", async ({ page }) => {
  const org = techneState();
  const there = { origin: org.origin, token: cliToken(org, `vault:${ORG_VAULT}:write`) };
  const journal = await record(there, "create", appletRecord("journal"), ORG_VAULT);
  try {
    await signInWithKey(page, org, ORG_VAULT);
    await page.goto("/settings");
    await expect(page.getByRole("status").filter({ hasText: /approved code only|run sealed/ })).toBeVisible({ timeout: 45_000 });
    await page.goto(`/v/${ORG_VAULT}/a/${journal.id}`);
    const card = page.getByRole("region", { name: /asking for access/ });
    // the hub's step is its own note (the other is the warning: someone else's vault)
    await expect(card.getByRole("note").filter({ hasText: "Then your hub" })).toContainText(`change notes in ${ORG_VAULT}`);
    const app = new URL(page.url()).origin;
    await card.getByRole("button", { name: "Allow" }).click();
    await page.waitForURL((u) => u.origin === org.origin || u.pathname === "/oauth/callback");
    await approveUntilBack(page, org.origin, app, undefined, "/oauth/callback").catch(() => 0);
    // the hub gave read (the person holds read there): nothing is allowed, and the screen says why
    await expect(page.getByRole("alert")).toContainText(`read only in ${ORG_VAULT}`);
    expect((await held(page))[ORG_VAULT]).toBe(`vault:${ORG_VAULT}:read`);
    const grants = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem("parachute.applets.grants.v1") ?? "{}")));
    expect(grants.filter((g) => g.includes(journal.id))).toEqual([]);
  } finally { await api(there, "DELETE", `notes/${journal.id}`, undefined, ORG_VAULT).catch(() => {}); }
});

test("a new note asks for write in the vault the person chose, and lands there after the hub's yes", async ({ page }) => {
  const hub = hubState();
  await signIn(page);
  await openVault(page, OTHER);
  const stamp = Date.now().toString(36);
  await page.goto(`/v/${OTHER}/new`);
  const app = new URL(page.url()).origin;
  await page.getByRole("combobox").selectOption({ label: VAULT });
  await page.getByLabel("The new note").fill(`Chosen vault ${stamp}\n\nInto the home.`);
  await page.getByRole("button", { name: "Save" }).click();
  const ask = page.getByRole("dialog", { name: `Change notes in ${VAULT}` });
  await expect(ask).toBeVisible();
  await ask.getByRole("button", { name: /^Continue to / }).click();
  await page.waitForURL((u) => u.origin === hub.origin || u.pathname === "/oauth/callback");
  expect(await approveUntilBack(page, hub.origin, app, undefined, `/v/${OTHER}/new`)).toBe(1);
  // back: the words, and the vault the person chose
  await expect(page.getByLabel("The new note")).toHaveValue(/Into the home\./);
  await expect(page.getByRole("combobox")).toHaveValue(VAULT);
  await page.getByRole("button", { name: "Save" }).click();
  await expect.poll(async () => ((await api(hub, "GET", `notes?search=${encodeURIComponent(stamp)}&limit=5`)) as { path: string }[]).map((n) => n.path)).toContain(`Chosen vault ${stamp}`);
  const there = { origin: hub.origin, token: mintToken(`vault:${OTHER}:write`) };
  expect(((await api(there, "GET", `notes?search=${encodeURIComponent(stamp)}&limit=5`, undefined, OTHER)) as unknown[]).length).toBe(0);
  for (const n of (await api(hub, "GET", `notes?search=${encodeURIComponent(stamp)}&limit=5`)) as { id: string }[]) await api(hub, "DELETE", `notes/${n.id}`).catch(() => {});
});
