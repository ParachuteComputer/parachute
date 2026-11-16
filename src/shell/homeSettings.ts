// The bar and the home: the person's choices, one note in their home vault (docs/NAVIGATION.md). Like the frame record
// (frameSource.ts), it lives on the person's side, so their agent can change it by writing that note, and the app keeps
// the last copy it read for when the vault can't be reached.
//
//   the note      `Parachute/Settings` in the home vault, tagged `parachute-settings`. Its metadata `parachute`:
//                   bar:   [{vault, hub?, applet}]   the pinned places, in order
//                   start: {vault, hub?, applet} | null   the home applet: it opens on start, first on the bar
//                 `vault` is a vault's name (with `hub`, an issuer origin, when two hubs hold vaults of that name);
//                 `applet` is the applet note's id or path. A place this device can't find is left out.
//   read          at boot, and each time the frame area is shown; after each write.
//   written       by the shell only, on a tap (the bar's sheet, or the frame's tap-gated bridge call), with
//                 if_updated_at; applets can't (their writes are content-only, and they can't tag a note parachute-*).
//   open on start the shell's rule, in start.ts: never on the record alone.
import { useSyncExternalStore } from "react";
import { appletsNow, refreshApplets, subscribeApplets } from "../applet/useApplets";
import { plain } from "../applet/contract";
import { clientFor } from "../vault/client";
import { listVaults, subscribeVaults, type VaultRecord } from "../vault/store";
import { homeVault } from "./frameSource";

export const SETTINGS_TAG = "parachute-settings";
export const SETTINGS_PATH = "Parachute/Settings";
export const SETTINGS_KEY = "parachute.homesettings.v1";
export const MAX_PLACES = 12;

/** A place as the note names it. */
export type Place = { vault: string; hub?: string; applet: string };
export type Settings = { bar: Place[]; start: Place | null };
/** A place this device can open: its vault (this device's key) and the applet's note. */
export type Found = { vault: string; noteId: string; name: string; glyph: string; href: string };

const EMPTY: Settings = { bar: [], start: null };
const line = (x: unknown, max: number): x is string => typeof x === "string" && x.length > 0 && x.length <= max && !/[\u0000-\u001f]/.test(x);

function placeOf(x: unknown): Place | null {
  if (!plain(x) || !Object.keys(x).every((k) => k === "vault" || k === "hub" || k === "applet")) return null;
  if (!line(x.vault, 120) || !line(x.applet, 300) || (x.hub !== undefined && !line(x.hub, 300))) return null;
  return { vault: x.vault, applet: x.applet, ...(x.hub !== undefined ? { hub: x.hub as string } : {}) };
}

/** The choices in a settings note's metadata. A place that doesn't parse is dropped, never the rest. */
export function settingsFrom(metadata: unknown): Settings {
  const p = plain(metadata) && plain(metadata.parachute) ? metadata.parachute : null;
  if (!p) return { ...EMPTY };
  const bar = Array.isArray(p.bar) ? p.bar.slice(0, MAX_PLACES).map(placeOf).filter((x): x is Place => !!x) : [];
  return { bar: dedupe(bar), start: placeOf(p.start) };
}
const same = (a: Place, b: Place) => a.vault === b.vault && a.applet === b.applet && (a.hub ?? "") === (b.hub ?? "");
const dedupe = (xs: Place[]) => xs.filter((x, i) => xs.findIndex((y) => same(x, y)) === i);

const originOf = (issuer: string) => { try { return new URL(issuer).origin; } catch { return issuer; } };
/** The vault a place names: by its hub when it names one, else the one on the home vault's hub, else the first. */
export function vaultFor(p: Pick<Place, "vault" | "hub">, list: readonly VaultRecord[] = listVaults(), home: VaultRecord | null = homeVault(list)): VaultRecord | null {
  const named = list.filter((v) => v.vault === p.vault);
  if (p.hub) return named.find((v) => originOf(v.issuer) === originOf(p.hub!)) ?? null;
  return named.find((v) => home && originOf(v.issuer) === originOf(home.issuer)) ?? named[0] ?? null;
}
/** How the note names one of this device's applets: by its vault's name (and hub, when another hub holds that name too), and its note's path. */
export function placeFor(rec: VaultRecord, appletPath: string, list: readonly VaultRecord[] = listVaults()): Place {
  const twice = list.some((v) => v.key !== rec.key && v.vault === rec.vault);
  return { vault: rec.vault, ...(twice ? { hub: originOf(rec.issuer) } : {}), applet: appletPath };
}

