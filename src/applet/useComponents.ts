// The components in one vault (component.ts), read from its records tagged `component` and kept for the session, with
// each one's code hash. From someone else's vault they are listed without their code and read one at a time, and any
// whose code is over the limit is left out (vault/limited.ts).
import type { Note, VaultClient } from "@openparachute/surface-client";
import { codeHash } from "./code";
import { COMPONENT_TAG, discoverComponents, type ComponentEntry } from "./component";
import { clientFor } from "../vault/client";
import { MAX_CODE_CHARS } from "../vault/limited";
import { whoseOf } from "../vault/whose";
import type { VaultRecord } from "../vault/store";

export type KeyedComponent = ComponentEntry & { hash: string; source: string };
type Entry = { state: "ok"; entries: KeyedComponent[]; skipped: number } | { state: "error"; error: string };
const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<Entry>>();

async function rows(client: Pick<VaultClient, "queryNotes" | "getNote">, notMine: boolean): Promise<Note[]> {
  if (!notMine) return client.queryNotes({ tag: COMPONENT_TAG, limit: 200, includeMetadata: true, includeContent: true });
  const listed = await client.queryNotes({ tag: COMPONENT_TAG, limit: 200, includeMetadata: true });
  const out: Note[] = [];
  for (let i = 0; i < listed.length; i += 4) {
    const got = await Promise.all(listed.slice(i, i + 4).map((r) => client.getNote(r.id).catch(() => null)));
    for (const n of got) if (n && (n.content ?? "").length <= MAX_CODE_CHARS) out.push(n);
  }
  return out;
}

export async function readComponents(client: Pick<VaultClient, "queryNotes" | "getNote">, vault: string, notMine = false): Promise<{ entries: KeyedComponent[]; skipped: number }> {
  const all = await rows(client, notMine);
  const found = discoverComponents(all, vault);
  const body = new Map(all.map((r) => [r.id, r.content ?? ""]));
  const entries = await Promise.all(found.entries.map(async (e) => ({ ...e, source: body.get(e.noteId) ?? "", hash: await codeHash(e.kind, body.get(e.noteId) ?? "") })));
  return { entries, skipped: found.skipped };
}

/** Read a vault's components (again). */
export function refreshComponents(rec: VaultRecord): Promise<Entry> {
  const running = inflight.get(rec.key);
  if (running) return running;
  const p = readComponents(clientFor(rec), rec.key, whoseOf(rec) !== "mine")
    .then((r): Entry => ({ state: "ok", ...r }), (e: unknown): Entry => ({ state: "error", error: e instanceof Error ? e.message : String(e) }))
    .then((e) => { cache.set(rec.key, e); return e; })
    .finally(() => inflight.delete(rec.key));
  inflight.set(rec.key, p);
  return p;
}
export const componentsNow = (key: string): Entry | undefined => cache.get(key);
export const forgetComponents = (key: string) => { cache.delete(key); };
