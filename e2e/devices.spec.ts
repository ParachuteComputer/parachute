// What an applet asks of this device through the shell (docs/design/KEYRING.md "Voice, files, links, storage"), driven
// as a person would in the web build: a voice note recorded on the shell's own sheet (Chromium's fake microphone, in
// this file's own launch options), sent to a real Buzz relay and played back; a link opened; a file saved; a file
// picked on the shell's picker and uploaded; a draft kept across reopening the applet; and a journal voice entry
// attached to its note with transcription asked. The rooms test needs our Buzz relay (e2e/services/README.md); the
// journal test runs on any hub.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { getPublicKey } from "nostr-tools/pure";
import { api, hubState, record, VAULT } from "./hub";
import { installApplet, ui } from "./helpers";
import { person } from "./services/client";
import { appletRecord } from "../applets/record.ts";

const RELAY = process.env.BUZZ_RELAY;
const KEYS = process.env.BUZZ_KEYS ?? "";
test.use({ storageState: "e2e/.signed-in.json", launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] } });

const secret = (n: string) => readFileSync(join(KEYS, `${n}.hex`), "utf8").trim();
const frame = (page: Page) => page.frameLocator("iframe.applet-frame");

/** The shell's recorder sheet, recording from the applet's tap: a moment of the fake microphone, then Send. */
async function recordOnSheet(page: Page, name: string, seconds = 2) {
  const sheet = page.getByRole("dialog", { name: `Recording for ${name}` });
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText(`${name} gets it only when you press Send`);
  await expect(sheet.getByRole("timer")).toContainText("Recording");
  await expect(sheet.getByRole("timer")).toContainText(`0:0${seconds}`, { timeout: (seconds + 5) * 1000 });
  await sheet.getByRole("button", { name: "Send" }).click();
  await expect(sheet).toBeHidden();
}

