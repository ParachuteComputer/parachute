// Parachute's own applets (docs/design/PARACHUTE-SOURCE.md): Notes, Journal, Capture, Vault, Connect and Home. They load
// from the Parachute source and never from a vault: the copy built into the app, or a newer one published on
// parachute.computer, signed with a key on PARACHUTE_KEYS, checked here when it is taken and again each time it loads.
// The applet screen decides by the address alone (`parachute:<name>`) before anything is read from a vault, so nothing a
// vault holds (an id, a path, a name, a hash) can make an applet Parachute's. They run with no card: the person trusted
// this code when they installed the app.
import captureRecord from "../../applets/capture.json";
import captureBody from "../../applets/capture.tsx?raw";
import journalRecord from "../../applets/journal.json";
import journalBody from "../../applets/journal.tsx?raw";
import vaultRecord from "../../applets/vault.json";
import vaultBody from "../../applets/vault.tsx?raw";
import homeRecord from "../../applets/home.json";
import homeBody from "../../applets/home.tsx?raw";
import notesRecord from "../../applets/notes.json";
import notesBody from "../../applets/notes.tsx?raw";
import connectRecord from "../../applets/connect.json";
import connectBody from "../../applets/connect.tsx?raw";
import { verifyEvent } from "nostr-tools/pure";
import { plain } from "./contract";
import { sha256Hex } from "./needs";
import { APP_LEVEL, tooNew } from "./level";
import { importsOf } from "./imports";

/** Parachute's release keys (x-only, hex). An index signed by any other key is refused. None yet: the key is made and
 *  kept off every machine that runs agents (docs/design/PARACHUTE-SOURCE.md, "The release key"); until it is listed
 *  here, the app's own copies are all that run, and nothing is fetched. */
const RELEASE_KEYS: string[] = [];
/** TEST ONLY: the end-to-end tests' release key (e2e/fixtures/release-test.key), compiled in only when the build sets
 *  VITE_E2E_SIGNER=1; CI checks the app's bundle has no trace of it (scripts/no-test-signer.sh). */
export const PARACHUTE_KEYS: readonly string[] = import.meta.env.VITE_E2E_SIGNER === "1"
  ? [...RELEASE_KEYS, "bcf193dfc16ce72d537863fd04861c5abf18a304da35d1a6e7dfb865e9364904"] : RELEASE_KEYS;
/** Where updates are published: the signed index, and each applet's code beside it as `<sha256>.<extension>`. */
export const PARACHUTE_PUBLISHER = "https://parachute.computer/applets/";
/** The index's event kind; `d` names it. On no applet's signing path (the person's key never signs it). */
export const INDEX_KIND = 30481;
export const INDEX_D = "parachute-applets";

export const OFFICIAL_NAMES = ["notes", "journal", "capture", "vault", "connect", "home"] as const;
export type OfficialName = (typeof OFFICIAL_NAMES)[number];
export type OfficialRecord = { path: string; extension: "tsx" | "jsx" | "html"; tags: string[]; fields: Record<string, unknown> };
export type Official = { name: OfficialName; version: number; record: OfficialRecord; body: string; from: "app" | "update" };

const PREFIX = "parachute:";
/** An official applet's note id in its address: `parachute:<name>`. A hub's note ids are ULIDs, never this. */
export const officialId = (name: OfficialName) => `${PREFIX}${name}`;
/** The official applet an address names, from the address alone; null for every other id. */
export function officialOf(noteId: string | null | undefined): OfficialName | null {
  if (!noteId || !noteId.startsWith(PREFIX)) return null;
  const n = noteId.slice(PREFIX.length);
  return (OFFICIAL_NAMES as readonly string[]).includes(n) ? (n as OfficialName) : null;
}
/** Any id in Parachute's own space, known to this build or not: never a vault's to claim. */
export const inParachuteSpace = (noteId: string | null | undefined) => !!noteId && noteId.startsWith(PREFIX);

