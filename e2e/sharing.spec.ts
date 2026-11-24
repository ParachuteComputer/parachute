// Sharing a vault with a friend (T-476, docs/design/SHARING.md): two people, each in their own Parachute (two browser
// profiles, each with its own key), on one hub. Aaron invites Bo to `recipes` from Vault → Sharing; Bo accepts the link
// in his own Parachute with his key and signs in; each edits a recipe; Changes and a record's History read "Bo" on
// Aaron's screen and "Aaron" on Bo's; Aaron ends it, and Bo's next read is refused. Against the real hub: what the hub
// holds is read back after each step.
// Needs a hub with sharing (core T-476). On core from npm, which has none yet, the test says so and skips, unless
// E2E_CORE_NEXT=1 says this hub is a core that must have it (CI's 0.9.0-pre.2 leg; the red run on a core without it).
import { expect, test, type Browser, type BrowserContext, type Page, type TestInfo } from "@playwright/test";
import { approveUntilBack, openVault, signInWithKey } from "./helpers";
import { account, api, cli, hubState, mintToken, techneState, VAULT } from "./hub";
import { keyDoor, newKey, pubOf } from "./keys";

const SHARED = "recipes";
/** Bo's own home vault, on his own Parachute (the suite's second hub stands in for it). */
const BO_HOME = "bo";
type Rec = { id: string; path: string; body: string; updatedAt: string };

/** A Parachute of its own: a fresh profile with this key on the test signer. */
async function person(browser: Browser, info: TestInfo, key: string): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ ...info.project.use, storageState: { cookies: [], origins: [] } });
  await ctx.addInitScript((k) => { (window as unknown as { __parachuteE2EKey: string }).__parachuteE2EKey = k; }, key);
  return { ctx, page: await ctx.newPage() };
}

/** Vault reaches the home until more is ticked (docs/ACCESS.md proposal 5): opened on a vault it wasn't given, the line
 *  over it offers to add it, and the person does, on the shell's sheet (signed with their key). */
async function give(page: Page, vault: string) {
  const line = page.locator("p.pick-line").filter({ hasText: `${vault} isn't one of Vault's vaults` });
  if (!(await line.waitFor({ timeout: 10_000 }).then(() => true, () => false))) return;
  await line.getByRole("button", { name: "Add" }).click();
  const sheet = page.getByRole("dialog", { name: /^Vaults Vault reaches$|^Which vaults may Vault reach\?$/ });
  await expect(sheet.getByRole("checkbox", { name: new RegExp(`^${vault}\\b`) })).toBeChecked();
  await page.waitForTimeout(800);
  await sheet.getByRole("button", { name: "Save" }).click();
  await sheet.waitFor({ state: "detached" });
}

/** Change a record's words in the app, as a person does; the first change to a vault held for reading asks first. */
async function edit(page: Page, vault: string, id: string, words: string, reader: { origin: string; token: string }) {
  const hub = hubState();
  const at = `/v/${vault}/n/${id}/edit`;
  await page.goto(at);
  const app = new URL(page.url()).origin;
  const box = page.getByLabel("The note's words");
  await expect(box).toBeVisible({ timeout: 20_000 });
  await box.fill(words);
  await page.getByRole("button", { name: "Save" }).click();
  const ask = page.getByRole("dialog", { name: `Change notes in ${vault}` });
  if (await ask.isVisible({ timeout: 3000 }).catch(() => false)) {
    await ask.getByRole("button", { name: /^Continue to / }).click();
    await page.waitForURL((u) => u.origin === hub.origin || u.pathname === "/oauth/callback");
    await approveUntilBack(page, hub.origin, app, undefined, at);
    await expect(page.getByLabel("The note's words")).toBeVisible({ timeout: 20_000 });
    await page.getByLabel("The note's words").fill(words);
    await page.getByRole("button", { name: "Save" }).click();
  }
  await expect.poll(async () => ((await api(reader, "GET", `records/${id}`, undefined, vault)) as Rec).body, { timeout: 20_000 }).toBe(words);
}

const vaultApplet = (page: Page) => page.frameLocator('iframe.applet-frame[title="Vault"]');

// the pick Aaron signed for Vault (recipes added) is his key's, in the shared home: taken away after, so the walks that
// follow start from none
test.afterEach(async () => {
  const r = await api(hubState(), "GET", "notes?tag=parachute-approval&include_metadata=true") as { id: string; path: string }[] | { notes?: { id: string; path: string }[] };
  for (const n of Array.isArray(r) ? r : r.notes ?? []) if (n.path.replace(/\.md$/, "").endsWith("/parachute:vault")) await api(hubState(), "DELETE", `notes/${n.id}`).catch(() => {});
});