const stripExt = (p: string) => p.replace(/\.(html|tsx|jsx)$/i, "");
/** The applet a place names, as this device last read that vault's applets; null when it isn't there (or not read yet). */
export function find(p: Place): Found | null {
  const rec = vaultFor(p);
  if (!rec) return null;
  const a = appletsNow(rec.key);
  if (a?.state !== "ok") return null;
  const e = a.found.entries.find((x) => x.noteId === p.applet) ?? a.found.entries.find((x) => stripExt(x.path) === stripExt(p.applet));
  return e ? { vault: rec.key, noteId: e.noteId, name: e.manifest.name, glyph: e.manifest.glyph, href: `/v/${encodeURIComponent(rec.key)}/a/${encodeURIComponent(e.noteId)}` } : null;
}
/** Read the applets of every vault the choices name (once each), so `find` can answer. */
export async function readPlaces(s: Settings): Promise<void> {
  const recs = new Map<string, VaultRecord>();
  for (const p of [...s.bar, ...(s.start ? [s.start] : [])]) { const r = vaultFor(p); if (r && appletsNow(r.key)?.state !== "ok") recs.set(r.key, r); }
  await Promise.all([...recs.values()].map((r) => refreshApplets(r)));
}

// ── what this device keeps: the last copy read, per home vault ──

type Kept = { vault: string; settings: Settings; noteId: string | null; updatedAt: string | null };
const storage = () => (typeof localStorage === "undefined" ? null : localStorage);
function keptNow(): Kept | null {
  try {
    const v = JSON.parse(storage()?.getItem(SETTINGS_KEY) ?? "null") as Kept | null;
    return v && typeof v.vault === "string" ? { vault: v.vault, settings: settingsFrom({ parachute: v.settings }), noteId: typeof v.noteId === "string" ? v.noteId : null, updatedAt: typeof v.updatedAt === "string" ? v.updatedAt : null } : null;
  } catch { return null; }
}
const keepNow = (k: Kept) => { try { storage()?.setItem(SETTINGS_KEY, JSON.stringify(k)); } catch { /* this session only */ } };

// ── the store ──

type State = { read: "none" | "reading" | "read" | "unreachable"; rev: number };
let state: State = { read: "none", rev: 0 };
const listeners = new Set<() => void>();
const bump = (p: Partial<State> = {}) => { state = { ...state, ...p, rev: state.rev + 1 }; listeners.forEach((f) => f()); };

/** The choices now: the last copy read from the home vault this device has now (none for another home). */
export function settingsNow(): Settings {
  const k = keptNow();
  const home = homeVault();
  return k && home && k.vault === home.key ? k.settings : { ...EMPTY };
}
/** Whether the home vault has been read this session (or couldn't be). */
export const settingsRead = () => state.read === "read" || state.read === "unreachable";

let generation = 0;
/** Read the settings note again. A read a newer one (or a change of home) overtook is dropped. */
export async function readSettings(): Promise<void> {
  const home = homeVault();
  const mine = ++generation;
  if (!home) { bump({ read: "read" }); return; }
  bump({ read: "reading" });
  try {
    const rows = await clientFor(home).queryNotes({ tag: SETTINGS_TAG, includeMetadata: true, limit: 20 });
    // two notes: the one at the usual path, else none (the person sees the bar empty and can fix it)
    const n = rows.length === 1 ? rows[0] : rows.find((r) => stripExt(r.path ?? "") === SETTINGS_PATH) ?? null;
    if (mine !== generation || homeVault()?.key !== home.key) return;
    keepNow({ vault: home.key, settings: n ? settingsFrom(n.metadata) : { ...EMPTY }, noteId: n?.id ?? null, updatedAt: (n as { updatedAt?: string } | null)?.updatedAt ?? null });
    await readPlaces(settingsNow());
    if (mine !== generation) return;
    bump({ read: "read" });
  } catch {
    if (mine !== generation) return;
    await readPlaces(settingsNow()).catch(() => {});
    bump({ read: "unreachable" });
  }
}

