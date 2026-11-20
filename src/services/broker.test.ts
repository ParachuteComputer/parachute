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
  cardView: async (_s, _v, e) => ({ kind: null, event_id: e.id, refused: "no", rows: [] }), cardAnswer: async () => ({ wraps: [], graced: false, summary: "" }), cardSent: async () => {},
  secretView: async () => { throw new Error("no"); }, secretSend: async () => ev("w"), secretForget: async () => ev("w"), cardTrust: async () => {},
  keyring: async () => ({ everyday: "", approval: "", same: true, seal_pub: "", approvers: [] }),
  approvalSign: async () => { throw new Error("no"); }, passcodeSet: async () => {},
  levelsStatus: async () => { throw new Error("no"); }, levelsRaise: async () => { throw new Error("no"); }, levelsLower: async () => { throw new Error("no"); },
  levelsAdopt: async () => { throw new Error("no"); }, idleTouch: async () => { throw new Error("no"); }, idleUnlock: async () => { throw new Error("no"); },
});
const relay: Service = { id: "rooms", kind: "nostr-relay", url: "wss://relay.example", publish: [9], media: false, private: [] };
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

function setup(n: Native = native()) {
  FakeSocket.all = [];
  const emitted: { event: string; data: any }[] = [];
  const b = createBroker({ native: n, session: "s", applet: { name: "Rooms", subject: "v\u0000n" }, services: [relay], hubs: [], emit: (event, data) => emitted.push({ event, data }), socket: (u) => new FakeSocket(u) as unknown as WebSocket });
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
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
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

  it("sends nothing before a slow sign-in finishes (the relay asked for one)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const slow = native();
      slow.relayAuth = () => new Promise((r) => setTimeout(() => r({ ...ev("auth"), kind: 22242 }), 6000));
      const { b } = setup(slow);
      b.subscribe({ service: "rooms", sub: "a", filters: [{ kinds: [9] }] });
      await vi.advanceTimersByTimeAsync(1);
      const sock = FakeSocket.all[0];
      sock.from(["AUTH", "challenge"]);
      await vi.advanceTimersByTimeAsync(5000);
      expect(sock.reqs()).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(1500);
      sock.from(["OK", "auth", true, ""]);
      expect(sock.reqs()).toHaveLength(1);
    } finally { vi.useRealTimers(); }
  });

  it("doesn't send later a post it said had failed when the connection dropped", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const { b } = setup();
      const posted = b.publish({ service: "rooms", event: { kind: 9, content: "hello", tags: [["h", "r"]] } });
      await vi.advanceTimersByTimeAsync(1);
      const first = FakeSocket.all[0];
      first.onclose?.();
      await expect(posted).resolves.toMatchObject({ ok: false });
      await vi.advanceTimersByTimeAsync(1100);
      const second = FakeSocket.all[1];
      await signIn(second, () => vi.advanceTimersByTimeAsync(1));
      expect(second.sent.some((m) => Array.isArray(m) && m[0] === "EVENT")).toBe(false);
    } finally { vi.useRealTimers(); }
  });

  it("doesn't send a post queued behind a sign-in the relay refused, nor one it said had timed out", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const slow = native();
      slow.relayAuth = () => new Promise((r) => setTimeout(() => r({ ...ev("auth"), kind: 22242 }), 12_000));
      const { b } = setup(slow);
      const late = b.publish({ service: "rooms", event: { kind: 9, content: "late", tags: [["h", "r"]] } });
      await vi.advanceTimersByTimeAsync(1);
      const sock = FakeSocket.all[0];
      sock.from(["AUTH", "challenge"]);
      // the sign-in takes longer than a post waits: it is told it failed
      await vi.advanceTimersByTimeAsync(10_500);
      await expect(late).resolves.toMatchObject({ ok: false });
      await vi.advanceTimersByTimeAsync(2000);
      const refused = b.publish({ service: "rooms", event: { kind: 9, content: "refused", tags: [["h", "r"]] } });
      await vi.advanceTimersByTimeAsync(1);
      sock.from(["OK", "auth", false, "restricted: not a member"]);
      await expect(refused).resolves.toMatchObject({ ok: false });
      // a later sign-in on this connection sends neither
      sock.from(["OK", "auth", true, ""]);
      expect(sock.sent.some((m) => Array.isArray(m) && m[0] === "EVENT")).toBe(false);
    } finally { vi.useRealTimers(); }
  });

  it("keeps under a relay's rate: a burst, then paced; a post goes before waiting subscriptions", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    try {
      const { b } = setup();
      b.subscribe({ service: "rooms", subs: Array.from({ length: 40 }, (_, i) => ({ sub: `r${i}`, filters: [{ kinds: [9], "#h": [`room-${i}`] }] })) });
      b.subscribe({ service: "rooms", subs: Array.from({ length: 30 }, (_, i) => ({ sub: `q${i}`, filters: [{ kinds: [9], "#h": [`more-${i}`] }] })) });
      await vi.advanceTimersByTimeAsync(1);
      const sock = FakeSocket.all[0];
      await signIn(sock, () => vi.advanceTimersByTimeAsync(1));
      expect(sock.reqs()).toHaveLength(10);
      const posted = b.publish({ service: "rooms", event: { kind: 9, content: "now", tags: [["h", "room-0"]] } });
      await vi.advanceTimersByTimeAsync(200);
      // the next message out is the post, ahead of the 40 subscriptions still waiting
      const after = sock.sent.slice(sock.sent.findIndex((m) => Array.isArray(m) && m[0] === "REQ") + 10);
      expect(after[0]).toMatchObject(["EVENT", { content: "now" }]);
      sock.from(["OK", (after[0] as unknown[] as [string, { id: string }])[1].id, true, ""]);
      await expect(posted).resolves.toMatchObject({ ok: true });
      // at most 45 counted messages in any 5 s (Buzz allows 50 a person, in a fixed window): checked over the whole run
      const at: number[] = [];
      const send = sock.send.bind(sock);
      sock.send = (x: string) => { if (/^\["(REQ|EVENT)"/.test(x)) at.push(Date.now()); send(x); };
      await vi.advanceTimersByTimeAsync(15_000);
      expect(sock.reqs()).toHaveLength(70);
      const all = [...Array(10 + 1).fill(0), ...at]; // the burst and the post went out at the start
      for (const t0 of at) expect(all.filter((t) => t >= t0 - 5000 && t <= t0).length).toBeLessThanOrEqual(45);
    } finally { vi.useRealTimers(); }
  });

  it("never closes a subscription the relay hasn't been sent yet (its CLOSE would overtake its REQ)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    try {
      const { b } = setup();
      b.subscribe({ service: "rooms", subs: Array.from({ length: 20 }, (_, i) => ({ sub: `r${i}`, filters: [{ kinds: [9], "#h": [`room-${i}`] }] })) });
      await vi.advanceTimersByTimeAsync(1);
      const sock = FakeSocket.all[0];
      await signIn(sock, () => vi.advanceTimersByTimeAsync(1));
      b.unsubscribe({ service: "rooms", subs: ["r0", "r19"] });
      await vi.advanceTimersByTimeAsync(5000);
      const ids = (t: string) => sock.sent.filter((m) => Array.isArray(m) && m[0] === t).map((m) => (m as string[])[1]);
      expect(ids("CLOSE")).toEqual(["a:r0"]);
      expect(ids("REQ")).not.toContain("a:r19");
      expect(ids("REQ")).toHaveLength(19);
    } finally { vi.useRealTimers(); }
  });

  it("sends a one-time read ahead of live subscriptions still waiting to go out", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    try {
      const { b } = setup();
      b.subscribe({ service: "rooms", subs: Array.from({ length: 40 }, (_, i) => ({ sub: `r${i}`, filters: [{ kinds: [9], "#h": [`room-${i}`] }] })) });
      await vi.advanceTimersByTimeAsync(1);
      const sock = FakeSocket.all[0];
      await signIn(sock, () => vi.advanceTimersByTimeAsync(1));
      void b.query({ service: "rooms", filters: [{ kinds: [9], "#h": ["opened-room"], limit: 150 }] });
      await vi.advanceTimersByTimeAsync(200);
      const reqs = sock.reqs();
      expect(reqs.findIndex((r) => JSON.stringify(r).includes("opened-room"))).toBe(10);
    } finally { vi.useRealTimers(); }
  });
});

