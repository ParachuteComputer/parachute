// The bar and the home: the person's choices, one note in their home vault (docs/NAVIGATION.md). Like the frame record
// (frameSource.ts), it lives on the person's side, so their agent can change it by writing that note, and the app keeps
// the last copy it read for when the vault can't be reached.
//
//   the note      `Parachute/Settings` in the home vault, tagged `parachute-settings`. Its metadata `parachute`:
//                   bar:   [{vault, hub?, applet}]   the pinned places, in order
//                   start: {vault, hub?, applet} | null   the home applet: it opens on start, first on the bar
//                   hubs:  [{hub, name?}]   the person's Parachutes (docs/design/ONE-SIGN-IN.md): shown, never signed
//                          in to by themselves
//                   bundle: "simple" | "everything" | <id>   which bundle this person's devices open (shell/bundles.ts,
//                          docs/SIMPLE.md): the simple one (Notes, Capture, Connect), everything (the launcher, every
//                          applet), or a bundle record's. Absent: everything. A new person's first sign-in writes "simple".
//                          Its older name `app` is read for one release (until 2026-12-20); a change writes `bundle`
//                   services: [{name, kind, url}]   the servers the person's applets reach (docs/design/SERVICES.md):
//                          their relay, their mail gateway. Shown in Settings with the applets that reach each; an
//                          applet's own record still names what it reaches, and its card is what allows it
//                 `vault` is a vault's name (with `hub`, an issuer origin, when two hubs hold vaults of that name);
//                 `applet` is the applet note's id or path. A place this device can't find is left out.
//   read          at boot, and each time the frame area is shown; after each write.
//   written       by the shell only, on a tap (the bar's sheet, or the frame's tap-gated bridge call), with
//                 if_updated_at; applets can't (their writes are content-only, and they can't tag a note parachute-*).
//   open on start the shell's rule, in start.ts: never on the record alone.
import { useSyncExternalStore } from "react";
import { appletsNow, refreshApplets, subscribeApplets } from "../applet/useApplets";
import { plain, stripExt } from "../applet/contract";
import { clientFor } from "../vault/client";
import { originOf, listVaults, subscribeVaults, type VaultRecord } from "../vault/store";
import { isMine } from "../vault/whose";
import { homeVault } from "./frameSource";
import { parseHub } from "../vault/parachute";
import { normalUrl } from "../applet/services";
import type { Levels } from "./levels";
import { BUNDLE_TAG, bundleOf as bundleRecordOf, bundlesFrom, followed, newerBundle, openBundle, recordOf, BUNDLE_FOLDER, OLD_BUNDLE_FOLDER, OLD_BUNDLE_TAG, type Bundle } from "./bundles";

export const SETTINGS_TAG = "parachute-settings";
export const SETTINGS_PATH = "Parachute/Settings";
export const SETTINGS_KEY = "parachute.homesettings.v1";
export const MAX_PLACES = 12;

/** A place as the note names it. */
export type Place = { vault: string; hub?: string; applet: string };
/** One of the person's Parachutes, as the note lists it: its address (an origin) and, maybe, what to call it. */
export type HubEntry = { hub: string; name?: string };
/** A server the person's applets reach, as the note lists it. */
export type ServiceEntry = { name: string; kind: "nostr-relay" | "http"; url: string };
/** Which bundle the person's devices open: "simple" (docs/SIMPLE.md), "everything", or the id of a bundle record
 *  (shell/bundles.ts); null: the note says nothing. Older apps read any other id as everything. */
export type BundleChoice = string;
export type Settings = { bar: Place[]; start: Place | null; hubs: HubEntry[]; services: ServiceEntry[]; bundle: BundleChoice | null };
/** A place this device can open: its vault (this device's key) and the applet's note. */
export type Found = { vault: string; noteId: string; name: string; glyph: string; href: string };

const EMPTY: Settings = { bar: [], start: null, hubs: [], services: [], bundle: null };
const choiceOf = (x: unknown): BundleChoice | null => (typeof x === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(x) && x.length <= 40 ? x : null);
const line = (x: unknown, max: number): x is string => typeof x === "string" && x.length > 0 && x.length <= max && !/[\u0000-\u001f]/.test(x);

