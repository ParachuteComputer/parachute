// An applet's manifest, contract 2, as the Uni app reads it (src/interface/manifest2.ts), for the one host this app
// has: a sealed frame. The manifest is the `applet` value of a note tagged `applet`:
//
//   applet:
//     contract: 2
//     id: recipes
//     name: Recipes
//     glyph: ❀
//     note: a book of recipes
//     access:
//       - vault: here                          # the vault the applet's note lives in: the only vault a sealed applet reads
//         allow:
//           - path: Recipes/                   # a folder
//             verbs: [read, create, update]    # read | create | update   (never delete)
//     search: [{what: recipes, vault: here, path: Recipes/}]
//     screens: [{id: home, name: Recipes}]
//
// Strict: an unknown key or verb, a hidden character or an over-long value is refused, never repaired. The Uni app
// refuses a key it doesn't know too, so nothing new goes in here: what an applet opens goes beside it (opens.ts).
// Kept from the Uni app's keys: `reach` parses, but this app has no rooms, so an applet that reaches one is refused.
// Doors are refused (a sealed frame holds no key). New here: an access rule under `.parachute/` is refused.
// Pure: no React, no Tauri.

import { hasHidden, hasOnly, plain, safePrefix } from "./contract.ts";

export const CONTRACT_V2 = 2;
export const VERBS = ["read", "create", "update"] as const;
export type Verb = (typeof VERBS)[number];

/** What an applet may do to the notes under one folder of the vault its note lives in. */
export type Rule = { path: string; verbs: Verb[] };
export type SearchOffer = { what: string; path?: string };
export type Screen = { id: string; name: string };
export type Manifest = { contract: 2; id: string; name: string; glyph: string; note?: string; allow: Rule[]; search: SearchOffer[]; screens: Screen[] };
export type Parse = { ok: true; manifest: Manifest } | { ok: false; error: string };

export const LIMITS = { id: 40, name: 40, note: 120, access: 8, rules: 8, search: 8, what: 40, screens: 8 };
export const HERE = "here";

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VAULT = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const KEYS = ["contract", "id", "name", "glyph", "note", "access", "reach", "search", "screens"];
const DEFAULT_GLYPH = "◇";
/** Folders an applet may never be given: the app's own settings and every applet's code. */
export const RESERVED_FOLDERS = [".parachute/", "Applets/"];
export const inReservedFolder = (path: string) => RESERVED_FOLDERS.some((f) => path.toLowerCase().startsWith(f.toLowerCase()));

const fail = (error: string): Parse => ({ ok: false, error });
function line(x: unknown, max: number): string | null {
  if (typeof x !== "string" || hasHidden(x) || /[\n\t]/.test(x)) return null;
  const s = x.trim();
  return s && [...s].length <= max ? s : null;
}
const list = (x: unknown, max: number): unknown[] | null => (x === undefined ? [] : Array.isArray(x) && x.length <= max ? x : null);
const pathOf = (x: unknown): string | null => (typeof x === "string" && !hasHidden(x) ? safePrefix(x) : null);

function wordsOf<T extends string>(x: unknown, allowed: readonly T[]): T[] | null {
  if (!Array.isArray(x) || !x.length || x.some((v) => typeof v !== "string" || !(allowed as readonly string[]).includes(v))) return null;
  if (new Set(x).size !== x.length) return null;
  return allowed.filter((v) => x.includes(v));
}

