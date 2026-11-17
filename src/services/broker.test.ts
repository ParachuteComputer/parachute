// The broker over a relay that asks for sign-in, with a stand-in socket and a stand-in native side (the real ones are
// tested in e2e/services.spec.ts and src-tauri/tests). What is held here: a subscription made before the sign-in goes
// out once; a live subscription stays open however many events pass through it; nothing connects after close.
import { describe, expect, it, vi } from "vitest";
import { createBroker } from "./broker";
import type { Native, SignedEvent } from "./native";
import type { Service } from "../applet/services";

class FakeSocket {
  static all: FakeSocket[] = [];
  sent: unknown[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((m: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(public url: string) { FakeSocket.all.push(this); setTimeout(() => this.onopen?.(), 0); }
  send(s: string) { this.sent.push(JSON.parse(s)); }
  close() { setTimeout(() => this.onclose?.(), 0); }
  from(m: unknown) { this.onmessage?.({ data: JSON.stringify(m) }); }
  reqs() { return this.sent.filter((m) => Array.isArray(m) && m[0] === "REQ") as unknown[][]; }
}
const ev = (id: string): SignedEvent => ({ id, pubkey: "b".repeat(64), created_at: 1, kind: 9, tags: [["h", "r"]], content: "x", sig: "s" });
const native = (): Native => ({
  open: async () => ({ pubkey: "a".repeat(64) }), close: async () => {},
  relayAuth: async () => ({ ...ev("auth"), kind: 22242 }), signEvent: async (_s, _v, t) => ({ ...ev("e"), ...t, pubkey: "a".repeat(64) }),
  http: async () => ({ status: 200, headers: {}, body: "" }), upload: async () => ({}), media: async () => ({ type: "", body: "" }),
  privateOpen: async () => "", privateSave: async () => ev("p"), tokenSet: async () => {}, tokenHas: async () => false, log: async () => [],
});
const relay: Service = { id: "rooms", kind: "nostr-relay", url: "wss://relay.example", publish: [9], media: false, private: [] };
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

function setup() {
  FakeSocket.all = [];
  const emitted: { event: string; data: any }[] = [];
  const b = createBroker({ native: native(), session: "s", applet: { name: "Rooms", subject: "v\u0000n" }, services: [relay], hubs: [], emit: (event, data) => emitted.push({ event, data }), socket: (u) => new FakeSocket(u) as unknown as WebSocket });
  return { b, emitted };
}
async function signIn(sock: FakeSocket, wait: () => Promise<unknown> = () => tick()) {
  sock.from(["AUTH", "challenge"]);
  await wait();
  sock.from(["OK", "auth", true, ""]);
}

describe("the broker's relay connection", () => {
  it("sends a subscription made before the sign-in once, after it", async () => {
    const { b } = setup();
    b.subscribe({ service: "rooms", subs: [{ sub: "a", filters: [{ kinds: [9], "#h": ["r"] }] }, { sub: "b", filters: [{ kinds: [9], "#h": ["q"] }] }] });
    await tick();
    const sock = FakeSocket.all[0];
    expect(sock.reqs()).toHaveLength(0);
    await signIn(sock);
    expect(sock.reqs().map((r) => r[1])).toEqual(["a:a", "a:b"]);
  });

  it("keeps a live subscription open however many events pass, the frame getting them in batches", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      const { b, emitted } = setup();
      b.subscribe({ service: "rooms", sub: "live", filters: [{ kinds: [9], "#h": ["r"] }] });
      await vi.advanceTimersByTimeAsync(1);
      const sock = FakeSocket.all[0];
      await signIn(sock, () => vi.advanceTimersByTimeAsync(1));
      await vi.advanceTimersByTimeAsync(1);
      sock.from(["EOSE", "a:live"]);
      for (let i = 0; i < 12_000; i++) { sock.from(["EVENT", "a:live", ev(`e${i}`)]); if (i % 100 === 0) await vi.advanceTimersByTimeAsync(60); }
      await vi.advanceTimersByTimeAsync(60);
      const got = emitted.filter((x) => x.event === "services.events").flatMap((x) => x.data.events);
      expect(got).toHaveLength(12_000);
      expect(emitted.some((x) => x.event === "services.status" && x.data.status === "closed")).toBe(false);
      expect(sock.sent.some((m) => Array.isArray(m) && m[0] === "CLOSE")).toBe(false);
      expect(Math.max(...emitted.filter((x) => x.event === "services.events").map((x) => x.data.events.length))).toBeLessThanOrEqual(200);
    } finally { vi.useRealTimers(); }
  });

  it("makes no connection after close, for a call that was on its way", async () => {
    const { b } = setup();
    const query = b.query({ service: "rooms", filters: [{ kinds: [9] }] });
    await tick();
    b.close();
    await expect(b.publish({ service: "rooms", event: { kind: 9, content: "late", tags: [["h", "r"]] } })).rejects.toThrow(/closed/);
    const before = FakeSocket.all.length;
    await tick(5);
    expect(FakeSocket.all.length).toBe(before);
    void query;
  });
});
