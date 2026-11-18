// Watching one relay with the gateway's own key. The gateway is a member like any bot: the relay's owner lets its key
// in (kind 9030) and a room's admins add it (kind 9000), and the room's member list shows it. It never holds a
// person's key. It reads the member lists (kind 39002) of the rooms registered people are in, listens in each such
// room it can read (one subscription per room), and hands each new message to match.ts. Each finished read of the
// member lists also tells the registry which keys it asked about and who the lists name (registry.ts `judge`).
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { finalizeEvent } from "nostr-tools/pure";
import { matches, membersOf, type Push } from "./match.ts";
import type { Reg } from "./registry.ts";
import type { Log } from "./push.ts";

const PACE_MS = 150; // Buzz takes about 10 frames a second from one key; one every 150 ms stays under it
const SKEW_S = 10;
const GAP_S = 120;
const REFRESH_MS = 5 * 60_000; // member lists change without an event the gateway can listen for (39002 has no `h`)
const SEEN = 5_000;
const MAX_FILTERS = 10; // what one REQ may carry on Buzz
const PER_FILTER = 100;
const LIMIT = 1000;
const STUCK_MS = 30_000; // a read of the member lists that hasn't finished by then is asked again

/** The filters one read of the member lists sends, and the keys it asks about. Keys the gateway confirmed come first;
 *  keys still pending (registry.ts) get their own filters, as many as the pending pool can fill, so a flood of them
 *  can't push confirmed people out of the read and confirmed people can't keep newcomers from ever being read. Only
 *  confirmed registrations' named rooms are asked for. Pure. */
export function rosterFilters(regs: readonly Reg[], relayKey: string | null, pendingCap: number) {
  const by = relayKey ? { authors: [relayKey] } : {};
  const chunk = (xs: string[], tag: "#p" | "#d") => {
    const out: Record<string, unknown>[] = [];
    for (let i = 0; i < xs.length; i += PER_FILTER) out.push({ kinds: [39002], [tag]: xs.slice(i, i + PER_FILTER), limit: LIMIT, ...by });
    return out;
  };
  const confirmed = [...new Set(regs.filter((r) => !r.pending).map((r) => r.pubkey))];
  const sure = new Set(confirmed);
  const pending = [...new Set(regs.filter((r) => r.pending && !sure.has(r.pubkey)).map((r) => r.pubkey))].slice(0, pendingCap);
  const named = [...new Set(regs.filter((r) => !r.pending).flatMap((r) => r.rooms ?? []))];
  const forPending = chunk(pending, "#p").slice(0, Math.ceil(pendingCap / PER_FILTER));
  const forPeople = chunk(confirmed, "#p").slice(0, MAX_FILTERS - forPending.length);
  const forRooms = chunk(named, "#d").slice(0, MAX_FILTERS - forPending.length - forPeople.length);
  const filters = [...forPeople, ...forPending, ...forRooms];
  const asked = new Set(filters.flatMap((f) => (f["#p"] as string[] | undefined) ?? []));
  const whole = asked.size === confirmed.length + pending.length && forRooms.length * PER_FILTER >= named.length;
  return { filters, asked, whole };
}

type Frame = unknown[];

/** When each relay was last known up, kept beside the registrations: a restarted gateway reads from shortly before
 *  then, so what came while it was down is still pushed (once: the relay's events since then, matched again). */
export class AliveFile {
  private at: Record<string, number> = {};
  private file: string | null;
  constructor(file: string | null) {
    this.file = file;
    if (file) try { this.at = JSON.parse(readFileSync(file, "utf8")); } catch { /* none yet */ }
  }
  get(relay: string): number { return typeof this.at[relay] === "number" ? this.at[relay] : 0; }
  set(relay: string, s: number) {
    this.at[relay] = s;
    if (this.file) { writeFileSync(`${this.file}.tmp`, JSON.stringify(this.at)); renameSync(`${this.file}.tmp`, this.file); }
  }
}
type Ev = { id: string; pubkey: string; kind: number; created_at: number; tags: string[][]; content: string };

export class RelayWatch {
  private ws: WebSocket | null = null;
  private gen = 0;
  private stopped = false;
  private authed = false;
  private authId: string | null = null;
  private backoffMs = 2_000;
  private out: string[] = [];
  private draining: ReturnType<typeof setTimeout> | null = null;
  private nextSub = 0;
  private roomSubs = new Map<string, string>(); // room → sub id
  private subRooms = new Map<string, string>(); // sub id → room
  private roster: { sub: string; found: Map<string, Set<string>>; asked: Set<string>; at: number } | null = null;
  private again = false;
  private members = new Map<string, Set<string>>();
  private seen = new Set<string>();
  private aliveS = 0;
  private timers: ReturnType<typeof setInterval>[] = [];
  private soon: ReturnType<typeof setTimeout> | null = null;
  /** For tests and /health: listening in these rooms now. */
  ready = false;

