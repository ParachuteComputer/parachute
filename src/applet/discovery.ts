// The applets in a vault: notes tagged `applet` whose manifest parses (manifest.ts), with what they open (opens.ts).
// A note whose manifest doesn't parse, or a second note with an id already taken, is skipped and counted, never
// half-shown. A bad `opens` makes an applet open nothing by itself, but it is still listed. Pure.
// (From the Uni app's src/interface/sealedApplet.ts, contract 2 only.)

import { plain, stripExt } from "./contract.ts";
import { parseManifest, type Manifest } from "./manifest.ts";
import { parseOpens, type Opens } from "./opens.ts";
import { parseApp, type AppWord } from "./app.ts";
import type { Need, Resolved } from "./needs.ts";
import { resolveNeeds } from "./needs.ts";

/** The app's own applet ids: a note may not take one. */
export const BUILT_IN_IDS = ["vault"];

export type AppletEntry = {
  manifest: Manifest;
  vault: string;
  noteId: string;
  path: string;
  opens: Opens[];
  /** What it may ask of the app beyond its vault (app.ts). */
  app: AppWord[];
  /** why `opens` was refused, when it was */
  opensError?: string;
};
export type Discovery = { entries: AppletEntry[]; skipped: number };
type Row = { id?: unknown; path?: unknown; tags?: unknown; metadata?: unknown };

export function readApplet(r: Row, vault: string): { ok: true; entry: AppletEntry } | { ok: false; error: string } {
  if (typeof r.id !== "string" || !r.id || typeof r.path !== "string" || !r.path) return { ok: false, error: "it isn't a note" };
  if (!Array.isArray(r.tags) || !r.tags.includes("applet")) return { ok: false, error: "it isn't tagged applet" };
  const meta = plain(r.metadata) ? r.metadata : {};
  const parsed = parseManifest(meta.applet);
  if (!parsed.ok) return { ok: false, error: `its manifest is invalid: ${parsed.error}` };
  if (BUILT_IN_IDS.includes(parsed.manifest.id)) return { ok: false, error: `the id ${parsed.manifest.id} is the app's own` };
  if (meta.interface !== undefined && meta.interface !== null) return { ok: false, error: "a contract 2 applet has one manifest. Its note must not carry interface too" };
  const app = parseApp(meta.app);
  if (!app.ok) return { ok: false, error: app.error };
  const opens = parseOpens(meta.opens, parsed.manifest);
  return { ok: true, entry: { manifest: parsed.manifest, vault, noteId: r.id, path: r.path, opens: opens.ok ? opens.opens : [], app: app.app, ...(opens.ok ? {} : { opensError: opens.error }) } };
}

export function discoverApplets(rows: readonly Row[], vault: string): Discovery {
  const entries: AppletEntry[] = [];
  const ids = new Set<string>();
  let skipped = 0;
  const sorted = [...rows].sort((a, b) => String(a.path ?? "").localeCompare(String(b.path ?? "")));
  for (const r of sorted) {
    const a = readApplet(r, vault);
    if (!a.ok || ids.has(a.entry.manifest.id)) { skipped++; continue; }
    ids.add(a.entry.manifest.id);
    entries.push(a.entry);
  }
  return { entries, skipped };
}

const VERB_CAP = { read: "vault.read", create: "vault.create", update: "vault.update" } as const;

/** What the frame may ask for: one need per folder and verb. */
export function needsOf(m: Manifest): Need[] {
  return m.allow.flatMap((r) => r.verbs.map((v) => ({ cap: VERB_CAP[v], scope: r.path })));
}
export const resolvedOf = (m: Manifest): Resolved => resolveNeeds(needsOf(m));

/** The folder an applet's note lives in ("Applets/" for `Applets/Recipes`), or null at the vault's top. */
export const ownFolder = (notePath: string): string | null => { const p = stripExt(notePath); const i = p.lastIndexOf("/"); return i > 0 ? p.slice(0, i + 1) : null; };