function placeOf(x: unknown): Place | null {
  if (!plain(x) || !Object.keys(x).every((k) => k === "vault" || k === "hub" || k === "applet")) return null;
  if (!line(x.vault, 120) || !line(x.applet, 300) || (x.hub !== undefined && !line(x.hub, 300))) return null;
  return { vault: x.vault, applet: x.applet, ...(x.hub !== undefined ? { hub: x.hub as string } : {}) };
}

/** A Parachute the note lists: an address that parses as one (vault/parachute.ts), and a short name if it has one. */
export function hubOf(x: unknown): HubEntry | null {
  if (!plain(x) || !line(x.hub, 300)) return null;
  const parsed = parseHub(x.hub);
  if (!parsed.ok) return null;
  const name = line(x.name, 60) ? (x.name as string) : undefined;
  return { hub: parsed.hub, ...(name ? { name } : {}) };
}

/** A server the note lists: a name, a kind and an address that parses as one (applet/services.ts), else nothing. */
export function serviceOf(x: unknown): ServiceEntry | null {
  if (!plain(x) || !line(x.name, 60) || (x.kind !== "nostr-relay" && x.kind !== "http")) return null;
  const u = normalUrl(x.url, x.kind === "http" ? ["https", "http"] : ["wss", "ws"], x.kind === "http");
  return u.ok ? { name: x.name as string, kind: x.kind, url: x.kind === "http" ? u.value.href : u.value.href.replace(/\/$/, "") } : null;
}

/** The choices in a settings note's metadata. A place (or a Parachute) that doesn't parse is dropped, never the rest. */
export function settingsFrom(metadata: unknown): Settings {
  const p = plain(metadata) && plain(metadata.parachute) ? metadata.parachute : null;
  if (!p) return { ...EMPTY, bar: [], hubs: [], services: [] };
  const bar = Array.isArray(p.bar) ? p.bar.slice(0, 200).map(placeOf).filter((x): x is Place => !!x) : [];
  const hubs = (Array.isArray(p.hubs) ? p.hubs.slice(0, 50).map(hubOf).filter((x): x is HubEntry => !!x) : []).filter((h, i, all) => all.findIndex((y) => y.hub === h.hub) === i);
  const services = Array.isArray(p.services) ? p.services.slice(0, 20).map(serviceOf).filter((x): x is ServiceEntry => !!x) : [];
  return { bar: dedupe(bar), start: placeOf(p.start), hubs, services, bundle: choiceOf(p.bundle) ?? choiceOf(p.app) };
}
const same = (a: Place, b: Place) => a.vault === b.vault && a.applet === b.applet && (a.hub ?? "") === (b.hub ?? "");
const dedupe = (xs: Place[]) => xs.filter((x, i) => xs.findIndex((y) => same(x, y)) === i);

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