/** Validate the `applet` value of a note's metadata. */
export function parseManifest(raw: unknown): Parse {
  if (!plain(raw)) return fail("applet must be an object");
  if (raw.contract !== CONTRACT_V2) return fail(`unsupported contract ${String(raw.contract)}`);
  if (!hasOnly(raw, KEYS)) return fail("applet has a key contract 2 doesn't know");
  const id = typeof raw.id === "string" && raw.id.length <= LIMITS.id && ID.test(raw.id) ? raw.id : null;
  if (!id) return fail("id must be short kebab-case (a-z, 0-9, -)");
  const name = line(raw.name, LIMITS.name);
  if (!name) return fail("name must be one short visible line");
  const m: Manifest = { contract: 2, id, name, glyph: DEFAULT_GLYPH, allow: [], search: [], screens: [] };
  if (raw.glyph !== undefined) {
    const glyph = line(raw.glyph, 1);
    if (!glyph || /\s/.test(glyph)) return fail("glyph must be one visible character");
    m.glyph = glyph;
  }
  if (raw.note !== undefined) {
    const note = line(raw.note, LIMITS.note);
    if (!note) return fail("note must be one short visible line");
    m.note = note;
  }

  const access = list(raw.access, LIMITS.access);
  if (!access) return fail("access must be a short list");
  let seenHere = false;
  for (const a of access) {
    if (!plain(a)) return fail("each access names a vault");
    if ("door" in a) return fail("a sealed applet can't use a door: the frame holds no key");
    if (!hasOnly(a, ["vault", "allow"])) return fail("a vault access is {vault, allow}");
    const vault = typeof a.vault === "string" && VAULT.test(a.vault) ? a.vault : null;
    if (!vault) return fail("vault is here, the vault the applet lives in");
    if (vault !== HERE) return fail("a sealed applet reads only the vault it lives in: vault must be here");
    if (seenHere) return fail("access names the here vault twice");
    seenHere = true;
    if (!Array.isArray(a.allow) || !a.allow.length || a.allow.length > LIMITS.rules) return fail("the here vault needs a short list of rules");
    for (const r of a.allow) {
      if (!plain(r) || !hasOnly(r, ["type", "path", "verbs", "own"])) return fail("each rule is {path, verbs}");
      if (r.type !== undefined || r.own !== undefined) return fail("a sealed applet works by folder: each rule is {path, verbs}, with no type and no own");
      const path = pathOf(r.path);
      if (!path) return fail("a path is a plain folder that ends in /");
      if (path.toLowerCase().startsWith(".parachute/")) return fail("a rule can't reach .parachute/, where the app keeps its own settings");
      if (Array.isArray(r.verbs) && r.verbs.includes("delete")) return fail("a sealed applet can't delete: its verbs are read, create and update");
      const verbs = wordsOf(r.verbs, VERBS);
      if (!verbs) return fail(`verbs are a list of ${VERBS.join(", ")}`);
      m.allow.push({ path, verbs });
    }
  }

  const reach = list(raw.reach, 6);
  if (!reach) return fail("reach must be a short list");
  if (reach.length) return fail("it reaches a room or the microphone, and Parachute has neither yet");

  const search = list(raw.search, LIMITS.search);
  if (!search) return fail("search must be a short list");
  for (const s of search) {
    if (!plain(s) || !hasOnly(s, ["what", "vault", "type", "path"])) return fail("each search is {what, vault?, type?, path?}");
    const what = line(s.what, LIMITS.what);
    if (!what) return fail("each search says what it finds, in a word or two");
    const offer: SearchOffer = { what };
    if (s.vault !== undefined || s.type !== undefined || s.path !== undefined) {
      if (s.vault !== HERE) return fail("a search over notes names its vault: here");
      if (s.type !== undefined) return fail("a sealed applet's search names a folder, not a type");
      const p = pathOf(s.path);
      if (!p) return fail("a search's path is a plain folder that ends in /");
      if (!m.allow.some((r) => r.verbs.includes("read") && p.startsWith(r.path))) return fail(`it offers ${what} to search but can't read them`);
      offer.path = p;
    }
    m.search.push(offer);
  }

  const screens = list(raw.screens, LIMITS.screens);
  if (!screens) return fail("screens must be a short list");
  for (const s of screens) {
    if (!plain(s) || !hasOnly(s, ["id", "name"])) return fail("each screen is {id, name}");
    const sid = typeof s.id === "string" && s.id.length <= LIMITS.id && ID.test(s.id) ? s.id : null;
    const sname = line(s.name, LIMITS.name);
    if (!sid || !sname) return fail("a screen has a kebab-case id and a short name");
    if (m.screens.some((x) => x.id === sid)) return fail("screens names an id twice");
    m.screens.push({ id: sid, name: sname });
  }
  if (!m.screens.length) m.screens.push({ id: "home", name });
  return { ok: true, manifest: m };
}

/** The screen to open: the one asked for when the manifest declares it, else its first. */
export function screenOf(m: Manifest, asked?: string | null): Screen {
  return m.screens.find((s) => s.id === asked) ?? m.screens[0];
}
