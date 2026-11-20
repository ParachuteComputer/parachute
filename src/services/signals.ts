// Signals on this device (docs/design/APP-RECORD.md "Signals"): the counts the bar shows for allowed applets that
// declare `signals` (applet/signals.ts), counted without running the applet. The rules are signalBook.ts; this is
// where their inputs come from:
//
//   notes in its vault   the vault's own live subscription for the folder (no polling), per signal
//   a relay's            its push gateway, which counts while Parachute is closed
//   an http feed         the applet's own number while it runs (`parachute.signal`)
//   in front             the applet on screen (App.tsx), and the app going out of sight
//   the gateway          in the app on a device with the key: Rust `push_signals`, signed (the applet as an opaque id,
//                        the signal's id and the number, nothing else), at start, on each change, back in front
import { useSyncExternalStore } from "react";
import { appletsNow, refreshApplets, subscribeApplets, type Keyed } from "../applet/useApplets";
import { deviceGrants, subjectOf } from "../applet/grants";
import { clientFor } from "../vault/client";
import { listVaults, originOf, subscribeVaults, type VaultRecord } from "../vault/store";
import { isMine } from "../vault/whose";
import { inShell } from "../vault/oauth";
import { knownHubs } from "./hubs";
import { SignalBook, keyOf, type BookLit, type GatewayCall, type NoteSeen } from "./signalBook";

/** The applet's opaque id at a gateway: base64url of SHA-256 over its hub, vault name and record id, 22 characters. The
 *  same on every device. */
export async function gidOf(hub: string, vault: string, record: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`parachute-signal|${hub}|${vault}|${record}`)));
  return btoa(String.fromCharCode(...d)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "").slice(0, 22);
}

const toGateway: GatewayCall = async (gateway, set) => {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke("push_signals", { gateway, set, hubs: knownHubs() });
};
const book = new SignalBook(typeof localStorage === "undefined" ? null : localStorage, inShell() ? toGateway : null);

type Lit = BookLit & { rec: VaultRecord };

/** The allowed applets' signals, from what was last read of each vault. A count goes to a gateway only from the
 *  person's own vaults. */
export async function litNow(): Promise<Lit[]> {
  const g = deviceGrants();
  const out: Lit[] = [];
  for (const rec of listVaults()) {
    const e = appletsNow(rec.key);
    if (e?.state !== "ok") continue;
    for (const a of e.found.entries as Keyed[]) {
      if (!a.signals?.length || g.status(subjectOf(rec.key, a.noteId), a.keys.scope, a.keys.html) !== "ok") continue;
      const gid = await gidOf(originOf(rec.issuer), rec.vault, a.noteId);
      for (const s of a.signals) out.push({ key: keyOf(rec.key, a.noteId, s.id), vaultKey: rec.key, noteId: a.noteId, signal: isMine(rec) ? s : { ...s, via: undefined }, gid, rec });
    }
  }
  return out;
}

/** The count on the bar for one applet: its signals' counts together. */
export function useBadge(vaultKey: string, noteId: string): number {
  useSyncExternalStore((cb) => book.subscribe(cb), () => book.version);
  return book.badge(vaultKey, noteId);
}

/** The user a sign-in is (its token's `sub`), to tell the person's own notes from someone else's. */
export function userOf(token: string): string | null {
  try {
    const sub = (JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))) as { sub?: unknown }).sub;
    return typeof sub === "string" ? sub : null;
  } catch { return null; }
}

// one watch per vault signal, keyed by what it counts: a record that changes its folder gets a new one
const watches = new Map<string, () => void>();
const watchKey = (l: Lit) => `${l.key}\u0000${JSON.stringify(l.signal.from)}`;

function watch(l: Lit): (() => void) | null {
  if (l.signal.from.kind !== "vault") return null;
  const from = l.signal.from;
  const me = userOf(l.rec.accessToken);
  const notes = new Map<string, NoteSeen>();
  const keep = (n: { id: string; createdAt?: string; createdBy?: string | null }) => { if (n.createdAt) notes.set(n.id, { createdAt: n.createdAt, createdBy: n.createdBy ?? null }); };
  const told = () => book.notes(l.key, [...notes.values()], me);
  try {
    return clientFor(l.rec).subscribe({ pathPrefix: from.path, ...(from.type ? { tag: from.type } : {}), includeContent: false }, {
      onSnapshot: (all) => { notes.clear(); all.forEach(keep); told(); },
      onUpsert: (n) => { keep(n); told(); },
      onRemove: (id) => { notes.delete(id); told(); },
    });
  } catch { return null; }
}

/** Read the allowed applets' signals again, watch what is counted here, and ask the gateways. */
export async function refreshSignals(): Promise<void> {
  const lit = await litNow();
  book.setLit(lit);
  const want = new Map(lit.filter((l) => l.signal.from.kind === "vault").map((l) => [watchKey(l), l]));
  for (const [k, stop] of watches) if (!want.has(k)) { stop(); watches.delete(k); }
  for (const [k, l] of want) if (!watches.has(k)) { const stop = watch(l); if (stop) watches.set(k, stop); }
  // applets are read again often (each launcher): the gateways are asked when what goes to them changed, or after a minute
  const to = [...new Set(lit.filter((l) => l.signal.via).map((l) => `${l.gid} ${l.signal.id} ${l.signal.via}`))].sort().join("\n");
  if (to !== asked.to || Date.now() - asked.at > 60_000) { asked = { to, at: Date.now() }; await book.exchange(); }
}
let asked = { to: "", at: 0 };

/** The applet now on screen (App.tsx): its counts are 0 while it is, here and on the person's other devices. */
export const setFront = (vaultKey: string | null, noteId: string | null) => book.setFront(vaultKey, noteId);
/** A running applet's own number (the kit's `signal`). False for a signal it doesn't declare. */
export const setOwn = (vaultKey: string, noteId: string, signal: string, n: number) => book.own(vaultKey, noteId, signal, n);
/** Ask the gateways now (after the native list is set: notify.ts). */
export const exchange = () => book.exchange();

let running = false;
/** Start once, in the shell: read the person's vaults' applets, then follow grants, applets and vaults; back in front,
 *  ask the gateways again; out of sight, what was in front was seen. Answers how to stop. */
export function startSignals(): () => void {
  if (running) return () => {};
  running = true;
  let queued: ReturnType<typeof setTimeout> | null = null;
  const soon = () => { if (!queued) queued = setTimeout(() => { queued = null; void refreshSignals(); }, 200); };
  for (const rec of listVaults()) if (!appletsNow(rec.key)) void refreshApplets(rec);
  const offs = [subscribeApplets(soon), subscribeVaults(soon), deviceGrants().onChange(soon)];
  const sight = () => { if (document.visibilityState === "visible") void book.exchange(); else book.hidden(); };
  document.addEventListener("visibilitychange", sight);
  soon();
  return () => { running = false; offs.forEach((f) => f()); document.removeEventListener("visibilitychange", sight); for (const stop of watches.values()) stop(); watches.clear(); book.stop(); };
}