/** The applet a place names, as this device last read that vault's applets; null when it isn't there (or not read yet). */
function findLive(p: Place): Found | null {
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

// ── what this device keeps: the last copy read, per home vault, and what its places named then ──

/** `bundles`: the bundle records read from the home vault (and, for one that follows someone else's, from theirs), as
 *  written; `app` is the record's body (its name from before the rename, kept for the copies devices already hold). */
type RawBundle = { app: unknown; path: string | null; noteId: string | null; hubOf?: string };
type Kept = { vault: string; settings: Settings; noteId: string | null; updatedAt: string | null; found: Record<string, Found>; apps?: RawBundle[] };
const storage = () => (typeof localStorage === "undefined" ? null : localStorage);
const keyOf = (p: Place) => `${p.vault}|${p.hub ?? ""}|${p.applet}`;
let keptRaw: string | null | undefined, keptParsed: Kept | null = null;
/** The kept copy, parsed once per change of what is stored. */
function keptNow(): Kept | null {
  let raw: string | null = null;
  try { raw = storage()?.getItem(SETTINGS_KEY) ?? null; } catch { raw = null; }
  if (raw === keptRaw) return keptParsed;
  keptRaw = raw;
  keptParsed = parseKept(raw);
  return keptParsed;
}
function parseKept(raw: string | null): Kept | null {
  try {
    const v = JSON.parse(raw ?? "null") as Kept | null;
    if (!v || typeof v.vault !== "string") return null;
    const found: Record<string, Found> = {};
    if (plain(v.found)) for (const [k, f] of Object.entries(v.found)) if (plain(f) && line(f.vault, 200) && line(f.noteId, 300) && typeof f.name === "string" && typeof f.glyph === "string" && typeof f.href === "string") found[k] = f as Found;
    const apps = Array.isArray(v.apps) ? v.apps.filter((a): a is RawBundle => plain(a) && (a.path === null || typeof a.path === "string")).slice(0, 50) : [];
    return { vault: v.vault, settings: settingsFrom({ parachute: v.settings }), noteId: typeof v.noteId === "string" ? v.noteId : null, updatedAt: typeof v.updatedAt === "string" ? v.updatedAt : null, found, apps };
  } catch { return null; }
}
const keepNow = (k: Kept) => { try { storage()?.setItem(SETTINGS_KEY, JSON.stringify(k)); } catch { /* this session only */ } };
/** Signing out of a vault: the copy kept from it goes (another vault could later take its key). */
export function forgetVaultSettings(vault: string) { if (keptNow()?.vault === vault) { try { storage()?.removeItem(SETTINGS_KEY); } catch { /* nothing kept */ } bump(); } }

/** The applet a place names: as this device last read that vault's applets, else as it found it when it last could
 *  (so the bar stays while the vault can't be reached). */
export function find(p: Place): Found | null {
  const rec = vaultFor(p);
  if (rec && appletsNow(rec.key)?.state === "ok") return findLive(p);
  const k = keptNow();
  const f = k?.found[keyOf(p)];
  return f && rec && f.vault === rec.key ? f : null;
}

// ── the store ──

type State = { read: "none" | "reading" | "read" | "unreachable"; rev: number };
let state: State = { read: "none", rev: 0 };
const listeners = new Set<() => void>();
const bump = (p: Partial<State> = {}) => { state = { ...state, ...p, rev: state.rev + 1 }; listeners.forEach((f) => f()); };

/** The choices now: the last copy read from the home vault this device has now (none for another home). */
export function settingsNow(): Settings {
  const k = keptNow();
  const home = homeVault();
  if (k && home && k.vault === home.key && (k.noteId || !simpleHere())) return k.settings;
  // a new person's simple app, chosen at their first sign-in, until the note can say so (docs/SIMPLE.md): the sign-in
  // reads the home only, so the note is written the first time they let Parachute change notes there. Only while the
  // home has no settings note: one there says what it says
  return simpleHere() && home ? { ...EMPTY, bundle: "simple" } : { ...EMPTY };
}

const SIMPLE_HERE_KEY = "parachute.app.simple-here.v1";
const simpleHere = () => { try { return localStorage.getItem(SIMPLE_HERE_KEY) === "1"; } catch { return false; } };
/** This device starts on the simple app (a new person on Parachute Cloud), whatever the note says until it says. */
export function startSimpleHere() { try { localStorage.setItem(SIMPLE_HERE_KEY, "1"); } catch { /* this session */ } bump({}); }
/** The note now says which app (written, or changed in Settings): the device's own start gives way. */
export function forgetSimpleHere() { try { localStorage.removeItem(SIMPLE_HERE_KEY); } catch { /* nothing */ } }

/** Whether the settings note was read from the home vault this session (not only the copy kept from before). Stays
 *  true while a later read runs, so a quick Back to the home doesn't find it "not read"; a read that fails clears it. */
let readThisSession: string | null = null;
export const settingsReadNow = () => readThisSession !== null && readThisSession === homeVault()?.key;

/** The settings note: the one note tagged so, or the one at the usual path when there are more. */
const pick = (rows: { path?: string | null }[]) => (rows.length === 1 ? rows[0] : rows.find((r) => stripExt(r.path ?? "") === SETTINGS_PATH) ?? null);

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
    const n = pick(rows) as (typeof rows)[number] | null;
    if (mine !== generation || homeVault()?.key !== home.key) return;
    const settings = n ? settingsFrom(n.metadata) : { ...EMPTY };
    const apps = await readBundleRecords(home).catch(() => keptNow()?.vault === home.key ? keptNow()?.apps ?? [] : []);
    if (mine !== generation || homeVault()?.key !== home.key) return;
    await readPlaces(effective(settings, parseBundles(apps)));
    if (mine !== generation || homeVault()?.key !== home.key) return;
    // what each place names now; a place in a vault whose applets couldn't be read keeps what it named before
    const was = keptNow();
    const before = was?.vault === home.key ? was.found : {};
    const found: Record<string, Found> = {};
    const eff = effective(settings, parseBundles(apps));
    for (const p of [...settings.bar, ...(settings.start ? [settings.start] : []), ...eff.bar, ...(eff.start ? [eff.start] : [])]) {
      const rec = vaultFor(p);
      const f = rec && appletsNow(rec.key)?.state === "ok" ? findLive(p) : before[keyOf(p)];
      if (f) found[keyOf(p)] = f;
    }
    keepNow({ vault: home.key, settings, noteId: n?.id ?? null, updatedAt: (n as { updatedAt?: string } | null)?.updatedAt ?? null, found, apps });
    readThisSession = home.key;
    bump({ read: "read" });
  } catch {
    if (mine !== generation) return;
    readThisSession = null;
    bump({ read: "unreachable" });
  }
}

