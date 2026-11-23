// The kit's line of calls (#49) as an applet's frame runs it: the real kit in a window of its own.
// Found in review (T-476):
// - a call that needs the person's tap (Trust Uni's key…, Approve, a secret) waited behind a busy room's card checks
//   and pictures; by the time it reached the shell the tap had worn off ("Tap the button itself.");
// - a write refused for being busy went back in line, but a later write of the same thing was already out and landed
//   first, so the older value was the one kept.
import { describe, expect, it } from "vitest";
// @ts-expect-error jsdom ships no types; vitest's own environment uses it the same way
import { JSDOM } from "jsdom";
import { FRAME_KIT } from "./frameKit";
import { createSession } from "../session";
import { createRouter } from "../router";
import { createStorageModule } from "../modules/storage";

type Msg = { uni: 1; id: string; ns: string; method: string; params: Record<string, unknown> };
type Svc = { card(s: string, e: unknown): Promise<unknown>; answer(s: string, e: unknown, d: string, r: string[]): Promise<unknown>; trust(s: string, e: unknown): Promise<unknown>; media(s: string, h: string, x: string): Promise<unknown> };
type Kit = { services: Svc; app: { follow(l: string): Promise<boolean> }; storage: { set(k: string, v: unknown): Promise<unknown>; get(k: string): Promise<unknown> }; saved: { set(k: string, v: unknown): void; flush(): Promise<unknown> } };

function windowWithKit(shell: { postMessage(m: never): void }) {
  const dom = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window as unknown as Window & typeof globalThis & { eval(s: string): unknown };
  Object.defineProperty(w, "parent", { value: shell, configurable: true });
  Object.assign(w, { TextEncoder, TextDecoder });
  w.eval(FRAME_KIT);
  const deliver = (data: unknown) => { const ev = new w.MessageEvent("message", { data }); Object.defineProperty(ev, "source", { value: shell }); w.dispatchEvent(ev); };
  return { kit: (w as unknown as { parachute: Kit }).parachute, deliver, w };
}
/** A shell that answers nothing until told. `late`: the test sends `ready` itself. */
function frame(late = false) {
  const sent: Msg[] = [];
  const shell = { postMessage: (m: Msg) => { sent.push(m); } };
  const { kit, deliver, w } = windowWithKit(shell as never);
  const start = (data: Record<string, unknown> = {}) => deliver({ uni: 1, event: "ready", data: { contract: 1, saved: {}, ...data } });
  if (!late) start();
  return { kit, w, start, sent: () => sent.filter((m) => m.uni === 1 && m.ns), deliver, tick: (ms = 0) => new Promise((r) => setTimeout(r, ms)) };
}
const CARD = { id: "e".repeat(64), pubkey: "a".repeat(64), kind: 9, created_at: 1, tags: [], content: "", sig: "s".repeat(128) };
const picture = (f: ReturnType<typeof frame>, i: number) => void f.kit.services.media("rooms", String(i).padStart(64, "0"), "png").catch(() => {});

describe("a tap's call in a busy room", () => {
  it("Trust Uni's key… goes to the shell at once, not behind the room's card checks and pictures", async () => {
    const f = frame();
    for (let i = 0; i < 12; i++) { picture(f, i); void f.kit.services.card("rooms", CARD).catch(() => {}); }
    await f.tick();
    void f.kit.services.trust("rooms", CARD).catch(() => {});
    await f.tick();
    expect(f.sent().some((m) => m.method === "trust")).toBe(true);
  });
  it("Approve on a card goes ahead of the card checks asked before it", async () => {
    const f = frame();
    for (let i = 0; i < 20; i++) void f.kit.services.card("rooms", CARD).catch(() => {});
    await f.tick();
    const before = f.sent().length;
    void f.kit.services.answer("rooms", CARD, "approve", ["r1"]).catch(() => {});
    await f.tick();
    expect(f.sent().slice(before).map((m) => m.method)).toEqual(["answer"]);
  });
  it("a place is kept for the person's taps: a note link opens while slow pictures hold the rest", async () => {
    const f = frame();
    for (let i = 0; i < 8; i++) picture(f, i);
    await f.tick();
    void f.kit.app.follow("uni:01K00000000000000000000000").catch(() => {});
    await f.tick();
    expect(f.sent().some((m) => m.method === "follow")).toBe(true);
    // and never more out than the shell holds (contract.ts LIMITS.maxPending)
    expect(f.sent().length).toBeLessThanOrEqual(8);
  });
});

describe("writes land in the order they were asked", () => {
  it("two writes of one key: the shell refuses the first for being busy and takes the second; the last one asked is the one kept", async () => {
    // the shell's real session, router and storage module; its clock is read once a message
    const times: number[] = [];
    let later = 0;
    const now = () => (times.length ? times.shift()! : later);
    let kept: Record<string, unknown> = {};
    const written: unknown[] = [];
    const storage = createStorageModule(true, { read: () => kept, write: (all) => { kept = all; written.push(all.last); } });
    // eslint-disable-next-line prefer-const
    let deliver: (data: unknown) => void = () => {};
    const shell = { postMessage: (m: { params?: { bytes?: ArrayBuffer } }) => {
      const b = m.params?.bytes;
      session.handle({ ...m, params: { ...m.params, ...(b ? { bytes: Uint8Array.from(new Uint8Array(b)).buffer } : {}) } });
    } };
    const session = createSession({ router: createRouter([storage]), grant: {}, now, post: (m) => setTimeout(() => deliver(m), 0) });
    const win = windowWithKit(shell as never);
    deliver = win.deliver;
    // the applet has been busy: 60 calls in the last ten seconds (the window is full)
    for (let i = 0; i < 60; i++) { times.push(i); session.handle({ uni: 1, id: `old${i}`, ns: "nope", method: "x", params: {} }); }
    await new Promise((r) => setTimeout(r, 0));
    // two writes of one key together: the first is read at 9999 (full), the second at 10000 (room again)
    times.push(9_999, 10_000);
    later = 20_000;
    await Promise.all([win.kit.storage.set("last", "first"), win.kit.storage.set("last", "second")]);
    expect(written).toEqual(["first", "second"]);
    expect(kept.last).toBe("second");
  });
});

