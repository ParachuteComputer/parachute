// A voice note that can't go never vanishes, on the phone (T-476, Aaron 11-25: "it said not sent connection closed. Then
// my message was gone"). A person with their key signs in to their own Parachute, opens Rooms on a throwaway Buzz relay
// and records a voice note; the relay's line is cut as the message goes out (e2e/android/cutter.ts). Then: the voice
// note stays in the room marked "Not sent – tap to retry"; it is there after leaving the room, and after the app is
// stopped and started again; with the line back, a tap sends it, once. Taps on the app are a finger's (adb input tap at
// the element's place on the screen); every screen on the way is a screenshot from the phone.
//   BUZZ_RELAY=ws://localhost:<relay> BUZZ_KEYS=<keys> DRIVE_PORTS=<relay>:<relay+1> scripts/android-drive.sh <debug.apk> unsent <folder>
// EXPECT=before: on a build without the fix, it stops at what the person saw then (the message gone) and says so.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { FrameLocator, Locator, Page } from "@playwright/test";
import { chromium } from "@playwright/test";
import { getPublicKey } from "nostr-tools/pure";
import { nip19 } from "nostr-tools";
import { installApplet } from "../helpers";
import { person } from "../services/client";
import { cutter } from "./cutter";
import { phone, wait } from "./phone";

const RELAY = process.env.BUZZ_RELAY ?? "", KEYS = process.env.BUZZ_KEYS ?? "";
const [phonePort, hostPort] = (process.env.DRIVE_PORTS ?? "").split(",")[0].split(":").map(Number);
if (!RELAY || !KEYS || !phonePort || !hostPort) throw new Error("needs BUZZ_RELAY, BUZZ_KEYS and DRIVE_PORTS=<relay port>:<cutter port>");
const relayPort = Number(new URL(RELAY).port);
const before = process.env.EXPECT === "before";
const ph = await phone(process.argv[2]);
const { hub, nsec } = ph.world;
let page: Page = ph.page();
const p = () => page;
const fail = async (why: string): Promise<never> => { await ph.shot("stopped"); console.error(`FAILED: ${why}`); process.exit(1); };
const visible = (l: Locator) => l.first().isVisible().catch(() => false);
async function until(why: string, test: () => Promise<boolean>, s = 60) {
  for (let i = 0; i < s; i++) { if (await test().catch(() => false)) return; await wait(1000); }
  await fail(why);
}
const applet = (): FrameLocator => p().frameLocator("iframe.applet-frame:visible");
const ui = (): FrameLocator => p().frameLocator("iframe.app-frame");
const onHub = () => p().url().startsWith(hub);
setTimeout(() => { console.error("FAILED: the walk took over 20 minutes"); process.exit(1); }, 20 * 60_000).unref();

// ── a finger: the element's middle, from CSS pixels to the screen's (the WebView's place, read from the screen) ──
let webview: { x: number; y: number } | null = null;
async function tap(l: Locator) {
  await systemAsks();
  await l.first().scrollIntoViewIfNeeded().catch(() => {});
  await wait(400);
  const box = await l.first().boundingBox();
  if (!box) await fail("nothing to tap");
  if (!webview) {
    const xml = await ph.adb("shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; $ADB shell cat /sdcard/ui.xml");
    const m = /class="android\.webkit\.WebView"[^>]*bounds="\[(\d+),(\d+)\]/.exec(xml);
    webview = m ? { x: +m[1], y: +m[2] } : { x: 0, y: 0 };
  }
  const dpr = await p().evaluate(() => devicePixelRatio);
  const x = Math.round(webview.x + (box!.x + box!.width / 2) * dpr), y = Math.round(webview.y + (box!.y + box!.height / 2) * dpr);
  await ph.adb(`shell input tap ${x} ${y}`);
}
/** Android's own ask over the app (notifications, the microphone): answered yes, as the person would. */
async function systemAsks() {
  if (!/permissioncontroller|GrantPermissions/i.test(await ph.adb("shell dumpsys window | grep -E 'mCurrentFocus'"))) return false;
  await ph.shot("android-asks");
  const ok = await tapText(/^(ALLOW|Allow|While using the app|WHILE USING THE APP)$/);
  await wait(1200);
  return ok;
}
/** A system screen's button, by its words (Android's permission ask, its unlock). */
async function tapText(re: RegExp): Promise<boolean> {
  const xml = await ph.adb("shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; $ADB shell cat /sdcard/ui.xml");
  for (const m of xml.matchAll(/<node [^>]*?text="([^"]*)"[^>]*?bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/g)) {
    if (re.test(m[1])) { await ph.adb(`shell input tap ${(+m[2] + +m[4]) >> 1} ${(+m[3] + +m[5]) >> 1}`); return true; }
  }
  return false;
}

