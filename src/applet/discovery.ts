// The applets in a vault: notes tagged `applet` whose manifest parses (manifest.ts), with what they open (opens.ts).
// A note whose manifest doesn't parse, or a second note with an id already taken, is skipped and counted, never
// half-shown. A bad `opens` makes an applet open nothing by itself, but it is still listed. Pure.
// (From the Uni app's src/interface/sealedApplet.ts, contract 2 only.)

import { plain, stripExt } from "./contract.ts";
import { parseManifest, shownGlyph, shownId, shownName, type Manifest } from "./manifest.ts";
import { APP_LEVEL, neededWhy, tooNew } from "./level.ts";
import { parseOpens, type Opens } from "./opens.ts";
import { parseApp, type AppWord } from "./app.ts";
import type { Need, Resolved } from "./needs.ts";
import { resolveNeeds } from "./needs.ts";
import { parseEmbeds, type Embed } from "./embeds.ts";
import { parseServices, type Service } from "./services.ts";
import { parseSignals, type Signal } from "./signals.ts";

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
  /** why `app` was refused, when it was (the applet then asks nothing of the app) */
  appError?: string;
  /** why `opens` was refused, when it was */
  opensError?: string;
  /** What its page embeds (embeds.ts): only for an applet in a vault of the person's own. */
  embeds: Embed[];
  /** The servers it may reach through the shell (services.ts, docs/design/SERVICES.md): only in a vault of the person's own. */
  services: Service[];
  /** why `services` was refused, when it was (the applet then reaches no service) */
  servicesError?: string;
  /** What counts as something for the person (signals.ts): the badge on the bar, and the notification. */
  signals: Signal[];
  /** why `signals` was refused, when it was (the applet then shows no count) */
  signalsError?: string;
  /** Which of the note's asks this device left out (someone else's vault here, a server at one of this device's hubs, a
   *  field it couldn't read). Part of the asks' hash (approvals.ts): an approval made where its card left something out
   *  doesn't allow the applet on a device that leaves nothing out. */
  left?: string[];
  /** Written for a newer app than this one (`needs` above this build's level, or a manifest key or contract it doesn't
   *  know: level.ts). Listed by its name so its place on the bar stays, with nothing allowed: its screen says "Update
   *  Parachute to use …" and nothing of it runs. */
  newer?: true;
  /** Why it reads as newer, in a few words: the level it needs, or the manifest's key this app doesn't know. */
  newerWhy?: string;
};
export type Discovery = { entries: AppletEntry[]; skipped: number };
type Row = { id?: unknown; path?: unknown; tags?: unknown; metadata?: unknown };

/** `theirs`: the vault isn't the person's own (vault/whose.ts): its applets ask nothing of the app, whatever `app` says,
 *  reach no service and no microphone. `isHub`: is an origin one of the person's Parachute hubs (never a service). */
/** An applet written for a newer app: its name and glyph (when they read as such), and nothing it asks. */
function newerEntry(r: { id: string; path: string }, raw: unknown, vault: string, why: string): AppletEntry {
  const name = shownName(raw) ?? stripExt(r.path).split("/").pop() ?? "this applet";
  const own = shownId(raw);
  const manifest: Manifest = { contract: 2, id: own && !BUILT_IN_IDS.includes(own) ? own : `newer-${r.id.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`.slice(0, 40).replace(/-+$/, ""), name, glyph: shownGlyph(raw), allow: [], search: [], screens: [{ id: "home", name }] };
  return { manifest, vault, noteId: r.id, path: r.path, opens: [], app: [], embeds: [], services: [], signals: [], newer: true, newerWhy: why };
}

/** `level`: this build's (level.ts); a test gives an older one. */
export function readApplet(r: Row, vault: string, theirs = false, isHub: (origin: string) => boolean = () => false, level = APP_LEVEL): { ok: true; entry: AppletEntry } | { ok: false; error: string } {
  if (typeof r.id !== "string" || !r.id || typeof r.path !== "string" || !r.path) return { ok: false, error: "it isn't a note" };
  if (!Array.isArray(r.tags) || !r.tags.includes("applet")) return { ok: false, error: "it isn't tagged applet" };
  const meta = plain(r.metadata) ? r.metadata : {};
  // written for a newer app: listed, never read further or run
  if (tooNew(meta.needs, level)) return { ok: true, entry: newerEntry({ id: r.id, path: r.path }, meta.applet, vault, neededWhy(meta.needs, level)) };
  const parsed = parseManifest(meta.applet);
  if (!parsed.ok && parsed.newer) return { ok: true, entry: newerEntry({ id: r.id, path: r.path }, meta.applet, vault, `its manifest: ${parsed.error}`) };
  if (!parsed.ok) return { ok: false, error: `its manifest is invalid: ${parsed.error}` };
  if (BUILT_IN_IDS.includes(parsed.manifest.id)) return { ok: false, error: `the id ${parsed.manifest.id} is the app's own` };
  if (meta.interface !== undefined && meta.interface !== null) return { ok: false, error: "a contract 2 applet has one manifest. Its note must not carry interface too" };
  const left: string[] = [];
  // as with `app`: an applet in someone else's vault gets no microphone, whatever its manifest says
  if (theirs && parsed.manifest.reach) left.push("reach");
  if (theirs && parsed.manifest.reach) { const { reach: _dropped, ...rest } = parsed.manifest; parsed.manifest = rest; }
  // as with `opens`: a bad `app` costs the applet what it asked of the app, not the applet
  const app = theirs ? { ok: false as const, error: "an applet in someone else's vault can't ask the app for anything" } : parseApp(meta.app);
  const opens = parseOpens(meta.opens, parsed.manifest);
  const services = theirs ? (meta.services === undefined ? { ok: true as const, services: [] } : { ok: false as const, error: "an applet in someone else's vault reaches no service" }) : parseServices(meta.services, isHub);
  // as with `opens`: a bad `signals` costs the applet its counts, not the applet
  const signals = parseSignals(meta.signals, parsed.manifest, services.ok ? services.services : [], theirs, isHub);
  if (meta.app !== undefined && !app.ok) left.push("app");
  if (!services.ok) left.push("services");
  if (!signals.ok) left.push("signals");
  return { ok: true, entry: { manifest: parsed.manifest, vault, noteId: r.id, path: r.path, opens: opens.ok ? opens.opens : [], app: app.ok ? app.app : [], embeds: theirs ? [] : parseEmbeds(meta.embeds), services: services.ok ? services.services : [],
    signals: signals.ok ? signals.value : [], ...(left.length ? { left } : {}),
    ...(app.ok ? {} : { appError: app.error }), ...(opens.ok ? {} : { opensError: opens.error }), ...(services.ok ? {} : { servicesError: services.error }), ...(signals.ok ? {} : { signalsError: signals.error }) } };
}

export function discoverApplets(rows: readonly Row[], vault: string, theirs = false, isHub: (origin: string) => boolean = () => false, level = APP_LEVEL): Discovery {
  const entries: AppletEntry[] = [];
  const ids = new Set<string>();
  let skipped = 0;
  const sorted = [...rows].sort((a, b) => String(a.path ?? "").localeCompare(String(b.path ?? "")));
  for (const r of sorted) {
    const a = readApplet(r, vault, theirs, isHub, level);
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
