// Rooms (applets/rooms.tsx) against our real Buzz relay, two people: alice in the app, bob on his own connection.
// Run by the Services workflow, not CI's web job (e2e/services/README.md): it runs when BUZZ_RELAY names a relay run with production's auth settings, and
// BUZZ_KEYS a folder with owner.hex (the relay's owner), alice.hex and bob.hex. Each run makes its own two rooms.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { expect, test, type Page } from "@playwright/test";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { api, hubState, record, VAULT } from "./hub";
import { withImports } from "../applets/record.ts";
import { installApplet, ui } from "./helpers";
import { person } from "./services/client";

const RELAY = process.env.BUZZ_RELAY;
const KEYS = process.env.BUZZ_KEYS ?? "";
test.skip(!RELAY || !KEYS, "needs our Buzz relay (BUZZ_RELAY, BUZZ_KEYS): e2e/services/README.md");
test.use({ storageState: "e2e/.signed-in.json" });

/** A small picture of its own colour (a PNG with nothing else in it), so each is a file of its own. */
function swatch(n: number): Buffer {
  const crc = (b: Buffer) => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (type: string, data: Buffer) => { const t = Buffer.from(type), len = Buffer.alloc(4), sum = Buffer.alloc(4); len.writeUInt32BE(data.length); sum.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, sum]); };
  const w = 16, ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(w, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => [n * 20 % 256, 120, 255 - n * 20 % 256]).flat())]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(Array(w).fill(row)))), chunk("IEND", Buffer.alloc(0))]);
}
const secret = (n: string) => readFileSync(join(KEYS, `${n}.hex`), "utf8").trim();
const frame = (page: Page) => page.frameLocator("iframe.applet-frame");

test("rooms on a real relay: two people talk, with cards, mentions, a reply, a picture and a voice note (no reaction buttons)", async ({ page }) => {
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
  const made = await installApplet("rooms", { relay: RELAY!, uni: bob.pubkey });
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
    await page.goto(`/v/${VAULT}?with=vault`);
    await ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name: /Rooms/ }).click();
    const card = page.getByRole("region", { name: /asking for access/ });
    await expect(card).toContainText(`With your everyday key: sign in to ${new URL(RELAY!.replace(/^ws/, "http")).host} on this device as you`);
    await expect(card).toContainText("Keep private notes there (read-state:…), sealed to your key: other apps of yours may share them");
    await page.getByRole("button", { name: "Allow" }).click();
    const app = frame(page);
    await expect(app.getByRole("heading", { name: "Rooms", exact: true })).toBeVisible();
    const list = app.getByRole("region", { name: "Your rooms" });
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

    // she picks an answer, approves the command once, and writes back naming bob
    await log.getByRole("button", { name: "North bed" }).click();
    await expect(log.getByRole("group", { name: "Ended ask" })).toContainText("You picked North bed");
    await log.getByRole("button", { name: "Approve once" }).click();
    await expect(log.getByRole("group", { name: "Hermes asks to run a command" })).toContainText("You said /approve");
    const beans = log.locator("article", { hasText: `are up ${stamp}` });
    // no reaction buttons (Aaron doesn't use them), and none drawn: a reaction bob made shows nothing
    await expect(log.getByRole("button", { name: /^React / })).toHaveCount(0);
    expect((await bob.publish({ kind: 7, content: "👍", tags: [["e", ask.ev.id], ["p", alice], ["h", g]] })).ok).toBe(true);
    // the relay sends in order: once bob's next line is here, so is his reaction
    expect((await bob.publish({ kind: 9, content: `After the reaction ${stamp}`, tags: [["h", g]] })).ok).toBe(true);
    await expect(log).toContainText(`After the reaction ${stamp}`, { timeout: 15_000 });
    await expect(log.getByRole("button", { name: /👍/ })).toHaveCount(0);
    const field = app.getByLabel(`Message Garden ${stamp}`);
    await field.fill("Thanks @");
    const bobName = "Bob";
    await app.getByRole("listbox", { name: "People in this room" }).getByRole("button", { name: bobName }).click();
    await field.pressSequentially(`see you at noon ${stamp}`);
    await app.getByRole("button", { name: "Send message" }).click(); // on a phone Enter is a new line
    await expect(log.locator("article.mine", { hasText: `see you at noon ${stamp}` })).toBeVisible({ timeout: 15_000 });

    // a reply in a thread
    await beans.getByRole("button", { name: "Reply" }).click();
    await expect(app.getByRole("heading", { name: "Thread" })).toBeVisible();
    await app.getByLabel(`Message Garden ${stamp}`).fill(`In the thread ${stamp}`);
    await app.getByRole("button", { name: "Send message" }).click();
    await expect(app.getByRole("log").locator("article.mine", { hasText: `In the thread ${stamp}` })).toBeVisible({ timeout: 15_000 });
    await app.getByRole("button", { name: `← Garden ${stamp}` }).click();
    await expect(log.locator("article", { hasText: `are up ${stamp}` }).getByRole("button", { name: "1 reply" })).toBeVisible();

    // a picture of her own, picked on the shell's own picker and sent through the shell's upload
    await app.getByRole("button", { name: "Choose files to attach" }).click();
    await page.getByRole("dialog", { name: "Rooms asks for files" }).locator("input[type=file]").setInputFiles({ name: "beds.png", mimeType: "image/png", buffer: png });
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
    const seen = [...await bob.query({ kinds: [9], "#h": [g], authors: [alice], limit: 50 }), ...await bob.query({ kinds: [7], authors: [alice], "#h": [g], limit: 20 })];
    const answer = seen.find((e) => e.tags.some((t) => t[0] === "q" && t[1] === ask.ev.id));
    expect(answer?.content).toContain("Picked: North bed");
    expect(answer?.content).toContain('"pick":"north"');
    expect(seen.find((e) => e.content === "/approve")).toBeTruthy();
    const thanks = seen.find((e) => e.content.includes(`see you at noon ${stamp}`));
    expect(thanks?.tags).toContainEqual(["p", bob.pubkey]);
    expect(seen.find((e) => e.content.includes(`In the thread ${stamp}`))?.tags.some((t) => t[0] === "e" && t[3] === "root")).toBe(true);
    expect(seen.some((e) => e.kind === 7)).toBe(false); // she sent no reaction
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
    await made.remove();
  }
});