/** Change the choices (a tap's): read the note as it is now, change only what was asked, and write it back. */
export async function changeSettings(change: (s: Settings) => Settings): Promise<void> {
  const home = homeVault();
  if (!home) throw new Error("There's no home vault yet.");
  const c = clientFor(home);
  const rows = await c.queryNotes({ tag: SETTINGS_TAG, includeMetadata: true, limit: 20 });
  const n = rows.length === 1 ? rows[0] : rows.find((r) => stripExt(r.path ?? "") === SETTINGS_PATH) ?? null;
  if (!n && rows.length > 1) throw new Error(`Your home vault has ${rows.length} settings notes; keep one, at ${SETTINGS_PATH}.`);
  const next = change(n ? settingsFrom(n.metadata) : { ...EMPTY });
  const parachute = { ...(plain(n?.metadata) && plain(n!.metadata!.parachute) ? n!.metadata!.parachute as Record<string, unknown> : {}), bar: next.bar.slice(0, MAX_PLACES), start: next.start };
  if (n) {
    const updatedAt = (n as { updatedAt?: string }).updatedAt;
    await c.updateNote(n.id, { metadata: { ...(n.metadata ?? {}), parachute }, ...(updatedAt ? { if_updated_at: updatedAt } : {}) } as Parameters<typeof c.updateNote>[1]);
  } else {
    await c.createNote({ path: SETTINGS_PATH, content: "The bar and the home applet of the Parachute app. See docs/NAVIGATION.md.", tags: [SETTINGS_TAG], metadata: { parachute } } as Parameters<typeof c.createNote>[0]);
  }
  await readSettings();
}

export const pin = (p: Place, on: boolean) => changeSettings((s) => ({ ...s, bar: on ? (s.bar.some((x) => same(x, p)) ? s.bar : [...s.bar, p]) : s.bar.filter((x) => !same(x, p)) }));
export const move = (p: Place, by: -1 | 1) => changeSettings((s) => {
  const i = s.bar.findIndex((x) => same(x, p)), j = i + by;
  if (i < 0 || j < 0 || j >= s.bar.length) return s;
  const bar = [...s.bar];
  [bar[i], bar[j]] = [bar[j], bar[i]];
  return { ...s, bar };
});
export const setStart = (p: Place | null) => changeSettings((s) => ({ ...s, start: p }));
export const samePlace = same;

/** A place names this applet of this device's (by id or path). */
const names = (p: Place, vault: string, noteId: string) => { const f = find(p); return !!f && f.vault === vault && f.noteId === noteId; };
function appletPlace(vault: string, noteId: string): Place {
  const rec = listVaults().find((v) => v.key === vault);
  const a = appletsNow(vault);
  const e = a?.state === "ok" ? a.found.entries.find((x) => x.noteId === noteId) : undefined;
  if (!rec || !e) throw new Error("That isn't an applet this vault has.");
  return placeFor(rec, stripExt(e.path));
}
/** Pin one of this device's applets (at the end of the bar), or unpin it however the note names it. */
export function pinApplet(vault: string, noteId: string, on: boolean): Promise<void> {
  const p = appletPlace(vault, noteId);
  return changeSettings((s) => ({ ...s, bar: on ? (s.bar.some((x) => same(x, p) || names(x, vault, noteId)) ? s.bar : [...s.bar, p]) : s.bar.filter((x) => !same(x, p) && !names(x, vault, noteId)) }));
}
/** Make one of this device's applets the home, or none. */
export function startApplet(vault: string, noteId: string | null): Promise<void> {
  const p = noteId === null ? null : appletPlace(vault, noteId);
  return changeSettings((s) => ({ ...s, start: p }));
}

/** The bar as this device can show it: the home applet first, then the pins it can find, each once. */
export function barNow(s: Settings = settingsNow()): { start: (Found & { place: Place }) | null; pins: (Found & { place: Place })[] } {
  const start = s.start ? find(s.start) : null;
  const pins: (Found & { place: Place })[] = [];
  for (const p of s.bar) {
    const f = find(p);
    if (f && !(start && f.vault === start.vault && f.noteId === start.noteId) && !pins.some((x) => x.vault === f.vault && x.noteId === f.noteId)) pins.push({ ...f, place: p });
  }
  return { start: start && s.start ? { ...start, place: s.start } : null, pins };
}

// what `find` answers changes with the applets read and the vaults held
subscribeApplets(() => bump());
subscribeVaults(() => bump());
export function subscribeSettings(f: () => void): () => void {
  listeners.add(f);
  return () => { listeners.delete(f); };
}
export function useSettings() {
  useSyncExternalStore(subscribeSettings, () => `${state.rev}:${homeVault()?.key ?? ""}`);
  return { settings: settingsNow(), bar: barNow(), read: state.read };
}