describe("what must land in order, and what must not wait", () => {
  const busy = { code: "rate_limited", message: "rate_limited" };
  it("the frame's height: one refused for being busy is never sent again after a newer one", async () => {
    const f = frame(true);
    let height = 116;
    Object.defineProperty(f.w.document.body, "getBoundingClientRect", { value: () => ({ height }) });
    const layouts = () => f.sent().filter((m) => m.method === "layout");
    f.start({ page: { sized: true } });
    await f.tick(60);
    expect(layouts().length).toBe(1);
    const first = layouts()[0].params.height as number;
    // the shell is busy: it goes back in line; meanwhile the page grows
    f.deliver({ uni: 1, id: layouts()[0].id, error: busy });
    height = 216;
    f.w.dispatchEvent(new f.w.Event("load"));
    // after the kit's short wait the refused one goes again; the shell takes it, and then the newer one
    await f.tick(400);
    expect(layouts().length).toBe(2);
    f.deliver({ uni: 1, id: layouts()[1].id, result: null });
    await f.tick(60);
    // the old height went again (it was asked first), and the newer one after it: the last word is the newer
    expect(layouts().map((m) => m.params.height)).toEqual([first, first, first + 100]);
  });
  it("a read of what it keeps waits for the write asked before it", async () => {
    const f = frame();
    void f.kit.storage.set("last", "new").catch(() => {});
    void f.kit.storage.get("last").catch(() => {});
    await f.tick();
    expect(f.sent().map((m) => m.method)).toEqual(["set"]);
    f.deliver({ uni: 1, id: f.sent()[0].id, result: null });
    await f.tick();
    expect(f.sent().map((m) => m.method)).toEqual(["set", "get"]);
  });
  it("the last save as the frame goes is sent at once, not behind a save still out", async () => {
    const f = frame();
    f.kit.saved.set("draft", "half");
    void f.kit.saved.flush();
    await f.tick();
    f.kit.saved.set("draft", "half a thought");
    f.w.dispatchEvent(new f.w.Event("pagehide"));
    const puts = f.sent().filter((m) => m.method === "put");
    expect(puts.map((m) => JSON.parse(new TextDecoder().decode(m.params.bytes as ArrayBuffer)).draft)).toEqual(["half", "half a thought"]);
  });
  it("posts keep no lane: one waiting on a slow relay doesn't hold the next (an approval's tap would wear off)", async () => {
    const f = frame();
    const relay = (f.kit.services as unknown as { relay(id: string): { publish(e: unknown): Promise<unknown> } }).relay("rooms");
    void relay.publish({ kind: 9, content: "one", tags: [] }).catch(() => {});
    void relay.publish({ kind: 9, content: "/approve", tags: [] }).catch(() => {});
    await f.tick();
    expect(f.sent().filter((m) => m.method === "publish").length).toBe(2);
  });
});

describe("a call that runs long in the shell", () => {
  // Found in review (T-476): Import from Notion gave up after the kit's 20 seconds while the shell went on uploading a
  // workspace's pictures; the button came back and a second import ran beside the first.
  it("Import from Notion is still waited on after ten minutes", async () => {
    const dom = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only", pretendToBeVisual: true });
    const w = dom.window as unknown as Window & typeof globalThis & { eval(s: string): unknown };
    const sent: Msg[] = [];
    const shell = { postMessage: (m: Msg) => { sent.push(m); } };
    Object.defineProperty(w, "parent", { value: shell, configurable: true });
    Object.assign(w, { TextEncoder, TextDecoder });
    // ten minutes pass at once: any wait of 15 s up to 10 min is over on the next turn
    const real = w.setTimeout.bind(w);
    (w as unknown as { setTimeout: unknown }).setTimeout = (fn: () => void, ms?: number) => real(fn, ms && ms >= 15_000 && ms <= 600_000 ? 0 : ms);
    w.eval(FRAME_KIT);
    const ev = new w.MessageEvent("message", { data: { uni: 1, event: "ready", data: { contract: 1, saved: {} } } });
    Object.defineProperty(ev, "source", { value: shell });
    w.dispatchEvent(ev);
    const kit = (w as unknown as { parachute: { vaults: { importNotion(v: string): Promise<unknown> } } }).parachute;
    let ended: unknown = "still waiting";
    kit.vaults.importNotion("kitchen").then(() => { ended = "answered"; }, (e: Error) => { ended = e.message; });
    await new Promise((r) => setTimeout(r, 30));
    expect(sent.some((m) => m.method === "importNotion")).toBe(true);
    expect(ended).toBe("still waiting");
  });
});
