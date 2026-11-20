// A component: one TSX or JSX record, tagged `component`, whose default export is a React component that a page can
// embed (in its own sealed frame, with its own card) or, from a source the person trusts, import (docs/design/EMBED.md).
// Its fields say what it takes and what it may touch:
//
//   component:
//     contract: 1
//     id: events                 # kebab-case, unique among the vault's components
//     name: Events
//     glyph: "◷"                 # optional
//     note: what's on at Techne  # optional
//     props: { days: number }    # optional: what it takes, each string | number | boolean
//     access: [{ vault: here, allow: [{ path: Events/, verbs: [read] }] }]
//
// `access` is read by the applet manifest's own parser (manifest.ts), so its rules are an applet's: folders of the
// vault it lives in, read/create/update, never `.parachute/` or delete. A component has no screens, search, opens or
// `app` words. Pure.

import { hasHidden, hasOnly, plain } from "./contract.ts";
import { parseManifest, shownGlyph, shownId, shownName, type Rule } from "./manifest.ts";
import { APP_LEVEL, neededWhy, tooNew } from "./level.ts";

export const COMPONENT_TAG = "component";
export const COMPONENT_CONTRACT = 1;
export const PROP_KINDS = ["string", "number", "boolean"] as const;
export type PropKind = (typeof PROP_KINDS)[number];
export type Component = { contract: 1; id: string; name: string; glyph: string; note?: string; props: Record<string, PropKind>; allow: Rule[] };
/** `newer`: refused for a key or contract this app doesn't know, so likely written for a newer app (level.ts). */
export type ComponentParse = { ok: true; component: Component } | { ok: false; error: string; newer?: true };

const KEYS = ["contract", "id", "name", "glyph", "note", "props", "access"];
const PROP = /^[a-z][a-zA-Z0-9]{0,31}$/;
export const MAX_PROPS = 12;

/** Validate the `component` value of a record's fields. Strict, as an applet's manifest: refused, never repaired. */
export function parseComponent(raw: unknown): ComponentParse {
  if (!plain(raw)) return { ok: false, error: "component must be an object" };
  if (raw.contract !== COMPONENT_CONTRACT) return { ok: false, error: `unsupported component contract ${String(raw.contract)}`, ...(typeof raw.contract === "number" && raw.contract > COMPONENT_CONTRACT ? { newer: true as const } : {}) };
  if (!hasOnly(raw, KEYS)) { const k = Object.keys(raw).find((x) => !KEYS.includes(x)); return { ok: false, error: `component has a key contract 1 doesn't know${k && /^[A-Za-z0-9_-]{1,40}$/.test(k) ? ` («${k}»)` : ""}`, newer: true }; }
  const props: Record<string, PropKind> = {};
  if (raw.props !== undefined) {
    if (!plain(raw.props) || Object.keys(raw.props).length > MAX_PROPS) return { ok: false, error: `props is a short map of names to ${PROP_KINDS.join(", ")}` };
    for (const [k, v] of Object.entries(raw.props)) {
      if (!PROP.test(k) || hasHidden(k)) return { ok: false, error: "a prop's name is a plain word (a-z, then letters and digits)" };
      if (!(PROP_KINDS as readonly string[]).includes(v as string)) return { ok: false, error: `a prop is one of ${PROP_KINDS.join(", ")}` };
      props[k] = v as PropKind;
    }
  }
  // the rest is an applet's manifest, less what a component doesn't have
  const { props: _p, contract: _c, ...rest } = raw;
  const m = parseManifest({ ...rest, contract: 2 });
  if (!m.ok) return { ok: false, error: m.error.replace(/applet/g, "component").replace(/contract 2/g, "contract 1"), ...(m.newer ? { newer: true as const } : {}) };
  return { ok: true, component: { contract: 1, id: m.manifest.id, name: m.manifest.name, glyph: m.manifest.glyph, ...(m.manifest.note ? { note: m.manifest.note } : {}), props, allow: m.manifest.allow } };
}