/** The note's choices as written, entries this app doesn't read included: a change keeps them. */
type Raw = { bar: unknown[]; start: unknown; hubs: unknown[]; bundle?: BundleChoice };
const parsedAs = (x: unknown, f: (p: Place) => boolean) => { const p = placeOf(x); return !!p && f(p); };

/** Change the choices (a tap's): read the note as it is now, change only what was asked, and write it back.
 *  `creating`: there is no settings note yet, and this write makes it. */
async function changeSettings(change: (raw: Raw, creating: boolean) => Raw): Promise<void> {
  const home = homeVault();
  if (!home) throw new Error("There's no home vault yet.");
  const c = clientFor(home);
  const rows = await c.queryNotes({ tag: SETTINGS_TAG, includeMetadata: true, limit: 20 });
  const n = pick(rows) as (typeof rows)[number] | null;
  if (!n && rows.length > 1) throw new Error(`Your home vault has ${rows.length} settings notes; keep one, at ${SETTINGS_PATH}.`);
  const was = plain(n?.metadata) && plain(n!.metadata!.parachute) ? n!.metadata!.parachute as Record<string, unknown> : {};
  const next = change({ bar: Array.isArray(was.bar) ? was.bar : [], start: was.start ?? null, hubs: Array.isArray(was.hubs) ? was.hubs : [] }, !n);
  // the choice of bundle is written under its new name and, until 2026-12-20, its older one, which the builds before
  // 11-20 read (a new device of the person's may run one)
  const parachute = { ...was, bar: next.bar, start: next.start, ...(next.hubs.length || Array.isArray(was.hubs) ? { hubs: next.hubs } : {}), ...(next.bundle ? { bundle: next.bundle, app: next.bundle } : {}) };
  if (n) {
    const updatedAt = (n as { updatedAt?: string }).updatedAt;
    await c.updateNote(n.id, { metadata: { ...(n.metadata ?? {}), parachute }, ...(updatedAt ? { if_updated_at: updatedAt } : {}) } as Parameters<typeof c.updateNote>[1]);
  } else {
    await c.createNote({ path: SETTINGS_PATH, content: "The bar, the home applet and the Parachutes of the Parachute app. See docs/NAVIGATION.md.", tags: [SETTINGS_TAG], metadata: { parachute } } as Parameters<typeof c.createNote>[0]);
  }
  await readSettings();
}

