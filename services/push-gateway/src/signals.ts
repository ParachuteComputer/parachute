// Signals (docs/design/APP-RECORD.md "Signals"): one number per person, applet and signal, kept here so a badge and a
// notification can show while the applet (or the whole app) is closed. The applet is an opaque id the app makes
// (a hash of its hub, vault and record), so the gateway never learns which applet or vault it is.
//
// Who moves a number: the relay watch, for a registration that names the signal (a message for the person in one of
// its rooms adds one); and the person's own devices, signed (`POST <gateway>signals`): the open app's count of a vault
// signal, a running applet's own number, 0 when the person opens it. A change is pushed to the person's phones as
// `{v, kind: "signal", subject, signal, count, to}`: no words, no note, no room.
import { readFileSync, renameSync, writeFileSync } from "node:fs";

export const SIGNAL_LIMITS = { perKey: 64, set: 16, max: 9999, perReg: 8, rooms: 100, ttlS: 30 * 24 * 3600 };
export const SUBJECT = /^[A-Za-z0-9_-]{8,64}$/;
export const SIGNAL_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const signalOk = (s: unknown): s is string => typeof s === "string" && s.length <= 40 && SIGNAL_ID.test(s);

export type Count = { subject: string; signal: string; count: number; at: number };
/** What a phone gets when a number changes. `to`: the key it is for, as a relay push says. */
export type SignalPush = { v: 1; kind: "signal"; subject: string; signal: string; count: number; to: string };
/** On a registration: which signal a message for the person in these rooms (or any of theirs) adds one to. */
export type RegSignal = { subject: string; signal: string; rooms: string[] | null };

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };
const plain = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);

/** The body of POST /signals: `{set: [{subject, signal, count}]}` (none to only read). Fields this gateway doesn't know
 *  are left out, as on a registration. */
export function parseSignals(x: unknown): Parsed<{ subject: string; signal: string; count: number }[]> {
  if (!plain(x) || !Array.isArray(x.set) || x.set.length > SIGNAL_LIMITS.set) return { ok: false, error: `signals is {set: [up to ${SIGNAL_LIMITS.set} {subject, signal, count}]}` };
  const out: { subject: string; signal: string; count: number }[] = [];
  for (const s of x.set) {
    if (!plain(s) || typeof s.subject !== "string" || !SUBJECT.test(s.subject) || !signalOk(s.signal)
      || typeof s.count !== "number" || !Number.isInteger(s.count) || s.count < 0 || s.count > SIGNAL_LIMITS.max) {
      return { ok: false, error: `each is {subject, signal, count}: an applet's id, a signal's id, 0 to ${SIGNAL_LIMITS.max}` };
    }
    out.push({ subject: s.subject, signal: s.signal, count: s.count });
  }
  return { ok: true, value: out };
}

/** A registration's `signals`, checked: which signal each of the person's messages in these rooms counts for. */
export function parseRegSignals(x: unknown, roomOk: (r: unknown) => boolean): Parsed<RegSignal[]> {
  if (x === undefined) return { ok: true, value: [] };
  const bad = { ok: false as const, error: `signals is up to ${SIGNAL_LIMITS.perReg} {subject, signal, rooms}` };
  if (!Array.isArray(x) || x.length > SIGNAL_LIMITS.perReg) return bad;
  const out: RegSignal[] = [];
  for (const s of x) {
    if (!plain(s) || typeof s.subject !== "string" || !SUBJECT.test(s.subject) || !signalOk(s.signal)) return bad;
    if (s.rooms !== null && (!Array.isArray(s.rooms) || !s.rooms.length || s.rooms.length > 50 || !s.rooms.every(roomOk))) return bad;
    out.push({ subject: s.subject, signal: s.signal, rooms: s.rooms === null ? null : [...new Set(s.rooms as string[])].sort() });
  }
  // so that any registration this accepts fits the body limit (server.ts)
  if (out.reduce((n, s) => n + (s.rooms?.length ?? 0), 0) > SIGNAL_LIMITS.rooms) return { ok: false, error: `signals name at most ${SIGNAL_LIMITS.rooms} rooms in all` };
  return { ok: true, value: out };
}