test("Uni's turn in a room: a quick reply, working and Stop, muted, a draft with its mention, a launch at a message, and search", async ({ page }) => {
  test.setTimeout(180_000);
  const alice = getPublicKey(Uint8Array.from(Buffer.from(secret("alice"), "hex")));
  const bob = await person(RELAY!, secret("bob")); // Uni, here: the key the grant names
  const stamp = Date.now().toString(36);
  const owner = await person(RELAY!, secret("owner"));
  const rooms = { Beds: crypto.randomUUID(), Shed: crypto.randomUUID() };
  for (const p of [alice, bob.pubkey]) await owner.publish({ kind: 9030, tags: [["p", p]] });
  for (const [name, id] of Object.entries(rooms)) {
    expect((await owner.publish({ kind: 9007, tags: [["h", id], ["name", `${name} ${stamp}`], ["visibility", "private"], ["channel_type", "stream"]] })).ok).toBe(true);
    for (const p of [alice, bob.pubkey]) expect((await owner.publish({ kind: 9000, tags: [["h", id], ["p", p]] })).ok).toBe(true);
  }
  owner.close();
  await bob.publish({ kind: 0, content: JSON.stringify({ name: "Bob", display_name: "Bob" }) });
  const b = rooms.Beds;
  expect((await bob.publish({ kind: 9, content: `The beds are dug ${stamp}. Shall I order more seed potatoes?`, tags: [["h", b], ["p", alice]] })).ok).toBe(true);
  await page.addInitScript((k) => { if (window === window.top) (window as unknown as { __parachuteE2EKey: string }).__parachuteE2EKey = k; }, secret("alice"));
  const made = await installApplet("rooms", { relay: RELAY!, uni: bob.pubkey });
  const mine = async (text: string) => (await bob.query({ kinds: [9], "#h": [b], authors: [alice], limit: 30 })).filter((e) => e.content === text || e.content.includes(text));
  try {
    await page.goto(`/v/${VAULT}?with=vault`);
    await ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name: /Rooms/ }).click();
    await expect(page.getByRole("region", { name: /asking for access/ })).toContainText("Tell you about messages in your rooms there that name you, and every message from");
    await page.getByRole("button", { name: "Allow" }).click();
    const app = frame(page);
    const appUrl = page.url();
    const list = app.getByRole("region", { name: "Your rooms" });
    await list.getByRole("button", { name: new RegExp(`Beds ${stamp}`) }).click({ timeout: 30_000 });
    const log = app.getByRole("log");

    // a yes-or-no question from Uni: Yes · No · Not now under it; Yes goes to Uni (listening)
    const quick = app.getByRole("group", { name: "Quick replies" });
    await expect(quick.getByRole("button")).toHaveText(["Yes", "No", "Not now"], { timeout: 20_000 });
    await quick.getByRole("button", { name: "Yes" }).click();
    await expect(quick).toHaveCount(0);
    await expect.poll(async () => (await mine("Yes")).length, { timeout: 15_000 }).toBe(1);
    const yes = (await mine("Yes"))[0];
    expect(yes.content).toBe("Yes");
    expect(yes.tags).toContainEqual(["p", bob.pubkey]);

    // Uni takes it (its 👀) and works: one quiet status line, its ping one quiet line, and Stop
    expect((await bob.publish({ kind: 7, content: "👀", tags: [["e", yes.id], ["p", alice], ["h", b]] })).ok).toBe(true);
    const turn = app.getByRole("status", { name: "Uni is working" });
    await expect(turn).toBeVisible({ timeout: 15_000 });
    // the ping in a later second than her Yes: in the same second the room may order the Yes after it (whole seconds,
    // then id), and the turn's line reads only the newest message (a real Uni pings minutes in)
    await new Promise((r) => setTimeout(r, Math.max(0, (yes.created_at + 1) * 1000 - Date.now()) + 50));
    expect((await bob.publish({ kind: 9, content: "⏳ Working — 3 min — iteration 4/90, terminal", tags: [["h", b]] })).ok).toBe(true);
    await expect(turn).toContainText("Running a command", { timeout: 15_000 });
    await expect(log.locator("p.ping", { hasText: "Working — 3 min" })).toHaveCount(0); // said once, on the turn's line
    await turn.getByRole("button", { name: "Stop Uni" }).click();
    await expect(turn).toHaveCount(0, { timeout: 15_000 });
    // stopped, the ping stays as one quiet line, never a message
    await expect(log.locator("p.ping", { hasText: "Working — 3 min" })).toBeVisible();
    await expect(log.locator("article", { hasText: "Working — 3 min" })).toHaveCount(0);
    await expect(log.getByText("You stopped Uni")).toBeVisible();
    await expect.poll(async () => (await mine("/stop")).length, { timeout: 15_000 }).toBe(1);
    expect((await mine("/stop"))[0].tags).toContainEqual(["p", bob.pubkey]);

    // Uni hearing the room is the usual, so nothing says so (Aaron, 11-22: "Uni listening feels irrelevant to show")
    await expect(app.getByText("Uni listening")).toHaveCount(0);
    await expect(app.getByRole("button", { name: /Mute Uni/ })).toHaveCount(0);
    // a room muted before (an older build's switch, kept in the applet's storage on this device) says so, and stays muted
    const kept = await page.evaluate(([prefix, key]) => {
      const names = Object.keys(localStorage).filter((k) => k.startsWith(prefix));
      for (const k of names) localStorage.setItem(k, JSON.stringify({ ...JSON.parse(localStorage.getItem(k) ?? "{}"), [key]: false }));
      return names.length;
    }, ["parachute.applet-storage.v1:" /* src/shell/saved.ts SAVED_PREFIX */, `u:${b}`] as const);
    expect(kept).toBeGreaterThan(0);
    // (the app holds the store while it runs: it reads the device's copy when it starts again)
    await page.goto(appUrl);
    await page.getByRole("button", { name: "Open Rooms" }).click();
    await list.getByRole("button", { name: new RegExp(`Beds ${stamp}`) }).click({ timeout: 30_000 });
    await expect(app.getByRole("button", { name: "Uni is muted here. Let Uni listen again" })).toBeVisible();
    // muted: what she sends here doesn't name Uni
    const field = app.getByLabel(`Message Beds ${stamp}`);
    await field.fill(`Just noting ${stamp}`);
    await app.getByRole("button", { name: "Send message" }).click();
    await expect.poll(async () => (await mine(`Just noting ${stamp}`)).length, { timeout: 15_000 }).toBe(1);
    expect((await mine(`Just noting ${stamp}`))[0].tags.filter((t) => t[0] === "p" && t[1] === bob.pubkey)).toEqual([]);

    // a draft, with the person it names, kept per room: away to another room and back, it is there, and sends to Bob
    await field.fill("Thanks @");
    await app.getByRole("listbox", { name: "People in this room" }).getByRole("button", { name: "Bob" }).click();
    await field.pressSequentially(`for the beds ${stamp}`);
    await page.waitForTimeout(900); // kept half a second after the last key
    await app.getByRole("button", { name: "← Rooms" }).click();
    await list.getByRole("button", { name: new RegExp(`Shed ${stamp}`) }).click();
    await app.getByLabel(`Message Shed ${stamp}`).fill(`a shed draft ${stamp}`);
    await page.waitForTimeout(900);
    await app.getByRole("button", { name: "← Rooms" }).click();
    await list.getByRole("button", { name: new RegExp(`Beds ${stamp}`) }).click();
    await expect(field).toHaveValue(`Thanks @Bob for the beds ${stamp}`);
    await expect(app.getByRole("button", { name: "Uni is muted here. Let Uni listen again" })).toBeVisible(); // muted stays, per room
    await app.getByRole("button", { name: "Send message" }).click();
    await expect.poll(async () => (await mine(`for the beds ${stamp}`)).length, { timeout: 15_000 }).toBe(1);
    expect((await mine(`for the beds ${stamp}`))[0].tags).toContainEqual(["p", bob.pubkey]); // the mention came back with the text
    await expect(field).toHaveValue("");
    // one tap and Uni hears the room again: "Uni muted" goes, nothing takes its place, and what she sends names Uni
    await app.getByRole("button", { name: "Uni is muted here. Let Uni listen again" }).click();
    await expect(app.getByText("Uni muted")).toHaveCount(0);
    await field.fill(`Over to you ${stamp}`);
    await app.getByRole("button", { name: "Send message" }).click();
    await expect.poll(async () => (await mine(`Over to you ${stamp}`)).length, { timeout: 15_000 }).toBe(1);
    expect((await mine(`Over to you ${stamp}`))[0].tags).toContainEqual(["p", bob.pubkey]);
    await app.getByRole("button", { name: "← Rooms" }).click();
    await list.getByRole("button", { name: new RegExp(`Shed ${stamp}`) }).click();
    await expect(app.getByLabel(`Message Shed ${stamp}`)).toHaveValue(`a shed draft ${stamp}`);
    await app.getByRole("button", { name: "← Rooms" }).click();

    // search across rooms (the relay's NIP-50): a hit opens its room at that message
    await app.getByLabel("Search your rooms").fill("seed potatoes");
    await app.getByLabel("Search your rooms").press("Enter");
    const found = app.getByRole("region", { name: "Found" });
    await expect(found.getByRole("button", { name: new RegExp(`Beds ${stamp}`) })).toBeVisible({ timeout: 15_000 });
    await found.getByRole("button", { name: new RegExp(`Beds ${stamp}`) }).first().click();
    await expect(log.locator("article.at")).toContainText(`The beds are dug ${stamp}`, { timeout: 15_000 });
    // back from a hit, the finds are still there (they take the list's place); Back to your rooms gives the list again
    await app.getByRole("button", { name: "← Rooms" }).click();
    await expect(found.getByRole("button", { name: new RegExp(`Beds ${stamp}`) }).first()).toBeVisible();
    await expect(app.getByLabel("Search your rooms")).toHaveValue("seed potatoes");
    await expect(app.getByRole("region", { name: "Your rooms" })).toHaveCount(0);
    await app.getByRole("button", { name: "Back to your rooms" }).click();
    await expect(found).toHaveCount(0);
    await expect(list.getByRole("button", { name: new RegExp(`Shed ${stamp}`) })).toBeVisible();

    // a notification's tap: the app opens the applet at that room and message
    const roof = await bob.publish({ kind: 9, content: `Look at the shed roof ${stamp}`, tags: [["h", rooms.Shed], ["p", alice]] });
    expect(roof.ok).toBe(true);
    // (a link into the app starts nothing by itself: the applet waits, stopped, for the person's tap)
    await page.goto(`${appUrl}?room=${rooms.Shed}&event=${roof.ev.id}`);
    await page.getByRole("button", { name: "Open Rooms" }).click();
    const at = frame(page).locator(`article[data-id="${roof.ev.id}"]`);
    await expect(at).toHaveClass(/\bat\b/, { timeout: 30_000 });
    await expect(at).toBeInViewport();
    await expect(frame(page).getByRole("heading", { name: `Shed ${stamp}` })).toBeVisible();
  } finally {
    bob.close();
    await made.remove();
  }
});

