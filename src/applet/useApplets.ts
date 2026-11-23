// The applets in one vault, as the app lists them (discovery.ts), read from the vault's notes tagged `applet` and kept
// for this session. Read again when a screen asks (`refresh`), so a newly published applet shows up.
import { failureOf, settled, type Failure } from "../vault/failure";
import { hubCheck } from "../services/hubs";
import { useEffect, useSyncExternalStore } from "react";
import type { Note, VaultClient } from "@openparachute/surface-client";
import { MAX_CODE_CHARS } from "../vault/limited";
import { whoseOf } from "../vault/whose";
import { embedsFrom, readPointers } from "./pointers";
import { compositeHash, importsOf } from "./imports";
import { readImports } from "./resolveImports";
import { discoverApplets, type AppletEntry, type Discovery } from "./discovery";
import { grantKey, grantOf } from "./grant";
import { codeHash, codeKindOf } from "./code";
import { withoutRoles } from "./opens";
import { readRoleTags } from "../open/roles";
import { clientFor, keptClientFor } from "../vault/client";
import { onFresh } from "../vault/readCache";
import { findVault } from "../vault/store";
import type { VaultRecord } from "../vault/store";

type Entry = { state: "loading" } | { state: "ok"; found: Read; at: number } | { state: "error"; error: string; failure: Failure };
const cache = new Map<string, Entry>();
const LOADING: Entry = { state: "loading" };
const inflight = new Map<string, Promise<boolean>>();
/** How many of the hub's own answers (fresh reads) have landed per vault. */
const freshSet = new Map<string, number>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((f) => f());

/** An applet as read now, with the two keys its status is judged on: the grant's and its code's. */
export type Keyed = AppletEntry & { keys: { scope: string; html: string } };
export type Read = { entries: Keyed[]; skipped: number };

/** The rows of a vault's applets, with their code. From someone else's vault (`notMine`), listed without their code and
 *  then read one at a time, so no one reply is big (vault/limited.ts), and any whose code is over the limit left out. */
async function appletRows(client: Pick<VaultClient, "queryNotes" | "getNote">, notMine: boolean): Promise<Note[]> {
  if (!notMine) return client.queryNotes({ tag: "applet", limit: 200, includeMetadata: true, includeContent: true });
  const listed = (await client.queryNotes({ tag: "applet", limit: 200, includeMetadata: true })).filter((r) => codeKindOf(r as { extension?: string }) !== null);
  const out: Note[] = [];
  for (let i = 0; i < listed.length; i += 4) {
    const got = await Promise.all(listed.slice(i, i + 4).map((r) => client.getNote(r.id).catch(() => null)));
    for (const n of got) if (n && (n.content ?? "").length <= MAX_CODE_CHARS) out.push(n);
  }
  return out;
}

export async function readApplets(client: Pick<VaultClient, "queryNotes" | "getNote">, vault: string, notMine = false, host?: VaultRecord): Promise<Read> {
  const [rows, roles] = await Promise.all([appletRows(client, notMine), readRoleTags(client)]);
  const found: Discovery = discoverApplets(rows.filter((r) => codeKindOf(r as { extension?: string }) !== null), vault, notMine, hubCheck());
  const html = new Map(rows.map((r) => [r.id, r.content ?? ""]));
  const kinds = new Map(rows.map((r) => [r.id, codeKindOf(r as { extension?: string })]));
  // as the applet screen reads them: the vault's role tags dropped first, so the keys match its keys
  // as the applet screen keys them: a page that shows things from someone else's vaults says so in its key
  const pointers = found.entries.some((e) => e.embeds.length) && host ? await readPointers() : [];
  const entries = await Promise.all(found.entries.map((e) => ({ ...e, opens: withoutRoles(e.opens, roles) })).map(async (e) => {
    const from = e.embeds.length && host ? await embedsFrom(host, e.embeds, pointers) : [];
    // as the applet screen hashes it: with what it imports, when it imports (an import it can't find leaves the plain
    // hash, and its screen refuses it)
    const kind = kinds.get(e.noteId)!, source = html.get(e.noteId) ?? "";
    const imp = kind !== "html" && host && importsOf(source).length ? await readImports(host, source).catch(() => null) : null;
    const code = imp?.ok && imp.imports.length && kind !== "html" ? await compositeHash(kind, source, imp.imports) : await codeHash(kind, source);
    return { ...e, keys: { scope: await grantKey({ ...grantOf(e.manifest, vault, e.opens, e.app, e.services, e.signals, e.settings), embedsFrom: from }, e.path), html: code } };
  }));
  return { entries, skipped: rows.length - found.entries.length };
}

/** Read a vault's applets again. Resolves to whether this read succeeded (a failure keeps the last list for the strip).
 *  Drawn from the copy kept of the read, the hub asked behind it (vault/readCache.ts); `fresh`: the hub's answer now,
 *  for what judges an applet as it is now (open-with at a tap, a pointer pinned to its code, a shipped applet added). */
export function refreshApplets(rec: VaultRecord, fresh = false): Promise<boolean> {
  const at = fresh ? `${rec.key}\u0000fresh` : rec.key;
  const running = inflight.get(at);
  if (running) return running;
  if (!cache.has(rec.key)) cache.set(rec.key, { state: "loading" });
  // a read from the copy that set off before the hub's own answer landed never lays its list over that answer
  const set = freshSet.get(rec.key) ?? 0;
  const p = readApplets(fresh ? clientFor(rec) : keptClientFor(rec), rec.key, whoseOf(rec) !== "mine", rec)
    .then((found) => {
      if (!fresh && (freshSet.get(rec.key) ?? 0) !== set) return true;
      if (fresh) freshSet.set(rec.key, (freshSet.get(rec.key) ?? 0) + 1);
      cache.set(rec.key, { state: "ok", found, at: Date.now() }); return true;
    }, async (e: unknown) => {
      // what went wrong, in the words the list says it with (a read that reached no hub may be a refused sign-in)
      const f = await settled(rec, failureOf(e)).catch(() => "other" as const);
      if (cache.get(rec.key)?.state !== "ok") cache.set(rec.key, { state: "error", error: String(e), failure: f === "alive" ? "offline" : f });
      return false;
    })
    .finally(() => { inflight.delete(at); notify(); });
  inflight.set(at, p);
  return p;
}

// what the list was drawn from (the copy kept of the reads, vault/readCache.ts) differs from the hub's answer: read again
onFresh((vault, key) => {
  if (!cache.has(vault) || !/[?&]tag=(?:applet|component)(?:&|$)|\.parachute%2Fnotes%2Fsettings|\/\.parachute\/notes\/settings/.test(key)) return;
  const rec = findVault(vault);
  if (rec) void refreshApplets(rec);
});

export function useApplets(rec: VaultRecord | null, refreshOnMount = true): Entry {
  const entry = useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => (rec ? cache.get(rec.key) : undefined) ?? LOADING);
  useEffect(() => { if (rec && (refreshOnMount || !cache.has(rec.key))) void refreshApplets(rec); }, [rec?.key]); // eslint-disable-line react-hooks/exhaustive-deps
  return entry;
}

/** What was last read for a vault, outside React. */
export const appletsNow = (key: string): Entry | undefined => cache.get(key);
export function subscribeApplets(cb: () => void): () => void { listeners.add(cb); return () => { listeners.delete(cb); }; }

/** Forget what was read (sign-out). */
export const forgetApplets = (key: string) => { cache.delete(key); notify(); };
