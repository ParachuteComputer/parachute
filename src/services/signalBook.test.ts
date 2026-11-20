// The rules behind the bar's counts (signalBook.ts), each a test that fails if broken. The gateway here keeps numbers
// as services/push-gateway does (one per subject and signal, with when it last moved, every number answered); only
// the network is left out.
import { afterEach, describe, expect, it } from "vitest";
import { SignalBook, type BookLit, type GatewayCall, type SetItem } from "./signalBook";
import type { Signal } from "../applet/signals";

const GW = "https://push.example/";
const ideas: Signal = { id: "new", name: "new ideas from others", from: { kind: "vault", path: "Ideas/", others: true }, via: GW };
const mail: Signal = { id: "unread", name: "unread mail", from: { kind: "feed", service: "mail", feed: "unread" }, via: GW };
const rooms: Signal = { id: "for-you", name: "mentions", from: { kind: "relay", service: "rooms" }, via: GW };
const lit = (noteId: string, signal: Signal): BookLit => ({ key: `home\u0000${noteId}\u0000${signal.id}`, vaultKey: "home", noteId, gid: `gid-of-${noteId}`, signal });

/** A gateway as the real one keeps numbers; `sent` is every set it was told. */
function gateway(clock: () => number) {
  const counts = new Map<string, { subject: string; signal: string; count: number; at: number }>();
  const sent: SetItem[][] = [];
  let down = false;
  const call: GatewayCall = async (_g, set) => {
    if (down) throw new Error("no answer");
    sent.push(set);
    for (const c of set) counts.set(`${c.subject} ${c.signal}`, { ...c, at: Math.floor(clock() / 1000) });
    return { counts: [...counts.values()] };
  };
  return { call, sent, counts, set: (subject: string, signal: string, count: number, at: number) => counts.set(`${subject} ${signal}`, { subject, signal, count, at }), down: (d: boolean) => { down = d; } };
}
const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } }; };
const books: SignalBook[] = [];
const make = (gw: ReturnType<typeof gateway>, clock: () => number, storage = memory()) => { const b = new SignalBook(storage, gw.call, clock, 60_000, 60_000); books.push(b); return b; };
afterEach(() => { books.splice(0).forEach((b) => b.stop()); });

