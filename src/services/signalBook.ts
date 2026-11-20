// The rules behind the bar's counts on one device (docs/design/APP-RECORD.md "Signals"), apart from where they come
// from: services/signals.ts feeds it the allowed applets' signals, the notes it watches and the applet in front, and
// gives it the call to the gateway. Kept here so the rules have their own tests (signalBook.test.ts).
//
//   seen      a vault signal counts notes made after the person last saw the applet: when they opened it, and for as
//             long as it stays in front; a signal new to this device counts from the moment it is first lit
//   in front  its counts are 0 (except a feed's: the applet's own number, which it keeps setting)
//   gateway   what moved here goes to the signal's gateway (`via`); the answer brings what the gateway counted (a
//             relay's) and what other devices set (a feed's number, a 0 when one was opened). A device that never
//             held a number doesn't send a 0 for it, and a number this device moved and hasn't sent yet isn't undone
//             by an older answer.
import type { Signal } from "../applet/signals";

export type BookLit = { key: string; vaultKey: string; noteId: string; gid: string; signal: Signal };
export type NoteSeen = { createdAt: string; createdBy: string | null };
export type SetItem = { subject: string; signal: string; count: number };
export type GatewayCount = { subject: string; signal: string; count: number; at: number };
export type GatewayCall = (gateway: string, set: SetItem[]) => Promise<{ counts?: GatewayCount[] }>;
type StorageLike = Pick<Storage, "getItem" | "setItem">;
type Stored = { seen: Record<string, string>; counts: Record<string, number> };

export const STORE = "parachute.signals.v1";
export const keyOf = (vaultKey: string, noteId: string, signal: string) => `${vaultKey}\u0000${noteId}\u0000${signal}`;

/** Notes made after `seen` (by someone else, with `others`). Pure. */
export function countNotes(notes: Iterable<NoteSeen>, seen: string | undefined, others: boolean, me: string | null): number {
  const since = Date.parse(seen ?? "") || 0;
  let n = 0;
  for (const x of notes) if (Date.parse(x.createdAt) > since && !(others && me && x.createdBy === me)) n++;
  return n;
}

/** Worth asking again later: no answer, or the gateway busy or failing (429, 5xx), as notify.rs words them. */
export const retryable = (e: unknown) => /didn't answer|\((?:429|5\d\d)\b/.test(String(e));

export class SignalBook {
  private lit: BookLit[] = [];
  private front: { vaultKey: string; noteId: string } | null = null;
  // the app is in sight: what is on screen counts as seen only then (a minimized window, a phone in a pocket: not)
  private visible = true;
  // what each gateway last said, per signal here: an open is told when it changes something there too
  private heard = new Map<string, number>();
  private backoffMs: number;
  private watched = new Map<string, { notes: NoteSeen[]; me: string | null }>();
  private toTell = new Map<string, Map<string, SetItem>>();
  private telling: ReturnType<typeof setTimeout> | null = null;
  private retrying: ReturnType<typeof setTimeout> | null = null;
  private st: Stored;
  // an applet's own number said before its signal was listed here (it starts the moment it is allowed; the list follows
  // a moment later): kept until it is listed, then counted
  private early = new Map<string, number>();
  private listeners = new Set<() => void>();
  version = 0;

  constructor(private storage: StorageLike | null, private call: GatewayCall | null, private now: () => number = Date.now, private delayMs = 400, private retryMs = 30_000) {
    let x: Partial<Stored> = {};
    try { x = JSON.parse(storage?.getItem(STORE) ?? "{}") as Partial<Stored>; } catch { /* a fresh store */ }
    this.st = { seen: x.seen && typeof x.seen === "object" ? x.seen : {}, counts: x.counts && typeof x.counts === "object" ? x.counts : {} };
    this.backoffMs = retryMs;
  }

