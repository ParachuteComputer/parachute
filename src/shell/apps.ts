// An app is a record (docs/design/APP-RECORD.md): `Parachute/Apps/<id>` in the person's home vault, tagged
// `parachute-app`, everything under `fields.app` (metadata `app` on a hub before 0.9). It says where applets come from
// (one applet, every applet in a vault, every vault on a hub), the bar, the home applet, which applet opens which kind
// of note, and how many applets stay running. Being listed never runs anything: what runs is decided by the applet's
// card (and, once there, a signed approval). The person can have several; each device opens one.
//
// Two apps are always there, made by the app itself when no record says otherwise:
//   everything  every applet in every vault this device holds, with the settings note's bar and home (as before)
//   simple      Notes, Capture and Connect (docs/SIMPLE.md)
// A record with one of those ids changes that app. An app someone else offers is a record of theirs that the person's
// own record follows (`live`): read from their vault each time, so their changes show; their code still asks.
// Pure, but for nothing: every reader here takes what it needs.
import { plain, stripExt } from "../applet/contract";
import { APP_LEVEL, tooNew } from "../applet/level";
import { askedOf, stricterAsked, type Asked } from "./levelRules";

export const APP_TAG = "parachute-app";
export const APP_FOLDER = "Parachute/Apps/";
export const BUILT_IN_APPS = ["everything", "simple"] as const;
export type Look = "launcher" | "notes";