test("rooms on a real relay: a voice note, a link, a saved file, an attached file and a kept draft", async ({ page }) => {
  test.skip(!RELAY || !KEYS, "needs our Buzz relay (BUZZ_RELAY, BUZZ_KEYS): e2e/services/README.md");
  test.setTimeout(180_000);
  const alice = getPublicKey(Uint8Array.from(Buffer.from(secret("alice"), "hex")));
  const bob = await person(RELAY!, secret("bob"));
  const stamp = Date.now().toString(36);
  const owner = await person(RELAY!, secret("owner"));
  const g = crypto.randomUUID();
  for (const p of [alice, bob.pubkey]) await owner.publish({ kind: 9030, tags: [["p", p]] });
  expect((await owner.publish({ kind: 9007, tags: [["h", g], ["name", `Shed ${stamp}`], ["visibility", "private"], ["channel_type", "stream"]] })).ok).toBe(true);
  for (const p of [alice, bob.pubkey]) expect((await owner.publish({ kind: 9000, tags: [["h", g], ["p", p]] })).ok).toBe(true);
  owner.close();
  // the shell's link out, as the web build does it, is caught here (only in the shell's own window)
  await page.addInitScript((k) => {
    if (window !== window.top) return;
    const w = window as unknown as { __parachuteE2EKey: string; __opened: string[] };
    w.__parachuteE2EKey = k;
    w.__opened = [];
    window.open = (url?: string | URL) => { w.__opened.push(String(url)); return null; };
  }, secret("alice"));
  const made = await installApplet("rooms", { relay: RELAY!, uni: bob.pubkey });
  try {
    // bob posts a link and a PDF (a file that isn't a picture, a video or a voice note)
    expect((await bob.publish({ kind: 9, content: `The seed list is at https://example.org/seeds-${stamp} for now.`, tags: [["h", g]] })).ok).toBe(true);
    const pdf = Buffer.from(`%PDF-1.4\n% seed list ${stamp}\n%%EOF\n`);
    const up = await bob.upload(pdf, "application/pdf");
    expect((await bob.publish({ kind: 9, content: `[seeds.pdf](${up.url})`, tags: [["h", g], ["imeta", `url ${up.url}`, "m application/pdf", `x ${up.sha256}`, `size ${up.size}`, "filename seeds.pdf"]] })).ok).toBe(true);

    await page.goto(`/v/${VAULT}?with=vault`);
    await ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name: /Rooms/ }).click();
    const card = page.getByRole("region", { name: /asking for access/ });
    await expect(card).toContainText("Record from your microphone when you press record (the app shows its own recorder)");
    await expect(card).toContainText("Open web addresses in your browser: what it reads could leave in an address it opens");
    await expect(card).toContainText("Save files to your device's Downloads");
    await expect(card).toContainText("Ask you to pick a file or picture to give it");
    await expect(card).toContainText("Keep up to 256 KB on this device for itself (drafts, what it last showed)");
    await page.getByRole("button", { name: "Allow" }).click();
    const app = frame(page);
    const list = app.getByRole("region", { name: "Your rooms" });
    await list.getByRole("button", { name: new RegExp(`Shed ${stamp}`) }).click({ timeout: 30_000 });
    const log = app.getByRole("log");

    // a link: the shell opens it, once for one tap
    const link = log.getByRole("link", { name: `https://example.org/seeds-${stamp}` });
    await link.click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __opened: string[] }).__opened)).toEqual([`https://example.org/seeds-${stamp}`]);
    await expect(page).toHaveURL(new RegExp(`/v/${VAULT}/a/`)); // the app stays where it was

    // a file saved: the browser's own download, under its bare name, with bob's bytes
    const download = page.waitForEvent("download");
    await log.getByRole("button", { name: "Save seeds.pdf" }).click();
    const dl = await download;
    expect(dl.suggestedFilename()).toBe("seeds.pdf");
    expect(readFileSync(await dl.path()).toString()).toContain(`seed list ${stamp}`);
    await expect(app.getByRole("status").filter({ hasText: "Saved to Downloads as seeds.pdf" })).toBeVisible();

    // a picture attached through the shell's own picker, then sent
    await app.getByRole("button", { name: "Choose files to attach" }).click();
    const picker = page.getByRole("dialog", { name: "Rooms asks for files" });
    await expect(picker).toContainText("It gets only what you choose here");
    const png = readFileSync(new URL("./fixtures/seedlings.png", import.meta.url));
    await picker.locator("input[type=file]").setInputFiles({ name: "beds.png", mimeType: "image/png", buffer: png });
    await expect(picker).toBeHidden();
    const field = app.getByLabel(`Message Shed ${stamp}`);
    await field.fill(`the beds ${stamp}`);
    await app.getByRole("button", { name: "Send message" }).click();
    await expect(log.locator("article.mine", { hasText: `the beds ${stamp}` }).getByRole("img", { name: "beds.png" })).toBeVisible({ timeout: 20_000 });

    // a voice note on the shell's recorder sheet
    await app.getByRole("button", { name: "Record a voice note" }).click();
    await recordOnSheet(page, "Rooms");
    const audio = log.locator("article.mine").getByLabel("Voice note voice.webm");
    await expect(audio).toBeVisible({ timeout: 20_000 });
    // it plays: the relay's copy, through the shell, as the room shows it
    await expect.poll(() => audio.evaluate((a: HTMLAudioElement) => a.readyState), { timeout: 15_000 }).toBeGreaterThan(0);
    expect(await audio.evaluate((a: HTMLAudioElement) => a.duration)).toBeGreaterThan(0);
    await audio.evaluate((a: HTMLAudioElement) => { a.muted = true; return a.play(); });
    await expect.poll(() => audio.evaluate((a: HTMLAudioElement) => a.currentTime), { timeout: 10_000 }).toBeGreaterThan(0.2);

    // on the relay: an empty kind 9 with an audio imeta, as the Uni app's and bob's voice notes are
    const mine = await bob.query({ kinds: [9], "#h": [g], authors: [alice], limit: 20 });
    const voice = mine.find((e) => e.tags.some((t) => t[0] === "imeta" && t.includes("filename voice.webm")));
    expect(voice?.content).toBe("");
    const imeta = voice!.tags.find((t) => t[0] === "imeta")!;
    expect(imeta).toContain("m audio/webm");
    expect(imeta.find((p) => p.startsWith("url "))).toMatch(/\/media\/[0-9a-f]{64}\.webm$/);
    expect(imeta.some((p) => p.startsWith("duration "))).toBe(false); // Buzz refuses a duration on audio
    expect(Number(imeta.find((p) => p.startsWith("size "))?.slice(5))).toBeGreaterThan(1000);
    expect(mine.find((e) => e.content.includes(`the beds ${stamp}`))?.tags.some((t) => t[0] === "imeta" && t.includes("filename beds.png"))).toBe(true);

    // a draft, kept on this device: away to the vault and back, it is still in the field
    await field.fill(`half a thought ${stamp}`);
    await page.waitForTimeout(900); // kept half a second after the last key
    await page.goto(`/v/${VAULT}?with=vault`);
    await ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name: /Rooms/ }).click();
    await frame(page).getByRole("region", { name: "Your rooms" }).getByRole("button", { name: new RegExp(`Shed ${stamp}`) }).click({ timeout: 30_000 });
    await expect(frame(page).getByLabel(`Message Shed ${stamp}`)).toHaveValue(`half a thought ${stamp}`);
    const kept = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("parachute.applet-storage.v1:")));
    expect(kept).toHaveLength(1);
  } finally {
    bob.close();
    await made.remove();
  }
});

