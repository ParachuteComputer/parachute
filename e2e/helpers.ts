import { expect, type Page } from "@playwright/test";
import { api, hubState, record, VAULT } from "./hub";
import { withImports, type AppletRecord } from "../applets/record.ts";
import { keyDoor } from "./keys";

/** The app back from the hub with every vault kept: on the list of applets (once `vault`'s are read: they, or the
 *  line that there are none); or, for a person whose settings choose Parachute Simplified (docs/SIMPLE.md), on Notes. */
async function backOnTheLauncher(page: Page, vault: string) {
  void vault;
  const list = ui(page).getByRole("list", { name: "Applets" });
  await expect(list.getByRole("link").first().or(list.getByText("No applets here yet.")).or(ui(page).getByRole("heading", { level: 1, name: "Notes" }))).toBeVisible({ timeout: 20_000 });
}

/** The hub's Approve, as many times as it asks (the app without a key asks twice: to see which vaults are the person's,
 *  then to read their home), until the app is back on its launcher (or at `backAt`). Returns how many times it asked.
 *  `onConsent`: called on each consent page before its Approve (what the hub shows, for a test to check). */
export async function approveUntilBack(page: Page, hubOrigin: string, appOrigin: string, onPick?: (page: Page) => Promise<void>, backAt = "/", onConsent?: (page: Page) => Promise<void>): Promise<number> {
  const approve = page.getByRole("button", { name: "Approve" });
  // on a hub the person runs, the app asks which of its vaults are theirs before the consent: all ticked, Continue
  const pick = page.getByRole("button", { name: "Continue" });
  const where = async () => {
    const u = new URL(page.url());
    if (u.origin === appOrigin && u.pathname === backAt) return "back";
    if (u.origin === appOrigin && await pick.isVisible().catch(() => false)) return "pick";
    return u.origin === hubOrigin && await approve.isVisible().catch(() => false) ? "asked" : "wait";
  };
  for (let asked = 0; ; ) {
    await expect.poll(where, { timeout: 30_000 }).not.toBe("wait");
    const at = await where();
    if (at === "back") return asked;
    const before = page.url();
    if (at === "pick") await (onPick ? onPick(page) : Promise.resolve());
    if (at === "asked" && onConsent) await onConsent(page);
    await (at === "pick" ? pick : approve).click();
    if (at === "asked") asked++;
    await page.waitForURL((u) => u.href !== before);
  }
}

/** Add the person's own Parachute (the e2e home hub) and sign in through the hub's own pages: its sign-in with the
 *  owner's password, then its Approves. It reads the home (`vault`, picked if asked); the app opens on the launcher. */
export async function signIn(page: Page, vault = VAULT) {
  const hub = hubState();
  await page.goto("/");
  const app = new URL(page.url()).origin;
  await page.getByLabel("Your Parachute's address").fill(hub.origin);
  await page.getByRole("radio", { name: "Mine" }).check();
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => u.origin === hub.origin);
  // a new registration is pending until the hub's owner approves it: the hub asks them to sign in first
  const approveFirst = page.getByText("Sign in as admin to approve");
  if (await approveFirst.isVisible().catch(() => false)) await approveFirst.click();
  if (await page.locator('input[type="password"]').isVisible().catch(() => false)) {
    await page.locator('input[name="username"]').fill("owner");
    await page.locator('input[type="password"]').fill(hub.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  }
  // asked which vault is home (more than one could be): `vault`
  await approveUntilBack(page, hub.origin, app, async (p) => { const home = p.getByRole("radio", { name: vault, exact: true }); if (await home.count()) await home.check(); });
  await backOnTheLauncher(page, vault);
}

/** Open a vault the sign-in didn't read (docs/design/SCOPES.md): its line in Settings, then the hub's Approve to read
 *  it. Returns how many times the hub asked (0: its grant already covered it). */
export async function openVault(page: Page, vault: string, onConsent?: (page: Page) => Promise<void>): Promise<number> {
  const hub = hubState();
  await page.goto("/settings");
  const app = new URL(page.url()).origin;
  await page.getByRole("button", { name: `Open ${vault}`, exact: true }).click();
  await page.waitForURL((u) => u.origin === hub.origin || u.pathname === "/oauth/callback");
  const asked = await approveUntilBack(page, hub.origin, app, undefined, "/", onConsent);
  await backOnTheLauncher(page, vault);
  return asked;
}

/** Let the app change notes in a vault, as a person does: a change it can't make yet (a new note) brings the ask, then
 *  the hub's Approve; back on the same screen. Returns how many times the hub asked. */
export async function letWrite(page: Page, vault: string, onConsent?: (page: Page) => Promise<void>): Promise<number> {
  const hub = hubState();
  const at = `/v/${vault}/new`;
  await page.goto(at);
  const app = new URL(page.url()).origin;
  await page.getByLabel("The new note").fill("Asks before it is saved");
  await page.getByRole("button", { name: "Save" }).click();
  const ask = page.getByRole("dialog", { name: `Change notes in ${vault}` });
  await expect(ask).toBeVisible();
  await ask.getByRole("button", { name: /^Continue to / }).click();
  await page.waitForURL((u) => u.origin === hub.origin || u.pathname === "/oauth/callback");
  const asked = await approveUntilBack(page, hub.origin, app, undefined, at, onConsent);
  await expect(page.getByLabel("The new note")).toBeVisible();
  return asked;
}

