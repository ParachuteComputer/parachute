// The kit when the shell makes its session again under the same page (a grant re-read, say): the shell closes the old
// session's recorder and picker and drops its replies, so the kit settles a recording or a pick it held as a Cancel.
// Found in review (T-476): a recording open as the session was made again left the kit's Record waiting an hour,
// pressed in and deaf to every tap. Other calls keep their own timeout and retry (a write may have landed).
import { describe, expect, it } from "vitest";
// @ts-expect-error jsdom ships no types; vitest's own environment uses it the same way
import { JSDOM } from "jsdom";
import { FRAME_KIT } from "./frameKit";

type Msg = { uni: 1; id: string; ns: string; method: string };

function frame() {
  const dom = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window as unknown as Window & typeof globalThis & { eval(s: string): unknown };
  const sent: Msg[] = [];
  const shell = { postMessage: (m: Msg) => { sent.push(m); } };
  Object.defineProperty(w, "parent", { value: shell, configurable: true });
  Object.assign(w, { TextEncoder, TextDecoder });
  w.eval(FRAME_KIT);
  const deliver = (data: unknown) => { const ev = new w.MessageEvent("message", { data }); Object.defineProperty(ev, "source", { value: shell }); w.dispatchEvent(ev); };
  const kit = (w as unknown as { parachute: { voice: { record(): Promise<unknown> } } }).parachute;
  const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
  deliver({ uni: 1, event: "ready", data: { contract: 1 } });
  return { kit, sent, deliver, tick };
}

describe("the session made again", () => {
  it("a recording the old session held is settled as a Cancel at once, and the next one is asked of the new session", async () => {
    const f = frame();
    const first = f.kit.voice.record();
    let settled: unknown = "waiting";
    first.then((v) => { settled = v; }, () => { settled = "error"; });
    await f.tick();
    expect(f.sent.filter((m) => m.ns === "voice")).toHaveLength(1);
    f.deliver({ uni: 1, event: "ready", data: { contract: 1 } });
    await f.tick();
    expect(settled).toBeNull();
    const second = f.kit.voice.record();
    await f.tick();
    const asks = f.sent.filter((m) => m.ns === "voice");
    expect(asks).toHaveLength(2);
    f.deliver({ uni: 1, id: asks[1].id, result: null });
    await expect(second).resolves.toBeNull();
  });
});
