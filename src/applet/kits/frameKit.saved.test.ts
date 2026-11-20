// The kit's saved state as an applet's frame runs it: the real kit in a window of its own, and a shell that answers.
// Found in review (T-476): a save that failed went back in line with the value it had carried, so an older draft could
// be written over a newer one (on disk and in the shell), and come back after a restart.
import { describe, expect, it } from "vitest";
// @ts-expect-error jsdom ships no types; vitest's own environment uses it the same way
import { JSDOM } from "jsdom";
import { FRAME_KIT } from "./frameKit";

type Msg = { uni: 1; id: string; ns: string; method: string; params: { bytes?: ArrayBuffer } };

function frame() {
  const dom = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window as unknown as Window & typeof globalThis & { eval(s: string): unknown };
  const sent: Msg[] = [];
  const shell = { postMessage: (m: Msg) => { sent.push(m); } };
  Object.defineProperty(w, "parent", { value: shell, configurable: true });
  Object.assign(w, { TextEncoder, TextDecoder });
  w.eval(FRAME_KIT);
  const deliver = (data: unknown) => { const ev = new w.MessageEvent("message", { data }); Object.defineProperty(ev, "source", { value: shell }); w.dispatchEvent(ev); };
  const kit = (w as unknown as { parachute: { saved: { set(k: string, v: unknown): void; flush(): Promise<unknown> } } }).parachute;
  const puts = () => sent.filter((m) => m.ns === "saved" && m.method === "put");
  const body = (m: Msg) => JSON.parse(new TextDecoder().decode(m.params.bytes!)) as Record<string, unknown>;
  const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
  deliver({ uni: 1, event: "ready", data: { contract: 1, saved: {} } });
  return { kit, puts, body, deliver, tick };
}
const failed = { code: "failed", message: "it couldn't be written on this device" };

describe("the kit's saved state, when a write fails", () => {
  it("two saves of one key both fail: the newer value is the one sent again", async () => {
    const f = frame();
    f.kit.saved.set("draft", "Dear Ana, the first words");
    void f.kit.saved.flush();
    f.kit.saved.set("draft", "Dear Ana, the first words and the rest");
    void f.kit.saved.flush();
    await f.tick();
    const [a, b] = f.puts();
    expect(f.body(a).draft).toBe("Dear Ana, the first words");
    f.deliver({ uni: 1, id: a.id, error: failed });
    f.deliver({ uni: 1, id: b.id, error: failed });
    await f.tick(1100);
    const again = f.puts().slice(2).map((m) => f.body(m).draft);
    expect(again.length).toBeGreaterThan(0);
    expect(again.at(-1)).toBe("Dear Ana, the first words and the rest");
    expect(again).not.toContain("Dear Ana, the first words");
  });

  it("an older save fails after a newer one was kept: the older value is never sent over it", async () => {
    const f = frame();
    f.kit.saved.set("draft", "old");
    void f.kit.saved.flush();
    f.kit.saved.set("draft", "old and new");
    void f.kit.saved.flush();
    await f.tick();
    const [a, b] = f.puts();
    f.deliver({ uni: 1, id: a.id, error: failed });
    f.deliver({ uni: 1, id: b.id, result: null });
    await f.tick(1100);
    expect(f.puts().slice(2).map((m) => f.body(m).draft)).not.toContain("old");
  });

  it("a key removed since the failed save stays removed", async () => {
    const f = frame();
    f.kit.saved.set("draft", "to be sent");
    void f.kit.saved.flush();
    f.kit.saved.set("draft", null);
    void f.kit.saved.flush();
    await f.tick();
    const [a, b] = f.puts();
    f.deliver({ uni: 1, id: a.id, error: failed });
    f.deliver({ uni: 1, id: b.id, result: null });
    await f.tick(1100);
    expect(f.puts().slice(2).map((m) => f.body(m).draft)).not.toContain("to be sent");
  });
});