/** One applet, as the bar names it today: its vault's name (and hub's origin, when not the home's) and its note's path or id. */
export type Place = { hub?: string; vault: string; applet: string };
/** Where applets come from: one applet, `applet: "*"` for every applet in a vault, `vault: "*"` (with a hub) for every vault there. */
export type Source = { hub?: string; vault: string; applet: string };
export type OpensChoice = { type: string; hub?: string; vault: string; applet: string | null };
export type Keep = "auto" | number;
export type App = {
  id: string; name: string; glyph: string; note: string;
  /** How its home looks: the launcher, or the simple app's Notes. */
  look: Look;
  sources: Source[]; hide: Place[];
  /** null: the settings note's (an app without its own). */
  bar: Place[] | null; start: Place | null | undefined;
  opens: OpensChoice[]; keep: Keep;
  /** How careful the app is (docs/design/APP-RECORD.md "Security levels"; shell/levels.ts): per action (approvals,
   *  code, join) none, unlock or passcode, and the idle lock's minutes. It only raises a device's levels: lowering one
   *  takes the person's signed approval. */
  security: Asked;
  /** An app someone else offers, followed live: where its record is. */
  live?: { hub: string; vault: string; path: string };
  /** Where this app's record is: the home vault's note id, or none for a built-in. */
  noteId: string | null;
  /** The hub its places mean when they name none: the home's, or the offering Parachute's for a live app. */
  hubOf?: string;
};

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VAULT = /^[a-z0-9][a-z0-9_-]{0,79}$/;
const line = (x: unknown, max: number): x is string => typeof x === "string" && x.length > 0 && x.length <= max && !/[\u0000-\u001f]/.test(x);
const hubOk = (x: unknown): x is string => typeof x === "string" && x.length <= 300 && /^https?:\/\/[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?(?::[0-9]{1,5})?$/.test(x);
const only = (o: Record<string, unknown>, keys: string[]) => Object.keys(o).every((k) => keys.includes(k));

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

/** Was this app record made for a newer Parachute (`needs` above this build's level, or a later contract: level.ts)?
 *  Then it isn't read here at all: the device opens the next app it can and says to update (homeSettings appNewer). */
export const newerApp = (raw: unknown, level = APP_LEVEL): boolean => plain(raw) && (tooNew(raw.needs, level) || (typeof raw.contract === "number" && raw.contract > 1));

/** An app record's `app` field, read strictly where a mistake would widen what is offered, kindly elsewhere: a
 *  source or place that doesn't parse is left out, never the rest. null when it isn't an app at all, or is newer. */
export function appOf(raw: unknown, path: string | null, noteId: string | null, level = APP_LEVEL): App | null {
  if (!plain(raw) || raw.contract !== 1 || newerApp(raw, level) || typeof raw.id !== "string" || !ID.test(raw.id) || raw.id.length > 40) return null;
  // the id is the last part of its path, so two records can't both claim one app
  if (path !== null && stripExt(path) !== `${APP_FOLDER}${raw.id}`) return null;
  const live = plain(raw.live) && hubOk(raw.live.hub) && typeof raw.live.vault === "string" && VAULT.test(raw.live.vault) && line(raw.live.path, 300)
    ? { hub: raw.live.hub as string, vault: raw.live.vault, path: raw.live.path as string } : undefined;
  if (!line(raw.name, 60) && !live) return null;
  const keep = raw.keep === "auto" || raw.keep === undefined ? "auto" : typeof raw.keep === "number" && Number.isInteger(raw.keep) && raw.keep >= 0 && raw.keep <= 12 ? raw.keep : "auto";
  const builtIn = (BUILT_IN_APPS as readonly string[]).includes(raw.id) ? builtInApp(raw.id as "everything" | "simple") : null;
  return {
    id: raw.id, name: line(raw.name, 60) ? raw.name : builtIn?.name ?? raw.id,
    glyph: line(raw.glyph, 4) ? raw.glyph : builtIn?.glyph ?? "◇",
    note: line(raw.note, 120) ? raw.note : builtIn?.note ?? "",
    look: raw.look === "notes" || raw.frame === "builtin:notes" ? "notes" : raw.look === "launcher" ? "launcher" : builtIn?.look ?? "launcher",
    // `everywhere`: every vault this device holds, on every Parachute. Only Everything may say it
    sources: [...(raw.everywhere === true && raw.id === "everything" ? [{ hub: ANY_HUB, vault: "*", applet: "*" }] : []), ...(Array.isArray(raw.sources) ? list(raw.sources, 100, sourceOf) : builtIn && raw.everywhere === undefined ? builtIn.sources : [])],
    hide: list(raw.hide, 200, placeOf),
    bar: Array.isArray(raw.bar) ? list(raw.bar, 200, placeOf) : null,
    start: raw.start === null ? null : raw.start === undefined ? undefined : placeOf(raw.start) ?? undefined,
    opens: list(raw.opens, 200, opensOf),
    keep,
    security: askedOf(raw.security),
    ...(live ? { live } : {}),
    noteId,
  };
}

/** The two apps the app always has, as they are when no record changes them. `sources` of everything: every vault
 *  on every Parachute this device holds (`anyHub`). */
export function builtInApp(id: "everything" | "simple"): App {
  return id === "simple"
    ? { id, name: "Simple", glyph: "¶", note: "your notes, Capture, and Connect an AI", look: "notes", sources: [], hide: [], bar: null, start: undefined, opens: [], keep: "auto", security: {}, noteId: null }
    : { id, name: "Everything", glyph: "⁂", note: "every applet in every vault", look: "launcher", sources: [{ hub: ANY_HUB, vault: "*", applet: "*" }], hide: [], bar: null, start: undefined, opens: [], keep: "auto", security: {}, noteId: null };
}
/** Stands for every hub in the built-in Everything only: no record can say it (`hubOk` refuses it). */
export const ANY_HUB = "*";

/** The person's apps: the two built-ins (as their records change them) and every other record, each id once. */
export function appsFrom(records: readonly App[]): App[] {
  const byId = new Map<string, App>();
  for (const id of BUILT_IN_APPS) byId.set(id, builtInApp(id));
  for (const r of records) if (!byId.has(r.id) || byId.get(r.id)!.noteId === null) byId.set(r.id, r);
  return [...byId.values()];
}

/** Which app this device opens: its own choice, else the one the settings note names, else everything. */
export function openApp(apps: readonly App[], device: string | null, settings: string | null): App {
  return apps.find((a) => a.id === device) ?? apps.find((a) => a.id === settings) ?? apps.find((a) => a.id === "everything") ?? builtInApp("everything");
}

/** A vault as this device holds it, for matching: its hub's origin and its name. */
export type Held = { hub: string; vault: string };
const sameHub = (a: string | undefined, b: string, home: string) => (a ?? home) === b;
/** The applet's note named by a place's `applet`: its id, or its path with or without an extension. */
export const namesApplet = (name: string, a: { noteId: string; path: string }) => name === a.noteId || stripExt(name) === stripExt(a.path);

/** Is this applet offered by the app? `home`: the hub its places mean when they name none. */
export function offered(app: App, v: Held, a: { noteId: string; path: string }, home: string): boolean {
  const base = app.hubOf ?? home;
  const hit = app.sources.some((s) => (s.hub === ANY_HUB || sameHub(s.hub, v.hub, base)) && (s.vault === "*" || s.vault === v.vault) && (s.applet === "*" || namesApplet(s.applet, a)));
  return hit && !app.hide.some((h) => sameHub(h.hub, v.hub, base) && h.vault === v.vault && namesApplet(h.applet, a));
}
/** Does the app offer anything in this vault (so its chapter shows)? */
export const offersIn = (app: App, v: Held, home: string) => app.sources.some((s) => (s.hub === ANY_HUB || sameHub(s.hub, v.hub, app.hubOf ?? home)) && (s.vault === "*" || s.vault === v.vault));

/** How many applets stay running while hidden: the app's number, else the device's default. */
export const keepOf = (app: App, deviceDefault: number) => (app.keep === "auto" ? deviceDefault : app.keep);

/** The record the app writes for an app (the built-ins' when they are first changed): only what it says. */
export function recordOf(app: App): Record<string, unknown> {
  return {
    contract: 1, id: app.id, name: app.name, glyph: app.glyph, ...(app.note ? { note: app.note } : {}), look: app.look,
    sources: app.sources.filter((s) => s.hub !== ANY_HUB), ...(app.sources.some((s) => s.hub === ANY_HUB) ? { everywhere: true } : {}),
    ...(app.hide.length ? { hide: app.hide } : {}), ...(app.bar ? { bar: app.bar } : {}), ...(app.start !== undefined ? { start: app.start } : {}),
    ...(app.opens.length ? { opens: app.opens } : {}), ...(app.keep !== "auto" ? { keep: app.keep } : {}),
    ...(Object.keys(app.security).length ? { security: app.security } : {}),
  };
}

/** An app someone else offers, as the person follows it: their record, under the person's own id and name for it, and
 *  never less careful than the person's own record asks: each level the stricter of the two (shell/levelRules.ts). A
 *  device's levels are raised by the open app's record and never lowered by one (src-tauri/src/levels.rs). */
export function followed(own: App, raw: unknown, theirs: Record<string, unknown>): Record<string, unknown> {
  // a later contract of theirs stays as it is, so this app sees it as made for a newer Parachute (newerApp), not as 1
  return { ...theirs, contract: typeof theirs.contract === "number" && theirs.contract > 1 ? theirs.contract : 1, id: own.id, ...(plain(raw) && typeof raw.name === "string" ? { name: raw.name } : {}), live: own.live,
    ...(Object.keys(own.security).length || theirs.security !== undefined ? { security: stricterAsked(own.security, askedOf(theirs.security)) } : {}) };
}
