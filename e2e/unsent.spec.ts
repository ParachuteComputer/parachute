// A message that can't go never vanishes (T-476, Aaron 11-25: "it said not sent connection closed. Then my message was
// gone"). Rooms on our real Buzz relay, alice in the app: the relay's connection is cut in the middle of a send (the
// upload, then the publish), as a phone that loses the tailnet or is just waking cuts it. What was sent stays in the
// room, marked "Not sent – tap to retry", with its recording kept on this device; it is still there after leaving the
// room and after the app starts again; a tap sends it once (the same event: no copy on the relay).
// The cut is the browser's (the network is the one thing faked): every connection to the relay is closed, and new ones
// are refused, until the test lets them through again.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "./test";
import { getPublicKey } from "nostr-tools/pure";
import { VAULT } from "./hub";
import { installApplet, ui } from "./helpers";
import { person } from "./services/client";

const RELAY = process.env.BUZZ_RELAY;
const KEYS = process.env.BUZZ_KEYS ?? "";
test.skip(!RELAY || !KEYS, "needs our Buzz relay (BUZZ_RELAY, BUZZ_KEYS): e2e/services/README.md");
test.use({ storageState: "e2e/.signed-in.json", launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] } });

const secret = (n: string) => readFileSync(join(KEYS, `${n}.hex`), "utf8").trim();
const frame = (page: Page) => page.frameLocator("iframe.applet-frame");

/** The relay, as this page reaches it, with a switch: `down` closes every connection and refuses new ones (and the
 *  media server's uploads); `cutOn(kind)` cuts the connection when the page sends an event of that kind, before (`drop`)
 *  or after (`lost`: the relay has it, its OK never arrives) passing it on. `sent`: the id of every message (kind 9) the
 *  page sent. */
async function relaySwitch(page: Page) {
  let down = false;
  let trap: { kind: number; how: "drop" | "lost" } | null = null;
  const open = new Set<{ close: () => Promise<void> }>();
  const sent: string[] = [];
  await page.routeWebSocket((u) => u.href.startsWith(RELAY!), (ws) => {
    if (down) { void ws.close({ code: 4000 }).catch(() => {}); return; }
    const server = ws.connectToServer();
    const conn = { close: async () => { open.delete(conn); await server.close().catch(() => {}); await ws.close({ code: 4000 }).catch(() => {}); } };
    open.add(conn);
    ws.onMessage((m) => {
      if (typeof m === "string" && m.startsWith('["EVENT"')) {
        const ev = JSON.parse(m)[1] as { id: string; kind: number };
        if (trap && ev.kind === trap.kind) {
          const how = trap.how; trap = null; down = true;
          sent.push(ev.id);
          if (how === "lost") server.send(m);
          // the relay has it (or not), and the connection goes before its OK can come back
          setTimeout(() => { for (const c of [...open]) void c.close(); }, how === "lost" ? 300 : 0);
          return;
        }
        if (ev.kind === 9) sent.push(ev.id);
      }
      server.send(m);
    });
    server.onMessage((m) => { if (!down) ws.send(m); });
  });
  const http = RELAY!.replace(/^ws/, "http");
  await page.route((u) => u.href.startsWith(http), (r) => (down ? r.abort("internetdisconnected") : r.continue()));
  return {
    sent,
    cutOn: (kind: number, how: "drop" | "lost") => { trap = { kind, how }; },
    cut: async () => { down = true; for (const c of [...open]) await c.close(); },
    restore: () => { down = false; },
  };
}

/** The shell's recorder sheet: a moment of the fake microphone, then Send. */
async function recordOnSheet(page: Page) {
  const sheet = page.getByRole("dialog", { name: "Recording for Rooms" });
  await expect(sheet.getByRole("timer")).toContainText("0:02", { timeout: 8000 });
  await sheet.getByRole("button", { name: "Send" }).click();
  await expect(sheet).toBeHidden();
}

async function setUp() {
  const alice = getPublicKey(Uint8Array.from(Buffer.from(secret("alice"), "hex")));
  const bob = await person(RELAY!, secret("bob"));
  const stamp = Date.now().toString(36);
  const owner = await person(RELAY!, secret("owner"));
  const g = crypto.randomUUID();
  for (const p of [alice, bob.pubkey]) await owner.publish({ kind: 9030, tags: [["p", p]] });
  expect((await owner.publish({ kind: 9007, tags: [["h", g], ["name", `Porch ${stamp}`], ["visibility", "private"], ["channel_type", "stream"]] })).ok).toBe(true);
  for (const p of [alice, bob.pubkey]) expect((await owner.publish({ kind: 9000, tags: [["h", g], ["p", p]] })).ok).toBe(true);
  owner.close();
  expect((await bob.publish({ kind: 9, content: `Evening ${stamp}`, tags: [["h", g]] })).ok).toBe(true);
  return { alice, bob, stamp, g, name: `Porch ${stamp}` };
}

