// T-476 (one ask cutover): the room applet against asks made by uni-tasks' real `tasks.py ask` (the merged step-3
// code), on a throwaway Buzz relay run with production's image and auth flags. Local only: needs BUZZ_RELAY, BUZZ_KEYS
// (owner, alice = Aaron's stand-in, bob = Uni's stand-in), ONEASK_ROOM (a room with both in it) and ONEASK_ENV (a
// shell file that points tasks.py at that relay, bob's key and a test registry). Made-up asks only.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { getPublicKey } from "nostr-tools/pure";
import { api, hubState, VAULT } from "./hub";
import { installApplet, ui } from "./helpers";
import { person } from "./services/client";

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
  for (const x of list().filter((x) => ["open", "later", "lapsed"].includes(x.state))) tasks("ask", "--close", x.id, "--reason", "withdrawn");   // earlier runs' leftovers
  const pick = tasks("ask", "--room", "asktest", "--kind", "choose", "--what", `Which bed gets the garlic ${stamp}?`, "--why", "Made-up ask (T-476 round trip)", "--options", "North bed,South bed", "--default", "North bed");
  const tell = tasks("ask", "--room", "asktest", "--kind", "tell", "--what", `The beans are up ${stamp}`, "--why", "Made-up ask (T-476 round trip)");
  const idOf = (out: string) => out.match(/ask ([0-9a-f]{64})/)![1];
  const [a, b] = [idOf(pick), idOf(tell)];
  const state = () => { const l = list(); return [l.find((x) => x.id === a)?.state, l.find((x) => x.id === b)?.state]; };
  expect(state()).toEqual(["open", "open"]);

  await page.addInitScript((k) => { if (window === window.top) (window as unknown as { __parachuteE2EKey: string }).__parachuteE2EKey = k; }, secret("alice"));
  const made = await installApplet("rooms", { relay: RELAY!, uni: getPublicKey(Uint8Array.from(Buffer.from(secret("bob"), "hex"))) });
  try {
    await page.goto(`/v/${VAULT}?with=vault`);
    await ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name: /Rooms/ }).click();
    await page.getByRole("button", { name: "Allow" }).click();
    const app = frame(page);
    const rooms = app.getByRole("region", { name: "Your rooms" });
    const row = rooms.getByRole("button", { name: /ask-test-t476/ });
    await expect(row).toContainText(/wants? you/, { timeout: 30_000 });
    await row.click();
    const log = app.getByRole("log");
    // 1. both asks tasks.py posted are cards
    await expect(log.getByRole("group", { name: `Wants you: Which bed gets the garlic ${stamp}?` })).toBeVisible({ timeout: 20_000 });
    await expect(log.getByRole("group", { name: `Wants you: The beans are up ${stamp}` })).toBeVisible();
    // 2. Aaron answers the choose ask in the app; uni-tasks reads that answer off the relay
    await log.getByRole("group", { name: `Wants you: Which bed gets the garlic ${stamp}?` }).getByRole("button", { name: "North bed" }).click();
    await expect(log.getByRole("group", { name: "Ended ask" }).filter({ hasText: `garlic ${stamp}? · You picked North bed` })).toBeVisible();
    await expect.poll(() => list().find((x) => x.id === a)?.state, { timeout: 15_000 }).toBe("answered");
    // 3. the room closes both: the answered one as done, the unanswered one as withdrawn
    tasks("ask", "--close", a, "--reason", "done");
    tasks("ask", "--close", b, "--reason", "withdrawn");
    expect(state()).toEqual(["answered", "closed"]);   // an answered ask stays answered after its close (SPEC §4)
    // 4. cleared: no card is left asking, and the room's row no longer says it wants him
    await expect(log.getByRole("group", { name: `Wants you: The beans are up ${stamp}` })).toHaveCount(0, { timeout: 15_000 });
    await expect(log.getByRole("group", { name: /^Wants you: / })).toHaveCount(0);
    await expect(log.getByText(`Closed (withdrawn): The beans are up ${stamp}`)).toBeVisible();
    // a fresh start of the applet reads the room again from the relay: the row no longer says it wants him
    await page.reload();
    await page.getByRole("button", { name: "Open Rooms" }).click();
    await expect(frame(page).getByRole("region", { name: "Your rooms" }).getByRole("button", { name: /ask-test-t476/ })).toBeVisible({ timeout: 30_000 });
    await expect(frame(page).getByRole("region", { name: "Your rooms" }).getByRole("button", { name: /ask-test-t476/ })).not.toContainText(/wants? you/);
  } finally { await made.remove(); }
});

