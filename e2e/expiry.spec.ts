// Signed in across the access token's expiry (T-476). A device keeps each sign-in the hub rotates; so must the saved start
// the specs share, which is a device kept on disk (e2e/test.ts): three specs in a row that start from it after the token
// ran out each read the vault. The hub's clock is moved past the token's 15 minutes (e2e/clock.ts) instead of waiting.
// Last in the run, on a sign-in of its own through the key door (a fourth password sign-in meets the hub's limit), so the
// moved clock reaches nothing after it.
import { expect, test, type Page } from "./test";
import { api, hubState, moveClock, VAULT } from "./hub";
import { expectInVault, signInWithKey } from "./helpers";

const SAVED = "e2e/.expiry-signed-in.json";
/** Past core's access token lifetime (15 minutes, ACCESS_TOKEN_TTL_SECONDS). */
const PAST_EXPIRY = 16 * 60_000;

test.describe.configure({ mode: "serial" });
test.afterAll(async () => { await moveClock(hubState(), 0); });

test("a sign-in of its own, saved as the shared start is", async ({ page }) => {
  test.setTimeout(120_000);
  await signInWithKey(page, hubState(), VAULT, "Mine");
  // Parachute's own Vault applet reaches the vaults picked for it (docs/ACCESS.md proposal 5), as the shared start has it
  await page.evaluate(({ hub, vault }) => {
    localStorage.setItem("parachute.picks.v1", JSON.stringify({ [`${hub}|${vault}|parachute:vault`]: [{ hub, vault }] }));
  }, { hub: new URL(hubState().origin).origin, vault: VAULT });
  // the self-test, as every saved start has passed it (auth.setup.ts)
  await page.goto("/settings");
  await expect(page.getByRole("status").filter({ hasText: /approved code only|run sealed/ })).toBeVisible({ timeout: 45_000 });
  await page.context().storageState({ path: SAVED });
});

test.describe("three specs in a row, each starting from the saved sign-in", () => {
  test.use({ storageState: SAVED });

  /** The Welcome note opened from a link, read from the hub; what the hub said to each refresh on the way. */
  async function opens(page: Page): Promise<number[]> {
    const said: number[] = [];
    page.context().on("response", (r) => { if (new URL(r.url()).pathname === "/oauth/token") said.push(r.status()); });
    const id = (await api(hubState(), "GET", `notes?id=${encodeURIComponent("Welcome")}`)).id as string;
    // a link to the note, as links.spec.ts opens one
    await page.goto(`/open-link?url=${encodeURIComponent(`parachute://open?url=${encodeURIComponent(`${hubState().origin}/surface/parachute/v/${VAULT}/n/${id}`)}`)}`);
    await expectInVault(page, VAULT, id, "Welcome");
    return said;
  }
  /** There was a refresh and the hub said yes to every one: the sign-in crossed the expiry and stayed. (A read refused just
   *  after a refresh can make the app refresh once more to check, vaultsDeps.ts; that is a yes too.) */
  const refreshed = (said: number[]) => {
    expect(said.length, "refreshed").toBeGreaterThan(0);
    expect(said.filter((s) => s !== 200), "what the hub refused").toEqual([]);
  };

  test("the first after the access token ran out: its reads are refused, it refreshes, and reads", async ({ page }) => {
    await moveClock(hubState(), PAST_EXPIRY);
    refreshed(await opens(page));
  });

  test("the second starts from what the first kept: its token is good, nothing to refresh", async ({ page }) => {
    expect(await opens(page)).toEqual([]);
  });

  test("after a second expiry, the third refreshes the one kept last, not the spent one the sign-in started with", async ({ page }) => {
    await moveClock(hubState(), 2 * PAST_EXPIRY);
    refreshed(await opens(page));
  });
});