type Shipped = { version?: number; path: string; extension: string; tags: string[]; fields: unknown };
const own = (name: OfficialName, r: Shipped, body: string): Official => ({
  name, version: typeof r.version === "number" ? r.version : 1, body, from: "app",
  record: { path: r.path, extension: r.extension as OfficialRecord["extension"], tags: r.tags, fields: r.fields as Record<string, unknown> },
});
/** The copies built into this app: the floor, offline and on a first run. */
export const BUNDLED: Record<OfficialName, Official> = {
  capture: own("capture", captureRecord as Shipped, captureBody),
  journal: own("journal", journalRecord as Shipped, journalBody),
  vault: own("vault", vaultRecord as Shipped, vaultBody),
  home: own("home", homeRecord as Shipped, homeBody),
  notes: own("notes", notesRecord as Shipped, notesBody),
  connect: own("connect", connectRecord as Shipped, connectBody),
};

export type SignedIndex = { id: string; pubkey: string; created_at: number; kind: number; tags: string[][]; content: string; sig: string };
type IndexEntry = { version: number; needs?: unknown; sha256: string; record: OfficialRecord };
type Index = { n: number; applets: Partial<Record<OfficialName, IndexEntry>> };

const HEX64 = /^[0-9a-f]{64}$/;
function recordOf(x: unknown): OfficialRecord | null {
  if (!plain(x) || typeof x.path !== "string" || !x.path || x.path.length > 300 || !["tsx", "jsx", "html"].includes(x.extension as string)) return null;
  if (!Array.isArray(x.tags) || !x.tags.every((t) => typeof t === "string") || !x.tags.includes("applet") || !plain(x.fields)) return null;
  return { path: x.path, extension: x.extension as OfficialRecord["extension"], tags: x.tags as string[], fields: x.fields };
}

/** The index's content, when its event is sound, signed by a listed key, of the right kind and name; else null. */
export function readIndex(ev: unknown, keys: readonly string[] = PARACHUTE_KEYS): Index | null {
  if (!plain(ev)) return null;
  const e = ev as SignedIndex;
  if (e.kind !== INDEX_KIND || !keys.includes(e.pubkey) || !Array.isArray(e.tags) || !e.tags.some((t) => Array.isArray(t) && t[0] === "d" && t[1] === INDEX_D)) return null;
  let ok = false;
  try { ok = verifyEvent({ id: e.id, pubkey: e.pubkey, created_at: e.created_at, kind: e.kind, tags: e.tags, content: e.content, sig: e.sig }); } catch { ok = false; }
  if (!ok) return null;
  let c: unknown;
  try { c = JSON.parse(e.content); } catch { return null; }
  if (!plain(c) || c.v !== 1 || typeof c.n !== "number" || !Number.isSafeInteger(c.n) || c.n < 1 || !plain(c.applets)) return null;
  const applets: Index["applets"] = {};
  for (const name of OFFICIAL_NAMES) {
    const a = c.applets[name];
    if (!plain(a) || typeof a.version !== "number" || !Number.isSafeInteger(a.version) || typeof a.sha256 !== "string" || !HEX64.test(a.sha256)) continue;
    const record = recordOf(a.record);
    if (record) applets[name] = { version: a.version, needs: a.needs, sha256: a.sha256, record };
  }
  return { n: c.n, applets };
}

// ── what this device took ──
// One store: the newest index it took, and the code of each update in it, keyed by sha256. Read and checked again on
// every load (signature, key, hash), so nothing written here by anything else runs as Parachute's.
const STORE = "parachute.source.v1";
type Kept = { n: number; index: SignedIndex; code: Record<string, string> };
export type Storage = { get(): string | null; set(v: string): void };
const local: Storage = {
  get: () => { try { return localStorage.getItem(STORE); } catch { return null; } },
  set: (v) => { try { localStorage.setItem(STORE, v); } catch { /* full or off: the app's own copies stay */ } },
};
function readKept(store: Storage): Kept | null {
  try {
    const k = JSON.parse(store.get() ?? "null") as unknown;
    return plain(k) && typeof k.n === "number" && plain(k.index) && plain(k.code) ? (k as unknown as Kept) : null;
  } catch { return null; }
}

/** The update to take for one applet from an index, when there is one: newer than this app's copy, for a level this app
 *  has, and its code what the index says. */