test("Aaron invites Bo to recipes; Bo accepts with his own key; their edits read by name; Aaron ends it", async ({ browser }, info) => {
  test.setTimeout(360_000);
  const hub = hubState();
  const look = await fetch(`${hub.origin}/account/invites/look`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: "x".repeat(43) }) });
  const sharing = look.status === 404 && ((await look.json().catch(() => ({}))) as { error?: string }).error === "no_invite";
  test.skip(!sharing && process.env.E2E_CORE_NEXT !== "1", "a hub before sharing (core T-476): this e2e runs on a core with it");

  // the shared vault, with two recipes
  try { cli(hub, ["vault", "create", SHARED, "--json", "--no-mirror"]); } catch { /* there from a run before */ }
  const own = { origin: hub.origin, token: mintToken(`vault:${SHARED}:write`, hub) };
  const stamp = Date.now().toString(36);
  const soup = await api(own, "POST", "notes", { path: `Recipes ${stamp}/Leek soup`, content: "# Leek soup\n\nLeeks, potatoes, stock.", tags: ["recipe"] }, SHARED) as Rec;
  const bread = await api(own, "POST", "notes", { path: `Recipes ${stamp}/Bread`, content: "# Bread\n\nFlour, water, salt.", tags: ["recipe"] }, SHARED) as Rec;

  // ── Aaron: his own Parachute, signed in with his key; recipes opened
  const aaron = await person(browser, info, hub.key);
  await signInWithKey(aaron.page, hub, VAULT, "Mine");
  await openVault(aaron.page, SHARED);
  await aaron.page.goto(`/v/${VAULT}/a/parachute%3Avault?vault=${SHARED}`);
  await give(aaron.page, SHARED);
  let v = vaultApplet(aaron.page);
  await v.getByRole("button", { name: "Sharing" }).click();
  await expect(v.getByRole("heading", { level: 1, name: "Sharing" })).toBeVisible({ timeout: 30_000 });
  const people = v.getByRole("region", { name: "People" });
  await expect(people).toContainText("You");
  // his own name, once; then who the invite is for
  await v.getByRole("button", { name: "Invite someone" }).click();
  await v.getByLabel("Your name, as the people you invite see it").fill("Aaron");
  await v.getByRole("button", { name: "Keep" }).click();
  await v.getByLabel("Invite someone").fill("Bo");
  await v.getByRole("button", { name: "Make the link" }).click();
  await aaron.page.getByRole("dialog", { name: `Invite Bo to ${SHARED}?` }).getByRole("button", { name: "Make the link" }).click();
  const made = v.getByLabel("Invite link");
  await expect(made).toBeVisible({ timeout: 20_000 });
  const link = (await made.locator("p.addr").textContent())!.trim();
  expect(link).toMatch(new RegExp(`^${hub.origin}/invite#[A-Za-z0-9_-]{40,}$`));
  await expect(people.getByText("Bo", { exact: true })).toBeVisible();
  await expect(people).toContainText("invited");

  // ── Bo: his own Parachute (his own hub, his home vault there) and his own key
  const boKey = newKey();
  const his = techneState();
  try { cli(his, ["vault", "create", BO_HOME, "--json", "--no-mirror"]); } catch { /* there from a run before */ }
  await account(his, "grant-access", { pubkey: pubOf(boKey), vault: BO_HOME, role: "write" });
  const bo = await person(browser, info, boKey);
  await bo.ctx.addCookies((await keyDoor(his.origin, boKey)).map((c) => ({ ...c, url: his.origin })));
  await bo.page.goto("/add");
  const app = new URL(bo.page.url()).origin;
  await bo.page.getByLabel("Your Parachute's address").fill(his.origin);
  await bo.page.getByRole("radio", { name: "Mine" }).check();
  await bo.page.getByRole("button", { name: "Sign in" }).click();
  await bo.page.waitForURL((u) => u.origin === his.origin);
  await approveUntilBack(bo.page, his.origin, app);
  // he reads Aaron's invite, then accepts it
  await bo.page.goto("/accept");
  await bo.page.getByLabel("The invite link").fill(link);
  await bo.page.getByRole("button", { name: "Read the invite" }).click();
  const invite = bo.page.getByRole("region", { name: "The invite" });
  await expect(invite).toContainText(`Aaron invites you to ${SHARED}`);
  await expect(invite).toContainText("You can read and change everything in it.");
  await bo.page.getByRole("button", { name: "Accept" }).click();
  // accepted: the usual sign-in to Aaron's Parachute, as someone else's (the web build has no key door of its own: the
  // test signs Bo in at the hub's key door, as the app's native side does)
  await bo.page.waitForURL((u) => u.origin === hub.origin, { timeout: 30_000 });
  await bo.ctx.addCookies((await keyDoor(hub.origin, boKey)).map((c) => ({ ...c, url: hub.origin })));
  await bo.page.reload();
  await approveUntilBack(bo.page, hub.origin, app);
  // the link is used: a second accept finds nothing open
  expect((await fetch(`${hub.origin}/account/invites/look`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: link.split("#")[1] }) })).status).toBe(404);

  // Aaron's list: Bo by name, the invite gone
  await aaron.page.reload();
  v = vaultApplet(aaron.page);
  await v.getByRole("button", { name: "Sharing" }).click();
  await expect(people.getByText("Bo", { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(people).toContainText("reads and changes everything");
  await expect(people).not.toContainText("invited");

  // ── each edits a recipe in their own Parachute
  await edit(bo.page, SHARED, soup.id, "# Leek soup\n\nLeeks, potatoes, stock.\nA little cream. (Bo)", own);
  await edit(aaron.page, SHARED, bread.id, "# Bread\n\nFlour, water, salt.\nA long rise. (Aaron)", own);

  // Aaron's Changes: Bo's under "Bo", his own as his
  await aaron.page.goto(`/v/${VAULT}/a/parachute%3Avault?vault=${SHARED}&show=changes`);
  v = vaultApplet(aaron.page);
  await expect(v.getByRole("heading", { level: 1, name: "Changes" })).toBeVisible({ timeout: 30_000 });
  const boRun = v.getByRole("region", { name: /^Bo, Today$/ });
  await expect(boRun.getByRole("button", { name: /Changed Leek soup/ })).toBeVisible({ timeout: 20_000 });
  await expect(v.getByRole("region", { name: /^You, in Parachute here, Today$/ }).getByRole("button", { name: /Changed Bread/ })).toBeVisible();
  // the record's History says Bo too
  await boRun.getByRole("button", { name: /Changed Leek soup/ }).click();
  await expect(v.getByRole("article", { name: "Changed Leek soup" })).toContainText("Changed by Bo");

  // Bo's Changes: Aaron's under "Aaron", his own as his
  await bo.page.goto(`/v/${BO_HOME}/a/parachute%3Avault?vault=${SHARED}&show=changes`);
  await give(bo.page, SHARED);
  const bv = vaultApplet(bo.page);
  await expect(bv.getByRole("heading", { level: 1, name: "Changes" })).toBeVisible({ timeout: 30_000 });
  await expect(bv.getByRole("region", { name: /^Aaron, Today$/ }).getByRole("button", { name: /Changed Bread/ })).toBeVisible({ timeout: 20_000 });
  await expect(bv.getByRole("region", { name: /^You, in Parachute here, Today$/ }).getByRole("button", { name: /Changed Leek soup/ })).toBeVisible();

  // ── Aaron ends it: Bo's next read is refused
  const boToken = await bo.page.evaluate((vault) => (JSON.parse(localStorage.getItem("parachute.vaults.v1") ?? "[]") as { vault: string; accessToken: string }[]).find((r) => r.vault === vault)?.accessToken ?? null, SHARED);
  expect(boToken).not.toBeNull();
  const read = () => fetch(`${hub.origin}/vault/${SHARED}/api/records/${soup.id}`, { headers: { authorization: `Bearer ${boToken}` } }).then((r) => r.status);
  expect(await read()).toBe(200);
  await aaron.page.goto(`/v/${VAULT}/a/parachute%3Avault?vault=${SHARED}`);
  v = vaultApplet(aaron.page);
  await v.getByRole("button", { name: "Sharing" }).click();
  await expect(people.getByText("Bo", { exact: true })).toBeVisible({ timeout: 20_000 });
  await people.getByRole("button", { name: "End" }).click();
  await aaron.page.getByRole("dialog", { name: `End Bo's access to ${SHARED}?` }).getByRole("button", { name: "End" }).click();
  await expect(people.getByRole("listitem").filter({ hasText: /^Bo/ })).toContainText("ended", { timeout: 20_000 });
  expect(await read()).toBe(401);
  // Bo's own screen says so, in words, not as a generic problem
  await bo.page.goto(`/v/${BO_HOME}/a/parachute%3Avault?vault=${SHARED}`);
  await expect(vaultApplet(bo.page).getByText(`You no longer reach ${SHARED}`)).toBeVisible({ timeout: 30_000 });
  // his past edit still reads as his, on Aaron's screen
  await aaron.page.goto(`/v/${VAULT}/a/parachute%3Avault?vault=${SHARED}&show=changes`);
  await expect(vaultApplet(aaron.page).getByRole("region", { name: /^Bo, Today$/ })).toBeVisible({ timeout: 30_000 });

  await aaron.ctx.close();
  await bo.ctx.close();
});