test("Rooms paints the list it last showed at once, keeps it while the relay is away, then reads it again", async ({ page }) => {
  test.setTimeout(150_000);
  const alice = getPublicKey(Uint8Array.from(Buffer.from(secret("alice"), "hex")));
  const bob = await person(RELAY!, secret("bob"));
  const stamp = Date.now().toString(36);
  const owner = await person(RELAY!, secret("owner"));
  const rooms = { Porch: crypto.randomUUID(), Shed: crypto.randomUUID() };
  for (const p of [alice, bob.pubkey]) await owner.publish({ kind: 9030, tags: [["p", p]] });
  for (const [name, id] of Object.entries(rooms)) {
    expect((await owner.publish({ kind: 9007, tags: [["h", id], ["name", `${name} ${stamp}`], ["visibility", "private"], ["channel_type", "stream"]] })).ok).toBe(true);
    for (const p of [alice, bob.pubkey]) expect((await owner.publish({ kind: 9000, tags: [["h", id], ["p", p]] })).ok).toBe(true);
  }
  await bob.publish({ kind: 0, content: JSON.stringify({ name: "Bob", display_name: "Bob" }) });
  expect((await bob.publish({ kind: 9, content: `The shed door sticks ${stamp}.`, tags: [["h", rooms.Shed]] })).ok).toBe(true);
  await new Promise((r) => setTimeout(r, 1100)); // the porch's line is the newer, by a second
  expect((await bob.publish({ kind: 9, content: `The gate is painted ${stamp}.`, tags: [["h", rooms.Porch]] })).ok).toBe(true);
  await new Promise((r) => setTimeout(r, 1100));
  const light = await bob.publish({ kind: 9, content: `The porch light is fixed ${stamp}.`, tags: [["h", rooms.Porch]] });
  expect(light.ok).toBe(true);
  await page.addInitScript((k) => { if (window === window.top) (window as unknown as { __parachuteE2EKey: string }).__parachuteE2EKey = k; }, secret("alice"));
  // while `away`, every connection to the relay closes at once, so nothing the list shows can come from it
  let away = false;
  await page.routeWebSocket((url) => url.href.startsWith(RELAY!), (ws) => { if (away) ws.close(); else ws.connectToServer(); });
  const made = await installApplet("rooms", { relay: RELAY!, uni: bob.pubkey });
  const open = async () => {
    await page.goto(`/v/${VAULT}?with=vault`);
    await ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name: /Rooms/ }).click();
  };
  const row = (name: string) => frame(page).getByRole("region", { name: "Your rooms" }).getByRole("button", { name: new RegExp(`${name} ${stamp}`) });
  // what the list keeps on this device, as the shell stores it
  const kept = () => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("parachute.applet-storage.v1:")).map((k) => localStorage.getItem(k) ?? "").join("\n"));
  try {
    await open();
    await page.getByRole("button", { name: "Allow" }).click();
    await expect(row("Porch")).toContainText(`Bob: The porch light is fixed ${stamp}.`, { timeout: 30_000 });
    await expect(row("Shed")).toContainText(`Bob: The shed door sticks ${stamp}.`);
    await expect.poll(kept, { timeout: 10_000 }).toContain(`The porch light is fixed ${stamp}.`);

    // the relay away: the list paints from what it kept, and is still there (and still kept) well past the relay's
    // 15 s query timeout, when its reads come back empty
    away = true;
    await open();
    await expect(row("Porch")).toContainText(`Bob: The porch light is fixed ${stamp}.`, { timeout: 5_000 });
    await expect(frame(page).getByRole("alert")).toContainText("The relay is away");
    await page.waitForTimeout(18_000);
    await expect(row("Porch")).toContainText(`Bob: The porch light is fixed ${stamp}.`);
    await expect(row("Shed")).toBeVisible();
    expect(await kept()).toContain(`The porch light is fixed ${stamp}.`);

    // meanwhile alice leaves the shed and bob takes his porch message back; with the relay back, what it says takes the
    // snapshot's place: the shed goes, and the porch's line is the one before
    expect((await owner.publish({ kind: 9001, tags: [["h", rooms.Shed], ["p", alice]] })).ok).toBe(true);
    expect((await bob.publish({ kind: 5, tags: [["e", light.ev.id], ["h", rooms.Porch]] })).ok).toBe(true);
    away = false;
    await open();
    await expect(row("Porch")).toContainText(`Bob: The gate is painted ${stamp}.`, { timeout: 30_000 });
    await expect(row("Shed")).toHaveCount(0);
    await expect.poll(kept, { timeout: 10_000 }).not.toContain(`The porch light is fixed ${stamp}.`);
  } finally {
    await made.remove();
    owner.close();
    bob.close();
  }
});

