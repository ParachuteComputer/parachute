// Leaving the screen while recording must never throw the voice note away (T-476). The recorder rests beside the applet now,
// so the top bar's Back, a tab on the bar and the phone's Back all reach the person while it records. Each way out stops
// the recording and keeps it: it is where it was on coming back, with Send, and nothing was sent by leaving. Journal on the
// hub alone, with Chromium's fake microphone. It signs in for itself (the shared sign-in of the specs before is retired well
// into a long run, and this runs late), so it sits with the other specs that do (playwright.config.ts).
import { devices, expect, test, type BrowserContext, type Page } from "./test";
import { api, hubState, record } from "./hub";
import { signIn } from "./helpers";
import { appletRecord } from "../applets/record.ts";
import { entries, journal, micOpen, voiced } from "./voiceHelpers";

test.use({ launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] } });

const exits: Record<string, { leave: (page: Page) => Promise<unknown>; back: (page: Page) => Promise<unknown> }> = {
  "the top bar's Back": { leave: (page) => page.getByRole("button", { name: "Back" }).click(), back: (page) => page.goForward() },
  "a tab on the bar": { leave: (page) => page.getByRole("navigation", { name: "Bar" }).getByRole("link", { name: /Settings/ }).click(), back: (page) => page.goBack() },
  "the phone's Back (popstate)": { leave: (page) => page.goBack(), back: (page) => page.goForward() },
};

test("leaving by Back, a tab or the phone's Back, while it records or after it stopped, keeps the recording: it is there on coming back, and Send sends it", async ({ browser, baseURL, context }, info) => {
  test.setTimeout(240_000);
  const made: string[] = [];
  let phone: BrowserContext | null = null;
  try {
    made.push((await record(hubState(), "create", appletRecord("journal"))).id);
    // a fresh sign-in, then a phone of its own with it and a history of its own (the sign-in's pages would be in the way of Back)
    const signedIn = info.outputPath("signed-in.json");
    const first = await context.newPage();
    await signIn(first);
    // as the shared start has it (e2e/auth.setup.ts): the settings note the sign-in wrote taken away, the self-test passed
    for (const n of await api(hubState(), "GET", "notes?tag=parachute-settings")) await api(hubState(), "DELETE", `notes/${n.id}`);
    await first.goto("/settings");
    await expect(first.getByRole("status").filter({ hasText: /approved code only|run sealed/ })).toBeVisible({ timeout: 45_000 });
    await context.storageState({ path: signedIn });
    // closed: a page of the first that refreshed would retire the sign-in the phone holds
    await first.close();
    phone = await browser.newContext({ ...devices["Pixel 7"], baseURL, storageState: signedIn });
    const page = await phone.newPage();
    const sheet = page.getByRole("dialog", { name: "Recording for Journal" });
    let sent = 0;
    for (const [how, exit] of Object.entries(exits)) {
      for (const state of ["while it records", "after it stopped by itself"] as const) {
        await test.step(`${how} ${state}`, async () => {
          const rec = await journal(page);
          await rec.click();
          await expect(sheet.getByRole("timer")).toContainText("0:01", { timeout: 6000 });
          if (state === "after it stopped by itself") {
            // the app went to the background: it stopped and kept it; the person is back and leaves without pressing either
            await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true }); document.dispatchEvent(new Event("visibilitychange")); });
            await expect(sheet.getByRole("timer")).toContainText("Recorded");
            await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true }); document.dispatchEvent(new Event("visibilitychange")); });
          }
          await exit.leave(page);
          await expect(page.locator("iframe.applet-frame")).toBeHidden();
          await expect(sheet).toBeHidden();
          // the microphone is let go at once, and nothing was sent by leaving
          await expect.poll(() => micOpen(page)).toBe(false);
          await page.waitForTimeout(1200);
          expect(await voiced()).toHaveLength(sent);
          await exit.back(page);
          await expect(sheet).toBeVisible();
          await expect(sheet.getByRole("timer")).toContainText("Recorded");
          await expect(sheet).toContainText("Your recording is kept");
          await sheet.getByRole("button", { name: "Send" }).click();
          await expect(sheet).toBeHidden();
          sent++;
          await expect.poll(async () => (await voiced()).length, { timeout: 15_000 }).toBe(sent);
        });
      }
    }
  } finally {
    await phone?.close().catch(() => {});
    for (const r of await entries()) made.push(r.id);
    for (const id of made) await api(hubState(), "DELETE", `notes/${id}`).catch(() => {});
  }
});
