// The broker over a relay that asks for sign-in, with a stand-in socket and a stand-in native side (the real ones are
// tested in e2e/services.spec.ts and src-tauri/tests). What is held here: a subscription made before the sign-in goes
// out once; a live subscription stays open however many events pass through it; nothing connects after close.
import { describe, expect, it, vi } from "vitest";
import { createBroker, TAP_AGAIN } from "./broker";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import type { Native, SignedEvent } from "./native";
import type { Service } from "../applet/services";

class FakeSocket {
  static all: FakeSocket[] = [];
  /** the network away: a new socket closes without opening */
  static refuse = false;
  sent: unknown[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((m: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(public url: string) { FakeSocket.all.push(this); setTimeout(() => (FakeSocket.refuse ? this.onclose?.() : this.onopen?.()), 0); }
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

/** every broker a test made: closed before the next test's, so none of them reconnects into another test */
const made: { close(): void }[] = [];
function setup(n: Native = native(), services: Service[] = [relay]) {
  made.splice(0).forEach((x) => x.close());
  FakeSocket.all = []; FakeSocket.refuse = false;
  const emitted: { event: string; data: any }[] = [];
  const b = createBroker({ native: n, session: "s", applet: { name: "Rooms", subject: "v\u0000n" }, services, hubs: [], emit: (event, data) => emitted.push({ event, data }), socket: (u) => new FakeSocket(u) as unknown as WebSocket });
  made.push(b);
  return { b, emitted };
}
async function signIn(sock: FakeSocket, wait: () => Promise<unknown> = () => tick()) {
  sock.from(["AUTH", "challenge"]);
  await wait();
  sock.from(["OK", "auth", true, ""]);
}

describe("what the broker asks the shell to sign", () => {
  it("refuses a bot's /approve in any kind it declared, without the approvals grant, before anything is signed", async () => {
    const n = native();
    const signEvent = vi.spyOn(n, "signEvent");
    const { b } = setup(n, [{ ...relay, publish: [1, 9, 40003] } as Service]);
    for (const kind of [9, 40003, 1]) {
      await expect(b.publish({ service: "rooms", event: { kind, content: "/approve", tags: [["h", "r"]] } }), `kind ${kind}`).rejects.toMatchObject({ code: "not_granted" });
    }
    await expect(b.publish({ service: "rooms", event: { kind: 27235, content: "", tags: [] } })).rejects.toMatchObject({ code: "out_of_scope" });
    expect(signEvent).not.toHaveBeenCalled();
  });
});

describe("a post signed before, sent as it is (a retry keeps its id: T-476)", () => {
  const sk = generateSecretKey();
  const real = (): Native => ({ ...native(), open: async () => ({ pubkey: getPublicKey(sk) }), signEvent: async (_s, _v, t) => finalizeEvent({ ...t, created_at: Math.floor(Date.now() / 1000) }, sk) as SignedEvent });
  const sent = (sock: FakeSocket) => sock.sent.filter((m) => Array.isArray(m) && m[0] === "EVENT").map((m) => (m as [string, SignedEvent])[1]);

  it("signs without sending; publishing that event sends it whole, and again on a retry, the same id each time", async () => {
    const { b } = setup(real());
    b.subscribe({ service: "rooms", sub: "a", filters: [{ kinds: [9] }] });
    await tick();
    const sock = FakeSocket.all[0];
    await signIn(sock);
    const ev = await b.sign({ service: "rooms", event: { kind: 9, content: "kept", tags: [["h", "r"]] } });
    await tick(5);
    expect(sent(sock)).toHaveLength(0);
    const first = b.publish({ service: "rooms", event: { ...ev } });
    await tick(5);
    sock.from(["OK", ev.id, false, "error: try later"]);
    await expect(first).resolves.toMatchObject({ ok: false });
    const second = b.publish({ service: "rooms", event: { ...ev } });
    await tick(5);
    sock.from(["OK", ev.id, true, "duplicate:"]);
    await expect(second).resolves.toMatchObject({ ok: true, id: ev.id });
    expect(sent(sock).map((e) => e.id)).toEqual([ev.id, ev.id]);
    expect(sent(sock)[1]).toMatchObject({ id: ev.id, pubkey: ev.pubkey, created_at: ev.created_at, kind: 9, content: "kept", tags: ev.tags, sig: ev.sig });
  });

  it("refuses one changed after signing, another key's, one outside its kinds, or one with more than an event's fields", async () => {
    const { b } = setup(real());
    const ev = await b.sign({ service: "rooms", event: { kind: 9, content: "kept", tags: [["h", "r"]] } });
    await expect(b.publish({ service: "rooms", event: { ...ev, content: "changed" } })).rejects.toMatchObject({ code: "out_of_scope" });
    const other = finalizeEvent({ kind: 9, created_at: Math.floor(Date.now() / 1000), content: "theirs", tags: [["h", "r"]] }, generateSecretKey());
    await expect(b.publish({ service: "rooms", event: other })).rejects.toMatchObject({ code: "out_of_scope" });
    const reaction = finalizeEvent({ kind: 7, created_at: Math.floor(Date.now() / 1000), content: "+", tags: [["h", "r"]] }, sk);
    await expect(b.publish({ service: "rooms", event: reaction })).rejects.toMatchObject({ code: "out_of_scope" });
    await expect(b.publish({ service: "rooms", event: { ...ev, extra: 1 } })).rejects.toMatchObject({ code: "bad_params" });
  });

  it("a bot's /approve signed earlier and sent again from storage needs its own tap; one signed in this session was paid for when signed", async () => {
    const svc: Service = { ...relay, approvals: { from: ["c".repeat(64)] } } as Service;
    let taps = 0;
    const shell = { tap: () => (taps-- > 0 ? true as const : false), secret: async () => null, say: () => {}, trust: async () => null, passcode: async () => null };
    FakeSocket.all = []; FakeSocket.refuse = false;
    const mk = () => createBroker({ native: real(), session: "s", applet: { name: "Rooms", subject: "v\u0000n" }, services: [svc], hubs: [], emit: () => {}, socket: (u) => new FakeSocket(u) as unknown as WebSocket, shell });
    const b = mk();
    taps = 1;
    const ev = await b.sign({ service: "rooms", event: { kind: 9, content: "/approve", tags: [["h", "r"]] } });
    // the same session sends it without another tap
    void b.publish({ service: "rooms", event: { ...ev } });
    await tick(5);
    // a new session (the app started again) holds it from storage: the retry is a tap
    const later = mk();
    await expect(later.publish({ service: "rooms", event: { ...ev } })).rejects.toMatchObject({ code: "not_granted" });
    taps = 1;
    void later.publish({ service: "rooms", event: { ...ev } });
    await tick(5);
    b.close(); later.close();
  });
});

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

  it("sends a post in flight again, the same event, when a dropped connection comes back, and resolves it on that OK (T-476)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const { b } = setup();
      b.subscribe({ service: "rooms", sub: "a", filters: [{ kinds: [9] }] });
      await vi.advanceTimersByTimeAsync(1);
      const first = FakeSocket.all[0];
      await signIn(first, () => vi.advanceTimersByTimeAsync(1));
      const posted = b.publish({ service: "rooms", event: { kind: 9, content: "hello", tags: [["h", "r"]] } });
      await vi.advanceTimersByTimeAsync(1);
      const sent = first.sent.find((m) => Array.isArray(m) && m[0] === "EVENT") as [string, SignedEvent];
      expect(sent).toBeTruthy();
      // the connection drops before the relay's OK (Aaron's "connection closed"): not told it failed
      first.onclose?.();
      let told: unknown = null;
      void posted.then((r) => { told = r; });
      await vi.advanceTimersByTimeAsync(1100);
      expect(told).toBeNull();
      const second = FakeSocket.all[1];
      await signIn(second, () => vi.advanceTimersByTimeAsync(1));
      await vi.advanceTimersByTimeAsync(1);
      const again = second.sent.filter((m) => Array.isArray(m) && m[0] === "EVENT") as [string, SignedEvent][];
      expect(again).toHaveLength(1);
      expect(JSON.stringify(again[0][1])).toBe(JSON.stringify(sent[1]));
      // the relay had it from the first time
      second.from(["OK", sent[1].id, true, "duplicate:"]);
      await expect(posted).resolves.toMatchObject({ ok: true, id: sent[1].id });
    } finally { vi.useRealTimers(); }
  });

  it("doesn't send later a post told it failed: the connection didn't come back within its wait", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const { b } = setup();
      const posted = b.publish({ service: "rooms", event: { kind: 9, content: "hello", tags: [["h", "r"]] } });
      await vi.advanceTimersByTimeAsync(1);
      FakeSocket.refuse = true;
      FakeSocket.all[0].onclose?.();
      await vi.advanceTimersByTimeAsync(15_500);
      await expect(posted).resolves.toMatchObject({ ok: false, message: "can't reach the relay" });
      FakeSocket.refuse = false;
      await vi.advanceTimersByTimeAsync(31_000);
      const back = FakeSocket.all[FakeSocket.all.length - 1];
      await signIn(back, () => vi.advanceTimersByTimeAsync(1));
      await vi.advanceTimersByTimeAsync(1);
      expect(back.sent.some((m) => Array.isArray(m) && m[0] === "EVENT")).toBe(false);
    } finally { vi.useRealTimers(); }
  });

  it("woken (the network back, the app in front), connects at once instead of waiting out its pause; a post does too", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const { b } = setup();
      b.subscribe({ service: "rooms", sub: "a", filters: [{ kinds: [9] }] });
      await vi.advanceTimersByTimeAsync(1);
      FakeSocket.refuse = true;
      FakeSocket.all[0].onclose?.();
      // a few tries while away: the pause grows to 8 s
      await vi.advanceTimersByTimeAsync(1000 + 2000 + 4000 + 10);
      const tries = FakeSocket.all.length;
      FakeSocket.refuse = false;
      window.dispatchEvent(new Event("online"));
      await vi.advanceTimersByTimeAsync(1);
      expect(FakeSocket.all.length).toBe(tries + 1);
      await signIn(FakeSocket.all[tries], () => vi.advanceTimersByTimeAsync(1));
      expect(FakeSocket.all[tries].reqs().map((r) => r[1])).toEqual(["a:a"]);
      // away again, then a post: it doesn't wait for the pause either
      FakeSocket.refuse = true;
      FakeSocket.all[tries].onclose?.();
      await vi.advanceTimersByTimeAsync(1000 + 2000 + 10);
      FakeSocket.refuse = false;
      const n = FakeSocket.all.length;
      void b.publish({ service: "rooms", event: { kind: 9, content: "now", tags: [["h", "r"]] } });
      await vi.advanceTimersByTimeAsync(1);
      expect(FakeSocket.all.length).toBe(n + 1);
    } finally { vi.useRealTimers(); }
  });

  it("back in front after a while, an open connection that gives no sign of life is dropped for a new one; the post goes on it", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const vis = vi.spyOn(document, "visibilityState", "get");
    try {
      const { b } = setup();
      b.subscribe({ service: "rooms", sub: "a", filters: [{ kinds: [9] }] });
      await vi.advanceTimersByTimeAsync(1);
      const first = FakeSocket.all[0];
      await signIn(first, () => vi.advanceTimersByTimeAsync(1));
      vis.mockReturnValue("hidden"); document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(60_000);
      // the socket died while the phone slept: it says nothing, and sending on it goes nowhere
      vis.mockReturnValue("visible"); document.dispatchEvent(new Event("visibilitychange"));
      const probe = first.reqs().at(-1)!;
      expect(probe[2]).toMatchObject({ limit: 1 });
      const posted = b.publish({ service: "rooms", event: { kind: 9, content: "after waking", tags: [["h", "r"]] } });
      await vi.advanceTimersByTimeAsync(4010);
      const second = FakeSocket.all[1];
      expect(second).toBeTruthy();
      await vi.advanceTimersByTimeAsync(1);
      await signIn(second, () => vi.advanceTimersByTimeAsync(1));
      await vi.advanceTimersByTimeAsync(1);
      const ev = second.sent.find((m) => Array.isArray(m) && m[0] === "EVENT") as [string, SignedEvent];
      expect(ev[1].content).toBe("after waking");
      second.from(["OK", ev[1].id, true, ""]);
      await expect(posted).resolves.toMatchObject({ ok: true });
    } finally { vis.mockRestore(); vi.useRealTimers(); }
  });

  it("an open connection that answers the sign-of-life is kept", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const vis = vi.spyOn(document, "visibilityState", "get");
    try {
      const { b } = setup();
      b.subscribe({ service: "rooms", sub: "a", filters: [{ kinds: [9] }] });
      await vi.advanceTimersByTimeAsync(1);
      const first = FakeSocket.all[0];
      await signIn(first, () => vi.advanceTimersByTimeAsync(1));
      vis.mockReturnValue("hidden"); document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(60_000);
      vis.mockReturnValue("visible"); document.dispatchEvent(new Event("visibilitychange"));
      first.from(["EOSE", first.reqs().at(-1)![1]]);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(FakeSocket.all).toHaveLength(1);
    } finally { vis.mockRestore(); vi.useRealTimers(); }
  });

  it("doesn't send a post queued behind a sign-in the relay refused, nor one it said had timed out", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const slow = native();
      slow.relayAuth = () => new Promise((r) => setTimeout(() => r({ ...ev("auth"), kind: 22242 }), 17_000));
      const { b } = setup(slow);
      const late = b.publish({ service: "rooms", event: { kind: 9, content: "late", tags: [["h", "r"]] } });
      await vi.advanceTimersByTimeAsync(1);
      const sock = FakeSocket.all[0];
      sock.from(["AUTH", "challenge"]);
      // the sign-in takes longer than a post waits: it is told it failed
      await vi.advanceTimersByTimeAsync(15_500);
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

describe("a tap that already paid", () => {
  // the shell's tap (views/ShellSheets.tsx useTapOnce): true once, then "again" for its few seconds
  const oneTap = () => { let left = 1; return { tap: () => (left-- > 0 ? true : "again" as const), secret: async () => null, say: () => {}, trust: async () => null, passcode: async () => null }; };
  const mail: Service = { id: "mail", kind: "http", url: "https://mail.example/mail/", auth: "nip98", approve: { field: "op", ops: ["send.approve"] } };
  const approve = { service: "mail", path: "op", method: "POST", body: JSON.stringify({ op: "send.approve", opId: "x" }) };

  it("pays for one approve: a retry at once after a cancelled unlock says to tap again in a moment, and asks nothing", async () => {
    let calls = 0;
    const http: Native["http"] = async () => { calls++; throw { code: "unlock", message: "The device unlock was cancelled or failed." }; };
    const b = createBroker({ native: { ...native(), http }, session: "s", applet: { name: "Mail", subject: "v\u0000m" }, services: [mail], hubs: [], emit: () => {}, shell: oneTap() });
    await expect(b.fetch(approve)).rejects.toMatchObject({ code: "unlock" });
    await expect(b.fetch(approve)).rejects.toThrow(TAP_AGAIN);
    expect(calls).toBe(1);
  });

  it("no tap at all still says it needs one", async () => {
    const b = createBroker({ native: native(), session: "s", applet: { name: "Mail", subject: "v\u0000m" }, services: [mail], hubs: [], emit: () => {}, shell: { ...oneTap(), tap: () => false } });
    await expect(b.fetch(approve)).rejects.toThrow("an approval needs your tap in the applet");
  });
});
