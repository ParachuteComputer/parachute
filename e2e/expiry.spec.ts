// Signed in across the access token's expiry (T-476). A device keeps each sign-in the hub rotates; so must the saved start
// the specs share, which is a device kept on disk (e2e/test.ts): three specs in a row that start from it after the token
// ran out each read the vault. The hub's clock is moved past the token's 15 minutes (e2e/clock.ts) instead of waiting.
// Last in the run, on a sign-in of its own through the key door (no fifth password sign-in: the hub limits them), so the
// moved clock reaches nothing after it.
import { expect, test, type Page } from "./test";
import { api, hubState, moveClock, VAULT } from "./hub";
import { expectInVault, signInWithKey } from "./helpers";

const SAVED = "e2e/.expiry-signed-in.json";
/** Past core's access token lifetime (15 minutes, ACCESS_TOKEN_TTL_SECONDS). */
const PAST_EXPIRY = 16 * 60_000;

test.afterEach(async () => { await moveClock(hubState(), 0); });

test("signed in across the access token's expiry: three specs in a row start from the kept sign-in and read the vault", async ({ page, browser }, info) => {
  test.setTimeout(180_000);
  await signInWithKey(page, hubState(), VAULT, "Mine");
  // Parachute's own Vault applet reaches the vaults picked for it (docs/ACCESS.md proposal 5), as the shared start has it
  await page.evaluate(({ hub, vault }) => {
    localStorage.setItem("parachute.picks.v1", JSON.stringify({ [`${hub}|${vault}|parachute:vault`]: [{ hub, vault }] }));
  }, { hub: new URL(hubState().origin).origin, vault: VAULT });
  // the self-test, as every saved start has passed it (auth.setup.ts)
  await page.goto("/settings");
  await expect(page.getByRole("status").filter({ hasText: /approved code only|run sealed/ })).toBeVisible({ timeout: 45_000 });
  await page.context().storageState({ path: SAVED });
  await page.context().close();
  const id = (await api(hubState(), "GET", `notes?id=${encodeURIComponent("Welcome")}`)).id as string;
  /** One spec's start: a browser from the saved sign-in, the Welcome note opened from the hub, and what the hub said to its refreshes. */
  const spec = async () => {
    const ctx = await browser.newContext({ ...info.project.use, storageState: SAVED });
    const refreshes: number[] = [];
    ctx.on("response", (r) => { if (new URL(r.url()).pathname === "/oauth/token") refreshes.push(r.status()); });
    const p: Page = await ctx.newPage();
    // a link to the note, as links.spec.ts opens one
    await p.goto(`/open-link?url=${encodeURIComponent(`parachute://open?url=${encodeURIComponent(`${hubState().origin}/surface/parachute/v/${VAULT}/n/${id}`)}`)}`);
    await expectInVault(p, VAULT, id, "Welcome");
    await ctx.close();
    return refreshes;
  };
  /** The hub said yes to every refresh, and there was one: the sign-in crossed the expiry and stayed. (A read refused just
   *  after a refresh can make the app refresh once more to check; vaultsDeps.ts. That is a yes too.) */
  const refreshedOk = (said: number[], which: string) => {
    expect(said.length, `${which}: refreshed`).toBeGreaterThan(0);
    expect(said.filter((s) => s !== 200), `${which}: what the hub refused`).toEqual([]);
  };
  // the token runs out: the first spec's reads are refused, it refreshes, and reads
  await moveClock(hubState(), PAST_EXPIRY);
  refreshedOk(await spec(), "the first spec after the expiry");
  // the next starts from what the first kept: its token is good, nothing to refresh
  expect.soft(await spec(), "the second").toEqual([]);
  // and it runs out again: the third refreshes the one kept last, not the spent one the sign-in started with
  await moveClock(hubState(), 2 * PAST_EXPIRY);
  refreshedOk(await spec(), "the third, after a second expiry");
});
