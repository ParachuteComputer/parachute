// What the recorder's specs share (voice.spec.ts, leaving.spec.ts): Journal on the hub, allowed, with the recorder's moments kept.
import { expect, type Page } from "@playwright/test";
import { api, hubState, VAULT } from "./hub";
import { ui } from "./helpers";

export const entries = async () => (await api(hubState(), "GET", `notes?path_prefix=${encodeURIComponent("Journal/")}&include_metadata=true&limit=100`) as { id: string; metadata?: Record<string, unknown> }[]);
export const voiced = async () => (await entries()).filter((r) => r.metadata?.transcribe_stub === true);

/** Journal, allowed, with the recorder's moments kept: when the recorder started, and every stream the shell opened. */
const watched = new WeakSet<Page>();
export async function journal(page: Page) {
  if (!watched.has(page)) await page.addInitScript(() => {
    const w = window as unknown as { __started: number; __streams: MediaStream[] };
    w.__started = 0; w.__streams = [];
    if (typeof MediaRecorder !== "undefined") {
      const start = MediaRecorder.prototype.start;
      MediaRecorder.prototype.start = function (this: MediaRecorder, ...a: [number?]) { this.addEventListener("start", () => { w.__started = performance.timeOrigin + performance.now(); }, { once: true }); return start.apply(this, a); };
    }
    const gum = navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);
    if (gum) navigator.mediaDevices.getUserMedia = async (c) => { const s = await gum(c); w.__streams.push(s); return s; };
  });
  watched.add(page);
  await page.goto(`/v/${VAULT}?with=vault`);
  await ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name: /Journal/ }).click();
  const app = page.frameLocator("iframe.applet-frame");
  // its card the first time on this device; already allowed after that
  const allow = page.getByRole("button", { name: "Allow" });
  const heading = app.getByRole("heading", { name: "Journal" });
  await expect.poll(async () => (await allow.isVisible()) || (await heading.isVisible()), { timeout: 20_000 }).toBe(true);
  if (await allow.isVisible()) await allow.click();
  await expect(heading).toBeVisible();
  return app.getByRole("button", { name: "Record a voice entry" });
}
export const now = (page: Page) => page.evaluate(() => performance.timeOrigin + performance.now());
export const started = (page: Page) => page.evaluate(() => (window as unknown as { __started: number }).__started);
export const micOpen = (page: Page) => page.evaluate(() => (window as unknown as { __streams: MediaStream[] }).__streams.some((s) => s.getTracks().some((t) => t.readyState === "live")));

