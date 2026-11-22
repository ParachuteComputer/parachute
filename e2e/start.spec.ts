// A newcomer's first screen (T-476 first run): a person whose home vault holds nothing of theirs lands on the list with
// "Start here": bring in what you have (Vault: a pack, or Import from Notion) and connect their AI. A coach takes
// "Clients and sessions", a starter pack: client, session and follow-up, a template each and a view of open
// follow-ups; a new session starts from its template; and once a pack is in, Start here is gone.
// It signs in itself, on a vault made empty for it, so it runs with the sign-in specs. Adding a pack needs core #139
// (write may define a type over REST); on an older hub that part skips, unless E2E_CORE_NEXT=1.
import { expect, test, type Page } from "@playwright/test";
import { api, cli, hubState, mintToken } from "./hub";
import { ui } from "./helpers";

const FRESH = "practice";
const frame = (page: Page) => page.frameLocator("iframe.applet-frame");
const shot = (page: Page, name: string) => (process.env.WALKTHROUGH_DIR ? page.screenshot({ path: `${process.env.WALKTHROUGH_DIR}/${name}.png` }) : Promise.resolve());
const dropVault = () => { try { cli(hubState(), ["vault", "remove", FRESH, "--yes"]); } catch { /* gone already */ } };

/** Sign in on a new device with a password and the hub's consent, the fresh vault as home, until the app is back. */
async function signInFresh(page: Page) {
  const hub = hubState();
  await page.goto("/");
  const app = new URL(page.url()).origin;
  await page.getByLabel("Your Parachute's address").fill(hub.origin);
  await page.getByRole("radio", { name: "Mine" }).check();
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => u.origin === hub.origin);
  // a new device with no session on the hub: its "not yet approved" page first, whose sign-in approves it (core T-476)
  const viaSignIn = page.getByRole("link", { name: /Sign in/ }).or(page.getByRole("button", { name: /Sign in/ })).first();
  if (!(await page.locator('input[type="password"]').isVisible().catch(() => false)) && await viaSignIn.isVisible().catch(() => false)) await viaSignIn.click();
  await page.locator('input[type="password"]').waitFor({ timeout: 15_000 }).catch(() => {});
  if (await page.locator('input[type="password"]').isVisible().catch(() => false)) {
    await page.locator('input[name="username"]').fill("owner");
    await page.locator('input[type="password"]').fill(hub.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  }
  const approve = page.getByRole("button", { name: "Approve" }), pick = page.getByRole("button", { name: "Continue" });
  const where = async () => {
    const u = new URL(page.url());
    if (u.origin === app && await pick.isVisible().catch(() => false)) return "pick";
    if (u.origin === app && (u.pathname === "/" || u.pathname.startsWith("/v/"))) return "back";
    return u.origin === hub.origin && await approve.isVisible().catch(() => false) ? "asked" : "wait";
  };
  for (let i = 0; i < 6; i++) {
    await expect.poll(where, { timeout: 30_000 }).not.toBe("wait");
    const at = await where();
    if (at === "back") return;
    if (at === "pick") { await page.getByRole("radio", { name: FRESH, exact: true }).check(); await pick.click(); }
    else await approve.click();
    await page.waitForTimeout(500);
  }
}

// a new device: nothing signed in, no saved session
test.use({ storageState: { cookies: [], origins: [] } });
test.beforeAll(() => { dropVault(); cli(hubState(), ["vault", "create", FRESH, "--json", "--no-mirror"]); });
test.afterAll(dropVault);

test("a new vault: Start here leads to Vault and Connect; Clients and sessions starts a practice; then Start here goes", async ({ page }) => {
  test.setTimeout(150_000);
  await signInFresh(page);
  await page.goto("/");
  const start = ui(page).getByRole("region", { name: "Start here" });
  await expect(start.getByRole("link", { name: /Bring in what you have/ })).toBeVisible({ timeout: 30_000 });
  await expect(start.getByRole("link", { name: /Connect your AI/ })).toBeVisible();
  await shot(page, "01-start-here");

  // Connect: one address, and what to choose so the AI can save
  await start.getByRole("link", { name: /Connect your AI/ }).click();
  await expect(frame(page).getByText(/Write.*so it can (remember|save)/)).toBeVisible({ timeout: 30_000 });
  await page.goto("/");

  const hub = hubState();
  const probe = await fetch(`${hub.origin}/vault/${FRESH}/api/types/startprobe`, { method: "PUT", headers: { authorization: `Bearer ${mintToken(`vault:${FRESH}:write`)}`, "content-type": "application/json" }, body: JSON.stringify({ kind: "type", fields: { x: { type: "string" } } }) });
  test.skip(!probe.ok && process.env.E2E_CORE_NEXT !== "1", "adding a pack needs core #139");
  await api({ origin: hub.origin, token: mintToken(`vault:${FRESH}:admin`) }, "DELETE", "types/startprobe", undefined, FRESH).catch(() => {});

  // Bring in what you have → Vault → Add a pack → Clients and sessions
  await ui(page).getByRole("region", { name: "Start here" }).getByRole("link", { name: /Bring in what you have/ }).click();
  const app = frame(page);
  await expect(app.getByRole("button", { name: "Import from Notion" })).toBeVisible({ timeout: 30_000 });
  await app.getByRole("button", { name: "Add a pack" }).click();
  await expect(app.getByRole("region", { name: "Clients and sessions" })).toContainText("client (status, working on, email, next session)");
  await expect(app.getByRole("region", { name: "Reading list" })).toBeVisible();
  await shot(page, "02-packs");
  await app.getByRole("button", { name: "Add Clients and sessions" }).click();
  await expect(app.getByRole("region", { name: "What Clients and sessions did" })).toContainText("Added the types client, session, follow-up and template, 3 templates and the saved view Open.", { timeout: 30_000 });

  // a pack added is a start: back on the list, no Start here (before any record of theirs)
  await page.goto("/");
  await expect(ui(page).getByRole("list", { name: "Applets" })).toBeVisible({ timeout: 30_000 });
  await expect(ui(page).getByRole("region", { name: "Start here" })).toHaveCount(0);
  await ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name: /^Vault/ }).click();

  // the vault has them, and a new session starts from its template
  const types = (await api({ origin: hub.origin, token: mintToken(`vault:${FRESH}:read`) }, "GET", "types?include_schema=true", undefined, FRESH)) as { name: string; fields: Record<string, { type: string }> }[];
  expect(types.find((t) => t.name === "follow-up")?.fields).toMatchObject({ client: { type: "reference" }, due: { type: "date" }, done: { type: "boolean" } });
  // Vault opens where it was left (Packs, with Clients and sessions installed): back to the vault, its session type
  await expect(app.getByRole("region", { name: "Installed packs" })).toContainText("Clients and sessions", { timeout: 30_000 });
  await app.getByRole("button", { name: `← ${FRESH}` }).click();
  await app.getByText("session", { exact: true }).click({ timeout: 30_000 });
  await app.getByLabel("New session").fill("Sam, first session");
  await app.getByRole("button", { name: "Add" }).click();
  await expect(app.getByText("How they are")).toBeVisible({ timeout: 30_000 });
  await shot(page, "03-new-session");

});