/** Add `add` at the end unless a place already matches; or take out every place that matches. */
function pinRaw(raw: Raw, match: (p: Place) => boolean, add: Place | null): Raw {
  if (!add) return { ...raw, bar: raw.bar.filter((x) => !parsedAs(x, match)) };
  if (raw.bar.some((x) => parsedAs(x, match))) return raw;
  // the places the bar shows: the ones found here
  const onBar = new Set(raw.bar.map((x) => { const p = placeOf(x); const f = p ? find(p) : null; return f ? `${f.vault}|${f.noteId}` : null; }).filter(Boolean));
  if (onBar.size >= MAX_PLACES) throw new Error(`The bar holds ${MAX_PLACES} places: unpin one first.`);
  return { ...raw, bar: [...raw.bar, add] };
}
/** The raw entries the bar shows, as barNow picks them: found here, the first name of each applet. */
function shownIndices(r: Raw): number[] {
  const seen = new Set<string>();
  const out: number[] = [];
  r.bar.forEach((x, i) => { const p = placeOf(x), f = p ? find(p) : null; if (f && out.length < MAX_PLACES && !seen.has(`${f.vault}|${f.noteId}`)) { seen.add(`${f.vault}|${f.noteId}`); out.push(i); } });
  return out;
}
/** Swap a place with its neighbour on the bar as shown, left or right (entries the bar doesn't show don't count). */
export const move = (p: Place, by: -1 | 1) => changeChoices((r) => {
  const shown = shownIndices(r);
  const k = shown.findIndex((i) => parsedAs(r.bar[i], (y) => same(y, p)));
  if (k < 0 || k + by < 0 || k + by >= shown.length) return r;
  const i = shown[k], j = shown[k + by];
  const bar = [...r.bar];
  [bar[i], bar[j]] = [bar[j], bar[i]];
  return { ...r, bar };
});
/** Put a Parachute on the person's list (after a sign-in to it), unless it is there; or take it off. `bundleIfNew`:
 *  which bundle their devices open, written only if this write makes their settings note (a new person's first
 *  sign-in): a note already there keeps what it says. */
export const listHub = (hub: string, on: boolean, name?: string, bundleIfNew?: BundleChoice) => changeSettings((r, creating) => {
  const has = r.hubs.some((x) => hubOf(x)?.hub === hub);
  const withApp = bundleIfNew && creating ? { ...r, bundle: bundleIfNew } : r;
  if (on) return has ? withApp : { ...withApp, hubs: [...r.hubs, { hub, ...(name ? { name } : {}) }] };
  return has ? { ...withApp, hubs: r.hubs.filter((x) => hubOf(x)?.hub !== hub) } : withApp;
});
/** Which bundle the person's devices open (Settings, a tap). */
export const setBundle = async (bundle: BundleChoice) => { await changeSettings((r) => ({ ...r, bundle })); forgetSimpleHere(); };
export const setStart = (p: Place | null) => changeChoices((r) => ({ ...r, start: p }));
export const samePlace = same;

/** A place names this applet of this device's (by id or path). */
const names = (p: Place, vault: string, noteId: string) => { const f = find(p); return !!f && f.vault === vault && f.noteId === noteId; };
/** How the note will name one of this device's applets (its vault's applets read first, if this session hasn't yet). */
async function appletPlace(vault: string, noteId: string): Promise<Place> {
  const rec = listVaults().find((v) => v.key === vault);
  if (rec && appletsNow(vault)?.state !== "ok") await refreshApplets(rec);
  const a = appletsNow(vault);
  const e = a?.state === "ok" ? a.found.entries.find((x) => x.noteId === noteId) : undefined;
  if (!rec || !e) throw new Error("That isn't an applet this vault has.");
  return placeFor(rec, stripExt(e.path));
}
/** Pin one of this device's applets (at the end of the bar), or unpin it however the note names it. */
export async function pinApplet(vault: string, noteId: string, on: boolean): Promise<void> {
  // unpinning needs no read of that vault: what each place names comes from the copy kept when it can't be read
  if (!on) return changeChoices((r) => pinRaw(r, (x) => names(x, vault, noteId), null));
  const p = await appletPlace(vault, noteId);
  return changeChoices((r) => pinRaw(r, (x) => same(x, p) || names(x, vault, noteId), on ? p : null));
}
/** Make one of this device's applets the home, or none. */
export async function startApplet(vault: string, noteId: string | null): Promise<void> {
  // the home applet is in a vault of the person's own: someone else's code never opens by itself (docs/design/EMBED.md)
  const rec = listVaults().find((v) => v.key === vault);
  if (noteId !== null && (!rec || !isMine(rec))) throw new Error("Only an applet in a vault of yours can open on start.");
  const p = noteId === null ? null : await appletPlace(vault, noteId);
  return changeChoices((r) => ({ ...r, start: p }));
}

/** The bar as this device can show it: the pins it can find, in their order, each once; and the home applet, which is on
 *  the bar only when it is pinned (the record's bar is the bar: the shell adds nothing of its own to it). */
