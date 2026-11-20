// Signals on this device (docs/design/APP-RECORD.md "Signals"): the counts the bar shows for allowed applets that
// declare `signals` (applet/signals.ts), counted without running the applet.
//
//   notes in its vault   counted here, live: the vault's own subscription (no polling) for the folder; a note made
//                        after the person last opened the applet counts (with `others`, only someone else's)
//   a relay's            counted by its push gateway while Parachute is closed; read from there
//   an http feed         the applet's own number while it runs (`parachute.signal`), kept here
// Opening the applet makes its counts 0. In the app on a device with the key, a signal with `via` is also told to that
// gateway (Rust `push_signals`, signed): the applet as an opaque id, the signal's id and the number, nothing else; the
// answer brings back what the gateway counted and what other devices set, so a count read on one clears on the others.
import { useSyncExternalStore } from "react";
import { appletsNow, refreshApplets, subscribeApplets, type Keyed } from "../applet/useApplets";
import { deviceGrants, subjectOf } from "../applet/grants";
import type { Signal } from "../applet/signals";
import { clientFor } from "../vault/client";
import { listVaults, originOf, subscribeVaults, type VaultRecord } from "../vault/store";
import { isMine } from "../vault/whose";
import { inShell } from "../vault/oauth";
import { knownHubs } from "./hubs";

/** One allowed applet's signal, as this device sees it. `gid`: the applet as the gateway knows it (the same on every
 *  device: its hub, vault name and record, hashed). */
export type Lit = { key: string; vaultKey: string; noteId: string; signal: Signal; gid: string; rec: VaultRecord };

const STORE = "parachute.signals.v1";
type Stored = { seen: Record<string, string>; counts: Record<string, number> };
const keyOf = (vaultKey: string, noteId: string, signal: string) => `${vaultKey}\u0000${noteId}\u0000${signal}`;

function load(): Stored {
  try {
    const x = JSON.parse(localStorage.getItem(STORE) ?? "{}") as Partial<Stored>;
    return { seen: x.seen && typeof x.seen === "object" ? x.seen : {}, counts: x.counts && typeof x.counts === "object" ? x.counts : {} };
  } catch { return { seen: {}, counts: {} }; }
}
let stored: Stored | null = null;
const st = () => (stored ??= typeof localStorage === "undefined" ? { seen: {}, counts: {} } : load());
const save = () => { try { localStorage.setItem(STORE, JSON.stringify(st())); } catch { /* this session only */ } };

const listeners = new Set<() => void>();
let version = 0;
const changed = () => { version++; listeners.forEach((f) => f()); };

/** The applet's opaque id at a gateway: base64url of SHA-256 over its hub, vault name and record id, 22 characters. */
export async function gidOf(hub: string, vault: string, record: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`parachute-signal|${hub}|${vault}|${record}`)));
  return btoa(String.fromCharCode(...d)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "").slice(0, 22);
}

/** The allowed applets' signals, from what was last read of each vault. Pure but for the stores it reads. */
export async function litNow(): Promise<Lit[]> {
  const g = deviceGrants();
  const out: Lit[] = [];
  for (const rec of listVaults()) {
    const e = appletsNow(rec.key);
    if (e?.state !== "ok") continue;
    for (const a of e.found.entries as Keyed[]) {
      if (!a.signals?.length || g.status(subjectOf(rec.key, a.noteId), a.keys.scope, a.keys.html) !== "ok") continue;
      const gid = await gidOf(originOf(rec.issuer), rec.vault, a.noteId);
      // a count goes to a gateway only from the person's own vaults
      for (const s of a.signals) out.push({ key: keyOf(rec.key, a.noteId, s.id), vaultKey: rec.key, noteId: a.noteId, signal: isMine(rec) ? s : { ...s, via: undefined }, gid, rec });
    }
  }
  return out;
}

let lit: Lit[] = [];

/** The count on the bar for one applet: its signals' counts together. */
export function badgeOf(vaultKey: string, noteId: string): number {
  return lit.filter((l) => l.vaultKey === vaultKey && l.noteId === noteId).reduce((n, l) => n + (st().counts[l.key] ?? 0), 0);
}
export function useBadge(vaultKey: string, noteId: string): number {
  useSyncExternalStore((cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; }, () => version);
  return badgeOf(vaultKey, noteId);
}

// ── what goes to the gateways ──

/** Counts this device moved and hasn't told the gateway yet, per gateway. */
const toTell = new Map<string, Map<string, { subject: string; signal: string; count: number }>>();
let telling: ReturnType<typeof setTimeout> | null = null;

function setCount(l: Lit, n: number, tell: boolean) {
  const before = st().counts[l.key];
  if (before === n) return;
  st().counts[l.key] = n;
  save();
  changed();
  if (tell && l.signal.via) {
    const m = toTell.get(l.signal.via) ?? new Map();
    m.set(l.key, { subject: l.gid, signal: l.signal.id, count: n });
    toTell.set(l.signal.via, m);
    if (!telling) telling = setTimeout(() => { telling = null; void exchange(); }, 400);
  }
}