async function openRoom(page: Page, name: string, first = false) {
  await page.goto(`/v/${VAULT}?with=vault`);
  await ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name: /Rooms/ }).click();
  if (first) await page.getByRole("button", { name: "Allow" }).click();
  await frame(page).getByRole("region", { name: "Your rooms" }).getByRole("button", { name: new RegExp(name) }).click({ timeout: 30_000 });
  await expect(frame(page).getByRole("log")).toBeVisible();
}

test("a voice note whose publish loses the relay stays in the room, marked, across leaving and a restart; a tap sends it once, the same event", async ({ page }) => {
  test.setTimeout(240_000);
  const { alice, bob, stamp, g, name } = await setUp();
  await page.addInitScript((k) => { if (window === window.top) (window as unknown as { __parachuteE2EKey: string }).__parachuteE2EKey = k; }, secret("alice"));
  const made = await installApplet("rooms", { relay: RELAY!, uni: bob.pubkey });
  try {
    const net = await relaySwitch(page);
    await openRoom(page, name, true);
    const app = frame(page), log = app.getByRole("log");
    await expect(log).toContainText(`Evening ${stamp}`);

    // the upload goes; then the connection drops as the message goes out (Aaron's "connection closed"), and stays away
    net.cutOn(9, "drop");
    await app.getByRole("button", { name: "Record a voice note" }).click();
    await recordOnSheet(page);
    const unsent = log.locator("article.mine.unsent");
    await expect(unsent.getByRole("button", { name: /Not sent – tap to retry/ })).toBeVisible({ timeout: 30_000 });
    await expect(unsent.getByLabel("Voice note voice.webm")).toBeVisible();

    // away from the room and back; then the app starts again: still there, with its recording
    await app.getByRole("link", { name: "← Rooms" }).or(app.getByRole("button", { name: "← Rooms" })).first().click().catch(() => {});
    await openRoom(page, name);
    await expect(frame(page).getByRole("log").locator("article.mine.unsent")).toHaveCount(1);
    await page.reload();
    await openRoom(page, name);
    const again = frame(page).getByRole("log").locator("article.mine.unsent");
    await expect(again.getByRole("button", { name: /Not sent – tap to retry/ })).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => again.getByLabel("Voice note voice.webm").evaluate((a: HTMLAudioElement) => a.readyState), { timeout: 15_000 }).toBeGreaterThan(0);

    // the network is back: one tap sends it, the very event that was tried before (signed once), once
    const tried = net.sent.length;
    expect(tried).toBeGreaterThanOrEqual(1);
    net.restore();
    await again.getByRole("button", { name: /Not sent – tap to retry/ }).click();
    await expect(frame(page).getByRole("log").locator("article.mine.unsent")).toHaveCount(0, { timeout: 30_000 });
    await expect(frame(page).getByRole("log").locator("article.mine").getByLabel("Voice note voice.webm")).toHaveCount(1);
    const mine = (await bob.query({ kinds: [9], "#h": [g], authors: [alice], limit: 20 })).filter((e) => e.tags.some((t) => t[0] === "imeta" && t.includes("filename voice.webm")));
    expect(mine).toHaveLength(1);
    expect(net.sent.slice(0, tried)).toContain(mine[0].id);
    expect(new Set(net.sent).size).toBe(1);
  } finally {
    bob.close();
    await made.remove();
  }
});

