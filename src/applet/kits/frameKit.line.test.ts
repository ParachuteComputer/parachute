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
type Kit = { services: Svc; app: { follow(l: string): Promise<boolean> }; storage: { set(k: string, v: unknown): Promise<unknown> } };

function windowWithKit(shell: { postMessage(m: never): void }) {
  const dom = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window as unknown as Window & typeof globalThis & { eval(s: string): unknown };
  Object.defineProperty(w, "parent", { value: shell, configurable: true });
  Object.assign(w, { TextEncoder, TextDecoder });
  w.eval(FRAME_KIT);
  const deliver = (data: unknown) => { const ev = new w.MessageEvent("message", { data }); Object.defineProperty(ev, "source", { value: shell }); w.dispatchEvent(ev); };
  return { kit: (w as unknown as { parachute: Kit }).parachute, deliver };
}
/** A shell that answers nothing until told. */
function frame() {
  const sent: Msg[] = [];
  const shell = { postMessage: (m: Msg) => { sent.push(m); } };
  const { kit, deliver } = windowWithKit(shell as never);
  deliver({ uni: 1, event: "ready", data: { contract: 1, saved: {} } });
  return { kit, sent: () => sent.filter((m) => m.uni === 1 && m.ns), deliver, tick: (ms = 0) => new Promise((r) => setTimeout(r, ms)) };
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