export function barNow(s: Settings = effective(settingsNow(), bundlesNow())): { start: (Found & { place: Place }) | null; pins: (Found & { place: Place })[] } {
  const start = s.start ? find(s.start) : null;
  const pins: (Found & { place: Place })[] = [];
  for (const p of s.bar) {
    const f = find(p);
    if (f && !pins.some((x) => x.vault === f.vault && x.noteId === f.noteId)) pins.push({ ...f, place: p });
    if (pins.length === MAX_PLACES) break;
  }
  return { start: start && s.start ? { ...start, place: s.start } : null, pins };
}

// ── bundles (shell/bundles.ts): the records, which one is open here, and the bar and home it gives ──

type Client = ReturnType<typeof clientFor>;
type Row = Awaited<ReturnType<Client["queryNotes"]>>[number];
/** A vault's bundle records with their bodies: the ones under `parachute-bundle` first, then the older ones under
 *  `parachute-app` (read for one release, until 2026-12-20), so a bundle of the same id wins (bundlesFrom keeps the
 *  first). `old`: the record still has its older tag, path and field. */
async function bundleRows(c: Client): Promise<{ row: Row; body: unknown; old: boolean }[]> {
  const [rows, olds] = await Promise.all([c.queryNotes({ tag: BUNDLE_TAG, includeMetadata: true, limit: 50 }), c.queryNotes({ tag: OLD_BUNDLE_TAG, includeMetadata: true, limit: 50 })]);
  const seen = new Set(rows.map((r) => r.id));
  return [...rows.map((row) => ({ row, body: plain(row.metadata) ? row.metadata.bundle : undefined, old: false })),
    ...olds.filter((r) => !seen.has(r.id)).map((row) => ({ row, body: plain(row.metadata) ? row.metadata.app : undefined, old: true }))];
}
const atFolder = (path: string | null | undefined, id: unknown) => [BUNDLE_FOLDER, OLD_BUNDLE_FOLDER].some((f) => stripExt(path ?? "") === `${f}${String(id)}`);
/** Two paths of one bundle record: the same, or the same id under the newer and the older folder. */
export const sameRecord = (a: string | null | undefined, b: string) => {
  const tail = (x: string) => { const y = stripExt(x); const f = [BUNDLE_FOLDER, OLD_BUNDLE_FOLDER].find((g) => y.startsWith(g)); return f ? `${BUNDLE_FOLDER}${y.slice(f.length)}` : y; };
  return tail(a ?? "") === tail(b);
};

/** The bundle records in the home vault, and for each that follows someone else's bundle (`live`), that one as it is in
 *  their vault now, when this device holds it. */
async function readBundleRecords(home: VaultRecord): Promise<RawBundle[]> {
  const out: RawBundle[] = [];
  for (const { row: r, body: raw } of await bundleRows(clientFor(home))) {
    const a = bundleRecordOf(raw, r.path ?? null, r.id);
    // one made for a newer Parachute is kept as it is (never read here), so the list can say to update
    if (!a) { if (newerBundle(raw) && plain(raw) && atFolder(r.path, raw.id)) out.push({ app: raw, path: r.path ?? null, noteId: r.id }); continue; }
    if (!a.live) { out.push({ app: raw, path: r.path ?? null, noteId: r.id }); continue; }
    const there = listVaults().find((v) => originOf(v.issuer) === a.live!.hub && v.vault === a.live!.vault);
    if (!there) { out.push({ app: raw, path: r.path ?? null, noteId: r.id }); continue; }
    try {
      // a slow Parachute of theirs never holds up the start: past a few seconds, the copy kept from before
      let timer: ReturnType<typeof setTimeout> | undefined;
      const listed = await Promise.race([bundleRows(clientFor(there)), new Promise<never>((_, no) => { timer = setTimeout(() => no(new Error("slow")), 3000); })]).finally(() => clearTimeout(timer));
      // their record may have moved to the newer folder (or not yet): the same id in either is the same record
      const theirs = listed.find((x) => sameRecord(x.row.path, a.live!.path));
      // its places mean their hub when they name none
      // their record, under the person's own id and name, and never less careful than the person's own (bundles.ts followed)
      out.push(theirs && plain(theirs.body) ? { app: followed(a, raw, theirs.body), path: r.path ?? null, noteId: r.id, hubOf: a.live.hub } : { app: raw, path: r.path ?? null, noteId: r.id });
    } catch {
      const was = keptNow()?.vault === home.key ? keptNow()?.apps?.find((x) => x.noteId === r.id && x.hubOf) : undefined;
      out.push(was ?? { app: raw, path: r.path ?? null, noteId: r.id });
    }
  }
  return out;
}
const parseBundles = (raw: readonly RawBundle[]): Bundle[] => bundlesFrom(raw.map((r) => { const a = bundleRecordOf(r.app, r.path, r.noteId); return a && r.hubOf ? { ...a, hubOf: r.hubOf } : a; }).filter((a): a is Bundle => !!a));