// ── the relay: the person and bob let in, a room for them, bob's line in it; the phone's line to it through the cutter ──
const secret = (n: string) => readFileSync(join(KEYS, `${n}.hex`), "utf8").trim();
const me = getPublicKey(nip19.decode(nsec).data as Uint8Array);
const owner = await person(RELAY, secret("owner"));
const bob = await person(RELAY, secret("bob"));
const room = crypto.randomUUID(), stamp = Date.now().toString(36).slice(-4), name = `Porch ${stamp}`;
for (const k of [me, bob.pubkey]) await owner.publish({ kind: 9030, tags: [["p", k]] });
await owner.publish({ kind: 9007, tags: [["h", room], ["name", name], ["visibility", "private"], ["channel_type", "stream"]] });
for (const k of [me, bob.pubkey]) await owner.publish({ kind: 9000, tags: [["h", room], ["p", k]] });
owner.close();
await bob.publish({ kind: 0, content: JSON.stringify({ name: "Bob", display_name: "Bob" }) });
await bob.publish({ kind: 9, content: "Back by six? Send me a voice note.", tags: [["h", room]] });
const line = cutter(hostPort, relayPort);
await line.start();
console.log(`relay ${RELAY} reached by the phone on its ${phonePort}, through the cutter on ${hostPort}`);

// Rooms, on this relay, in the vault they open
const made = await installApplet("rooms", { relay: RELAY, uni: bob.pubkey });

// ── 1. the key, pasted; signed in to their own Parachute (as e2e/android/libfirst.ts) ──
const PIN = "1357";
await ph.adb(`shell locksettings set-pin ${PIN}`);
await until("the first screen didn't come", () => visible(p().getByRole("button", { name: "Make a new key" })), 180);
await p().getByText("Advanced: paste a secret key").click();
await p().getByPlaceholder("nsec1…").fill(nsec);
await p().getByRole("button", { name: "Keep this key" }).click();
await until("the key wasn't kept", () => visible(p().getByRole("button", { name: "Sign in with your key" })), 60);
await p().getByLabel("Your Parachute's address").fill(hub);
await p().getByRole("radio", { name: "Mine" }).check();
await p().getByRole("button", { name: "Sign in with your key" }).click();
for (let i = 0; i < 90; i++) {
  await wait(1000);
  if (onHub()) { const ok = p().getByRole("button", { name: "Approve" }); if (await visible(ok)) await ok.click(); continue; }
  const cont = p().getByRole("button", { name: "Continue" });
  if (await visible(cont)) { await cont.click(); continue; }
  if (await visible(p().locator("nav[aria-label=Bar]")) && !p().url().includes("/oauth/")) break;
}
await until("not signed in", () => visible(p().locator("nav[aria-label=Bar]")), 60);
console.log("signed in");

/** Applets → Rooms → the room, as a person goes there (Allow the first time, with the phone's own unlock if asked). */
async function openRoom(first: boolean) {
  const bar = () => p().getByRole("navigation", { name: "Bar" });
  await bar().getByRole("link", { name: /Applets/ }).click();
  const rooms = ui().getByRole("list", { name: "Applets" }).getByRole("link", { name: /Rooms/ });
  await until("Rooms isn't on the list", () => visible(rooms as never), 60);
  await tap(rooms as never);
  if (first) {
    const allow = p().getByRole("button", { name: "Allow" });
    await until("Rooms' card didn't come", () => visible(allow), 60);
    await ph.shot("rooms-card");
    await tap(allow);
    for (let i = 0; i < 20; i++) {
      await wait(1500);
      if (/BiometricPrompt|ConfirmDeviceCredential|[Bb]iometric|AuthContainerView/.test(await ph.adb("shell dumpsys window | grep -E 'mCurrentFocus|mFocusedWindow'"))) {
        await ph.adb(`shell input text ${PIN} && $ADB shell input keyevent 66`); continue;
      }
      if (onHub()) { const ok = p().getByRole("button", { name: "Approve" }); if (await visible(ok)) await ok.click(); continue; }
      if (await systemAsks()) continue;
      if (await visible(applet().getByRole("region", { name: "Your rooms" }) as never)) break;
    }
  }
  await systemAsks();
  const row = applet().getByRole("region", { name: "Your rooms" }).getByRole("button", { name: new RegExp(name) });
  await until("the room isn't in the list", () => visible(row as never), 60);
  await tap(row as never);
  await until("the room didn't open", () => visible(applet().getByRole("log") as never), 30);
  await wait(1500);
}
const log = () => applet().getByRole("log");
const unsent = () => log().locator("article.mine.unsent");

