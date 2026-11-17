// Rooms (applets/rooms.tsx) against our real Buzz relay, two people: alice in the app, bob on his own connection.
// Local only (e2e/services/README.md): it runs when BUZZ_RELAY names a relay run with production's auth settings, and
// BUZZ_KEYS a folder with owner.hex (the relay's owner), alice.hex and bob.hex. Each run makes its own two rooms.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { getPublicKey } from "nostr-tools/pure";
import { api, hubState, record, VAULT } from "./hub";
import { ui } from "./helpers";
import { person } from "./services/client";
import { appletRecord } from "../applets/record.ts";

const RELAY = process.env.BUZZ_RELAY;
const KEYS = process.env.BUZZ_KEYS ?? "";
test.skip(!RELAY || !KEYS, "needs our Buzz relay (BUZZ_RELAY, BUZZ_KEYS): e2e/services/README.md");
test.use({ storageState: "e2e/.signed-in.json" });

const secret = (n: string) => readFileSync(join(KEYS, `${n}.hex`), "utf8").trim();
const frame = (page: Page) => page.frameLocator("iframe.applet-frame");

test("rooms on a real relay: two people talk, with cards, mentions, a reply, a reaction, a picture and a voice note", async ({ page }) => {
  test.setTimeout(180_000);
  const alice = getPublicKey(Uint8Array.from(Buffer.from(secret("alice"), "hex")));
  const bob = await person(RELAY!, secret("bob"));
  const stamp = Date.now().toString(36);
  // the owner lets both in, and makes this run's rooms with both in them
  const owner = await person(RELAY!, secret("owner"));
  const rooms = { Garden: crypto.randomUUID(), Kitchen: crypto.randomUUID() };
  for (const p of [alice, bob.pubkey]) await owner.publish({ kind: 9030, tags: [["p", p]] });
  for (const [name, id] of Object.entries(rooms)) {
    expect((await owner.publish({ kind: 9007, tags: [["h", id], ["name", `${name} ${stamp}`], ["visibility", "private"], ["channel_type", "stream"]] })).ok).toBe(true);
    for (const p of [alice, bob.pubkey]) expect((await owner.publish({ kind: 9000, tags: [["h", id], ["p", p]] })).ok).toBe(true);
  }
  owner.close();
  // bob has a name (his profile): the @ list and the room show it
  await bob.publish({ kind: 0, content: JSON.stringify({ name: "Bob", display_name: "Bob" }) });
  await page.addInitScript((k) => { if (window === window.top) (window as unknown as { __parachuteE2EKey: string }).__parachuteE2EKey = k; }, secret("alice"));
  const note = await record(hubState(), "create", appletRecord("rooms", { relay: RELAY! }));
  try {
    // bob writes first: a plain message, an ask, Hermes's command prompt, a picture and a voice note
    const g = rooms.Garden;
    const until = Math.floor(Date.now() / 1000) + 3600;
    expect((await bob.publish({ kind: 9, content: `Morning! The **beans** are up ${stamp}.`, tags: [["h", g], ["p", bob.pubkey]] })).ok).toBe(true);
    const ask = await bob.publish({ kind: 9, content: `Which bed gets the garlic?\n\n\`\`\`uni-ask\n${JSON.stringify({ v: 1, kind: "choose", what: `Where should the garlic go ${stamp}?`, why: "It goes in this week.", until, options: [{ id: "north", label: "North bed" }, { id: "south", label: "South bed" }] })}\n\`\`\``, tags: [["h", g], ["p", alice]] });
    expect(ask.ok).toBe(true);
    const prompt = await bob.publish({ kind: 9, content: "**Hermes wants to run a command that needs your OK**\n```\nrm -rf ./build\n```\nWhy it was flagged: it deletes files\n\nReply `/approve` to run it once, or `/deny` to cancel.", tags: [["h", g]] });
    expect(prompt.ok).toBe(true);
    const png = readFileSync(new URL("./fixtures/seedlings.png", import.meta.url));
    const pic = await bob.upload(png, "image/png");
    expect((await bob.publish({ kind: 9, content: `![image](${pic.url})`, tags: [["h", g], ["imeta", `url ${pic.url}`, "m image/png", `x ${pic.sha256}`, `size ${pic.size}`, "filename seedlings.png", "alt seedlings.png"]] })).ok).toBe(true);
    await new Promise((r) => setTimeout(r, 1100)); // the voice note is the newest, by a second
    const voice = await bob.upload(readFileSync(new URL("./fixtures/voice.webm", import.meta.url)), "audio/webm");
    expect((await bob.publish({ kind: 9, content: "", tags: [["h", g], ["imeta", `url ${voice.url}`, `m ${voice.type}`, `x ${voice.sha256}`, `size ${voice.size}`, "filename voice.webm"]] })).ok).toBe(true);

    // alice opens Rooms: the card names the relay and what it does there as her
    await page.goto(`/v/${VAULT}`);
    await ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name: /Rooms/ }).click();
    const card = page.getByRole("region", { name: /asking for access/ });
    await expect(card).toContainText(`Sign in to ${new URL(RELAY!.replace(/^ws/, "http")).host} on this device as you`);
    await expect(card).toContainText("Keep private notes there (read-state:…), sealed to your key: other apps of yours may share them");
    await page.getByRole("button", { name: "Allow" }).click();
    const app = frame(page);
    await expect(app.getByRole("heading", { name: "Rooms" })).toBeVisible();
    const list = app.getByRole("list", { name: "Your rooms" });
    await expect(list.getByRole("button", { name: new RegExp(`Garden ${stamp}`) })).toBeVisible({ timeout: 30_000 });
    await expect(list.getByRole("button", { name: new RegExp(`Kitchen ${stamp}`) })).toBeVisible();
    await expect(list.getByRole("button", { name: new RegExp(`Garden ${stamp}`) })).toContainText(/wants? you/);
    await expect(list.getByRole("button", { name: new RegExp(`Garden ${stamp}`) })).toContainText("Voice note");

    // the room: markdown, the ask, the prompt, the picture, the voice note
    await list.getByRole("button", { name: new RegExp(`Garden ${stamp}`) }).click();
    const log = app.getByRole("log");
    await expect(log.locator("strong", { hasText: "beans" })).toBeVisible({ timeout: 20_000 });
    await expect(log.getByRole("group", { name: new RegExp(`Wants you: Where should the garlic go ${stamp}`) })).toBeVisible();
    await expect(log.getByRole("group", { name: "Hermes asks to run a command" })).toContainText("rm -rf ./build");
    await expect(log.getByRole("img", { name: "seedlings.png" })).toBeVisible({ timeout: 20_000 });
    expect(await log.getByRole("img", { name: "seedlings.png" }).evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(48);
    const audio = log.getByLabel("Voice note voice.webm");
    await expect(audio).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => audio.evaluate((a: HTMLAudioElement) => a.duration), { timeout: 15_000 }).toBeGreaterThan(1);

    // she picks an answer, approves the command once, reacts, and writes back naming bob
    await log.getByRole("button", { name: "North bed" }).click();
    await expect(log.getByRole("group", { name: "Ended ask" })).toContainText("You picked North bed");
    await log.getByRole("button", { name: "Approve once" }).click();
    await expect(log.getByRole("group", { name: "Hermes asks to run a command" })).toContainText("You said /approve");
    const beans = log.locator("article", { hasText: `are up ${stamp}` });
    await beans.getByRole("button", { name: "React 👍" }).click();
    await expect(beans.getByRole("button", { name: "👍 1, including yours" })).toBeVisible();
    const field = app.getByLabel(`Message Garden ${stamp}`);
    await field.fill("Thanks @");
    const bobName = "Bob";
    await app.getByRole("listbox", { name: "People in this room" }).getByRole("button", { name: bobName }).click();
    await field.pressSequentially(`see you at noon ${stamp}`);
    await app.getByRole("button", { name: "Send message" }).click(); // on a phone Enter is a new line
    await expect(log.locator("article.mine", { hasText: `see you at noon ${stamp}` })).toBeVisible();

    // a reply in a thread
    await beans.getByRole("button", { name: "Reply" }).click();
    await expect(app.getByRole("heading", { name: "Thread" })).toBeVisible();
    await app.getByLabel(`Message Garden ${stamp}`).fill(`In the thread ${stamp}`);
    await app.getByRole("button", { name: "Send message" }).click();
    await expect(app.getByRole("log").locator("article.mine", { hasText: `In the thread ${stamp}` })).toBeVisible();
    await app.getByRole("button", { name: `← Garden ${stamp}` }).click();
    await expect(log.locator("article", { hasText: `are up ${stamp}` }).getByRole("button", { name: "1 reply" })).toBeVisible();

    // a picture of her own, through the shell's upload
    await app.locator("input[type=file]").setInputFiles({ name: "beds.png", mimeType: "image/png", buffer: png });
    await field.fill(`the beds ${stamp}`);
    await app.getByRole("button", { name: "Send message" }).click(); // on a phone Enter is a new line
    await expect(log.locator("article.mine", { hasText: `the beds ${stamp}` }).getByRole("img", { name: "beds.png" })).toBeVisible({ timeout: 20_000 });

    const bedsEv = (await bob.query({ kinds: [9], "#h": [g], authors: [alice], limit: 50 })).find((e) => e.content.includes(`the beds ${stamp}`));
    expect(bedsEv?.tags.some((t) => t[0] === "imeta")).toBe(true);
    // she edits her picture's line, then deletes it: bob sees both
    const beds = log.locator("article.mine", { hasText: `the beds ${stamp}` });
    await beds.getByRole("button", { name: "Edit" }).click();
    await app.getByLabel("Edit your message").fill(`the raised beds ${stamp}`);
    await app.getByRole("button", { name: "Save" }).click();
    const raised = log.locator("article.mine", { hasText: `the raised beds ${stamp}` });
    await expect(raised).toContainText("(edited)");
    await raised.getByRole("button", { name: "Delete" }).click();
    await raised.getByRole("button", { name: "Tap again to delete" }).click();
    await expect(log.locator("article", { hasText: `the raised beds ${stamp}` })).toHaveCount(0);

    // what bob sees, on the relay: each signed by alice, shaped as the Uni app shapes it
    const seen = [...await bob.query({ kinds: [9], "#h": [g], authors: [alice], limit: 50 }), ...await bob.query({ kinds: [7], authors: [alice], limit: 20 })];
    const answer = seen.find((e) => e.tags.some((t) => t[0] === "q" && t[1] === ask.ev.id));
    expect(answer?.content).toContain("Picked: North bed");
    expect(answer?.content).toContain('"pick":"north"');
    expect(seen.find((e) => e.content === "/approve")).toBeTruthy();
    const thanks = seen.find((e) => e.content.includes(`see you at noon ${stamp}`));
    expect(thanks?.tags).toContainEqual(["p", bob.pubkey]);
    expect(seen.find((e) => e.content.includes(`In the thread ${stamp}`))?.tags.some((t) => t[0] === "e" && t[3] === "root")).toBe(true);
    expect(seen.some((e) => e.kind === 7 && e.content === "👍")).toBe(true);
    const later = await bob.query({ kinds: [40003, 5], authors: [alice], "#e": [bedsEv!.id] });
    expect(later.find((e) => e.kind === 40003)?.content).toBe(`the raised beds ${stamp}`);
    expect(later.some((e) => e.kind === 5)).toBe(true);

    // unread: back on the list, bob writes naming her; the row says so
    await app.getByRole("button", { name: "← Rooms" }).click();
    await new Promise((r) => setTimeout(r, 1100)); // read markers are whole seconds: a message in the same second counts as read
    await bob.publish({ kind: 9, content: `Can you water today? ${stamp}`, tags: [["h", g], ["p", alice]] });
    await expect(list.getByRole("button", { name: new RegExp(`Garden ${stamp}`) }).getByLabel("1 new, mentions you")).toBeVisible({ timeout: 20_000 });
    // her read marker is on the relay, sealed: the Uni app's read state
    const marks = await bob.query({ kinds: [30078], authors: [alice], "#t": ["read-state"] });
    expect(marks.length).toBeGreaterThan(0);
    expect(marks[0].content).not.toContain(g);
  } finally {
    bob.close();
    await api(hubState(), "DELETE", `notes/${note.id}`);
  }
});