  subscribe(f: () => void): () => void { this.listeners.add(f); return () => { this.listeners.delete(f); }; }
  private changed() { this.version++; this.listeners.forEach((f) => f()); }
  private save() { try { this.storage?.setItem(STORE, JSON.stringify(this.st)); } catch { /* this session only */ } }
  private iso = () => new Date(this.now()).toISOString();
  private atFront = (l: BookLit) => this.visible && !!this.front && this.front.vaultKey === l.vaultKey && this.front.noteId === l.noteId;

  /** The allowed applets' signals now. */
  setLit(lit: BookLit[]) {
    for (const l of lit) if (l.signal.from.kind === "vault" && !this.st.seen[l.key]) { this.st.seen[l.key] = this.iso(); this.save(); }
    this.lit = lit;
    for (const l of lit) { const n = this.early.get(l.key); if (n !== undefined) { this.early.delete(l.key); if (l.signal.from.kind === "feed") this.set(l, n, "opened"); } }
    for (const k of [...this.watched.keys()]) if (!lit.some((l) => l.key === k)) this.watched.delete(k);
    // the applet in front may have been lit only now (a cold start from a notification's tap)
    if (this.front && this.visible) this.seeAll(this.front.vaultKey, this.front.noteId);
    this.changed();
  }
  litNow(): readonly BookLit[] { return this.lit; }

  count(key: string): number | undefined { return this.st.counts[key]; }
  badge(vaultKey: string, noteId: string): number {
    return this.lit.filter((l) => l.vaultKey === vaultKey && l.noteId === noteId).reduce((n, l) => n + (this.st.counts[l.key] ?? 0), 0);
  }

  /** The applet now on screen (null: none). The one leaving was seen until now; the one arriving is seen now. */
  setFront(vaultKey: string | null, noteId: string | null) {
    if (this.front && this.visible) this.seeAll(this.front.vaultKey, this.front.noteId);
    this.front = vaultKey && noteId ? { vaultKey, noteId } : null;
    if (this.front && this.visible) this.seeAll(this.front.vaultKey, this.front.noteId);
  }
  /** The app went out of sight: what was in front was seen until now, and nothing after. */
  hidden() { if (this.front && this.visible) this.seeAll(this.front.vaultKey, this.front.noteId); this.visible = false; }
  /** Back in sight: the applet in front is seen again. */
  shown() { this.visible = true; if (this.front) this.seeAll(this.front.vaultKey, this.front.noteId); }

  private seeAll(vaultKey: string, noteId: string) {
    const mine = this.lit.filter((x) => x.vaultKey === vaultKey && x.noteId === noteId);
    // the gateway may have counted since it was last asked (a mention just now): ask, and the answer is seen too
    if (mine.some((l) => l.signal.via && l.signal.from.kind !== "feed")) this.askSoon();
    for (const l of mine) {
      if (l.signal.from.kind === "feed") continue; // the applet's own number: it says what is left
      if (l.signal.from.kind === "vault") { this.st.seen[l.key] = this.iso(); this.save(); }
      this.set(l, 0, "opened");
    }
  }

  /** The notes a vault signal's watch holds now (snapshot and every change after). */
  notes(key: string, notes: NoteSeen[], me: string | null) { this.watched.set(key, { notes, me }); this.recount(key); }

  private recount(key: string) {
    const l = this.lit.find((x) => x.key === key), w = this.watched.get(key);
    if (!l || !w || l.signal.from.kind !== "vault") return;
    if (this.atFront(l)) { this.st.seen[l.key] = this.iso(); this.save(); this.set(l, 0, "moved"); return; }
    this.set(l, countNotes(w.notes, this.st.seen[key], !!l.signal.from.others, w.me), "moved");
  }

