// One sign-in per Parachute (docs/design/ONE-SIGN-IN.md), on two real hubs: the person's own (three vaults, each with
// an applet) and Techne's (two vaults, one of them given to the person's key). Nobody types a vault's address: each hub
// is signed in to once, and every vault the person may reach there comes with it. A second device that signs in to the
// home Parachute finds Techne on the person's list.
import { expect, test, type Page } from "@playwright/test";
import { api, hubState, MORE_VAULTS, NOT_GIVEN, ORG_VAULT, techneState, VAULT } from "./hub";
import { signInWithKey, ui } from "./helpers";
import { keyDoor } from "./keys";

const hostOf = (origin: string) => new URL(origin).host;
const parachute = (page: Page, origin: string) => ui(page).getByRole("region", { name: `Parachute: ${hostOf(origin)}` });
const home = (method: string, path: string, body?: unknown) => api(hubState(), method, path, body, VAULT);

/** Sign out of everything this test signed in to on the hubs' side: the settings note's list goes too. */
async function tidy() {
  for (const n of await home("GET", "notes?tag=parachute-settings&include_metadata=true")) {
    const meta = { ...(n.metadata ?? {}) };
    if (meta.parachute) { delete meta.parachute.hubs; await home("PATCH", `notes/${n.id}`, { metadata: meta, if_updated_at: n.updatedAt }); }
  }
}

// a fresh device: nothing held, not signed in on either hub
test.use({ storageState: { cookies: [], origins: [] } });
test.afterEach(tidy);

test("sign in once per hub with the key: every vault of yours, with its applets, and none you weren't given; no vault address typed", async ({ page }) => {
  // a fresh device: nothing held
  await page.goto("/");
  await expect(page.getByLabel("Your Parachute's address")).toBeVisible();
  await expect(page.getByLabel("Vault address")).toHaveCount(0);

  // the person's own Parachute, signed in with their key (linked to its owner)
  const asked = await signInWithKey(page, hubState(), VAULT, "Mine");
  // without a key in the page (the web build), the hub asks twice: to list the vaults, then for all of them at once
  expect(asked).toBe(2);
  // one Parachute: its vaults' chapters, no heading over them
  for (const v of [VAULT, ...MORE_VAULTS.map((m) => m.vault)]) await expect(ui(page).getByRole("region", { name: v, exact: true })).toBeVisible();
  for (const m of MORE_VAULTS) await expect(ui(page).getByRole("region", { name: m.vault, exact: true }).getByRole("link", { name: new RegExp(m.applet) })).toBeVisible();

  // Techne's, as someone else's: only the vault the person was given
  expect(await signInWithKey(page, techneState(), ORG_VAULT)).toBe(2);
  // two Parachutes: each its own part, the home's first
  const mine = parachute(page, hubState().origin);
  for (const v of [VAULT, ...MORE_VAULTS.map((m) => m.vault)]) await expect(mine.getByRole("region", { name: v, exact: true })).toBeVisible();
  const org = parachute(page, techneState().origin);
  await expect(org.getByRole("region", { name: ORG_VAULT, exact: true })).toContainText(`someone else's · at ${hostOf(techneState().origin)}`);
  await expect(ui(page).getByRole("region", { name: NOT_GIVEN, exact: true })).toHaveCount(0);
  // the home Parachute first, with the home vault
  await expect(ui(page).getByRole("region", { name: /^Parachute: / }).first()).toHaveAccessibleName(`Parachute: ${hostOf(hubState().origin)}`);
  await expect(mine.getByRole("region", { name: VAULT, exact: true })).toContainText("your home");

  // an applet of another vault runs, through that vault's own token (minted from the one sign-in)
  await mine.getByRole("region", { name: "letters", exact: true }).getByRole("link", { name: /Post/ }).click();
  await page.getByRole("button", { name: "Allow" }).click();
  await expect(page.frameLocator("iframe.applet-frame").getByText("In letters.")).toBeVisible();

  // both Parachutes are on the person's list, in their home vault
  const [note] = await home("GET", "notes?tag=parachute-settings&include_metadata=true");
  expect(note.metadata.parachute.hubs.map((h: { hub: string }) => h.hub).sort()).toEqual([hubState().origin, techneState().origin].sort());

  // Settings: one place per Parachute; whose came from the one answer for all its vaults
  await page.goto("/settings");
  const s = page.getByRole("region", { name: `Parachute: ${hostOf(hubState().origin)}` });
  for (const v of [VAULT, ...MORE_VAULTS.map((m) => m.vault)]) await expect(s.getByRole("combobox", { name: `Whose ${v} is` })).toHaveValue("mine");
  await expect(page.getByRole("region", { name: `Parachute: ${hostOf(techneState().origin)}` }).getByRole("combobox", { name: `Whose ${ORG_VAULT} is` })).toHaveValue("theirs");
});