test("a room opens at once from what the list holds, at its newest once its own read lands, and where you left it next time", async ({ page }) => {
  test.setTimeout(180_000);
  const alice = getPublicKey(Uint8Array.from(Buffer.from(secret("alice"), "hex")));
  const bob = await person(RELAY!, secret("bob"));
  const stamp = Date.now().toString(36);
  const owner = await person(RELAY!, secret("owner"));
  const yard = crypto.randomUUID();
  for (const p of [alice, bob.pubkey]) await owner.publish({ kind: 9030, tags: [["p", p]] });
  expect((await owner.publish({ kind: 9007, tags: [["h", yard], ["name", `Yard ${stamp}`], ["visibility", "private"], ["channel_type", "stream"]] })).ok).toBe(true);
  for (const p of [alice, bob.pubkey]) expect((await owner.publish({ kind: 9000, tags: [["h", yard], ["p", p]] })).ok).toBe(true);
  owner.close();
  await bob.publish({ kind: 0, content: JSON.stringify({ name: "Bob", display_name: "Bob" }) });
  // more lines than the list reads for a room (40), so the room's own read brings older ones above what was drawn
  const N = 56;
  for (let i = 1; i <= N; i++) {
    expect((await bob.publish({ kind: 9, content: `Yard note ${i} ${stamp}: ${"the fence by the compost needs another post. ".repeat(2)}`, tags: [["h", yard]] })).ok).toBe(true);
    // paced under the relay's rate, and the last one a second after the rest (the newest by its time)
    if (i % 8 === 0 || i === N - 1) await new Promise((r) => setTimeout(r, 1200));
  }
  await page.addInitScript((k) => { if (window === window.top) (window as unknown as { __parachuteE2EKey: string }).__parachuteE2EKey = k; }, secret("alice"));
  // while `slow`, the room's own read (its 150 newest) reaches the relay 4 s late; everything else as it comes
  let slow = false;
  await page.routeWebSocket((url) => url.href.startsWith(RELAY!), (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((m) => { const t = String(m); if (slow && t.startsWith('["REQ"') && t.includes('"limit":150')) setTimeout(() => server.send(m), 4000); else server.send(m); });
  });
  const made = await installApplet("rooms", { relay: RELAY!, uni: bob.pubkey });
  const app = frame(page);
  const row = () => app.getByRole("region", { name: "Your rooms" }).getByRole("button", { name: new RegExp(`Yard ${stamp}`) });
  // the room's talk scrolls (docs/LOOK.md): how far its newest line is from the foot of what shows
  const where = () => app.locator(".room .scroll").evaluate((sc) => {
    const last = [...sc.querySelectorAll(".msg")].pop()!.getBoundingClientRect(), box = sc.getBoundingClientRect();
    return { newestShown: last.bottom <= box.bottom + 1 && last.top >= box.top - 1, fromFoot: Math.round(sc.scrollHeight - sc.scrollTop - sc.clientHeight), tall: sc.scrollHeight > sc.clientHeight * 2 };
  });
  const back = () => app.getByRole("button", { name: "← Rooms" }).click();
  try {
    await page.goto(`/v/${VAULT}?with=vault`);
    await ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name: /Rooms/ }).click();
    await page.getByRole("button", { name: "Allow" }).click();
    await expect(row()).toContainText(`Yard note ${N} ${stamp}`, { timeout: 30_000 });

    // the room's read held back: it draws at once from what the list holds; as a browser without scroll anchoring
    // (WebKit) would, it is at its foot again once the read lands with older lines above
    slow = true;
    await row().click();
    await expect(app.getByRole("log")).toContainText(`Yard note ${N} ${stamp}`, { timeout: 1_500 });
    await expect(app.getByRole("log")).toContainText(`Yard note 3 ${stamp}`, { timeout: 15_000 }); // the read landed
    // older lines landed above: the talk is at its foot, the newest line in view
    await expect.poll(async () => { const w = await where(); return w.tall && w.newestShown; }, { timeout: 3_000 }).toBe(true);
    slow = false;

    // scrolled up to read, then to the list and in again: the room is where you left it
    await app.locator(".room .scroll").evaluate((sc) => { sc.scrollTop = sc.scrollTop - 1500; });
    await expect.poll(async () => (await where()).newestShown).toBe(false);
    const left = (await where()).fromFoot;
    await back();
    await row().click();
    await expect(app.getByRole("log")).toContainText(`Yard note 3 ${stamp}`, { timeout: 15_000 });
    await expect.poll(async () => Math.abs((await where()).fromFoot - left), { timeout: 5_000 }).toBeLessThan(80);
    // and what you send takes you to the newest, as in any chat
    await app.getByLabel(`Message Yard ${stamp}`).fill(`Back at the yard ${stamp}`);
    await app.getByRole("button", { name: "Send message" }).click();
    await expect(app.getByRole("log").locator("article.mine", { hasText: `Back at the yard ${stamp}` })).toBeVisible({ timeout: 15_000 });
    await expect.poll(async () => (await where()).newestShown, { timeout: 5_000 }).toBe(true);
  } finally {
    await made.remove();
    bob.close();
  }
});