test("one ask: a close under a stream of later edits still ends it, on Today and on a fresh Rooms", async ({ page }) => {
  test.setTimeout(240_000);
  const stamp = Date.now().toString(36);
  for (const x of list().filter((x) => ["open", "later", "lapsed"].includes(x.state))) tasks("ask", "--close", x.id, "--reason", "withdrawn");
  const keep = tasks("ask", "--room", "asktest", "--kind", "do", "--what", `Stays open ${stamp}`, "--why", "Made-up ask (T-476)").match(/ask ([0-9a-f]{64})/)![1];
  const gone = tasks("ask", "--room", "asktest", "--kind", "do", "--what", `Closed then buried ${stamp}`, "--why", "Made-up ask (T-476)").match(/ask ([0-9a-f]{64})/)![1];
  tasks("ask", "--close", gone, "--reason", "withdrawn");
  // then Uni streams a long reply in the room: 45 edits of one message, newer than the close
  const bob = await person(RELAY!, secret("bob"));
  // the asker edits the closed ask again, block and all: a close is final (uni-ask SPEC §3), so it stays closed
  const until = Math.floor(Date.now() / 1000) + 3600;
  expect((await bob.publish({ kind: 40003, content: `Reopened?\n\n\`\`\`uni-ask\n${JSON.stringify({ v: 1, kind: "do", what: `Closed then buried ${stamp}`, why: "x", until })}\n\`\`\``, tags: [["h", ROOM!], ["e", gone]] })).ok).toBe(true);
  const reply = await bob.publish({ kind: 9, content: "Thinking", tags: [["h", ROOM!]] });
  for (let i = 0; i < 45; i++) {
    for (let tries = 0; ; tries++) {                 // the relay's publish quota: wait as it says
      const r = await bob.publish({ kind: 40003, content: i === 44 ? "Thinking done: the ask format is a fenced block.\n\n```uni-ask\nan example, not an ask\n```" : `Thinking ${"…".repeat(i)}`, tags: [["h", ROOM!], ["e", reply.ev.id]] });
      if (r.ok) break;
      const wait = Number(/retry in (\d+)s/.exec(r.msg)?.[1] ?? NaN);
      expect(Number.isNaN(wait) || tries > 5, r.msg).toBe(false);
      await new Promise((res) => setTimeout(res, wait * 1000 + 500));
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  bob.close();
  await page.addInitScript((k) => { if (window === window.top) (window as unknown as { __parachuteE2EKey: string }).__parachuteE2EKey = k; }, secret("alice"));
  const uni = getPublicKey(Uint8Array.from(Buffer.from(secret("bob"), "hex")));
  const rooms = await installApplet("rooms", { relay: RELAY!, uni });
  const home = await installApplet("today", { relay: RELAY!, uni });
  const made: string[] = [];
  const rows = async (q: string) => { const r = await api(hubState(), "GET", q); return (Array.isArray(r) ? r : r.notes ?? []) as { id: string }[]; };
  for (const t of ["parachute-settings", "parachute-app"]) for (const n of await rows(`notes?tag=${t}`)) await api(hubState(), "DELETE", `notes/${n.id}`);
  try {
    made.push((await api(hubState(), "POST", "notes", { path: "Parachute/Apps/uni", content: "an app", tags: ["parachute-app"], metadata: { app: {
      contract: 1, id: "uni", name: "Uni", sources: [{ vault: VAULT, applet: "*" }], start: { vault: VAULT, applet: "Applets/Home" },
      bar: [{ vault: VAULT, applet: "Applets/Home" }, { vault: VAULT, applet: "Applets/Rooms" }] } } })).id);
    made.push((await api(hubState(), "POST", "notes", { path: "Parachute/Settings", content: "settings", tags: ["parachute-settings"], metadata: { parachute: { app: "uni" } } })).id);
    await page.goto("about:blank");
    await page.goto("/");
    await page.getByRole("button", { name: "Allow" }).click();
    const wants = frame(page).getByRole("region", { name: "Wants you" });
    await expect(wants).toContainText(`Stays open ${stamp}`, { timeout: 30_000 });
    await expect(wants).not.toContainText(`Closed then buried ${stamp}`);
    // Rooms, started fresh: the room wants him once (the open ask), not twice
    await page.getByRole("navigation", { name: "Bar" }).getByRole("link", { name: /Rooms/ }).click();
    await page.getByRole("button", { name: "Allow" }).click().catch(() => {});
    const row = page.locator("iframe.applet-frame:visible").contentFrame().getByRole("region", { name: "Your rooms" }).getByRole("button", { name: /ask-test-t476/ });
    await expect(row).toContainText("Something wants you", { timeout: 30_000 });
    // and in the room: the open ask is a card, the closed one (re-edited with its block after, buried under edits) is not
    await row.click();
    const log = page.locator("iframe.applet-frame:visible").contentFrame().getByRole("log");
    await expect(log.getByRole("group", { name: `Wants you: Stays open ${stamp}` })).toBeVisible({ timeout: 20_000 });
    await expect(log.getByRole("group", { name: `Wants you: Closed then buried ${stamp}` })).toHaveCount(0);
    await expect(log.getByText(`Closed (withdrawn): Closed then buried ${stamp}`)).toBeVisible();
    // a reply that quotes the ask format is no ask: its last streamed edit (it carries the fence line) is what the room shows
    await expect(log.getByText("Thinking done: the ask format is a fenced block.")).toBeVisible();
  } finally {
    tasks("ask", "--close", keep, "--reason", "withdrawn");
    for (const id of made) await api(hubState(), "DELETE", `notes/${id}`).catch(() => {});
    await home.remove(); await rooms.remove();
  }
});
