// What an applet opens: the `opens` key beside its manifest, in a metadata key the Uni app never reads, so the
// manifest itself stays exactly as the Uni app parses it.
//
//   opens:
//     - type: recipe        # a tag. Notes with it (or a tag beneath it, recipe/…)…
//       path: Recipes/      # …under this folder open in this applet. Notes it adds here get the tag.
//       screen: home        # optional; one of the manifest's screens
//
// Rules: at most 8 entries. `path` must sit inside one of the manifest's read rules, so an applet only opens what it
// may read. `screen`, when given, is one of the manifest's screens. `*` is refused: only the app's own vault view
// opens everything. Reserved types (`applet`, `view`, `capture`, `component`, anything beginning `parachute`, in any letter case)
// and folders (`.parachute/`, `Applets/`) are refused. A vault's own role tags are reserved too, but roles are set
// per vault, so the app drops them with `withoutRoles` when it reads a vault's applets, before the card, the grant's
// key, the tagging writer or open-with see the list. Anything wrong refuses the whole list (the
// applet then opens nothing by itself), never the applet. Pure.

import { hasHidden, hasOnly, inScope, plain, safePrefix } from "./contract.ts";
import { inReservedFolder, type Manifest } from "./manifest.ts";

export type Opens = { type: string; path: string; screen?: string };
export type OpensParse = { ok: true; opens: Opens[] } | { ok: false; error: string };

export const MAX_OPENS = 8;
const TYPE = /^[a-z0-9][a-z0-9_-]*(?:\/[a-z0-9][a-z0-9_-]*)*$/;
/** Types no applet may claim, whatever the letter case: the app's own, and any it may come to own. */
// `publish`: the hub serves a note carrying it to anyone, so an applet that tags the notes it adds with it could put
// what it read on the open web (T-476 review)
export const RESERVED_TYPES = ["applet", "view", "capture", "component", "publish"];
export const isReservedType = (type: string) => {
  const t = type.toLowerCase();
  return RESERVED_TYPES.some((r) => t === r || t.startsWith(`${r}/`)) || t.startsWith("parachute");
};

/** Parse `metadata.opens` against the applet's manifest. Absent is an empty list. */
export function parseOpens(raw: unknown, m: Manifest): OpensParse {
  if (raw === undefined || raw === null) return { ok: true, opens: [] };
  if (!Array.isArray(raw)) return { ok: false, error: "opens must be a list" };
  if (raw.length > MAX_OPENS) return { ok: false, error: `opens has more than ${MAX_OPENS} entries` };
  const out: Opens[] = [];
  for (const e of raw) {
    if (!plain(e) || !hasOnly(e, ["type", "path", "screen"])) return { ok: false, error: "each entry of opens is {type, path, screen?}" };
    if (e.type === "*" ) return { ok: false, error: "an applet can't open everything: only the vault view does" };
    if (typeof e.type !== "string" || e.type.length > 64 || hasHidden(e.type)) return { ok: false, error: "a type is a tag" };
    if (isReservedType(e.type)) return { ok: false, error: `${e.type.slice(0, 40)} is the app's own type: no applet can claim it` };
    if (!TYPE.test(e.type)) return { ok: false, error: "a type is a tag: lower-case letters, digits, - and /" };
    const path = typeof e.path === "string" && !hasHidden(e.path) ? safePrefix(e.path) : null;
    if (!path) return { ok: false, error: "a path is a plain folder that ends in /" };
    if (inReservedFolder(path)) return { ok: false, error: `${path} is the app's own folder: no applet can open notes there` };
    if (!m.allow.some((r) => r.verbs.includes("read") && path.startsWith(r.path))) return { ok: false, error: `it would open notes in ${path}, which it can't read` };
    const entry: Opens = { type: e.type, path };
    if (e.screen !== undefined) {
      if (typeof e.screen !== "string" || !m.screens.some((s) => s.id === e.screen)) return { ok: false, error: "screen is one of the applet's screens" };
      entry.screen = e.screen;
    }
    if (out.some((o) => o.type === entry.type && o.path === entry.path)) return { ok: false, error: "opens names the same type and folder twice" };
    out.push(entry);
  }
  return { ok: true, opens: out };
}

/** A note has a type when it carries that tag or one beneath it (`recipe/soup` is a `recipe`). */
export const hasType = (tags: readonly unknown[] | null | undefined, type: string) =>
  Array.isArray(tags) && tags.some((t) => typeof t === "string" && (t === type || t.startsWith(`${type}/`)));

/** The folder test the vault module uses (contract.ts `inScope`): plain segments, strictly inside `folder`. */
const inside = (folder: string, path: string | null | undefined) => inScope([folder], path);

/** The entry of `opens` that claims this note: its type among the note's tags and its path under the entry's folder. */
export function claimOf(opens: readonly Opens[], note: { path?: string | null; tags?: readonly unknown[] | null }): Opens | null {
  return opens.find((o) => hasType(note.tags, o.type) && inside(o.path, note.path)) ?? null;
}

/** The tags a note the applet adds at `path` gets: each claimed type whose folder holds it. */
export const tagsFor = (opens: readonly Opens[], path: string): string[] => [...new Set(opens.filter((o) => inside(o.path, path)).map((o) => o.type))];

/** Does a claimed type touch a role tag: the same tag, one beneath the role, or one the role sits beneath (any case)? */
export const touchesRole = (type: string, roleTags: readonly string[]) => {
  const t = type.toLowerCase();
  return roleTags.some((role) => { const r = role.toLowerCase(); return t === r || t.startsWith(`${r}/`) || r.startsWith(`${t}/`); });
};
/** `opens` without the entries whose type touches one of the vault's role tags. */
export const withoutRoles = (opens: readonly Opens[], roleTags: readonly string[]): Opens[] => opens.filter((o) => !touchesRole(o.type, roleTags));