async function updateFrom(name: OfficialName, idx: Index, code: (sha: string) => string | undefined, level: number): Promise<Official | null> {
  const a = idx.applets[name];
  if (!a || a.version <= BUNDLED[name].version || tooNew(a.needs, level)) return null;
  const body = code(a.sha256);
  if (body === undefined || (await sha256Hex(body)) !== a.sha256) return null;
  // nothing of a vault comes into a frame with no card: an update that imports or embeds is left, the app's copy runs
  if (importsOf(body).length || a.record.fields.embeds !== undefined) return null;
  return { name, version: a.version, record: a.record, body, from: "update" };
}

/** An official applet as this device runs it now: a kept update that still checks, else the app's own copy. */
export async function officialNow(name: OfficialName, opts: { store?: Storage; keys?: readonly string[]; level?: number } = {}): Promise<Official> {
  const kept = readKept(opts.store ?? local);
  const idx = kept ? readIndex(kept.index, opts.keys) : null;
  if (!kept || !idx || idx.n !== kept.n) return BUNDLED[name];
  return (await updateFrom(name, idx, (sha) => kept.code[sha], opts.level ?? APP_LEVEL)) ?? BUNDLED[name];
}

export type SyncResult = "taken" | "same" | "refused" | "offline";
/** Read the publisher's index once and take what it updates: only an index signed by a listed key, numbered above the
 *  one this device took, each applet's code fetched beside it and matching its hash. Anything else leaves things as
 *  they are. */
export async function syncParachuteSource(opts: { fetch?: typeof fetch; publisher?: string; store?: Storage; keys?: readonly string[]; level?: number } = {}): Promise<SyncResult> {
  const get = opts.fetch ?? fetch, publisher = opts.publisher ?? PARACHUTE_PUBLISHER, store = opts.store ?? local, level = opts.level ?? APP_LEVEL;
  // no key to check an index with: nothing is asked of the publisher
  if (!(opts.keys ?? PARACHUTE_KEYS).length) return "refused";
  let ev: unknown;
  try {
    const r = await get(`${publisher}index.json`, { cache: "no-store" });
    if (!r.ok) return "offline";
    ev = await r.json();
  } catch { return "offline"; }
  const idx = readIndex(ev, opts.keys);
  if (!idx) return "refused";
  const was = readKept(store);
  if (was && idx.n <= was.n) return idx.n === was.n ? "same" : "refused";
  const code: Record<string, string> = {};
  for (const name of OFFICIAL_NAMES) {
    const a = idx.applets[name];
    if (!a || a.version <= BUNDLED[name].version || tooNew(a.needs, level)) continue;
    try {
      const r = await get(`${publisher}${a.sha256}.${a.record.extension}`, { cache: "no-store" });
      // a code that didn't arrive (or doesn't match) leaves the index untaken: the next start asks again
      if (!r.ok) return "offline";
      const body = await r.text();
      if ((await sha256Hex(body)) !== a.sha256) return "refused";
      code[a.sha256] = body;
    } catch { return "offline"; }
  }
  store.set(JSON.stringify({ n: idx.n, index: ev as SignedIndex, code } satisfies Kept));
  return "taken";
}

/** How the list and the bar name an official applet: from this app's own copy (an update keeps its name). */
export function officialFace(name: OfficialName): { name: string; glyph: string; note?: string; screens: { id: string; name: string }[] } {
  const a = (BUNDLED[name].record.fields.applet ?? {}) as { name?: string; glyph?: string; note?: string; screens?: { id: string; name: string }[] };
  return { name: a.name ?? name, glyph: a.glyph ?? "·", ...(a.note ? { note: a.note } : {}), screens: a.screens ?? [{ id: "home", name: a.name ?? name }] };
}
/** The address of an official applet in the home vault. */
export const officialPath = (homeKey: string, name: OfficialName) => `/v/${encodeURIComponent(homeKey)}/a/${encodeURIComponent(officialId(name))}`;

/** The official applet a vault's applet copies by its manifest id (the old Add Capture wrote such copies into the home),
 *  by name; null for any other. Only for telling the two apart in a list: a copy is still an ordinary applet. */
export function officialCopyOf(manifestId: string): string | null {
  for (const n of OFFICIAL_NAMES) {
    const a = BUNDLED[n].record.fields.applet as { id?: string; name?: string } | undefined;
    if (a?.id === manifestId) return a.name ?? n;
  }
  return null;
}