  readonly relay: string;
  private secret: Uint8Array;
  private regs: () => Reg[];
  private onPush: (reg: Reg, push: Push) => void;
  private log: Log;
  private alive: AliveFile;
  private judge: (asked: ReadonlySet<string>, members: ReadonlySet<string>) => void;
  private pendingCap: number;
  /** The relay's own key (NIP-11 `self`, read at each connection): only member lists it signed count. Null when it
   *  doesn't say (then the relay's refusal of member lists from anyone else is what holds; Buzz refuses them). */
  private relayKey: string | null = null;
  /** The most events one filter gets (NIP-11 `limitation.max_limit`, at most what the gateway asks for). */
  private pageLimit = LIMIT;

  constructor(relay: string, secret: Uint8Array, regs: () => Reg[], onPush: (reg: Reg, push: Push) => void, log: Log, alive = new AliveFile(null),
    judge: (asked: ReadonlySet<string>, members: ReadonlySet<string>) => void = () => {}, pendingCap = 200) {
    this.relay = relay; this.secret = secret; this.regs = regs; this.onPush = onPush; this.log = log; this.alive = alive;
    this.judge = judge; this.pendingCap = pendingCap;
    this.aliveS = alive.get(relay);
  }

  private async readInfo() {
    try {
      const r = await fetch(this.relay.replace(/^ws/, "http"), { headers: { accept: "application/nostr+json" }, redirect: "manual", signal: AbortSignal.timeout(10_000) });
      const info = await r.json() as { self?: unknown; pubkey?: unknown; limitation?: { max_limit?: unknown } };
      const max = info.limitation?.max_limit;
      this.pageLimit = typeof max === "number" && max > 0 ? Math.min(LIMIT, max) : LIMIT;
      // `self` is the relay's own key (what signs member lists); `pubkey` is its operator's contact, not used here
      this.relayKey = typeof info.self === "string" && /^[0-9a-f]{64}$/.test(info.self) ? info.self : null;
    } catch { /* keep what it said last time */ }
  }

  start() {
    this.connect();
    this.timers.push(setInterval(() => this.refresh(), REFRESH_MS));
    this.timers.push(setInterval(() => { if (this.ready) { this.aliveS = Math.floor(Date.now() / 1000); this.alive.set(this.relay, this.aliveS); } }, 30_000));
  }

  stop() {
    this.stopped = true;
    this.gen++;
    this.timers.forEach(clearInterval);
    if (this.draining) clearTimeout(this.draining);
    if (this.soon) clearTimeout(this.soon);
    this.ws?.close();
    this.ws = null;
  }

  /** Registrations changed: read the member lists again shortly (changes that come together are read once). A read
   *  already due isn't put off, so a steady stream of registrations can't keep the read from happening. */
  changed() {
    if (this.soon) return;
    this.soon = setTimeout(() => { this.soon = null; this.refresh(); }, 300);
  }

  /** The rooms it listens in now. */
  rooms(): string[] { return [...this.roomSubs.keys()]; }

  private sub(p: string) { return p + (this.nextSub++).toString(36); }

  private connect() {
    if (this.stopped) return;
    void this.readInfo().then(() => this.connectNow());
  }

  private connectNow() {
    if (this.stopped) return;
    const g = ++this.gen;
    this.authed = false; this.authId = null; this.ready = false;
    this.out = []; this.roomSubs.clear(); this.subRooms.clear(); this.roster = null;
    const ws = new WebSocket(this.relay);
    this.ws = ws;
    ws.onmessage = (m) => { if (g === this.gen) this.message(String(m.data)); };
    ws.onclose = () => { if (g === this.gen) this.lost("closed"); };
    ws.onerror = () => { if (g === this.gen) this.lost("failed"); };
  }

  private lost(why: string) {
    if (this.stopped) return;
    if (this.authed) this.aliveS = Math.floor(Date.now() / 1000);
    this.authed = false; this.ready = false;
    this.gen++;
    try { this.ws?.close(); } catch { /* gone */ }
    this.ws = null;
    const wait = this.backoffMs + Math.random() * 1000;
    this.backoffMs = Math.min(this.backoffMs * 2, 300_000);
    this.log(`relay ${this.relay}: ${why}; again in ${Math.round(wait / 1000)}s`);
    setTimeout(() => this.connect(), wait);
  }

  private send(f: Frame, first = false) {
    if (first) this.out.unshift(JSON.stringify(f));
    else this.out.push(JSON.stringify(f));
    if (!this.draining) this.drain();
  }

  private drain() {
    const f = this.out.shift();
    if (!f || !this.ws || this.ws.readyState !== WebSocket.OPEN) { this.draining = null; return; }
    this.ws.send(f);
    this.draining = setTimeout(() => this.drain(), PACE_MS);
  }

