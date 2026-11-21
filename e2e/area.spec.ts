// An area's applet (applets/area.tsx, docs/WRITE-AN-APPLET.md "An applet for an area"): the synthetic area Garden, its
// room on our real Buzz relay beside its notes in the vault. Its grant names one room and one folder: the card says
// so, the page shows only those, and a call from inside the frame for another room or folder is refused (and nothing
// lands there, as bob sees it). Services workflow only, as rooms.spec.ts: BUZZ_RELAY and BUZZ_KEYS.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { getPublicKey } from "nostr-tools/pure";
import { api, hubState, VAULT } from "./hub";
import { installApplet, ui } from "./helpers";
import { person } from "./services/client";

const RELAY = process.env.BUZZ_RELAY;
const KEYS = process.env.BUZZ_KEYS ?? "";
test.skip(!RELAY || !KEYS, "needs our Buzz relay (BUZZ_RELAY, BUZZ_KEYS): e2e/services/README.md");
test.use({ storageState: "e2e/.signed-in.json" });

const secret = (n: string) => readFileSync(join(KEYS, `${n}.hex`), "utf8").trim();
const frame = (page: Page) => page.frameLocator("iframe.applet-frame");
/** The applet's own frame, to call its kit as a hostile applet would. */
const kitFrame = async (page: Page) => (await page.locator("iframe.applet-frame").elementHandle())!.contentFrame();