test("in twenty-six rooms, a room full of asks and pictures opens and reads: nothing is refused for being too busy", async ({ page }) => {
  test.setTimeout(360_000);
  // her own key for this test: exactly these rooms, however many earlier runs left on the relay
  const hers = Buffer.from(generateSecretKey()).toString("hex");
  const alice = getPublicKey(Uint8Array.from(Buffer.from(hers, "hex")));
  const bob = await person(RELAY!, secret("bob"));
  const stamp = Date.now().toString(36);
  const owner = await person(RELAY!, secret("owner"));
  // under the relay's ten a second, and its sixty a minute for one key (a refusal names its wait)
  const send = async (who: typeof bob, ev: { kind: number; content?: string; tags: string[][] }) => {
    for (;;) {
      await new Promise((r) => setTimeout(r, 120));
      const r = await who.publish(ev);
      const wait = /retry in (\d+)s/.exec(r.msg)?.[1];
      if (r.ok || !wait) return r;
      await new Promise((res) => setTimeout(res, Number(wait) * 1000 + 500));
    }
  };
  for (const p of [alice, bob.pubkey]) await owner.publish({ kind: 9030, tags: [["p", p]] });
  // twenty-five quiet rooms, and one that wants a lot of her
  const rooms = [...Array.from({ length: 25 }, (_, i) => ({ id: crypto.randomUUID(), name: `Plot ${i + 1} ${stamp}` })), { id: crypto.randomUUID(), name: `Asks ${stamp}` }];
  for (const r of rooms) {
    expect((await send(owner, { kind: 9007, tags: [["h", r.id], ["name", r.name], ["about", "a plot in the garden"], ["visibility", "private"], ["channel_type", "stream"]] })).ok).toBe(true);
    expect((await send(owner, { kind: 9000, tags: [["h", r.id], ["p", alice], ["p", bob.pubkey]] })).ok).toBe(true);
  }
  owner.close();
  // each ask is a card the shell checks, each picture a file it fetches: all asked for the moment the room is drawn
  const asks = rooms[25].id, until = Math.floor(Date.now() / 1000) + 3600;
  for (let i = 1; i <= 12; i++) {
    const pic = await bob.upload(swatch(i), "image/png");
    expect((await send(bob, { kind: 9, content: `Ask ${i}\n\n\`\`\`uni-ask\n${JSON.stringify({ v: 1, kind: "choose", what: `Which bed for row ${i}?`, why: "Planting week.", until, options: [{ id: "north", label: "North bed" }, { id: "south", label: "South bed" }] })}\n\`\`\``, tags: [["h", asks], ["p", alice]] })).ok).toBe(true);
    expect((await send(bob, { kind: 9, content: `Row ${i}: ![image](${pic.url})`, tags: [["h", asks], ["imeta", `url ${pic.url}`, "m image/png", `x ${pic.sha256}`, `size ${pic.size}`, `filename row-${i}.png`, `alt row ${i}`]] })).ok).toBe(true);
  }
  await new Promise((r) => setTimeout(r, 1100));
  expect((await send(bob, { kind: 9, content: `The newest line ${stamp}`, tags: [["h", asks]] })).ok).toBe(true);
  await page.addInitScript((k) => { if (window === window.top) (window as unknown as { __parachuteE2EKey: string }).__parachuteE2EKey = k; }, hers);
  // a phone's distance from the relay: each read and each file a moment late, so the calls overlap as they do there
  await page.routeWebSocket((url) => url.href.startsWith(RELAY!), (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((m) => { if (String(m).startsWith('["REQ"')) setTimeout(() => server.send(m), 800); else server.send(m); });
  });
  await page.route((url) => url.href.startsWith(RELAY!.replace(/^ws/, "http") + "/media/"), async (route) => { await new Promise((r) => setTimeout(r, 800)); await route.continue(); });
  const made = await installApplet("rooms", { relay: RELAY!, uni: bob.pubkey });
  try {
    await page.goto(`/v/${VAULT}?with=vault`);
    await ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name: /Rooms/ }).click();
    await page.getByRole("button", { name: "Allow" }).click();
    const app = frame(page);
    const list = app.getByRole("region", { name: "Your rooms" });
    const row = list.getByRole("button", { name: new RegExp(`Asks ${stamp}`) });
    await expect(row).toContainText(`The newest line ${stamp}`, { timeout: 60_000 });
    await expect(list.getByRole("button", { name: new RegExp(`Plot 25 ${stamp}`) })).toBeVisible();
    await expect(app.getByRole("alert")).toHaveCount(0); // no "Couldn't read your rooms"
    // in at once, drawn from what the list holds: every card and picture asks the shell at the same moment as the room's read
    await row.click();
    const log = app.getByRole("log");
    await expect(log.getByRole("group", { name: /Wants you: Which bed for row 12/ })).toBeVisible({ timeout: 30_000 });
    await expect(log.getByRole("group", { name: /Wants you: Which bed for row 1\?/ })).toBeVisible();
    // what a phone showed: "Couldn't read the room: too_many_pending", and pictures "unavailable"
    await expect(log.locator("img")).toHaveCount(12, { timeout: 30_000 });
    await expect(log.getByText("Image unavailable")).toHaveCount(0);
    await expect(app.getByText(/Couldn't read the room/)).toHaveCount(0);
    // and the room is live: its own read and subscription went through
    await send(bob, { kind: 9, content: `After it opened ${stamp}`, tags: [["h", asks]] });
    await expect(log).toContainText(`After it opened ${stamp}`, { timeout: 15_000 });
    await expect(app.getByText(/Couldn't read the room|too_many_pending|rate_limited/)).toHaveCount(0);
  } finally {
    await made.remove();
    bob.close();
  }
});

test("room to room in one tap: the rooms are a row at the room's head; the new room is there at once and the old one fades over it, never blank; on a Mac the list stays beside", async ({ page }) => {
  test.setTimeout(120_000);
  const alice = getPublicKey(Uint8Array.from(Buffer.from(secret("alice"), "hex")));
  const bob = await person(RELAY!, secret("bob"));
  const stamp = Date.now().toString(36);
  const owner = await person(RELAY!, secret("owner"));
  const ids = [crypto.randomUUID(), crypto.randomUUID()], names = [`Beds ${stamp}`, `Bakery ${stamp}`];
  for (const p of [alice, bob.pubkey]) await owner.publish({ kind: 9030, tags: [["p", p]] });
  for (const [i, id] of ids.entries()) {
    expect((await owner.publish({ kind: 9007, tags: [["h", id], ["name", names[i]], ["visibility", "private"], ["channel_type", "stream"]] })).ok).toBe(true);
    for (const p of [alice, bob.pubkey]) expect((await owner.publish({ kind: 9000, tags: [["h", id], ["p", p]] })).ok).toBe(true);
    expect((await bob.publish({ kind: 9, content: `A line in ${names[i]}`, tags: [["h", id]] })).ok).toBe(true);
  }
  owner.close();
  await page.addInitScript((k) => { if (window === window.top) (window as unknown as { __parachuteE2EKey: string }).__parachuteE2EKey = k; }, secret("alice"));
  const made = await installApplet("rooms", { relay: RELAY!, uni: bob.pubkey });
  const app = frame(page);
  try {
    await page.goto(`/v/${VAULT}?with=vault`);
    await ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name: /Rooms/ }).click();
    await page.getByRole("button", { name: "Allow" }).click();
    await app.getByRole("region", { name: "Your rooms" }).getByRole("button", { name: new RegExp(names[0]) }).click();
    await expect(app.getByRole("log")).toContainText(`A line in ${names[0]}`);
    // the row: every room, the one you are in marked
    const row = app.getByRole("navigation", { name: "Your rooms" });
    await expect(row.locator('[aria-current="page"]')).toContainText(names[0]);
    // one tap: the new room drawn at once (its words in the first frames), the old one a copy fading over it
    const inner = (await (await page.locator('iframe[title="Rooms"]').elementHandle())!.contentFrame())!;
    await inner.evaluate(() => { (window as unknown as { __frames: string[] }).__frames = []; const f = () => { const w = window as unknown as { __frames: string[] }; const ghost = document.querySelector<HTMLElement>("body > .room[aria-hidden]"); w.__frames.push(`${document.querySelector("section.room:not([aria-hidden]) h2")?.textContent}|${ghost ? getComputedStyle(ghost).opacity : "-"}`); if (w.__frames.length < 30) requestAnimationFrame(f); }; requestAnimationFrame(f); });
    await row.getByRole("button", { name: new RegExp(names[1]) }).click();
    await expect(app.getByRole("log")).toContainText(`A line in ${names[1]}`);
    await page.waitForTimeout(400);
    const frames = await inner.evaluate(() => (window as unknown as { __frames: string[] }).__frames);
    const after = frames.filter((f) => f.startsWith(names[1]));
    expect(after.length).toBeGreaterThan(0);
    // the old room fades between 1 and 0 over the new one in the first frames after the tap, then is gone
    expect(after.some((f) => { const o = parseFloat(f.split("|")[1]); return o > 0 && o < 1; }), frames.join("\n")).toBe(true);
    await expect(inner.locator("body > .room[aria-hidden]")).toHaveCount(0);
    await expect(row.locator('[aria-current="page"]')).toContainText(names[1]);
    // a Mac: the list of rooms on the left page, the room beside it; a tap there swaps the room
    await page.setViewportSize({ width: 1440, height: 900 });
    const list = app.getByRole("region", { name: "Rooms", exact: true });
    await expect(list).toBeVisible();
    await list.getByRole("button", { name: new RegExp(names[0]) }).click();
    await expect(app.getByRole("log")).toContainText(`A line in ${names[0]}`);
    await expect(list).toBeVisible();
  } finally {
    await made.remove();
    bob.close();
  }
});