describe("a tap the device's gate refused", () => {
  // the shell's tap (views/ShellSheets.tsx useTapOnce): one call per tap; `untap` gives it back
  const oneTap = () => { let left = 1; return { tap: () => (left > 0 ? (left--, true) : false), untap: () => { left = 1; }, secret: async () => null, say: () => {}, trust: async () => null, passcode: async () => null as string | null }; };
  const mail: Service = { id: "mail", kind: "http", url: "https://mail.example/mail/", auth: "nip98", approve: { field: "op", ops: ["send.approve"] } };
  const approve = { service: "mail", path: "op", method: "POST", body: JSON.stringify({ op: "send.approve", opId: "x" }) };
  const broker = (http: Native["http"], shell: ReturnType<typeof oneTap>) =>
    createBroker({ native: { ...native(), http }, session: "s", applet: { name: "Mail", subject: "v\u0000m" }, services: [mail], hubs: [], emit: () => {}, shell });

  it("paid for nothing: after a cancelled unlock the person's next tap counts", async () => {
    const shell = oneTap();
    let calls = 0;
    const b = broker(async () => { if (++calls === 1) throw { code: "unlock", message: "The device unlock was cancelled or failed." }; return { status: 200, headers: {}, body: "" }; }, shell);
    await expect(b.fetch(approve)).rejects.toMatchObject({ code: "unlock" });
    await expect(b.fetch(approve)).resolves.toMatchObject({ status: 200 });
    expect(calls).toBe(2);
  });

  it("paid for nothing: a passcode sheet the person cancelled", async () => {
    const shell = oneTap();
    let calls = 0;
    const b = broker(async (_s, _v, _r, code) => { calls++; if (!code) throw { code: "passcode", message: "Your passcode is needed for this." }; return { status: 200, headers: {}, body: "" }; }, shell);
    await expect(b.fetch(approve)).rejects.toThrow("Cancelled: nothing was sent.");
    shell.passcode = async () => "1234";
    await expect(b.fetch(approve)).resolves.toMatchObject({ status: 200 });
  });

  it("a request that went out keeps its tap spent, even when it failed", async () => {
    const shell = oneTap();
    const b = broker(async () => { throw { code: "failed", message: "the gateway didn't answer" }; }, shell);
    await expect(b.fetch(approve)).rejects.toMatchObject({ code: "failed" });
    await expect(b.fetch(approve)).rejects.toThrow("an approval needs your tap in the applet");
  });
});