/** The person's bundles: the built-ins and their records, as last read. */
export function bundlesNow(): Bundle[] {
  const k = keptNow(), home = homeVault();
  return parseBundles(k && home && k.vault === home.key ? k.apps ?? [] : []);
}
const DEVICE_BUNDLE_KEY = "parachute.app.open.v1";
/** Which bundle this device opens (its own choice, per home vault), or null to follow the settings note. */
export function deviceBundle(): string | null {
  try { const v = JSON.parse(localStorage.getItem(DEVICE_BUNDLE_KEY) ?? "{}") as Record<string, unknown>; const home = homeVault(); const x = home ? v[home.key] : null; return typeof x === "string" ? x : null; } catch { return null; }
}
/** Open this bundle here (Settings → Your bundle), and make it the one a new device opens. */
export async function chooseBundle(id: string): Promise<void> {
  const home = homeVault();
  if (!home) throw new Error("There's no home vault yet.");
  try { const v = JSON.parse(localStorage.getItem(DEVICE_BUNDLE_KEY) ?? "{}") as Record<string, unknown>; localStorage.setItem(DEVICE_BUNDLE_KEY, JSON.stringify({ ...v, [home.key]: id })); } catch { /* this session */ }
  bump({});
  await setBundle(id);
}
/** The bundle open on this device now. */
export const openBundleNow = (): Bundle => openBundle(bundlesNow(), deviceBundle(), settingsNow().bundle);
/** The bundle this device (or the settings note) chose, when its record didn't load (malformed, gone, or never read and no
 *  copy kept): the app then opens the next bundle it can (Everything at the end), and the list says so, with Settings. A
 *  broken record never locks the person out. null while the settings are first read, and when the chosen bundle is open. */
export function bundleMissing(): string | null {
  if (!settingsReadNow() && state.read !== "unreachable") return null;
  const chosen = deviceBundle() ?? settingsNow().bundle;
  return chosen && chosen !== openBundleNow().id ? chosen : null;
}

/** When the bundle that didn't load was made for a newer Parachute (bundles.ts newerBundle): its name, for "Update Parachute to
 *  use …". null otherwise. */
export function bundleNewer(chosen: string | null = bundleMissing()): string | null {
  const home = homeVault(), k = keptNow();
  if (!chosen || !home || k?.vault !== home.key) return null;
  const raw = (k.apps ?? []).find((r) => plain(r.app) && r.app.id === chosen && newerBundle(r.app) && atFolder(r.path, chosen))?.app;
  if (!plain(raw)) return null;
  return typeof raw.name === "string" && raw.name.length > 0 && raw.name.length <= 60 && !/[\u0000-\u001f]/.test(raw.name) ? raw.name : chosen;
}

/** The bar and home as the open bundle gives them: its own, or the settings note's when it has none. */
export function effective(s: Settings, apps: readonly Bundle[]): Settings {
  const app = openBundle(apps, deviceBundle(), s.bundle);
  // a bundle someone else offers: a place that names no hub is on theirs
  const at = (p: Place): Place => (app.hubOf && !p.hub ? { ...p, hub: app.hubOf } : p);
  return { ...s, bar: app.bar ? app.bar.map(at) : s.bar, start: app.start === undefined ? s.start : app.start && at(app.start) };
}

/** Change the open bundle's record: read it now, change only what `change` touches, and write it back with
 *  if_updated_at; made from the built-in the first time. An older record (`Parachute/Apps/<id>`, `parachute-app`,
 *  `fields.app`) is written as it is, under its older names: the builds before 11-20 read only those, and one of the
 *  person's devices may still run one. scripts/migrate-bundles.ts moves it once none does. */
