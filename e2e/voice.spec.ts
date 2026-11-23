// The recorder as a person meets it (Aaron, 11-22: "the voice recording experience was a bit more fluid in the old Uni
// app"): one tap on an applet's record button and it records, as the Uni app's microphone does; Send sends. Going to
// the background stops it and keeps what was recorded; Cancel throws it away and lets the microphone go. Journal's
// voice entry on the hub alone, with Chromium's fake microphone (docs/design/KEYRING.md "Voice, files, links, storage").
import { expect, test, type Page } from "@playwright/test";
import { api, hubState, record, VAULT } from "./hub";
import { ui } from "./helpers";
import { appletRecord } from "../applets/record.ts";

test.use({ storageState: "e2e/.signed-in.json", launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] } });

const entries = async () => (await api(hubState(), "GET", `notes?path_prefix=${encodeURIComponent("Journal/")}&include_metadata=true&limit=100`) as { id: string; metadata?: Record<string, unknown> }[]);
const voiced = async () => (await entries()).filter((r) => r.metadata?.transcribe_stub === true);

/** Journal, allowed, with the recorder's moments kept: when the recorder started, and every stream the shell opened. */
async function journal(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __started: number; __streams: MediaStream[] };
    w.__started = 0; w.__streams = [];
    if (typeof MediaRecorder !== "undefined") {
      const start = MediaRecorder.prototype.start;
      MediaRecorder.prototype.start = function (this: MediaRecorder, ...a: [number?]) { this.addEventListener("start", () => { w.__started = performance.timeOrigin + performance.now(); }, { once: true }); return start.apply(this, a); };
    }
    const gum = navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);
    if (gum) navigator.mediaDevices.getUserMedia = async (c) => { const s = await gum(c); w.__streams.push(s); return s; };
  });
  await page.goto(`/v/${VAULT}?with=vault`);
  await ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name: /Journal/ }).click();
  await page.getByRole("button", { name: "Allow" }).click();
  const app = page.frameLocator("iframe.applet-frame");
  await expect(app.getByRole("heading", { name: "Journal" })).toBeVisible();
  return app.getByRole("button", { name: "Record a voice entry" });
}
const now = (page: Page) => page.evaluate(() => performance.timeOrigin + performance.now());
const started = (page: Page) => page.evaluate(() => (window as unknown as { __started: number }).__started);
const micOpen = (page: Page) => page.evaluate(() => (window as unknown as { __streams: MediaStream[] }).__streams.some((s) => s.getTracks().some((t) => t.readyState === "live")));

let made: string[] = [];
test.beforeEach(async () => { made = [(await record(hubState(), "create", appletRecord("journal"))).id]; });
test.afterEach(async () => { for (const r of await entries()) made.push(r.id); for (const id of made) await api(hubState(), "DELETE", `notes/${id}`).catch(() => {}); });

test("one tap records at once, with its time and shape; Send sends it", async ({ page }) => {
  const rec = await journal(page);
  const tapped = await now(page);
  await rec.click();
  const sheet = page.getByRole("dialog", { name: "Recording for Journal" });
  // recording, with no second tap: the recorder runs within a moment of the tap (the Uni app's microphone, the same)
  await expect(sheet.getByRole("timer")).toContainText("Recording");
  await expect.poll(() => started(page)).toBeGreaterThan(0);
  expect((await started(page)) - tapped).toBeLessThan(1500);
  await expect(sheet.locator("svg.record-shape rect").first()).toBeAttached();
  await expect(sheet.getByRole("timer")).toContainText("0:01", { timeout: 6000 });
  await sheet.getByRole("button", { name: "Send" }).click();
  await expect(sheet).toBeHidden();
  await expect.poll(async () => (await voiced()).length, { timeout: 15_000 }).toBe(1);
  expect(await micOpen(page)).toBe(false);
});

test("the app going to the background stops it and keeps it: Send still sends what was recorded", async ({ page }) => {
  const rec = await journal(page);
  await rec.click();
  const sheet = page.getByRole("dialog", { name: "Recording for Journal" });
  await expect(sheet.getByRole("timer")).toContainText("0:01", { timeout: 6000 });
  // the screen locks, or another app comes to the front
  await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true }); document.dispatchEvent(new Event("visibilitychange")); });
  await expect(sheet.getByRole("timer")).toContainText("Recorded");
  await expect(sheet).toContainText("Stopped when Parachute went to the background. What was recorded is here.");
  expect(await micOpen(page)).toBe(false);
  await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true }); document.dispatchEvent(new Event("visibilitychange")); });
  await sheet.getByRole("button", { name: "Send" }).click();
  await expect(sheet).toBeHidden();
  await expect.poll(async () => (await voiced()).length, { timeout: 15_000 }).toBe(1);
});

test("Cancel throws it away and lets the microphone go; nothing reaches the applet", async ({ page }) => {
  const rec = await journal(page);
  await rec.click();
  const sheet = page.getByRole("dialog", { name: "Recording for Journal" });
  await expect(sheet.getByRole("timer")).toContainText("Recording");
  await expect.poll(() => micOpen(page)).toBe(true);
  await sheet.getByRole("button", { name: "Cancel" }).click();
  await expect(sheet).toBeHidden();
  expect(await micOpen(page)).toBe(false);
  await page.waitForTimeout(1500);
  expect(await voiced()).toHaveLength(0);
});

test("a tap is a click at once: the shell and an applet's frame leave out the double tap's wait (Android's webview held each click ~300 ms)", async ({ page }) => {
  const rec = await journal(page);
  await expect(rec).toBeVisible();
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).touchAction)).toBe("manipulation");
  const applet = await page.locator("iframe.applet-frame").elementHandle().then((h) => h!.contentFrame());
  expect(await applet!.evaluate(() => getComputedStyle(document.documentElement).touchAction)).toBe("manipulation");
});
