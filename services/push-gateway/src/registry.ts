// Registrations: who asked to be told about what, and where to push. Kept in one JSON file, written whole and renamed
// into place. A registration lives 30 days unless the app registers again (it does at each start); a key the person
// forgot can't sign an unregister, so registrations end on their own.
//
// A new key's registration is *pending* until the relay's member lists (kind 39002, signed by the relay) show the key
// in some room: the next read of them confirms it or drops it (watch.ts calls `judge`). Pending ones are a small pool
// of their own, oldest dropped first, so keys no room has can't crowd out the people the gateway serves.
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { keysOk, type Keys } from "./webpush.ts";
import { endpointOk, relayKey } from "./urls.ts";
import { parseRegSignals, type RegSignal } from "./signals.ts";

export const TTL_S = 30 * 24 * 3600;
export const LIMITS = { perKey: 8, total: 20_000, pending: 200, rooms: 50, from: 4, endpoint: 1024 };
const HEX_KEY = /^[0-9a-f]{64}$/;
export const ROOM_ID = /^[A-Za-z0-9_-]{1,64}$/;

export type Reg = {
  pubkey: string;
  endpoint: string;
  keys: Keys;
  relay: string;
  rooms: string[] | null;
  mentions: boolean;
  from: string[];
  /** When it was made: only messages from then on are pushed (a few seconds' grace for clocks). */
  created: number;
  expires: number;
  /** Not yet seen in any of the relay's member lists (absent: confirmed, as in a file written before this mark). */
  pending?: true;
  /** Which applet's signal a message for the person counts toward (signals.ts), by room. Absent: none. */
  signals?: RegSignal[];
};

const plain = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);

export type Opts = { relays: string[]; allowLoopback: boolean; privateHosts?: string[] };
type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/** The body of POST /register: {endpoint, keys: {p256dh, auth}, relay, rooms, mentions, from, signals?}. A field this
 *  gateway doesn't know (an app newer than it) is left out, never refused: what is kept is only what is read here
 *  (README.md, "Older and newer apps"). */
export function parseRegister(x: unknown, pubkey: string, opts: Opts, now: number): Parsed<Reg> {
  if (!plain(x)) return { ok: false, error: "a registration is {endpoint, keys, relay, rooms, mentions, from, signals?}" };
  const ep = endpointOk(x.endpoint, opts.allowLoopback, opts.privateHosts);
  if (!ep.ok) return ep;
  if (!keysOk(x.keys)) return { ok: false, error: "keys is {p256dh, auth}: the push keys the app's connector made" };
  const relay = typeof x.relay === "string" ? relayKey(x.relay) : null;
  if (!relay || !opts.relays.includes(relay)) return { ok: false, error: "this gateway doesn't watch that relay" };
  let rooms: string[] | null = null;
  if (x.rooms !== null) {
    if (!Array.isArray(x.rooms) || !x.rooms.length || x.rooms.length > LIMITS.rooms || !x.rooms.every((r) => typeof r === "string" && ROOM_ID.test(r)) || new Set(x.rooms).size !== x.rooms.length) {
      return { ok: false, error: `rooms is null (your rooms) or 1 to ${LIMITS.rooms} room ids` };
    }
    rooms = [...(x.rooms as string[])].sort();
  }
  if (typeof x.mentions !== "boolean") return { ok: false, error: "mentions is true or false" };
  if (!Array.isArray(x.from) || x.from.length > LIMITS.from || !x.from.every((k) => typeof k === "string" && HEX_KEY.test(k)) || new Set(x.from).size !== x.from.length) {
    return { ok: false, error: `from is up to ${LIMITS.from} public keys (hex)` };
  }
  if (!x.mentions && !x.from.length) return { ok: false, error: "ask for mentions, or name who you hear from" };
  const signals = parseRegSignals(x.signals, (r) => typeof r === "string" && ROOM_ID.test(r));
  if (!signals.ok) return signals;
  const keys = x.keys as Keys;
  return { ok: true, value: { pubkey, endpoint: ep.value, keys: { p256dh: keys.p256dh, auth: keys.auth }, relay, rooms, mentions: x.mentions, from: [...(x.from as string[])].sort(), created: now, expires: now + TTL_S,
    ...(signals.value.length ? { signals: signals.value } : {}) } };
}

/** The body of POST /unregister: {endpoint, relay} (anything else is left out). */
export function parseUnregister(x: unknown): Parsed<{ endpoint: string; relay: string }> {
  if (!plain(x) || typeof x.endpoint !== "string" || typeof x.relay !== "string") return { ok: false, error: "an unregistration is {endpoint, relay}" };
  const relay = relayKey(x.relay);
  let endpoint: string;
  try { endpoint = new URL(x.endpoint).href; } catch { return { ok: false, error: "an unregistration is {endpoint, relay}" }; }
  if (!relay || x.endpoint.length > LIMITS.endpoint) return { ok: false, error: "an unregistration is {endpoint, relay}" };
  return { ok: true, value: { endpoint, relay } };
}