  private message(text: string) {
    let m: unknown[];
    try { m = JSON.parse(text); } catch { return; }
    if (!Array.isArray(m)) return;
    switch (m[0]) {
      case "AUTH": {
        const ev = finalizeEvent({ kind: 22242, created_at: Math.floor(Date.now() / 1000), tags: [["relay", this.relay], ["challenge", String(m[1])]], content: "" }, this.secret);
        this.authId = ev.id;
        this.send(["AUTH", ev], true);
        break;
      }
      case "OK":
        if (m[1] === this.authId) {
          if (m[2] === true) { this.authed = true; this.backoffMs = 2_000; this.log(`relay ${this.relay}: signed in`); this.refresh(); }
          else { this.log(`relay ${this.relay}: sign-in refused (${String(m[3]).slice(0, 80)})`); this.lost("sign-in refused"); }
        }
        break;
      case "EVENT": this.event(String(m[1]), m[2] as Ev); break;
      case "EOSE": this.eose(String(m[1])); break;
      case "CLOSED": this.closed(String(m[1]), String(m[2] ?? "")); break;
    }
  }

  /** Read the member lists of the rooms registered people are in (and the rooms registrations name). One read at a
   *  time: a change while one runs reads again when it finishes. */
  refresh() {
    if (!this.authed) return;
    if (this.roster && Date.now() - this.roster.at < STUCK_MS) { this.again = true; return; }
    this.again = false;
    const regs = this.regs().filter((r) => r.relay === this.relay);
    if (this.roster) this.send(["CLOSE", this.roster.sub]);
    if (!regs.length) { this.roster = null; this.members = new Map(); this.listen(); return; }
    const { filters, asked, whole } = rosterFilters(regs, this.relayKey, this.pendingCap);
    if (!whole) this.log(`relay ${this.relay}: more registered people and rooms than one read takes; some rooms aren't watched`);
    const sub = this.sub("r");
    this.roster = { sub, found: new Map(), asked, at: Date.now() };
    this.send(["REQ", sub, ...filters]);
  }

  /** One subscription per room someone registered is in; the rest closed. */
  private listen() {
    const want = new Set<string>();
    for (const r of this.regs()) {
      if (r.relay !== this.relay) continue;
      const rooms = r.rooms ?? [...this.members.keys()];
      for (const room of rooms) if (this.members.get(room)?.has(r.pubkey)) want.add(room);
    }
    for (const [room, s] of [...this.roomSubs]) if (!want.has(room)) { this.send(["CLOSE", s]); this.roomSubs.delete(room); this.subRooms.delete(s); }
    const now = Math.floor(Date.now() / 1000);
    const since = this.aliveS ? Math.max(this.aliveS - GAP_S, now - 3600) : now - SKEW_S;
    for (const room of want) {
      if (this.roomSubs.has(room)) continue;
      const s = this.sub("m");
      this.roomSubs.set(room, s); this.subRooms.set(s, room);
      this.send(["REQ", s, { kinds: [9], "#h": [room], since }]);
    }
    this.ready = true;
    this.log(`relay ${this.relay}: listening in ${this.roomSubs.size} room(s)`);
  }

  private eose(s: string) {
    if (this.roster?.sub === s) {
      this.send(["CLOSE", s]);
      const { found, asked } = this.roster;
      this.members = found;
      this.roster = null;
      // a read that may have stopped at a filter's limit can't say who isn't listed
      if (found.size < this.pageLimit) this.judge(asked, new Set([...found.values()].flatMap((m) => [...m])));
      this.listen();
      if (this.again) this.refresh();
    }
  }

  private closed(s: string, why: string) {
    if (this.roster?.sub === s) { this.roster = null; this.again = false; this.log(`relay ${this.relay}: member lists refused (${why.split(":")[0]})`); return; }
    const room = this.subRooms.get(s);
    if (!room) return;
    this.subRooms.delete(s); this.roomSubs.delete(room);
    this.log(`relay ${this.relay}: a room's subscription closed (${why.split(":")[0]})`);
    if (/^(rate-limited|auth-required|error)/.test(why)) setTimeout(() => this.listen(), 30_000);
  }

  private event(s: string, ev: Ev) {
    if (!ev || typeof ev !== "object" || !Array.isArray(ev.tags)) return;
    if (this.roster?.sub === s) {
      if (ev.kind !== 39002 || (this.relayKey && ev.pubkey !== this.relayKey)) return;
      const d = ev.tags.find((t) => t[0] === "d")?.[1];
      if (d) this.roster.found.set(d, membersOf(ev));
      return;
    }
    const room = this.subRooms.get(s);
    if (!room || ev.kind !== 9 || !ev.tags.some((t) => t[0] === "h" && t[1] === room)) return;
    if (this.seen.has(ev.id)) return;
    this.seen.add(ev.id);
    if (this.seen.size > SEEN) this.seen.delete(this.seen.values().next().value!);
    for (const { reg, push } of matches(ev, this.relay, this.regs(), (r) => this.members.get(r))) this.onPush(reg, push);
  }
}
