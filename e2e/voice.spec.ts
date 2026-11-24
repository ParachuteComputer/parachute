// The recorder as a person meets it (Aaron, 11-22: "the voice recording experience was a bit more fluid in the old Uni
// app"): one tap on an applet's record button and it records, as the Uni app's microphone does; Send sends. Going to
// the background stops it and keeps what was recorded; Cancel throws it away and lets the microphone go. Journal's
// voice entry on the hub alone, with Chromium's fake microphone (docs/design/KEYRING.md "Voice, files, links, storage").
import { expect, test } from "@playwright/test";
import { api, hubState, record } from "./hub";
import { appletRecord } from "../applets/record.ts";

test.use({ storageState: "e2e/.signed-in.json", launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] } });

import { entries, journal, micOpen, now, started, voiced } from "./voiceHelpers";

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

// Aaron, 11-23: "I can't scroll ... while I'm recording". The recorder rests at the foot of the screen, beside the
// applet, not over it: a journal longer than the screen still scrolls under a finger while it records.
test.describe("on a phone 390 wide", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("the journal scrolls under a finger while the recorder records; Send still sends", async ({ page }) => {
    const stamp = Date.now().toString(36);
    for (let i = 0; i < 14; i++) made.push((await api(hubState(), "POST", "notes", { path: `Journal/2026/11-${String(2 + i).padStart(2, "0")}/07-15 Morning ${i} ${stamp}`, tags: ["journal"], content: `Morning ${i} ${stamp}. ${"The beds, the frost, the light on the fence. ".repeat(4)}` })).id);
    const rec = await journal(page);
    const app = page.frameLocator("iframe.applet-frame");
    const entry = app.getByRole("article", { name: /Entry at/ }).filter({ hasText: `Morning 13 ${stamp}` });
    await expect(entry).toBeVisible();
    await rec.click();
    const sheet = page.getByRole("dialog", { name: "Recording for Journal" });
    await expect(sheet.getByRole("timer")).toContainText("Recording");
    await page.waitForTimeout(600);
    const top = (await sheet.boundingBox())!.y;
    const cdp = await page.context().newCDPSession(page);
    const before = (await entry.boundingBox())!.y;
    // a finger above the recorder pushes the journal up, to the older days below
    await expect(async () => {
      const y = top - 60;
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 195, y }] });
      for (let i = 1; i <= 12; i++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 195, y: y - (300 * i) / 12 }] }); await page.waitForTimeout(16); }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      expect((await entry.boundingBox())?.y ?? 9999, "the journal moved under the finger").toBeLessThan(before - 100);
    }).toPass({ intervals: [300, 600], timeout: 8000 });
    await cdp.detach();
    await expect(sheet.getByRole("timer")).toContainText("Recording");
    await sheet.getByRole("button", { name: "Send" }).click();
    await expect(sheet).toBeHidden();
    await expect.poll(async () => (await voiced()).length, { timeout: 15_000 }).toBe(1);
  });
});