/** What the app holds of each vault at the hub (its tokens' scopes), from its own storage. */
export async function held(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => Object.fromEntries((JSON.parse(localStorage.getItem("parachute.vaults.v1") ?? "[]") as { vault: string; scope: string }[]).map((v) => [v.vault, v.scope])));
}

/** The frame: the vault list, a vault, a note and open-with, in their sealed iframe. The shell's own screens (signing in,
 *  an applet and its card, Settings) are on the page itself. */
export const ui = (page: Page) => page.frameLocator("iframe.app-frame");

/** Add another Parachute (the org's) and sign in there with the person's key: the hub's key door (signed by the test, as
 *  the app's native side signs it), then the hub's own Approves. Returns how many times the hub asked. */
export async function signInWithKey(page: Page, hub: { origin: string }, vault: string, whose: "Mine" | RegExp = /Someone else's/, onPick?: (page: Page) => Promise<void>): Promise<number> {
  const cookies = await keyDoor(hub.origin, hubState().key);
  await page.context().addCookies(cookies.map((c) => ({ ...c, url: hub.origin })));
  await page.goto("/add");
  const app = new URL(page.url()).origin;
  await page.getByLabel("Your Parachute's address").fill(hub.origin);
  await page.getByRole("radio", { name: whose }).check();
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => u.origin === hub.origin);
  const asked = await approveUntilBack(page, hub.origin, app, onPick);
  await backOnTheLauncher(page, vault);
  return asked;
}

/** An applet from applets/ put in the e2e vault with the components it imports (the Room in Rooms), as
 *  scripts/install-applets.ts puts them in; `change` adjusts the applet's own record (another path, a line taken out).
 *  `remove` deletes everything it made (not a component that was there already): call it in a finally, as the vault is
 *  shared by every spec, and remove in the reverse order of installing. */
export async function installApplet(name: string, vars: Record<string, string> = {}, change: (r: AppletRecord) => AppletRecord = (r) => r) {
  const recs = withImports(name, vars);
  const made: string[] = [];
  const remove = async () => { for (const id of made.splice(0).reverse()) await api(hubState(), "DELETE", `notes/${id}`).catch(() => {}); };
  try {
    for (const [i, r] of recs.entries()) {
      const last = i === recs.length - 1;
      // a component another applet here already brought in is shared, not made twice (one path, one id in a vault)
      if (!last && ((await api(hubState(), "GET", `notes?path_prefix=${encodeURIComponent(r.path)}&limit=20`)) as { path: string }[]).some((x) => x.path === r.path)) continue;
      made.push((await record(hubState(), "create", last ? change(r) : r)).id as string);
    }
  } catch (e) { await remove(); throw e; }
  return { id: made[made.length - 1], remove };
}

/** A running applet's Stop or Revoke: in the bar's menu (⋯), as the person reaches them. */
export async function fromAppletMenu(page: Page, choice: "Stop" | "Revoke") {
  await page.locator("header.bar").getByRole("button", { name: "Menu" }).click();
  await page.getByRole("dialog", { name: /menu$/ }).getByRole("button", { name: choice, exact: true }).click();
}

type Row = { id: string; updatedAt: string; metadata?: Record<string, unknown> };
async function settingsNotes(): Promise<Row[]> {
  const rows = await api(hubState(), "GET", "notes?tag=parachute-settings&include_metadata=true");
  return (Array.isArray(rows) ? rows : rows.notes ?? []) as Row[];
}

/** The applet alone on the bar, in the settings note the suite may already hold; answers how to put it back. */
export async function barOf(applet: string): Promise<() => Promise<void>> {
  const bar = [{ vault: VAULT, applet }];
  const [n] = await settingsNotes();
  if (!n) {
    const made = (await api(hubState(), "POST", "notes", { path: "Parachute/Settings", content: "settings", tags: ["parachute-settings"], metadata: { parachute: { bar } } })) as Row;
    return async () => { await api(hubState(), "DELETE", `notes/${made.id}`).catch(() => {}); };
  }
  const before = (await api(hubState(), "GET", `notes/${n.id}`)) as Row;
  const was = (before.metadata?.parachute ?? {}) as Record<string, unknown>;
  await api(hubState(), "PATCH", `notes/${n.id}`, { metadata: { ...before.metadata, parachute: { ...was, bar, app: undefined, bundle: undefined } }, if_updated_at: before.updatedAt });
  return async () => {
    const now = (await api(hubState(), "GET", `notes/${n.id}`)) as Row;
    await api(hubState(), "PATCH", `notes/${n.id}`, { metadata: before.metadata ?? {}, if_updated_at: now.updatedAt }).catch(() => {});
  };
}