test("journal: a voice entry, recorded on the shell's sheet, attached to its note with transcription asked", async ({ page }) => {
  test.setTimeout(90_000);
  const made: string[] = [];
  const note = await record(hubState(), "create", appletRecord("journal"));
  made.push(note.id);
  try {
    await page.goto(`/v/${VAULT}?with=vault`);
    await ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name: /Journal/ }).click();
    const card = page.getByRole("region", { name: /asking for access/ });
    await expect(card).toContainText("Read, add and change notes in Journal/");
    await expect(card).toContainText("Record from your microphone when you press record");
    await page.getByRole("button", { name: "Allow" }).click();
    const app = frame(page);
    await expect(app.getByRole("heading", { name: "Journal" })).toBeVisible();
    await app.getByRole("button", { name: "Record a voice entry" }).click();
    await recordOnSheet(page, "Journal");
    // the entry shows, waiting for its words
    const entry = app.getByRole("article", { name: /Entry at/ }).filter({ hasText: /Transcribing…|Transcription unavailable/ }).first();
    await expect(entry).toContainText(/Transcribing…|Transcription unavailable/, { timeout: 20_000 });
    await expect(entry).toContainText("voice");

    // in the vault: the Uni app's voice entry, its recording attached and transcription asked of the hub
    const rows = await api(hubState(), "GET", `notes?path_prefix=${encodeURIComponent("Journal/")}&include_content=true&include_metadata=true&limit=50`) as { id: string; path: string; content?: string; metadata?: Record<string, unknown> }[];
    const voiced = rows.filter((r) => r.metadata?.transcribe_stub === true);
    expect(voiced).toHaveLength(1);
    made.push(voiced[0].id);
    expect(voiced[0].path).toMatch(/^Journal\/\d{4}\/\d{2}-\d{2}\/\d{2}-\d{2}(-\d{2})?$/);
    expect(voiced[0].content).toMatch(/_Transcript pending\._|_Transcription unavailable\._/);
    const atts = await api(hubState(), "GET", `notes/${voiced[0].id}/attachments`) as { mimeType?: string; mime_type?: string; metadata?: Record<string, unknown> }[];
    expect(atts).toHaveLength(1);
    expect(atts[0].mimeType ?? atts[0].mime_type).toBe("audio/webm");
    expect(atts[0].metadata?.transcribe_origin).toBe("legacy"); // asked for, not guessed by the hub
  } finally { for (const id of made) await api(hubState(), "DELETE", `notes/${id}`).catch(() => {}); }
});