test("each vault keeps a sign-in of its own: one refreshed, the others untouched", async ({ page }) => {
  await signInWithKey(page, hubState(), VAULT, "Mine");
  type Rec = { vault: string; accessToken: string; refreshToken: string; clientId: string };
  const held = () => page.evaluate(() => JSON.parse(localStorage.getItem("parachute.vaults.v1")!) as Rec[]);
  const before = await held();
  // three vaults, one registration of the app, a token pair each
  expect(before.map((v) => v.vault).sort()).toEqual([VAULT, ...MORE_VAULTS.map((m) => m.vault)].sort());
  expect(new Set(before.map((v) => v.clientId)).size).toBe(1);
  expect(new Set(before.map((v) => v.refreshToken)).size).toBe(3);
  // pantry's token is spoiled: its next read is refused, so the app refreshes pantry's own sign-in
  await page.evaluate(() => {
    const vaults = JSON.parse(localStorage.getItem("parachute.vaults.v1")!) as { vault: string; accessToken: string }[];
    for (const v of vaults) if (v.vault === "pantry") v.accessToken = "spoiled";
    localStorage.setItem("parachute.vaults.v1", JSON.stringify(vaults));
  });
  await page.goto("/v/pantry");
  await expect(ui(page).getByRole("list", { name: "Notes" })).toContainText("Shelves");
  const after = await held();
  const was = (v: string) => before.find((x) => x.vault === v)!, now = (v: string) => after.find((x) => x.vault === v)!;
  expect(now("pantry").refreshToken).not.toBe(was("pantry").refreshToken);
  for (const v of [VAULT, "letters"]) expect(now(v)).toEqual(was(v));
  // and the others still read with theirs
  await page.goto("/v/letters");
  await expect(ui(page).getByRole("list", { name: "Notes" })).toContainText("Post");
});

test("a sign-in stopped partway keeps the vaults it had, and says which", async ({ page }) => {
  // the hub says no to the last vault's own sign-in (as if the person pressed Deny on a page it showed)
  await page.route((u) => u.pathname === "/oauth/authorize" && u.searchParams.get("vault") === "pantry" && u.searchParams.get("scope") !== null && !u.searchParams.get("scope")!.includes("kitchen"), async (r) => {
    const u = new URL(r.request().url());
    await r.fulfill({ status: 302, headers: { location: `${u.searchParams.get("redirect_uri")}?error=access_denied&state=${u.searchParams.get("state")}` } });
  });
  const cookies = await keyDoor(hubState().origin, hubState().key);
  await page.context().addCookies(cookies.map((c) => ({ ...c, url: hubState().origin })));
  await page.goto("/");
  await page.getByLabel("Your Parachute's address").fill(hubState().origin);
  await page.getByRole("radio", { name: "Mine" }).check();
  await page.getByRole("button", { name: "Sign in" }).click();
  // the two pages without a key: see which vaults are yours, then all of them; the hops after stop at pantry
  for (let i = 0; i < 2; i++) {
    const before = page.url();
    await page.getByRole("button", { name: "Approve" }).click();
    await page.waitForURL((u) => u.href !== before);
  }
  await expect(page.getByRole("alert")).toContainText("You said no on the hub. The 2 vaults signed in to before that stay: kitchen, letters.");
  await page.getByRole("link", { name: "Open your launcher" }).click();
  for (const v of [VAULT, "letters"]) await expect(ui(page).getByRole("region", { name: v, exact: true })).toBeVisible();
  await expect(ui(page).getByRole("region", { name: "pantry", exact: true })).toHaveCount(0);
});

test("a second device that signs in to the home Parachute finds Techne on the list, a tap from signed in", async ({ browser }, info) => {
  const fresh = () => browser.newContext({ ...info.project.use, storageState: { cookies: [], origins: [] } });
  // the first device: both Parachutes, so the list holds both
  const first = await fresh();
  const a = await first.newPage();
  await signInWithKey(a, hubState(), VAULT, "Mine");
  await signInWithKey(a, techneState(), ORG_VAULT);
  await first.close();

  const second = await fresh();
  const b = await second.newPage();
  await signInWithKey(b, hubState(), VAULT, "Mine");
  // the same home, and Techne listed but not signed in here
  await expect(parachute(b, hubState().origin).getByRole("region", { name: VAULT, exact: true })).toContainText("your home");
  const org = parachute(b, techneState().origin);
  await expect(org).toContainText("not signed in on this device");
  await expect(org.getByRole("region", { name: ORG_VAULT, exact: true })).toHaveCount(0);
  // its Sign in fills in the address and still asks whose it is
  await org.getByRole("link", { name: `Sign in to ${hostOf(techneState().origin)}` }).click();
  await expect(b.getByLabel("Your Parachute's address")).toHaveValue(techneState().origin);
  await expect(b.getByRole("radio", { name: "Mine" })).not.toBeChecked();
  await expect(b.getByRole("radio", { name: /Someone else's/ })).not.toBeChecked();
  await signInWithKey(b, techneState(), ORG_VAULT);
  await expect(parachute(b, techneState().origin).getByRole("region", { name: ORG_VAULT, exact: true })).toBeVisible();
  await second.close();
});