  /** A running applet's own number for one of its signals. False for one it doesn't declare. */
  own(vaultKey: string, noteId: string, signal: string, count: number): boolean {
    const l = this.lit.find((x) => x.vaultKey === vaultKey && x.noteId === noteId && x.signal.id === signal);
    if (!l) {
      // none of its signals listed yet (allowed a moment ago): kept for when they are; a few at most
      if (this.lit.some((x) => x.vaultKey === vaultKey && x.noteId === noteId) || this.early.size >= 50) return false;
      this.early.set(keyOf(vaultKey, noteId, signal), count);
      return true;
    }
    this.set(l, count, "opened");
    return true;
  }

  /** `moved`: counted here; `opened`: the person or the applet said so (always told); `heard`: from the gateway (never
   *  told back). */
  private set(l: BookLit, n: number, how: "moved" | "opened" | "heard") {
    const before = this.st.counts[l.key];
    if (before !== n) {
      this.st.counts[l.key] = n;
      this.save();
      this.changed();
    } else if (how !== "opened" || (this.heard.get(l.key) ?? 0) === 0) return; // an open is told when the gateway may hold more
    // a device that never held a number for it has nothing to clear elsewhere
    if (!l.signal.via || how === "heard" || (before === undefined && n === 0 && how === "moved")) return;
    const m = this.toTell.get(l.signal.via) ?? new Map<string, SetItem>();
    m.set(l.key, { subject: l.gid, signal: l.signal.id, count: n });
    this.toTell.set(l.signal.via, m);
    this.askSoon();
  }

  private askSoon() { if (!this.telling) this.telling = setTimeout(() => { this.telling = null; void this.exchange(); }, this.delayMs); }

  /** Tell each gateway what moved here, and take what it holds. */
  async exchange(): Promise<void> {
    if (!this.call) return;
    const gateways = new Set(this.lit.filter((l) => l.signal.via).map((l) => l.signal.via!));
    for (const gateway of gateways) {
      const sent = this.toTell.get(gateway) ?? new Map<string, SetItem>();
      this.toTell.delete(gateway);
      let got: { counts?: GatewayCount[] };
      try { got = await this.call(gateway, [...sent.values()]); } catch (e) {
        // kept for the next time (a number moved meanwhile replaces it); tried again later, less often each time, only
        // when the gateway didn't answer (a refusal won't change by asking again: the next change or start asks)
        const m = this.toTell.get(gateway) ?? new Map<string, SetItem>();
        for (const [k, c] of sent) if (!m.has(k)) m.set(k, c);
        this.toTell.set(gateway, m);
        if (retryable(e) && !this.retrying) {
          this.retrying = setTimeout(() => { this.retrying = null; void this.exchange(); }, this.backoffMs);
          this.backoffMs = Math.min(this.backoffMs * 2, 30 * 60_000);
        }
        continue;
      }
      this.backoffMs = this.retryMs;
      for (const [k, c] of sent) this.heard.set(k, c.count);
      for (const c of got.counts ?? []) {
        // a gateway's clock can't put "seen" in the future
        const at = Math.min(c.at * 1000, this.now());
        for (const l of this.lit.filter((x) => x.gid === c.subject && x.signal.id === c.signal && x.signal.via === gateway)) {
          if (this.toTell.get(gateway)?.has(l.key)) continue; // moved here since this answer left: ours is newer
          this.heard.set(l.key, c.count);
          if (this.atFront(l) && l.signal.from.kind !== "feed") { if (c.count !== 0) this.set(l, 0, "opened"); continue; }
          if (l.signal.from.kind === "vault") {
            // another device opened it since: what it saw counts as seen here too
            if (c.count === 0 && at > (Date.parse(this.st.seen[l.key] ?? "") || 0)) { this.st.seen[l.key] = new Date(at).toISOString(); this.save(); this.recount(l.key); }
          } else this.set(l, c.count, "heard");
        }
      }
    }
  }

  /** Stop the timers (tests; the app closing). */
  stop() { if (this.telling) clearTimeout(this.telling); if (this.retrying) clearTimeout(this.retrying); this.telling = this.retrying = null; }
}