/** Tell each gateway what moved here, and take what it holds (in the app on a device with the key only). */
export async function exchange(): Promise<void> {
  if (!inShell()) return;
  const gateways = new Set(lit.filter((l) => l.signal.via).map((l) => l.signal.via!));
  const { invoke } = await import("@tauri-apps/api/core");
  for (const gateway of gateways) {
    const set = [...(toTell.get(gateway)?.values() ?? [])];
    toTell.delete(gateway);
    let got: { counts?: { subject: string; signal: string; count: number; at: number }[] };
    try { got = await invoke("push_signals", { gateway, set, hubs: knownHubs() }); } catch { continue; }
    for (const c of got.counts ?? []) {
      for (const l of lit.filter((x) => x.gid === c.subject && x.signal.id === c.signal && x.signal.via === gateway)) {
        if (l.signal.from.kind === "vault") {
          // another device opened it since: what it saw counts as seen here too
          if (c.count === 0 && c.at * 1000 > Date.parse(st().seen[l.key] ?? "0")) { st().seen[l.key] = new Date(c.at * 1000).toISOString(); save(); recount(l.key); }
        } else setCount(l, c.count, false);
      }
    }
  }
}

// ── counting notes in a vault, live ──

type Watch = { stop: () => void; notes: Map<string, { createdAt: string; createdBy: string | null }>; me: string | null };
const watches = new Map<string, Watch>();

/** The hub user a sign-in is (its token's `sub`), to tell the person's own notes from someone else's. */
export function userOf(token: string): string | null {
  try {
    const p = token.split(".")[1];
    const sub = (JSON.parse(atob(p.replace(/-/g, "+").replace(/_/g, "/"))) as { sub?: unknown }).sub;
    return typeof sub === "string" ? sub : null;
  } catch { return null; }
}

/** Notes made after the person last opened the applet (by someone else, with `others`). Pure. */
export function countNotes(notes: Iterable<{ createdAt: string; createdBy: string | null }>, seen: string | undefined, others: boolean, me: string | null): number {
  const since = Date.parse(seen ?? "") || 0;
  let n = 0;
  for (const x of notes) if (Date.parse(x.createdAt) > since && !(others && me && x.createdBy === me)) n++;
  return n;
}

function recount(key: string) {
  const w = watches.get(key), l = lit.find((x) => x.key === key);
  if (!w || !l || l.signal.from.kind !== "vault") return;
  setCount(l, countNotes(w.notes.values(), st().seen[key], !!l.signal.from.others, w.me), true);
}

function watch(l: Lit): Watch | null {
  if (l.signal.from.kind !== "vault") return null;
  const from = l.signal.from;
  const w: Watch = { stop: () => {}, notes: new Map(), me: userOf(l.rec.accessToken) };
  const keep = (n: { id: string; createdAt?: string; createdBy?: string | null }) => { if (n.createdAt) w.notes.set(n.id, { createdAt: n.createdAt, createdBy: n.createdBy ?? null }); };
  try {
    w.stop = clientFor(l.rec).subscribe({ pathPrefix: from.path, ...(from.type ? { tag: from.type } : {}), includeContent: false }, {
      onSnapshot: (notes) => { w.notes.clear(); notes.forEach(keep); recount(l.key); },
      onUpsert: (n) => { keep(n); recount(l.key); },
      onRemove: (id) => { w.notes.delete(id); recount(l.key); },
    });
  } catch { return null; }
  return w;
}

// ── keeping it all in line ──

let running = false;
/** Read the allowed applets' signals again, watch what is counted here, and bring the gateways in line. */
export async function refreshSignals(): Promise<void> {
  lit = await litNow();
  // a signal new to this device counts from now: an applet allowed today doesn't show everything it ever had as new
  const now = new Date().toISOString();
  for (const l of lit) if (l.signal.from.kind === "vault" && !st().seen[l.key]) { st().seen[l.key] = now; save(); }
  const want = new Set(lit.filter((l) => l.signal.from.kind === "vault").map((l) => l.key));
  for (const [k, w] of watches) if (!want.has(k)) { w.stop(); watches.delete(k); }
  for (const l of lit) if (want.has(l.key) && !watches.has(l.key)) { const w = watch(l); if (w) watches.set(l.key, w); }
  changed();
  await exchange();
}

/** The person opened the applet: its counts are 0, here and (through the gateway) on their other devices. */
export function opened(vaultKey: string, noteId: string) {
  const now = new Date().toISOString();
  for (const l of lit.filter((x) => x.vaultKey === vaultKey && x.noteId === noteId)) {
    st().seen[l.key] = now;
    save();
    setCount(l, 0, true);
  }
}

/** The running applet's own number for one of its signals (the kit's `parachute.signal`). False for a signal it
 *  doesn't declare. */
export function setOwn(vaultKey: string, noteId: string, signal: string, n: number): boolean {
  const l = lit.find((x) => x.vaultKey === vaultKey && x.noteId === noteId && x.signal.id === signal);
  if (!l) return false;
  setCount(l, n, true);
  return true;
}

/** Start once, in the shell: read the person's vaults' applets, then follow grants, applets and vaults; back in front,
 *  ask the gateways again. Answers how to stop (tests). */
export function startSignals(): () => void {
  if (running) return () => {};
  running = true;
  let queued: ReturnType<typeof setTimeout> | null = null;
  const soon = () => { if (!queued) queued = setTimeout(() => { queued = null; void refreshSignals(); }, 200); };
  for (const rec of listVaults()) if (!appletsNow(rec.key)) void refreshApplets(rec);
  const offs = [subscribeApplets(soon), subscribeVaults(soon), deviceGrants().onChange(soon)];
  const back = () => { if (document.visibilityState === "visible") void exchange(); };
  document.addEventListener("visibilitychange", back);
  soon();
  return () => { running = false; offs.forEach((f) => f()); document.removeEventListener("visibilitychange", back); for (const w of watches.values()) w.stop(); watches.clear(); };
}