async function changeBundle(change: (was: Record<string, unknown>, app: Bundle) => Record<string, unknown>, from: (app: Bundle) => Record<string, unknown>): Promise<void> {
  const home = homeVault();
  if (!home) throw new Error("There's no home vault yet.");
  const app = openBundleNow();
  const c = clientFor(home);
  const found = (await bundleRows(c)).find((r) => (app.noteId ? r.row.id === app.noteId : atFolder(r.row.path, app.id))) ?? null;
  if (app.noteId && !found) throw new Error("The bundle's record is gone; read it again.");
  const body = change(found && plain(found.body) ? found.body : from(app), app);
  const content = `The ${app.name} bundle: where its applets come from, its bar and its home. See docs/NAVIGATION.md.`;
  if (found) {
    const n = found.row, updatedAt = (n as { updatedAt?: string }).updatedAt;
    await c.updateNote(n.id, { metadata: { ...(n.metadata ?? {}), [found.old ? "app" : "bundle"]: body }, ...(updatedAt ? { if_updated_at: updatedAt } : {}) } as Parameters<typeof c.updateNote>[1]);
  } else {
    await c.createNote({ path: `${BUNDLE_FOLDER}${app.id}`, content, tags: [BUNDLE_TAG], metadata: { bundle: body } } as Parameters<typeof c.createNote>[0]);
  }
}

/** A change to the bar or the home: to the open bundle's record, or the settings note. Simple's and Everything's are
 *  kept in the settings note too, which older apps read. */
async function changeChoices(f: (raw: Raw, creating: boolean) => Raw): Promise<void> {
  if (!toRecord()) return changeSettings(f);
  if (openBundleNow().live) throw new Error(`${openBundleNow().name} is offered by someone else: its bar is theirs.`);
  const s = settingsNow();
  await changeBundle((was) => {
    const before: Raw = { bar: Array.isArray(was.bar) ? was.bar : s.bar, start: was.start === undefined ? s.start : was.start, hubs: [] };
    const r = f(before, false);
    // only what the change touched, or what the record already said, is written: the rest stays the settings note's
    return { ...was, ...(Array.isArray(was.bar) || JSON.stringify(r.bar) !== JSON.stringify(before.bar) ? { bar: r.bar } : {}),
      ...(was.start !== undefined || JSON.stringify(r.start ?? null) !== JSON.stringify(before.start ?? null) ? { start: r.start ?? null } : {}) };
  }, (app) => recordOf({ ...app, bar: s.bar, start: s.start }));
  const app = openBundleNow();
  if (app.id === "everything" || app.id === "simple") await changeSettings(f); else await readSettings();
}
/** The open bundle's security levels, written to its record (made from the built-in the first time) so every device
 *  that opens it follows (shell/levels.ts): only `security` changes. A lowering is signed first (`signLowering`);
 *  without that signature this write only ever raises another device. */
export async function changeSecurity(levels: Levels): Promise<void> {
  const app = openBundleNow();
  if (app.live) throw new Error(`${app.name} is offered by someone else: its levels are theirs, and yours can only be stricter.`);
  await changeBundle((was) => ({ ...was, security: { approvals: levels.approvals, code: levels.code, join: levels.join, idle: levels.idle } }), recordOf);
  await readSettings();
}

/** Whether a change to the bar or home goes to the open bundle's record (a bundle other than the two built-ins, or one
 *  of them whose record has a bar or a home of its own); else to the settings note, as before. */
const toRecord = () => { const a = openBundleNow(); return a.id !== "everything" && a.id !== "simple" ? true : a.noteId !== null && (a.bar !== null || a.start !== undefined); };

// what `find` answers changes with the applets read and the vaults held: followed from the first subscriber on (not at
// load: the applet list imports this module's readers back)
let following = false;
export function subscribeSettings(f: () => void): () => void {
  if (!following) { following = true; subscribeApplets(() => bump()); subscribeVaults(() => bump()); }
  listeners.add(f);
  return () => { listeners.delete(f); };
}
export function useSettings() {
  useSyncExternalStore(subscribeSettings, () => `${state.rev}:${homeVault()?.key ?? ""}`);
  return { settings: settingsNow(), bar: barNow(), read: state.read, bundle: openBundleNow(), bundles: bundlesNow() };
}
