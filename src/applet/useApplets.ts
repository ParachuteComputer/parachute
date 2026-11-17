// The applets in one vault, as the app lists them (discovery.ts), read from the vault's notes tagged `applet` and kept
// for this session. Read again when a screen asks (`refresh`), so a newly published applet shows up.
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
import { clientFor } from "../vault/client";
import type { VaultRecord } from "../vault/store";

type Entry = { state: "loading" } | { state: "ok"; found: Read; at: number } | { state: "error"; error: string };
const cache = new Map<string, Entry>();
const LOADING: Entry = { state: "loading" };
const inflight = new Map<string, Promise<boolean>>();
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
  const found: Discovery = discoverApplets(rows.filter((r) => codeKindOf(r as { extension?: string }) !== null), vault, notMine);
  const html = new Map(rows.map((r) => [r.id, r.content ?? ""]));
  const kinds = new Map(rows.map((r) => [r.id, codeKindOf(r as { extension?: string })]));
  // as the applet screen reads them: the vault's role tags dropped first, so the keys match its keys
  // as the applet screen keys them: a page that shows things from someone else's vaults says so in its key
  const pointers = found.entries.some((e) => e.embeds.length) && host ? await readPointers().catch(() => []) : [];
  const entries = await Promise.all(found.entries.map((e) => ({ ...e, opens: withoutRoles(e.opens, roles) })).map(async (e) => {
    const from = e.embeds.length && host ? await embedsFrom(host, e.embeds, pointers) : [];
    // as the applet screen hashes it: with what it imports, when it imports (an import it can't find leaves the plain
    // hash, and its screen refuses it)
    const kind = kinds.get(e.noteId)!, source = html.get(e.noteId) ?? "";
    const imp = kind !== "html" && host && importsOf(source).length ? await readImports(host, source).catch(() => null) : null;
    const code = imp?.ok && imp.imports.length && kind !== "html" ? await compositeHash(kind, source, imp.imports) : await codeHash(kind, source);
    return { ...e, keys: { scope: await grantKey({ ...grantOf(e.manifest, vault, e.opens, e.app), embedsFrom: from }, e.path), html: code } };
  }));
  return { entries, skipped: rows.length - found.entries.length };
}

/** Read a vault's applets again. Resolves to whether this read succeeded (a failure keeps the last list for the strip). */
export function refreshApplets(rec: VaultRecord): Promise<boolean> {
  const running = inflight.get(rec.key);
  if (running) return running;
  if (!cache.has(rec.key)) cache.set(rec.key, { state: "loading" });
  const p = readApplets(clientFor(rec), rec.key, whoseOf(rec) !== "mine", rec)
    .then((found) => { cache.set(rec.key, { state: "ok", found, at: Date.now() }); return true; }, (e: unknown) => { if (cache.get(rec.key)?.state !== "ok") cache.set(rec.key, { state: "error", error: String(e) }); return false; })
    .finally(() => { inflight.delete(rec.key); notify(); });
  inflight.set(rec.key, p);
  return p;
}

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