describe("the bar's counts", () => {
  it("count notes someone else made since the applet was last seen, and tell the gateway the number only", async () => {
    let t = Date.parse("2026-11-19T10:00:00Z");
    const gw = gateway(() => t), b = make(gw, () => t);
    b.setLit([lit("I", ideas)]);
    t += 60_000;
    b.notes(lit("I", ideas).key, [
      { createdAt: "2026-11-19T09:00:00Z", createdBy: "friend" },  // before it was lit: not new
      { createdAt: "2026-11-19T10:00:30Z", createdBy: "friend" },
      { createdAt: "2026-11-19T10:00:40Z", createdBy: "me" },      // the person's own
    ], "me");
    expect(b.badge("home", "I")).toBe(1);
    await b.exchange();
    expect(gw.sent.flat()).toEqual([{ subject: "gid-of-I", signal: "new", count: 1 }]);
  });

  it("a fresh device with nothing new sends no 0 (it would clear the person's phone for nothing)", async () => {
    const t = Date.parse("2026-11-19T10:00:00Z");
    const gw = gateway(() => t), b = make(gw, () => t);
    gw.set("gid-of-I", "new", 3, t / 1000 - 10);
    b.setLit([lit("I", ideas)]);
    b.notes(lit("I", ideas).key, [], "me");
    await b.exchange();
    expect(gw.sent.flat()).toEqual([]);
    expect(gw.counts.get("gid-of-I new")?.count).toBe(3);
  });

  it("an applet opened from a cold start is seen once its signals are read, and the 0 reaches the gateway", async () => {
    let t = Date.parse("2026-11-19T10:00:00Z");
    const gw = gateway(() => t), store = memory();
    const first = make(gw, () => t, store);
    first.setLit([lit("I", ideas)]);
    first.notes(lit("I", ideas).key, [{ createdAt: "2026-11-19T10:00:05Z", createdBy: "friend" }], "me");
    await first.exchange();
    expect(gw.counts.get("gid-of-I new")?.count).toBe(1);
    // the app starts again from the notification's tap: Ideas is in front before its signals are known
    t += 60_000;
    const again = make(gw, () => t, store);
    again.setFront("home", "I");
    again.setLit([lit("I", ideas)]);
    again.notes(lit("I", ideas).key, [{ createdAt: "2026-11-19T10:00:05Z", createdBy: "friend" }, { createdAt: "2026-11-19T10:00:59Z", createdBy: "friend" }], "me");
    expect(again.badge("home", "I")).toBe(0);
    await again.exchange();
    expect(gw.counts.get("gid-of-I new")?.count).toBe(0);
    // and while it stays in front, what arrives is seen
    t += 1_000;
    again.notes(lit("I", ideas).key, [{ createdAt: new Date(t - 10).toISOString(), createdBy: "friend" }], "me");
    expect(again.badge("home", "I")).toBe(0);
  });

  it("an applet's own number isn't cleared by opening it: Mail says what is still unread", async () => {
    const t = Date.parse("2026-11-19T10:00:00Z");
    const gw = gateway(() => t), b = make(gw, () => t);
    b.setLit([lit("M", mail)]);
    expect(b.own("home", "M", "unread", 5)).toBe(true);
    b.setFront("home", "M");
    b.setFront(null, null);
    expect(b.badge("home", "M")).toBe(5);
    expect(b.own("home", "M", "nope", 1)).toBe(false);
    await b.exchange();
    expect(gw.counts.get("gid-of-M unread")?.count).toBe(5);
  });

  it("another device's open counts as seen here; a gateway's clock can't put seen in the future", async () => {
    let t = Date.parse("2026-11-19T10:00:00Z");
    const gw = gateway(() => t), b = make(gw, () => t);
    b.setLit([lit("I", ideas)]);
    t += 120_000;
    const later = [{ createdAt: "2026-11-19T10:01:00Z", createdBy: "friend" }];
    b.notes(lit("I", ideas).key, later, "me");
    expect(b.badge("home", "I")).toBe(1);
    await b.exchange();
    // the phone opened Ideas at 10:01:30
    gw.set("gid-of-I", "new", 0, Date.parse("2026-11-19T10:01:30Z") / 1000);
    await b.exchange();
    expect(b.badge("home", "I")).toBe(0);
    // a 0 dated next year is taken as now: a note after now still counts
    gw.set("gid-of-I", "new", 0, Date.parse("2027-11-19T10:00:00Z") / 1000);
    await b.exchange();
    t += 60_000;
    b.notes(lit("I", ideas).key, [...later, { createdAt: new Date(t - 1_000).toISOString(), createdBy: "friend" }], "me");
    expect(b.badge("home", "I")).toBe(1);
  });

  it("a relay's number comes from the gateway, and is 0 while Rooms is in front", async () => {
    const t = Date.parse("2026-11-19T10:00:00Z");
    const gw = gateway(() => t), b = make(gw, () => t);
    gw.set("gid-of-R", "for-you", 2, t / 1000);
    b.setLit([lit("R", rooms)]);
    await b.exchange();
    expect(b.badge("home", "R")).toBe(2);
    expect(gw.sent.flat(), "what the gateway said isn't told back").toEqual([]);
    b.setFront("home", "R");
    expect(b.badge("home", "R")).toBe(0);
    await b.exchange();
    expect(gw.counts.get("gid-of-R for-you")?.count).toBe(0);
    // a mention while Rooms is on screen: the gateway counts it; here it is seen, and the 0 goes back
    gw.set("gid-of-R", "for-you", 1, t / 1000);
    await b.exchange();
    await b.exchange();
    expect(b.badge("home", "R")).toBe(0);
    expect(gw.counts.get("gid-of-R for-you")?.count).toBe(0);
  });

  it("a number that couldn't be sent is kept and sent later; an older answer doesn't undo a newer number here", async () => {
    const t = Date.parse("2026-11-19T10:00:00Z");
    const gw = gateway(() => t), b = make(gw, () => t);
    b.setLit([lit("M", mail)]);
    gw.down(true);
    b.own("home", "M", "unread", 4);
    await b.exchange();
    gw.down(false);
    await b.exchange();
    expect(gw.counts.get("gid-of-M unread")?.count).toBe(4);
    // the gateway still says 4 while this device has moved to 2 and not sent it yet
    const slow = new SignalBook(memory(), async () => ({ counts: [{ subject: "gid-of-M", signal: "unread", count: 4, at: t / 1000 }] }), () => t, 60_000, 60_000);
    books.push(slow);
    slow.setLit([lit("M", mail)]);
    slow.own("home", "M", "unread", 4);
    const answering = slow.exchange();
    slow.own("home", "M", "unread", 2);
    await answering;
    expect(slow.badge("home", "M")).toBe(2);
  });
});
