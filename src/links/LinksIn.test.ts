import { beforeEach, describe, expect, it } from "vitest";
import { HANDLED_KEY, listenForLinks, openLinkPath } from "./LinksIn";

const LINK = "parachute://open?url=https%3A%2F%2Fhub.example%2Fv%2Frecipes%2Fn%2Fabc";
// the shell's deep-link plugin, which this app doesn't control
function plugin(start: string | null) {
  let cb: ((urls: string[]) => void) | null = null;
  return { getCurrent: async () => (start ? [start] : null), onOpenUrl: async (f: (urls: string[]) => void) => { cb = f; return () => { cb = null; }; }, tap: (u: string) => cb?.([u]) };
}
const tick = () => new Promise((r) => setTimeout(r, 0));
beforeEach(() => sessionStorage.clear());

describe("links in", () => {
  it("opens the link the app was started with, once: not again after a reload", async () => {
    const went: string[] = [];
    listenForLinks((p) => went.push(p), plugin(LINK));
    await tick();
    expect(went).toEqual([openLinkPath(LINK)]);
    // the page reloads: the plugin still reports the same start link
    listenForLinks((p) => went.push(p), plugin(LINK));
    await tick();
    expect(went).toHaveLength(1);
  });
  it("opens a fresh tap of the same link while the app runs", async () => {
    const went: string[] = [];
    const p = plugin(LINK);
    listenForLinks((x) => went.push(x), p);
    await tick();
    p.tap(LINK);
    expect(went).toEqual([openLinkPath(LINK), openLinkPath(LINK)]);
    expect(sessionStorage.getItem(HANDLED_KEY)).toBe(LINK);
  });
  it("does nothing with no link", async () => {
    const went: string[] = [];
    listenForLinks((x) => went.push(x), plugin(null));
    await tick();
    expect(went).toEqual([]);
  });
});