test("an area's applet: Garden's room beside Garden's notes, its grant one room and one folder, everything else refused", async ({ page }) => {
  test.setTimeout(180_000);
  const alice = getPublicKey(Uint8Array.from(Buffer.from(secret("alice"), "hex")));
  const bob = await person(RELAY!, secret("bob")); // Uni, here
  const stamp = Date.now().toString(36);
  const owner = await person(RELAY!, secret("owner"));
  const rooms = { Garden: crypto.randomUUID(), Kitchen: crypto.randomUUID() };
  for (const p of [alice, bob.pubkey]) await owner.publish({ kind: 9030, tags: [["p", p]] });
  for (const [name, id] of Object.entries(rooms)) {
    expect((await owner.publish({ kind: 9007, tags: [["h", id], ["name", `${name} ${stamp}`], ["visibility", "private"], ["channel_type", "stream"]] })).ok).toBe(true);
    for (const p of [alice, bob.pubkey]) expect((await owner.publish({ kind: 9000, tags: [["h", id], ["p", p]] })).ok).toBe(true);
  }
  owner.close();
  expect((await bob.publish({ kind: 9, content: `The beans are up ${stamp}.`, tags: [["h", rooms.Garden]] })).ok).toBe(true);
  expect((await bob.publish({ kind: 9, content: `Only for the kitchen ${stamp}.`, tags: [["h", rooms.Kitchen]] })).ok).toBe(true);
  // the vault: Garden's own note and one more, and a note of another area
  const notes: string[] = [];
  const note = async (path: string, content: string) => notes.push((await api(hubState(), "POST", "notes", { path, content })).id);
  await note("Areas/Garden/Garden", `# Garden\n\nThe beds by the shed, and what grows in them ${stamp}.`);
  await note("Areas/Garden/Seed order", `Beans, garlic, kale ${stamp}.`);
  await note("Areas/Kitchen/Pantry", `Jars ${stamp}.`);
  await page.addInitScript((k) => { if (window === window.top) (window as unknown as { __parachuteE2EKey: string }).__parachuteE2EKey = k; }, secret("alice"));
  const made = await installApplet("area", { relay: RELAY!, uni: bob.pubkey, area: "Garden", area_id: "garden", area_room: rooms.Garden });
  try {
    await page.goto(`/v/${VAULT}?with=vault`);
    await ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name: /Garden/ }).click();
    // the card: that folder, that room, and nothing wider
    const card = page.getByRole("region", { name: /asking for access/ });
    await expect(card).toContainText("Read notes outside its own folder, in Areas/Garden/");
    await expect(card).toContainText(`post as you only in «Garden» (${rooms.Garden.slice(0, 6)}`);
    await expect(card).toContainText("It reads only those rooms there");
    await expect(card).toContainText("Includes «Room», a component from this vault");
    await expect(card).not.toContainText("in your rooms");
    await expect(card).not.toContainText("Areas/Kitchen");
    await page.getByRole("button", { name: "Allow" }).click();

    // the page: Garden's note and notes, Garden's room
    const app = frame(page);
    await expect(app.getByRole("heading", { name: "Garden", level: 1 })).toBeVisible();
    await expect(app.getByText(`The beds by the shed, and what grows in them ${stamp}.`)).toBeVisible({ timeout: 20_000 });
    const list = app.getByRole("region", { name: "Notes in Garden" });
    await expect(list.getByRole("button", { name: /Seed order/ })).toBeVisible();
    await expect(app.locator("body")).not.toContainText(`Jars ${stamp}`);
    const talk = app.getByRole("region", { name: "Talk about Garden" });
    await expect(talk.getByRole("log")).toContainText(`The beans are up ${stamp}.`, { timeout: 20_000 });
    await expect(app.locator("body")).not.toContainText(`Only for the kitchen ${stamp}`);
    // a note opens in place
    await list.getByRole("button", { name: /Seed order/ }).click();
    await expect(app.getByText(`Beans, garlic, kale ${stamp}.`)).toBeVisible();
    await app.getByRole("button", { name: "← Garden" }).click();

    // talking there: alice's message lands in Garden, naming Uni (listening)
    await talk.getByLabel(`Message Garden ${stamp}`).fill(`Shall we sow the kale ${stamp}`);
    await talk.getByRole("button", { name: "Send message" }).click();
    await expect(talk.getByRole("log").locator("article.mine", { hasText: `Shall we sow the kale ${stamp}` })).toBeVisible({ timeout: 15_000 });
    const sent = (await bob.query({ kinds: [9], "#h": [rooms.Garden], authors: [alice], limit: 10 })).find((e) => e.content.includes(`sow the kale ${stamp}`));
    expect(sent?.tags).toContainEqual(["p", bob.pubkey]);

    // a crafted call from inside the frame, for the other room or folder, is refused
    const f = await kitFrame(page);
    const tried = await f!.evaluate(async (other) => {
      const kit = (window as unknown as { uni: any }).uni;
      const relay = kit.services.relay("rooms");
      const out: Record<string, string> = {};
      const attempt = async (k: string, p: () => Promise<unknown>) => { try { const r: any = await p(); out[k] = r === null ? "refused: not there for it" : r && r.ok === false ? `refused: ${r.message}` : `went: ${JSON.stringify(r).slice(0, 120)}`; } catch (e: any) { out[k] = `refused: ${e?.code ?? ""} ${e?.message ?? e}`; } };
      await attempt("post", () => relay.publish({ kind: 9, content: "sneaking in", tags: [["h", other]] }));
      await attempt("read", () => relay.query([{ kinds: [9], "#h": [other], limit: 5 }]));
      await attempt("search", () => relay.query([{ kinds: [9], search: "kitchen", limit: 5 }]));
      await attempt("folder", () => kit.vault.queryRecords({ pathPrefix: "Areas/Kitchen/", includeBody: true }));
      await attempt("note", () => kit.vault.getRecord("Areas/Kitchen/Pantry")); // outside its folders a note is as if it weren't there
      return out;
    }, rooms.Kitchen);
    for (const [k, v] of Object.entries(tried)) expect(v, k).toMatch(/^refused/);
    // and nothing of alice's reached the kitchen
    expect(await bob.query({ kinds: [9], "#h": [rooms.Kitchen], authors: [alice] })).toEqual([]);

    // on a phone the room sits under the area's note; on a wide screen, beside it
    const lede = app.getByRole("region", { name: "Garden", exact: true });
    const box = async () => ({ note: (await lede.boundingBox())!, talk: (await talk.boundingBox())! });
    let b = await box();
    expect(b.talk.y).toBeGreaterThanOrEqual(b.note.y + b.note.height - 1);
    await page.setViewportSize({ width: 1280, height: 860 });
    await expect.poll(async () => { b = await box(); return b.talk.x >= b.note.x + b.note.width; }).toBe(true);
    expect(Math.abs(b.talk.y - b.note.y)).toBeLessThan(200);
  } finally {
    bob.close();
    await made.remove();
    for (const id of notes) await api(hubState(), "DELETE", `notes/${id}`).catch(() => {});
  }
});