/** For a message in `room`, the signals of a registration it counts for. Pure. */
export const countedIn = (signals: readonly RegSignal[] | undefined, room: string) => (signals ?? []).filter((s) => !s.rooms || s.rooms.includes(room));

/** The numbers, per key; kept in one JSON file, written whole and renamed into place. A number nobody touched in 30
 *  days goes. */
export class Counts {
  private by = new Map<string, Count[]>();
  private readonly file: string | null;
  private saving: ReturnType<typeof setTimeout> | null = null;
  constructor(file: string | null, now = Math.floor(Date.now() / 1000)) {
    this.file = file;
    if (file) {
      try {
        const read = JSON.parse(readFileSync(file, "utf8"));
        // what nobody touched in 30 days goes as it is read, for every key
        if (plain(read)) for (const [k, v] of Object.entries(read)) if (Array.isArray(v)) { const live = (v as Count[]).filter((c) => c.at > now - SIGNAL_LIMITS.ttlS); if (live.length) this.by.set(k, live); }
      } catch { /* none yet */ }
    }
  }

  /** Written a moment after the last change (a busy room moves many numbers at once), whole and renamed into place. */
  private save() {
    if (!this.file || this.saving) return;
    this.saving = setTimeout(() => this.flush(), 1_000);
    this.saving.unref?.();
  }

  /** Write now (the gateway closing; tests). */
  flush() {
    if (this.saving) clearTimeout(this.saving);
    this.saving = null;
    if (!this.file) return;
    const now = Math.floor(Date.now() / 1000);
    for (const [k, v] of this.by) { const live = v.filter((c) => c.at > now - SIGNAL_LIMITS.ttlS); if (live.length !== v.length) { if (live.length) this.by.set(k, live); else this.by.delete(k); } }
    writeFileSync(`${this.file}.tmp`, JSON.stringify(Object.fromEntries(this.by)), { mode: 0o600 });
    renameSync(`${this.file}.tmp`, this.file);
  }

  /** Whether these numbers fit under the key's 64, counting the ones it holds already. */
  fits(pubkey: string, subjects: readonly { subject: string; signal: string }[], now: number): boolean {
    const list = this.of(pubkey, now);
    const fresh = new Set(subjects.filter((s) => !list.some((c) => c.subject === s.subject && c.signal === s.signal)).map((s) => `${s.subject} ${s.signal}`));
    return list.length + fresh.size <= SIGNAL_LIMITS.perKey;
  }

  /** A key's live numbers. */
  of(pubkey: string, now: number): Count[] {
    const all = this.by.get(pubkey) ?? [];
    const live = all.filter((c) => c.at > now - SIGNAL_LIMITS.ttlS);
    if (live.length !== all.length) { if (live.length) this.by.set(pubkey, live); else this.by.delete(pubkey); this.save(); }
    return live;
  }

  /** Set (`to`) or add one (`to` null). The number before and after, or null when it couldn't be kept (the key holds
   *  its 64 already). */
  move(pubkey: string, subject: string, signal: string, to: number | null, now: number): { before: number; after: number } | null {
    const list = this.of(pubkey, now);
    let c = list.find((x) => x.subject === subject && x.signal === signal);
    if (!c) {
      if (list.length >= SIGNAL_LIMITS.perKey) return null;
      c = { subject, signal, count: 0, at: now };
      list.push(c);
      this.by.set(pubkey, list);
    }
    const before = c.count;
    c.count = to ?? Math.min(SIGNAL_LIMITS.max, c.count + 1);
    c.at = now;
    this.save();
    return { before, after: c.count };
  }
}