// ── 2. the room; a voice note, recorded; the line cut as it goes out ──
await openRoom(true);
await until("bob's line isn't in the room", async () => (await log().innerText()).includes("Back by six"), 30);
await ph.shot("room");
await tap(applet().getByRole("button", { name: "Record a voice note" }) as never);
// Android asks for the microphone the first time
for (let i = 0; i < 10; i++) {
  await wait(1000);
  if (await systemAsks()) console.log("microphone allowed");
  if (await visible(p().getByRole("dialog", { name: "Recording for Rooms" }))) break;
}
const sheet = p().getByRole("dialog", { name: "Recording for Rooms" });
await until("the recorder didn't open", () => visible(sheet), 20);
await until("the recorder isn't recording", async () => /0:0[3-9]/.test(await sheet.getByRole("timer").innerText()), 20);
await ph.shot("recording");
line.cutOnPost();
await tap(sheet.getByRole("button", { name: "Send" }));
await until("the line wasn't cut as the message went", async () => line.posts.length > 0, 30);
const tried = line.posts[0];
console.log("cut as it went:", tried);
await wait(20_000); // the relay's answer doesn't come: its wait runs out
await ph.shot("after-the-cut");
const said = (await applet().locator(".composer").innerText().catch(() => "")).replace(/\n+/g, " | ");
console.log("THE ROOM SAYS:", said.slice(0, 300));
if (before) {
  const kept = await unsent().count();
  console.log(kept ? "the voice note is still in the room" : "the voice note is gone from the room");
  bob.close(); line.close(); await made.remove();
  process.exit(kept ? 1 : 0);
}
await until("the voice note isn't marked Not sent", () => visible(unsent().getByRole("button", { name: /Not sent – tap to retry/ }) as never), 30);
await ph.shot("not-sent");

// ── 3. away from the room and back; then the app stopped and started again: still there, with its recording ──
await tap(applet().getByRole("button", { name: "← Rooms" }) as never);
await wait(1500);
await ph.shot("rooms-list");
await tap(applet().getByRole("region", { name: "Your rooms" }).getByRole("button", { name: new RegExp(name) }) as never);
await until("the voice note isn't there after leaving the room", () => visible(unsent() as never), 30);
await ph.shot("back-in-the-room");
await ph.adb("shell am force-stop computer.parachute.app");
await wait(2000);
await ph.adb("shell monkey -p computer.parachute.app -c android.intent.category.LAUNCHER 1");
let pid = "";
for (let i = 0; i < 60 && !pid; i++) { await wait(1000); pid = (await ph.adb("shell pidof computer.parachute.app")).trim(); }
for (let i = 0; i < 60; i++) { if ((await ph.adb("shell cat /proc/net/unix")).includes(`webview_devtools_remote_${pid}`)) break; await wait(1000); }
await ph.adb(`forward tcp:${Number(process.env.CDP) - 1} localabstract:webview_devtools_remote_${pid}`);
await ph.browser.close().catch(() => {});
const again = await chromium.connectOverCDP(`http://127.0.0.1:${process.env.CDP}`);
for (let i = 0; i < 30; i++) { const ps = again.contexts().flatMap((c) => c.pages()); const pg = ps.find((x) => !x.url().startsWith("about:")); if (pg) { page = pg; break; } await wait(1000); }
for (const c of again.contexts()) c.setDefaultTimeout(30_000);
webview = null;
console.log("started again; at", p().url());
await until("the app didn't come back signed in", () => visible(p().locator("nav[aria-label=Bar]")), 90);
await openRoom(false);
await until("the voice note isn't there after the app started again", () => visible(unsent().getByRole("button", { name: /Not sent – tap to retry/ }) as never), 30);
await until("its recording isn't there", async () => (await unsent().getByLabel(/Voice note/).first().evaluate((a: HTMLAudioElement) => a.readyState)) > 0, 20);
await ph.shot("after-restart");

// ── 4. the line back: one tap sends it, the event that was tried, once ──
line.up();
await tap(unsent().getByRole("button", { name: /Not sent – tap to retry/ }) as never);
await until("it didn't go", async () => (await unsent().count()) === 0, 60);
await until("it isn't in the room as sent", () => visible(log().locator("article.mine:not(.unsent)").getByLabel(/Voice note/) as never), 30);
await ph.shot("sent");
const mine = (await bob.query({ kinds: [9], "#h": [room], authors: [me], limit: 20 })).filter((e) => e.tags.some((t) => t[0] === "imeta" && t.some((x) => x.startsWith("m audio/"))));
console.log(`on the relay: ${mine.length} voice note(s); ids the phone sent: ${[...new Set(line.posts)].join(", ")}`);
if (mine.length !== 1) await fail(`the relay has ${mine.length} voice notes from the person, not 1`);
if (mine[0].id !== tried) await fail("what went isn't the event that was tried first");
bob.close(); line.close(); await made.remove();
console.log("PASSED: the voice note stayed through the cut, leaving the room and a restart, and went once on a tap");
process.exit(0);