/** Rooms and its Room as an older vault keeps them (e2e/fixtures/older-rooms: before the pages), with today's records. */
async function installOlderRooms(vars: Record<string, string>) {
  const recs = withImports("rooms", vars).map((r) => ({ ...r, body: readFileSync(new URL(`./fixtures/older-rooms/${r.path === "Components/Room" ? "room" : "rooms"}.tsx`, import.meta.url), "utf8") }));
  const made: string[] = [];
  const remove = async () => { for (const id of made.splice(0).reverse()) await api(hubState(), "DELETE", `notes/${id}`).catch(() => {}); };
  try { for (const r of recs) made.push((await record(hubState(), "create", r)).id as string); } catch (e) { await remove(); throw e; }
  return { remove };
}

for (const [which, install] of [["today's Rooms", (v: Record<string, string>) => installApplet("rooms", v)], ["a Rooms from before the pages, as an older vault keeps it", installOlderRooms]] as const)
test.describe(`on a phone 390 wide, ${which}`, () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("a room opens on its newest messages with the box to write in on screen; a tap there and on Send reaches the other person", async ({ page }) => {
    test.setTimeout(120_000);
    const alice = getPublicKey(Uint8Array.from(Buffer.from(secret("alice"), "hex")));
    const bob = await person(RELAY!, secret("bob"));
    const stamp = Date.now().toString(36);
    const owner = await person(RELAY!, secret("owner"));
    const id = crypto.randomUUID(), name = `Porch ${stamp}`;
    for (const p of [alice, bob.pubkey]) await owner.publish({ kind: 9030, tags: [["p", p]] });
    expect((await owner.publish({ kind: 9007, tags: [["h", id], ["name", name], ["visibility", "private"], ["channel_type", "stream"]] })).ok).toBe(true);
    for (const p of [alice, bob.pubkey]) expect((await owner.publish({ kind: 9000, tags: [["h", id], ["p", p]] })).ok).toBe(true);
    owner.close();
    // more than a screen of talk, the newest last
    for (let i = 1; i <= 24; i++) expect((await bob.publish({ kind: 9, content: `Line ${i} of the porch talk, long enough to wrap on a phone ${stamp}`, tags: [["h", id]] })).ok).toBe(true);
    await new Promise((r) => setTimeout(r, 1100));
    expect((await bob.publish({ kind: 9, content: `The newest line ${stamp}`, tags: [["h", id]] })).ok).toBe(true);
    await page.addInitScript((k) => { if (window === window.top) (window as unknown as { __parachuteE2EKey: string }).__parachuteE2EKey = k; }, secret("alice"));
    const made = await install({ relay: RELAY!, uni: bob.pubkey });
    const app = frame(page);
    /** A tap where a person sees it: it must be wholly on the screen as it is (nothing scrolled or turned for the test). */
    const tap = async (what: string, l: ReturnType<typeof app.locator>) => {
      const b = await l.boundingBox(), v = page.viewportSize()!;
      expect(b, `${what}: drawn`).not.toBeNull();
      expect(b!.x >= 0 && b!.y >= 0 && b!.x + b!.width <= v.width + 0.5 && b!.y + b!.height <= v.height + 0.5, `${what} on the screen: ${JSON.stringify(b)} in ${v.width}x${v.height}`).toBe(true);
      return { at: () => page.mouse.click(b!.x + b!.width / 2, b!.y + b!.height / 2) };
    };
    try {
      await page.goto(`/v/${VAULT}?with=vault`);
      await ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name: /Rooms/ }).click();
      await page.getByRole("button", { name: "Allow" }).click();
      const row = app.getByRole("region", { name: "Your rooms" }).getByRole("button", { name: new RegExp(name) });
      await expect(row).toBeVisible({ timeout: 30_000 });
      await (await tap("the room's row", row)).at();
      const log = app.getByRole("log");
      const newest = log.locator("article", { hasText: `The newest line ${stamp}` });
      await expect(newest).toBeVisible({ timeout: 20_000 });
      await page.waitForTimeout(600); // settled: where it lands is where a person finds it
      await tap("the newest message", newest);
      // a person taps the box and writes, then taps Send: no scrolling, no turning a page to find either
      const field = app.getByLabel(`Message ${name}`);
      await (await tap("the box to write in", field)).at();
      await page.keyboard.type(`On my way ${stamp}`);
      await expect(field).toHaveValue(`On my way ${stamp}`);
      await (await tap("Send", app.getByRole("button", { name: "Send message" }))).at();
      const mine = log.locator("article.mine", { hasText: `On my way ${stamp}` });
      await expect(mine).toBeVisible({ timeout: 15_000 });
      await expect(field).toHaveValue("");
      await page.waitForTimeout(600);
      await tap("the message just sent", mine);
      await tap("the box to write in, after sending", field);
      // the keyboard comes up (the screen gets shorter): the newest stays in view above the box (today's Rooms; the
      // older one never followed it, and its code is the vault's)
      if (install !== installOlderRooms) {
        await page.setViewportSize({ width: 390, height: 520 });
        await page.waitForTimeout(600);
        await tap("the message just sent, with the keyboard up", mine);
        await tap("the box to write in, with the keyboard up", field);
      }
      await expect.poll(async () => (await bob.query({ kinds: [9], "#h": [id], authors: [alice], limit: 10 })).some((e) => e.content === `On my way ${stamp}`), { timeout: 15_000 }).toBe(true);
    } finally {
      await made.remove();
      bob.close();
    }
  });
});