test("a message and a picture sent with the relay away stay, marked; the field is free; a tap sends each once", async ({ page }) => {
  test.setTimeout(240_000);
  const { alice, bob, stamp, g, name } = await setUp();
  await page.addInitScript((k) => { if (window === window.top) (window as unknown as { __parachuteE2EKey: string }).__parachuteE2EKey = k; }, secret("alice"));
  const made = await installApplet("rooms", { relay: RELAY!, uni: bob.pubkey });
  try {
    const net = await relaySwitch(page);
    await openRoom(page, name, true);
    const app = frame(page), log = app.getByRole("log");
    await expect(log).toContainText(`Evening ${stamp}`);
    const field = app.getByLabel(`Message ${name}`);

    // the relay goes away: a line, then a picture (its upload refused too)
    await net.cut();
    await field.fill(`see you at six ${stamp}`);
    await app.getByRole("button", { name: "Send message" }).click();
    await expect(log.locator("article.mine.unsent", { hasText: `see you at six ${stamp}` }).getByRole("button", { name: /Not sent – tap to retry/ })).toBeVisible({ timeout: 30_000 });
    await expect(field).toHaveValue("");
    await app.getByRole("button", { name: "Choose files to attach" }).click();
    const picker = page.getByRole("dialog", { name: "Rooms asks for files" });
    await picker.locator("input[type=file]").setInputFiles({ name: "porch.png", mimeType: "image/png", buffer: readFileSync(new URL("./fixtures/seedlings.png", import.meta.url)) });
    await expect(picker).toBeHidden();
    await app.getByRole("button", { name: "Send message" }).click();
    const pic = log.locator("article.mine.unsent").filter({ has: app.getByRole("img", { name: "porch.png" }) });
    await expect(pic.getByRole("button", { name: /Not sent – tap to retry/ })).toBeVisible({ timeout: 30_000 });

    // the app starts again with the relay still away: both are there; then it is back, and a tap sends each
    await page.reload();
    await openRoom(page, name);
    const log2 = frame(page).getByRole("log");
    await expect(log2.locator("article.mine.unsent")).toHaveCount(2, { timeout: 30_000 });
    net.restore();
    for (const which of [log2.locator("article.mine.unsent", { hasText: `see you at six ${stamp}` }), log2.locator("article.mine.unsent").filter({ has: frame(page).getByRole("img", { name: "porch.png" }) })])
      await which.getByRole("button", { name: /Not sent – tap to retry/ }).click();
    await expect(log2.locator("article.mine.unsent")).toHaveCount(0, { timeout: 30_000 });
    const mine = await bob.query({ kinds: [9], "#h": [g], authors: [alice], limit: 20 });
    expect(mine.filter((e) => e.content.includes(`see you at six ${stamp}`))).toHaveLength(1);
    expect(mine.filter((e) => e.tags.some((t) => t[0] === "imeta" && t.includes("filename porch.png")))).toHaveLength(1);
  } finally {
    bob.close();
    await made.remove();
  }
});

test("a message the relay took whose OK was lost with the connection: marked while away, then there once when the network is back", async ({ page }) => {
  test.setTimeout(180_000);
  const { alice, bob, stamp, g, name } = await setUp();
  await page.addInitScript((k) => { if (window === window.top) (window as unknown as { __parachuteE2EKey: string }).__parachuteE2EKey = k; }, secret("alice"));
  const made = await installApplet("rooms", { relay: RELAY!, uni: bob.pubkey });
  try {
    const net = await relaySwitch(page);
    await openRoom(page, name, true);
    const app = frame(page), log = app.getByRole("log");
    await expect(log).toContainText(`Evening ${stamp}`);
    net.cutOn(9, "lost");
    await app.getByLabel(`Message ${name}`).fill(`on my way ${stamp}`);
    await app.getByRole("button", { name: "Send message" }).click();
    // shown at once, then marked once its wait for the relay's answer runs out
    await expect(log.locator("article.mine.unsent", { hasText: `on my way ${stamp}` })).toBeVisible();
    await expect(log.locator("article.mine.unsent", { hasText: `on my way ${stamp}` }).getByRole("button", { name: /Not sent – tap to retry/ })).toBeVisible({ timeout: 30_000 });
    net.restore();
    // back: the room reads it from the relay (or a tap sends it again, the same event): there once, not marked
    const retry = log.locator("article.mine.unsent").getByRole("button", { name: /Not sent – tap to retry/ });
    await retry.click({ timeout: 5000 }).catch(() => { /* already read back as sent */ });
    await expect(log.locator("article.mine.unsent")).toHaveCount(0, { timeout: 30_000 });
    await expect(log.locator("article.mine", { hasText: `on my way ${stamp}` })).toHaveCount(1);
    const mine = (await bob.query({ kinds: [9], "#h": [g], authors: [alice], limit: 20 })).filter((e) => e.content.includes(`on my way ${stamp}`));
    expect(mine).toHaveLength(1);
    expect(new Set(net.sent)).toEqual(new Set([mine[0].id]));
  } finally {
    bob.close();
    await made.remove();
  }
});