const same = (a: Reg, b: { pubkey: string; endpoint: string; relay: string }) => a.pubkey === b.pubkey && a.endpoint === b.endpoint && a.relay === b.relay;
const known = (regs: readonly Reg[], pubkey: string, relay: string) => regs.some((x) => x.pubkey === pubkey && x.relay === relay && !x.pending);

export class Registry {
  private regs: Reg[] = [];
  private listeners = new Set<() => void>();
  private readonly file: string | null;

  constructor(file: string | null) {
    this.file = file;
    if (file) {
      try {
        const read = JSON.parse(readFileSync(file, "utf8"));
        if (Array.isArray(read)) this.regs = read;
      } catch { /* none yet */ }
    }
  }

  onChange(f: () => void) { this.listeners.add(f); return () => this.listeners.delete(f); }

  private save() {
    if (this.file) {
      writeFileSync(`${this.file}.tmp`, JSON.stringify(this.regs), { mode: 0o600 });
      renameSync(`${this.file}.tmp`, this.file);
    }
    this.listeners.forEach((f) => f());
  }

  /** The live ones (expired ones are dropped as they are found). */
  all(now: number): Reg[] {
    const live = this.regs.filter((r) => r.expires > now);
    if (live.length !== this.regs.length) { this.regs = live; this.save(); }
    return live;
  }

  /** A key this gateway hasn't confirmed on that relay, making a new registration (what the per-address limit counts). */
  newcomer(r: { pubkey: string; endpoint: string; relay: string }, now: number): boolean {
    const live = this.all(now);
    return !known(live, r.pubkey, r.relay) && !live.some((x) => same(x, r));
  }

  /** Add or replace (same key, endpoint and relay). Refused past the per-key limit, or for a confirmed key past the
   *  total. A key not yet confirmed on that relay goes to the pending pool: when it is full the oldest pending goes. */
  put(r: Reg, now: number): { ok: true; pending: boolean } | { ok: false; error: string } {
    const live = this.all(now);
    const i = live.findIndex((x) => same(x, r));
    if (i < 0 && live.filter((x) => x.pubkey === r.pubkey).length >= LIMITS.perKey) return { ok: false, error: `at most ${LIMITS.perKey} registrations per key` };
    const pending = !known(live, r.pubkey, r.relay);
    const { pending: _, ...plainReg } = r;
    const next: Reg = pending ? { ...plainReg, pending: true } : plainReg;
    if (i < 0 && !pending && live.filter((x) => !x.pending).length >= LIMITS.total) return { ok: false, error: "this gateway is full" };
    if (i >= 0) live[i] = { ...next, created: Math.min(r.created, live[i].created ?? r.created) };
    else live.push(next);
    // the pending pool: oldest made first out (never the one just put)
    const mine = i >= 0 ? live[i] : next;
    let waiting = live.filter((x) => x.pending);
    while (waiting.length > LIMITS.pending) {
      const oldest = waiting.filter((x) => x !== mine).reduce((a, b) => (b.created < a.created ? b : a));
      live.splice(live.indexOf(oldest), 1);
      waiting = live.filter((x) => x.pending);
    }
    this.regs = live;
    this.save();
    return { ok: true, pending };
  }

  /** A read of a relay's member lists finished: `asked` the keys it asked about, `members` everyone the lists it got
   *  name. A pending registration whose key was asked about is confirmed when listed and dropped when not; a confirmed
   *  one stays (it lives out its 30 days). Saves only on a change, so the refresh this starts settles. */
  judge(relay: string, asked: ReadonlySet<string>, members: ReadonlySet<string>): { confirmed: number; dropped: number } {
    let confirmed = 0, dropped = 0;
    const out: Reg[] = [];
    for (const r of this.regs) {
      if (r.relay !== relay || !r.pending || !asked.has(r.pubkey)) { out.push(r); continue; }
      if (members.has(r.pubkey)) { const { pending: _, ...c } = r; out.push(c); confirmed++; }
      else dropped++;
    }
    if (confirmed || dropped) { this.regs = out; this.save(); }
    return { confirmed, dropped };
  }

  remove(k: { pubkey: string; endpoint: string; relay: string }): boolean {
    const before = this.regs.length;
    this.regs = this.regs.filter((x) => !same(x, k));
    if (this.regs.length !== before) this.save();
    return this.regs.length !== before;
  }

  /** The push server said the endpoint is gone (404 or 410): every registration to it goes. */
  dropEndpoint(endpoint: string): number {
    const before = this.regs.length;
    this.regs = this.regs.filter((x) => x.endpoint !== endpoint);
    if (this.regs.length !== before) this.save();
    return before - this.regs.length;
  }
}
