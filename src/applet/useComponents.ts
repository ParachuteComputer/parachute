// The components in one vault (component.ts), read from its records tagged `component` and kept for the session. From
// the person's own vaults, with their code and its hash. From someone else's, listed from their fields alone (no code,
// so a listing is one small reply); a component's code is read on its own, and checked against the limit, only when it
// is brought in, added to a page or imported (`fullComponent`).
import type { Note, VaultClient } from "@openparachute/surface-client";
import { codeHash } from "./code";
import { COMPONENT_TAG, discoverComponents, type ComponentEntry } from "./component";
import { clientFor } from "../vault/client";
import { MAX_CODE_CHARS } from "../vault/limited";
import { whoseOf } from "../vault/whose";
import type { VaultRecord } from "../vault/store";

export type KeyedComponent = ComponentEntry & { hash: string; source: string };
type Entry = { state: "ok"; entries: KeyedComponent[]; skipped: number; at: number } | { state: "error"; error: string };
/** A read this recent is used again, unless a fresh one is asked for (a write that pins a hash asks). */
const FRESH_MS = 10_000;
const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<Entry>>();

async function rows(client: Pick<VaultClient, "queryNotes" | "getNote">, notMine: boolean): Promise<Note[]> {
  return client.queryNotes({ tag: COMPONENT_TAG, limit: 200, includeMetadata: true, ...(notMine ? {} : { includeContent: true }) });
}

/** One component with its code and hash, read now (for someone else's vault, within the limit). */
export async function fullComponent(rec: VaultRecord, noteId: string): Promise<KeyedComponent> {
  const n = await clientFor(rec).getNote(noteId);
  if (!n) throw new Error("That component is gone.");
  if (whoseOf(rec) !== "mine" && (n.content ?? "").length > MAX_CODE_CHARS) throw new Error("That component is bigger than one from someone else's vault may be.");
  const found = discoverComponents([n], rec.key).entries[0];
  if (!found) throw new Error("That isn't a component this vault has.");
  return { ...found, source: n.content ?? "", hash: await codeHash(found.kind, n.content ?? "") };
}

export async function readComponents(client: Pick<VaultClient, "queryNotes" | "getNote">, vault: string, notMine = false): Promise<{ entries: KeyedComponent[]; skipped: number }> {
  const all = await rows(client, notMine);
  const found = discoverComponents(all, vault);
  const body = new Map(all.map((r) => [r.id, r.content ?? ""]));
  // listed without code (someone else's vault): no source, no hash
  const entries = await Promise.all(found.entries.map(async (e) => ({ ...e, source: body.get(e.noteId) ?? "", hash: notMine ? "" : await codeHash(e.kind, body.get(e.noteId) ?? "") })));
  return { entries, skipped: found.skipped };
}

/** A vault's components: as read in the last few seconds, or read again (`fresh`: always). */
export function refreshComponents(rec: VaultRecord, fresh = false): Promise<Entry> {
  const hit = cache.get(rec.key);
  if (!fresh && hit?.state === "ok" && Date.now() - hit.at < FRESH_MS) return Promise.resolve(hit);
  const running = inflight.get(rec.key);
  if (running) return running;
  const p = readComponents(clientFor(rec), rec.key, whoseOf(rec) !== "mine")
    .then((r): Entry => ({ state: "ok", ...r, at: Date.now() }), (e: unknown): Entry => ({ state: "error", error: e instanceof Error ? e.message : String(e) }))
    .then((e) => { cache.set(rec.key, e); return e; })
    .finally(() => inflight.delete(rec.key));
  inflight.set(rec.key, p);
  return p;
}
export const componentsNow = (key: string): Entry | undefined => cache.get(key);
export const forgetComponents = (key: string) => { cache.delete(key); };