/** A finger's swipe at (x, y) on the screen, `by` pixels down (up when negative), as raw touches the browser hit-tests
 *  and scrolls with itself (its synthesized gesture doesn't reach a sandboxed frame here). */
async function swipeDown(page: Page, x: number, y: number, by = 300) {
  const cdp = await page.context().newCDPSession(page);
  const steps = 12;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  for (let i = 1; i <= steps; i++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y + (by * i) / steps }] }); await page.waitForTimeout(16); }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

// Aaron, 11-23: "I can't scroll because of a glitch in the parachute thing while I'm recording". The recorder sheet's
// scrim lay over the whole applet and took every touch, so the room he was answering couldn't be read while he spoke.
// 844 tall, and 640 (a shorter phone, or the keyboard up), where the frame must give up its least height for the recorder
for (const height of [844, 640])
test.describe(`on a phone 390 by ${height}, while recording`, () => {
  test.use({ viewport: { width: 390, height } });

  test("the room scrolls under a finger while the recorder records and after it stops, its newest line above the recorder; Send still sends", async ({ page }) => {
    test.skip(!RELAY || !KEYS, "needs our Buzz relay (BUZZ_RELAY, BUZZ_KEYS): e2e/services/README.md");
    test.setTimeout(150_000);
    const alice = getPublicKey(Uint8Array.from(Buffer.from(secret("alice"), "hex")));
    const bob = await person(RELAY!, secret("bob"));
    const stamp = Date.now().toString(36);
    const owner = await person(RELAY!, secret("owner"));
    const g = crypto.randomUUID(), name = `Orchard ${stamp}`;
    for (const p of [alice, bob.pubkey]) await owner.publish({ kind: 9030, tags: [["p", p]] });
    expect((await owner.publish({ kind: 9007, tags: [["h", g], ["name", name], ["visibility", "private"], ["channel_type", "stream"]] })).ok).toBe(true);
    for (const p of [alice, bob.pubkey]) expect((await owner.publish({ kind: 9000, tags: [["h", g], ["p", p]] })).ok).toBe(true);
    owner.close();
    // more than a screen of talk: the first line is the one being answered, far above the newest
    expect((await bob.publish({ kind: 9, content: `The question about the pear trees ${stamp}`, tags: [["h", g]] })).ok).toBe(true);
    for (let i = 1; i <= 24; i++) expect((await bob.publish({ kind: 9, content: `Line ${i} of the orchard talk, long enough to wrap on a phone ${stamp}`, tags: [["h", g]] })).ok).toBe(true);
    await new Promise((r) => setTimeout(r, 1100));
    expect((await bob.publish({ kind: 9, content: `The newest line ${stamp}`, tags: [["h", g]] })).ok).toBe(true);
    await page.addInitScript((k) => { if (window === window.top) (window as unknown as { __parachuteE2EKey: string }).__parachuteE2EKey = k; }, secret("alice"));
    const made = await installApplet("rooms", { relay: RELAY!, uni: bob.pubkey });
    try {
      await page.goto(`/v/${VAULT}?with=vault`);
      await ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name: /Rooms/ }).click();
      await page.getByRole("button", { name: "Allow" }).click();
      const app = frame(page);
      await app.getByRole("region", { name: "Your rooms" }).getByRole("button", { name: new RegExp(name) }).click({ timeout: 30_000 });
      const log = app.getByRole("log");
      const newest = log.locator("article", { hasText: `The newest line ${stamp}` });
      await expect(newest).toBeVisible({ timeout: 20_000 });
      await page.waitForTimeout(600);
      const first = log.locator("article", { hasText: `The question about the pear trees ${stamp}` });

      const mic = app.getByRole("button", { name: "Record a voice note" });
      await mic.click();
      const sheet = page.getByRole("dialog", { name: "Recording for Rooms" });
      await expect(sheet.getByRole("timer")).toContainText("Recording");
      // the room still takes taps: its microphone shows it is on, and a second tap on it changes nothing
      await expect(mic).toHaveAttribute("aria-pressed", "true");
      await mic.click();
      await page.waitForTimeout(400);
      await expect(app.getByText(/Not recorded/)).toHaveCount(0);
      await expect(sheet.getByRole("timer")).toContainText("Recording");
      await page.waitForTimeout(600); // the frame has made room for the recorder
      const top = (await sheet.boundingBox())!.y;
      // the newest line stands above the recorder, not under it
      const nb = (await newest.boundingBox())!;
      expect(nb.y + nb.height, `the newest line (${JSON.stringify(nb)}) ends above the recorder at ${top}`).toBeLessThanOrEqual(top + 1);
      // and so does the room's whole foot, its box to write in: the frame got shorter, the recorder covers none of it
      const box = (await app.getByLabel(`Message ${name}`).boundingBox())!;
      expect(box.y + box.height, `the box to write in (${JSON.stringify(box)}) ends above the recorder at ${top}`).toBeLessThanOrEqual(top + 1);
      // a finger on the talk, above the recorder, swipes it down to the line being answered: it scrolls, and recording
      // goes on. It lands in the middle of what the room shows of its talk, as the screen is now
      const scroller = app.locator(".room .scroll");
      const talk = async () => { const b = (await scroller.boundingBox())!; return b.y + b.height / 2; };
      const at = (await newest.boundingBox())!.y;
      await swipeDown(page, 195, await talk(), 150);
      await expect.poll(async () => (await newest.boundingBox())?.y ?? 9999, { message: "the talk moved under the finger" }).toBeGreaterThan(at + 60);
      for (let i = 0; i < 30 && ((await first.boundingBox())?.y ?? -1) < (await scroller.boundingBox())!.y; i++) await swipeDown(page, 195, await talk(), 150);
      const fb = (await first.boundingBox())!;
      expect(fb.y >= 0 && fb.y + fb.height <= top, `the line being answered is on screen above the recorder: ${JSON.stringify(fb)}`).toBe(true);
      await expect(sheet.getByRole("timer")).toContainText(/Recording 0:(0[2-9]|[1-5]\d)/, { timeout: 8000 });

      // stopped (the app went to the background and came back): the talk still scrolls, and Send sends what was kept
      await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true }); document.dispatchEvent(new Event("visibilitychange")); });
      await expect(sheet.getByRole("timer")).toContainText("Recorded");
      await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true }); document.dispatchEvent(new Event("visibilitychange")); });
      await page.waitForTimeout(1000); // the last swipe's fling has come to rest
      const was = await scroller.evaluate((e) => e.scrollTop);
      // a swipe up shows what is below (again if a swipe was taken as a tap; before the fix none ever moved it)
      await expect(async () => {
        await swipeDown(page, 195, await talk(), -160);
        expect(await scroller.evaluate((e) => e.scrollTop), "the talk moved under the finger, stopped").toBeGreaterThan(was + 60);
      }).toPass({ intervals: [300, 600], timeout: 8000 });
      await sheet.getByRole("button", { name: "Send" }).click();
      await expect(sheet).toBeHidden();
      await expect(log.locator("article.mine").getByLabel("Voice note voice.webm")).toBeAttached({ timeout: 20_000 });
      await expect(mic).not.toHaveAttribute("aria-pressed", "true");
    } finally {
      bob.close();
      await made.remove();
    }
  });
});
