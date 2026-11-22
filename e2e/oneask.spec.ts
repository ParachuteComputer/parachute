// T-476 (one ask cutover): the room applet against asks made by uni-tasks' real `tasks.py ask` (the merged step-3
// code), on a throwaway Buzz relay run with production's image and auth flags. Local only: needs BUZZ_RELAY, BUZZ_KEYS
// (owner, alice = Aaron's stand-in, bob = Uni's stand-in), ONEASK_ROOM (a room with both in it) and ONEASK_ENV (a
// shell file that points tasks.py at that relay, bob's key and a test registry). Made-up asks only.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { getPublicKey } from "nostr-tools/pure";
import { VAULT } from "./hub";
import { installApplet, ui } from "./helpers";

const RELAY = process.env.BUZZ_RELAY, KEYS = process.env.BUZZ_KEYS ?? "", ROOM = process.env.ONEASK_ROOM, ENV = process.env.ONEASK_ENV;
test.skip(!RELAY || !KEYS || !ROOM || !ENV, "needs BUZZ_RELAY, BUZZ_KEYS, ONEASK_ROOM, ONEASK_ENV");
test.use({ storageState: "e2e/.signed-in.json" });
const secret = (n: string) => readFileSync(join(KEYS, `${n}.hex`), "utf8").trim();
const frame = (page: Page) => page.frameLocator("iframe.applet-frame");
/** uni-tasks' own CLI, as a room runs it (cwd: the merged uni-tasks worktree). */
const tasks = (...args: string[]) => execFileSync("bash", ["-c", `. "$0" && cd "$UNI_ASK_DIR/../../uni-tasks" && python3 tasks.py "$@"`, ENV!, ...args], { encoding: "utf8" });
const list = () => JSON.parse(tasks("ask", "--list", "--all", "--json")) as { id: string; state: string; what: string }[];

test("one ask: tasks.py asks, the room applet shows it, Aaron answers, the room closes it, and it clears", async ({ page }) => {
  test.setTimeout(180_000);
  const stamp = Date.now().toString(36);
  const pick = tasks("ask", "--room", "asktest", "--kind", "choose", "--what", `Which bed gets the garlic ${stamp}?`, "--why", "Made-up ask (T-476 round trip)", "--options", "North bed,South bed", "--default", "North bed");
  const tell = tasks("ask", "--room", "asktest", "--kind", "tell", "--what", `The beans are up ${stamp}`, "--why", "Made-up ask (T-476 round trip)");
  const idOf = (out: string) => out.match(/ask ([0-9a-f]{64})/)![1];
  const [a, b] = [idOf(pick), idOf(tell)];
  expect(list().filter((x) => x.id === a || x.id === b).map((x) => x.state)).toEqual(["open", "open"]);

  await page.addInitScript((k) => { if (window === window.top) (window as unknown as { __parachuteE2EKey: string }).__parachuteE2EKey = k; }, secret("alice"));
  const made = await installApplet("rooms", { relay: RELAY!, uni: getPublicKey(Uint8Array.from(Buffer.from(secret("bob"), "hex"))) });
  try {
    await page.goto(`/v/${VAULT}`);
    await ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name: /Rooms/ }).click();
    await page.getByRole("button", { name: "Allow" }).click();
    const app = frame(page);
    const rooms = app.getByRole("region", { name: "Your rooms" });
    const row = rooms.getByRole("button", { name: /ask-test-t476/ });
    await expect(row).toContainText(/wants? you/, { timeout: 30_000 });
    await page.screenshot({ path: "../walkthrough/01-rooms-wants-you.png" });
    await row.click();
    const log = app.getByRole("log");
    // 1. both asks tasks.py posted are cards
    await expect(log.getByRole("group", { name: `Wants you: Which bed gets the garlic ${stamp}?` })).toBeVisible({ timeout: 20_000 });
    await expect(log.getByRole("group", { name: `Wants you: The beans are up ${stamp}` })).toBeVisible();
    await page.screenshot({ path: "../walkthrough/02-room-ask-cards.png" });
    // 2. Aaron answers the choose ask in the app; uni-tasks reads that answer off the relay
    await log.getByRole("group", { name: `Wants you: Which bed gets the garlic ${stamp}?` }).getByRole("button", { name: "North bed" }).click();
    await expect(log.getByRole("group", { name: "Ended ask" }).filter({ hasText: `garlic ${stamp}? · You picked North bed` })).toBeVisible();
    await expect.poll(() => list().find((x) => x.id === a)?.state, { timeout: 15_000 }).toBe("answered");
    await page.screenshot({ path: "../walkthrough/03-answered.png" });
    // 3. the room closes both: the answered one as done, the unanswered one as withdrawn
    tasks("ask", "--close", a, "--reason", "done");
    tasks("ask", "--close", b, "--reason", "withdrawn");
    expect(list().filter((x) => x.id === a || x.id === b).map((x) => x.state)).toEqual(["answered", "closed"]);   // an answered ask stays answered after its close (SPEC §4)
    // 4. cleared: no card is left asking, and the room's row no longer says it wants him
    await expect(log.getByRole("group", { name: `Wants you: The beans are up ${stamp}` })).toHaveCount(0, { timeout: 15_000 });
    await expect(log.getByRole("group", { name: /^Wants you: / })).toHaveCount(0);
    await expect(log.getByText(`Closed (withdrawn): The beans are up ${stamp}`)).toBeVisible();
    await page.screenshot({ path: "../walkthrough/04-closed-cleared.png" });
    await app.getByRole("button", { name: /Back|Rooms/ }).first().click().catch(() => {});
    await page.reload();
    await ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name: /Rooms/ }).click().catch(() => {});
    await expect(frame(page).getByRole("region", { name: "Your rooms" }).getByRole("button", { name: /ask-test-t476/ })).toBeVisible({ timeout: 30_000 });
    await expect(frame(page).getByRole("region", { name: "Your rooms" }).getByRole("button", { name: /ask-test-t476/ })).not.toContainText(/wants? you/);
  } finally { await made.remove(); }
});