/** The props a page hands a component: only names it declares, each of its kind, the whole at most 2 KB of JSON.
 *  Anything else is dropped (never the component). */
export const MAX_PROPS_JSON = 2048;
export function propsFor(c: Pick<Component, "props">, given: unknown): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!plain(given)) return out;
  for (const [k, v] of Object.entries(given)) {
    const kind = Object.prototype.hasOwnProperty.call(c.props, k) ? c.props[k] : undefined;
    if (!kind || typeof v !== kind || (typeof v === "number" && !Number.isFinite(v)) || (typeof v === "string" && (v.length > 500 || hasHidden(v)))) continue;
    out[k] = v as string | number | boolean;
  }
  return JSON.stringify(out).length <= MAX_PROPS_JSON ? out : {};
}

// ── the components in a vault ──

/** `newer`: written for a newer app (why, in a few words): listed by its id and name so an import or an embed finds it
 *  and says "Update Parachute to open …"; it takes no props and reaches nothing, and is never run. */
export type ComponentEntry = { component: Component; vault: string; noteId: string; path: string; kind: "tsx" | "jsx"; newer?: string };

/** Was this component record written for a newer app (`needs` past this build, or a key or contract it doesn't know)?
 *  Why, in a few words; null when it reads here. */
export function componentNewer(fields: unknown, level = APP_LEVEL): string | null {
  const meta = plain(fields) ? fields : {};
  if (tooNew(meta.needs, level)) return neededWhy(meta.needs, level);
  const c = parseComponent(meta.component);
  return !c.ok && c.newer ? `its fields: ${c.error}` : null;
}
type Row = { id?: unknown; path?: unknown; tags?: unknown; metadata?: unknown; extension?: unknown };

/** One record as a component, or why not. */
export function readComponent(r: Row, vault: string): { ok: true; entry: ComponentEntry } | { ok: false; error: string } {
  if (typeof r.id !== "string" || !r.id || typeof r.path !== "string" || !r.path) return { ok: false, error: "it isn't a record" };
  if (!Array.isArray(r.tags) || !r.tags.includes(COMPONENT_TAG)) return { ok: false, error: "it isn't tagged component" };
  const ext = String(r.extension ?? "md").replace(/^\./, "").toLowerCase();
  if (ext !== "tsx" && ext !== "jsx") return { ok: false, error: `its record is ${ext}, and a component is tsx or jsx` };
  const meta = plain(r.metadata) ? r.metadata : {};
  const newer = componentNewer(meta);
  if (newer) {
    const id = shownId(meta.component);
    if (!id) return { ok: false, error: "it was made for a newer app, and has no id this one reads" };
    const name = shownName(meta.component) ?? id;
    return { ok: true, entry: { component: { contract: 1, id, name, glyph: shownGlyph(meta.component), props: {}, allow: [] }, vault, noteId: r.id, path: r.path, kind: ext, newer } };
  }
  const parsed = parseComponent(meta.component);
  if (!parsed.ok) return { ok: false, error: `its fields are invalid: ${parsed.error}` };
  return { ok: true, entry: { component: parsed.component, vault, noteId: r.id, path: r.path, kind: ext } };
}

/** The vault's components: valid ones, by path; a second with an id already taken is skipped and counted. */
export function discoverComponents(rows: readonly Row[], vault: string): { entries: ComponentEntry[]; skipped: number } {
  const entries: ComponentEntry[] = [];
  let skipped = 0;
  for (const r of [...rows].sort((a, b) => String(a.path ?? "").localeCompare(String(b.path ?? "")))) {
    const c = readComponent(r, vault);
    if (!c.ok || entries.some((e) => e.component.id === c.entry.component.id)) { skipped++; continue; }
    entries.push(c.entry);
  }
  return { entries, skipped };
}
