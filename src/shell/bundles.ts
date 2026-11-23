// A bundle is a record (docs/design/APP-RECORD.md): `Parachute/Bundles/<id>` in the person's home vault, tagged
// `parachute-bundle`, everything under `fields.bundle`. It says where applets come from (one applet, every applet in a
// vault, every vault on a hub), the bar, the home applet, which applet opens which kind of note, and how many applets
// stay running. Being listed never runs anything: what runs is decided by the applet's card (and, once there, a signed
// approval). The person can have several; each device opens one. (Called an "app" record before 11-20: the Parachute
// app is the app, so the record that picks what it shows is a bundle.)
//
// The app ships two bundles as records (DEFAULT_BUNDLES), read like any other and obeying the same contract:
//   everything  every applet in every vault this device holds; the list is its home
//   simple      Parachute Simplified: Notes as its home, Journal, Capture and Connect on its bar (docs/SIMPLE.md)
// The person's record of the same id is read over a default: what it doesn't say, the default says. Nothing here or in
// the shell asks which id a bundle has; what a bundle does is what its record says. A bundle someone else offers is a record of theirs that the
// person's own record follows (`live`): read from their vault each time, so their changes show; their code still asks.
//
// Older records (`Parachute/Apps/<id>`, tagged `parachute-app`, under `fields.app`) are read the same, for one release
// (until 2026-12-20): a bundle of the same id wins. A change to an older record is written under its older names, which builds from
// before 11-20 read; scripts/migrate-bundles.ts moves it once none runs (homeSettings.ts).
// Pure, but for nothing: every reader here takes what it needs.
import { plain, stripExt } from "../applet/contract";
import { APP_LEVEL, tooNew } from "../applet/level";
import { askedOf, stricterAsked, type Asked } from "./levelRules";
import defaults from "./default-bundles.json";
import { officialFace, PARACHUTE_PUBLISHER } from "../applet/parachuteSource";

export const BUNDLE_TAG = "parachute-bundle";
export const BUNDLE_FOLDER = "Parachute/Bundles/";
/** The older names, read until 2026-12-20, and written while the vault holds no record under the newer ones (builds
 *  from before 11-20 read only these). */
export const OLD_BUNDLE_TAG = "parachute-app";
export const OLD_BUNDLE_FOLDER = "Parachute/Apps/";
export type Look = "launcher" | "notes";

/** One applet, as the bar names it today: its vault's name (and hub's origin, when not the home's) and its note's path or id. */
export type Place = { hub?: string; vault: string; applet: string };
/** A place on the bar that is the app's own: `home` (the bundle's home screen: Notes or the list, by its `look`),
 *  `connect` (Connect an AI), or an applet the app ships (`capture`, `journal`, `vault`: the home vault's copy, or the screen that adds it). */
export type AppPlace = { screen: "home" | "connect" } | { shipped: "capture" | "journal" | "vault" | "notes" | "connect" | "home" };
export type BarEntry = Place | AppPlace;
export const isAppPlace = (e: BarEntry): e is AppPlace => "screen" in e || "shipped" in e;
/** Where applets come from: one applet, `applet: "*"` for every applet in a vault, `vault: "*"` (with a hub) for every vault there. */
export type Source = { hub?: string; vault: string; applet: string };
export type OpensChoice = { type: string; hub?: string; vault: string; applet: string | null };
export type Keep = "auto" | number;
export type Bundle = {
  id: string; name: string; glyph: string; note: string;
  /** How its home looks: the launcher, or Parachute Simplified's Notes. */
  look: Look;
  sources: Source[]; hide: Place[];
  /** null: the record says none, so the settings note's (read until 2026-12-20), after `base`. */
  bar: BarEntry[] | null; start: Place | null | undefined;
  /** The bar a default of the same id starts with, when the record says none. */
  base: BarEntry[];
  opens: OpensChoice[]; keep: Keep;
  /** How careful the app is (docs/design/APP-RECORD.md "Security levels"; shell/levels.ts): per action (approvals,
   *  code, join) none, unlock or passcode, and the idle lock's minutes. It only raises a device's levels: lowering one
   *  takes the person's signed approval. */
  security: Asked;
  /** Whether it offers Parachute's own applets (docs/design/PARACHUTE-SOURCE.md): its `publishers` name Parachute's
   *  (https://parachute.computer/applets/), or it says none and its default does (a bundle of the person's own with no
   *  default offers them only once it names them). A record can leave the source out; it can never give a publisher a
   *  key: Parachute's keys are the app's own. */
  parachute: boolean;
  /** An app someone else offers, followed live: where its record is. */
  live?: { hub: string; vault: string; path: string };
  /** Where this bundle's record is: the home vault's note id, or none for a default no record changes. */
  noteId: string | null;
  /** The hub its places mean when they name none: the home's, or the offering Parachute's for a live app. */
  hubOf?: string;
};

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VAULT = /^[a-z0-9][a-z0-9_-]{0,79}$/;
const line = (x: unknown, max: number): x is string => typeof x === "string" && x.length > 0 && x.length <= max && !/[\u0000-\u001f]/.test(x);
const hubOk = (x: unknown): x is string => typeof x === "string" && x.length <= 300 && /^https?:\/\/[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?(?::[0-9]{1,5})?$/.test(x);
const only = (o: Record<string, unknown>, keys: string[]) => Object.keys(o).every((k) => keys.includes(k));

/** One of the app's own places on a bar, exactly as written; else null. */
function appPlaceOf(x: unknown): AppPlace | null {
  if (!plain(x)) return null;
  if (only(x, ["screen"]) && (x.screen === "home" || x.screen === "connect")) return { screen: x.screen };
  if (only(x, ["shipped"]) && (["capture", "journal", "vault", "notes", "connect", "home"] as unknown[]).includes(x.shipped)) return { shipped: x.shipped as "capture" };
  return null;
}
const barEntryOf = (x: unknown): BarEntry | null => appPlaceOf(x) ?? placeOf(x);

/** A place on the bar, the home, a hidden one: a key it doesn't know (a newer app's) is left out, not the place. */
export function placeOf(x: unknown): Place | null {
  if (!plain(x)) return null;
  if (typeof x.vault !== "string" || !VAULT.test(x.vault) || !line(x.applet, 300) || x.applet.includes("*")) return null;
  if (x.hub !== undefined && !hubOk(x.hub)) return null;
  return { vault: x.vault, applet: x.applet, ...(x.hub !== undefined ? { hub: x.hub as string } : {}) };
}
/** One applet, every applet in a vault, or every vault on a named hub. No "every hub", no "this applet in every vault".
 *  Strict: a key it doesn't know might narrow it, so such a source is left out (a narrower app). The same for `opens`. */
export function sourceOf(x: unknown): Source | null {
  if (!plain(x) || !only(x, ["hub", "vault", "applet"])) return null;
  if (x.hub !== undefined && !hubOk(x.hub)) return null;
  const hub = x.hub as string | undefined;
  if (x.vault === "*") return x.applet === "*" && hub ? { hub, vault: "*", applet: "*" } : null;
  if (x.applet === "*") return typeof x.vault === "string" && VAULT.test(x.vault) ? { vault: x.vault, applet: "*", ...(hub ? { hub } : {}) } : null;
  return placeOf(x);
}
function opensOf(x: unknown): OpensChoice | null {
  if (!plain(x) || !only(x, ["type", "hub", "vault", "applet"]) || typeof x.type !== "string" || !/^[a-z0-9][a-z0-9_/-]{0,79}$/.test(x.type)) return null;
  if (x.applet === null) { if (typeof x.vault !== "string" || !VAULT.test(x.vault) || (x.hub !== undefined && !hubOk(x.hub))) return null; return { type: x.type, vault: x.vault, applet: null, ...(x.hub ? { hub: x.hub as string } : {}) }; }
  const p = placeOf({ vault: x.vault, applet: x.applet, ...(x.hub !== undefined ? { hub: x.hub } : {}) });
  return p ? { type: x.type, ...p } : null;
}
const list = <T>(x: unknown, max: number, f: (y: unknown) => T | null): T[] => (Array.isArray(x) ? x.slice(0, max).map(f).filter((y): y is T => !!y) : []);

/** Was this bundle record made for a newer Parachute (`needs` above this build's level, or a later contract: level.ts)?
 *  Then it isn't read here at all: the device opens the next app it can and says to update (homeSettings bundleNewer). */
export const newerBundle = (raw: unknown, level = APP_LEVEL): boolean => plain(raw) && (tooNew(raw.needs, level) || (typeof raw.contract === "number" && raw.contract > 1));

/** A bundle record's body (`fields.bundle`, or `fields.app` on an older one), read strictly where a mistake would widen what is offered, kindly elsewhere: a
 *  source or place that doesn't parse is left out, never the rest. null when it isn't an app at all, or is newer. */
export function bundleOf(raw: unknown, path: string | null, noteId: string | null, level = APP_LEVEL): Bundle | null {
  if (!plain(raw) || raw.contract !== 1 || newerBundle(raw, level) || typeof raw.id !== "string" || !ID.test(raw.id) || raw.id.length > 40) return null;
  // the id is the last part of its path, so two records can't both claim one bundle (an older record's path, alike)
  if (path !== null && stripExt(path) !== `${BUNDLE_FOLDER}${raw.id}` && stripExt(path) !== `${OLD_BUNDLE_FOLDER}${raw.id}`) return null;
  const live = plain(raw.live) && hubOk(raw.live.hub) && typeof raw.live.vault === "string" && VAULT.test(raw.live.vault) && line(raw.live.path, 300)
    ? { hub: raw.live.hub as string, vault: raw.live.vault, path: raw.live.path as string } : undefined;
  // what the record doesn't say, a default of its id says (none for any other id)
  const d = noteId === null ? null : defaultOf(raw.id);
  if (!line(raw.name, 60) && !live && !d) return null;
  const keep = raw.keep === "auto" || raw.keep === undefined ? "auto" : typeof raw.keep === "number" && Number.isInteger(raw.keep) && raw.keep >= 0 && raw.keep <= 12 ? raw.keep : "auto";
  // `everywhere`: every vault this device holds, on every Parachute. Listing runs nothing, so any bundle may say it
  // a record of a default's id that names no sources (none, or the empty list builds before 11-20 wrote for Simplified,
  // whose Notes look offered every applet then) offers what the default offers
  const everywhere = raw.everywhere === true || (raw.everywhere === undefined && (raw.sources === undefined || (Array.isArray(raw.sources) && raw.sources.length === 0)) && !!d?.sources.some((x) => x.hub === ANY_HUB));
  const sources = [...(everywhere ? [{ hub: ANY_HUB, vault: "*", applet: "*" }] : []), ...(Array.isArray(raw.sources) ? list(raw.sources, 100, sourceOf) : d && raw.everywhere === undefined ? d.sources.filter((x) => x.hub !== ANY_HUB) : [])];
  return {
    id: raw.id, name: line(raw.name, 60) ? raw.name : d?.name ?? raw.id,
    glyph: line(raw.glyph, 4) ? raw.glyph : d?.glyph ?? "◇",
    note: line(raw.note, 120) ? raw.note : d?.note ?? "",
    look: raw.look === "notes" || raw.frame === "builtin:notes" ? "notes" : raw.look === "launcher" ? "launcher" : d?.look ?? "launcher",
    sources,
    hide: list(raw.hide, 200, placeOf),
    bar: Array.isArray(raw.bar) ? list(raw.bar, 200, barEntryOf) : null,
    base: d ? [...(d.bar ?? []), ...d.base] : [],
    start: raw.start === null ? null : raw.start === undefined ? undefined : placeOf(raw.start) ?? undefined,
    opens: list(raw.opens, 200, opensOf),
    keep,
    security: askedOf(raw.security),
    parachute: Array.isArray(raw.publishers) ? raw.publishers.slice(0, 20).some((p) => plain(p) && p.url === PARACHUTE_PUBLISHER) : d?.parachute ?? false,
    ...(live ? { live } : {}),
    noteId,
  };
}

/** Stands for every hub, from `everywhere` only: no source can say it (`hubOk` refuses it). */
export const ANY_HUB = "*";

/** The bundles the app ships, as records (default-bundles.json), in the order Settings lists them. Their bar is the start of the bar while the
 *  person's own record says none (the settings note's pins follow it, read until 2026-12-20). A person new to the app on
 *  Parachute Cloud starts on NEWCOMER_BUNDLE; a device whose chosen bundle doesn't load opens FALLBACK_BUNDLE. */
export const DEFAULT_BUNDLES: readonly Record<string, unknown>[] = defaults;
export const NEWCOMER_BUNDLE = "simple";
export const FALLBACK_BUNDLE = "everything";
/** A default as it is read: its bar is the base the person's pins go after, not a bar of its own. */
function defaultOf(id: string): Bundle | null {
  const raw = DEFAULT_BUNDLES.find((r) => r.id === id);
  const b = raw ? bundleOf(raw, null, null) : null;
  return b && { ...b, bar: null, base: b.bar ?? [] };
}
export const defaultBundles = (): Bundle[] => DEFAULT_BUNDLES.map((r) => defaultOf(r.id as string)!);

/** The person's bundles: the defaults (as their records change them) and every other record, each id once. */
export function bundlesFrom(records: readonly Bundle[]): Bundle[] {
  const byId = new Map<string, Bundle>();
  for (const d of defaultBundles()) byId.set(d.id, d);
  for (const r of records) if (!byId.has(r.id) || byId.get(r.id)!.noteId === null) byId.set(r.id, r);
  return [...byId.values()];
}

/** Which bundle this device opens: its own choice, else the one the settings note names, else the fallback. */
export function openBundle(apps: readonly Bundle[], device: string | null, settings: string | null): Bundle {
  return apps.find((a) => a.id === device) ?? apps.find((a) => a.id === settings) ?? apps.find((a) => a.id === FALLBACK_BUNDLE) ?? defaultOf(FALLBACK_BUNDLE)!;
}

/** A vault as this device holds it, for matching: its hub's origin and its name. */
export type Held = { hub: string; vault: string };
const sameHub = (a: string | undefined, b: string, home: string) => (a ?? home) === b;
/** The applet's note named by a place's `applet`: its id, or its path with or without an extension. */
export const namesApplet = (name: string, a: { noteId: string; path: string }) => name === a.noteId || stripExt(name) === stripExt(a.path);

/** Is this applet offered by the app? `home`: the hub its places mean when they name none. */
export function offered(app: Bundle, v: Held, a: { noteId: string; path: string }, home: string): boolean {
  const base = app.hubOf ?? home;
  const hit = app.sources.some((s) => (s.hub === ANY_HUB || sameHub(s.hub, v.hub, base)) && (s.vault === "*" || s.vault === v.vault) && (s.applet === "*" || namesApplet(s.applet, a)));
  return hit && !app.hide.some((h) => sameHub(h.hub, v.hub, base) && h.vault === v.vault && namesApplet(h.applet, a));
}
/** Does the app offer anything in this vault (so its chapter shows)? */
export const offersIn = (app: Bundle, v: Held, home: string) => app.sources.some((s) => (s.hub === ANY_HUB || sameHub(s.hub, v.hub, app.hubOf ?? home)) && (s.vault === "*" || s.vault === v.vault));

/** How many applets stay running while hidden: the app's number, else the device's default. */
export const keepOf = (app: Bundle, deviceDefault: number) => (app.keep === "auto" ? deviceDefault : app.keep);

/** The record the app writes for a bundle (a default's when it is first changed): only what it says. */
export function recordOf(app: Bundle): Record<string, unknown> {
  return {
    contract: 1, id: app.id, name: app.name, glyph: app.glyph, ...(app.note ? { note: app.note } : {}), look: app.look,
    sources: app.sources.filter((s) => s.hub !== ANY_HUB), ...(app.sources.some((s) => s.hub === ANY_HUB) ? { everywhere: true } : {}),
    ...(app.hide.length ? { hide: app.hide } : {}), ...(app.bar ? { bar: app.bar } : {}), ...(app.start !== undefined ? { start: app.start } : {}),
    ...(app.opens.length ? { opens: app.opens } : {}), ...(app.keep !== "auto" ? { keep: app.keep } : {}),
    ...(Object.keys(app.security).length ? { security: app.security } : {}),
    publishers: app.parachute ? [{ url: PARACHUTE_PUBLISHER }] : [],
  };
}

/** An app someone else offers, as the person follows it: their record, under the person's own id and name for it, and
 *  never less careful than the person's own record asks: each level the stricter of the two (shell/levelRules.ts). A
 *  device's levels are raised by the open bundle's record and never lowered by one (src-tauri/src/levels.rs). */
export function followed(own: Bundle, raw: unknown, theirs: Record<string, unknown>): Record<string, unknown> {
  // a later contract of theirs stays as it is, so this app sees it as made for a newer Parachute (newerBundle), not as 1
  return { ...theirs, contract: typeof theirs.contract === "number" && theirs.contract > 1 ? theirs.contract : 1, id: own.id, ...(plain(raw) && typeof raw.name === "string" ? { name: raw.name } : {}), live: own.live,
    ...(Object.keys(own.security).length || theirs.security !== undefined ? { security: stricterAsked(own.security, askedOf(theirs.security)) } : {}) };
}

/** What a bundle puts on the bar, by name, in its order (Settings → Your bundle says it in a line), as the bar draws it
 *  (homeSettings `effective`, BottomBar.tsx): its own bar, or where it has none its default's places and then the
 *  person's pins (`pins`, the settings note's); each applet by `nameOf` (its name as listed) or its note's path; and
 *  its home screen (Notes or Applets) where it names none. Settings, always last on every bar, isn't said. */
export function barNames(b: Bundle, pins: readonly BarEntry[] = [], nameOf: (p: Place) => string | null = () => null): string[] {
  const home = b.look === "notes" ? "Notes" : "Applets";
  const entries = b.bar ?? [...b.base, ...pins];
  const names = entries.map((e) => (!isAppPlace(e) ? nameOf(e) ?? stripExt(e.applet.split("/").pop() ?? e.applet)
    : "shipped" in e ? officialFace(e.shipped).name : e.screen === "connect" ? officialFace("connect").name : home));
  const wayHome = entries.some((e) => isAppPlace(e) && "screen" in e && e.screen === "home");
  return [...new Set(wayHome ? names : [...names, home])];
}
