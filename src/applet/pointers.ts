// The pointers in the person's home vault (pointer.ts): read, found for a record, written and re-pinned by the shell.
// Only the home vault's are read (docs/design/EMBED.md), and only when that vault is the person's own.
import type { VaultClient } from "@openparachute/surface-client";
import { homeVault } from "../shell/frameSource";
import { clientFor, keptClientFor } from "../vault/client";
import { isMine } from "../vault/whose";
import { originOf, listVaults, type VaultRecord } from "../vault/store";
import { stripExt } from "./contract";
import { parsePointer, pointerPath, POINTER_TAG, type Pointer } from "./pointer";

export type PointerNote = { noteId: string; path: string; updatedAt: string | null; pointer: Pointer };

/** The home vault's pointers that parse. */
export async function readPointers(c: Pick<VaultClient, "queryNotes"> | null = homeReader()): Promise<PointerNote[]> {
  if (!c) return [];
  const rows = await c.queryNotes({ tag: POINTER_TAG, includeMetadata: true, limit: 200 });
  const out: PointerNote[] = [];
  for (const r of rows) {
    const meta = (r.metadata ?? {}) as Record<string, unknown>;
    const p = parsePointer(meta.pointer);
    if (p.ok && r.path) out.push({ noteId: r.id, path: r.path, updatedAt: (r as { updatedAt?: string }).updatedAt ?? null, pointer: p.pointer });
  }
  return out;
}
function homeClient() { const h = homeVault(); return h && isMine(h) ? clientFor(h) : null; }
/** For a read only: answered from the copy kept of it at once, the hub asked behind it (vault/readCache.ts). */
function homeReader() { const h = homeVault(); return h && isMine(h) ? keptClientFor(h) : null; }

/** Does this pointer name that record (on that hub and vault)? */
export const names = (p: Pointer, rec: Pick<VaultRecord, "issuer" | "vault">, recordId: string) => p.hub === originOf(rec.issuer) && p.vault === rec.vault && p.record === recordId;

/** The pointer in the home vault that names this record, if one does (the first by path). */
export async function pointerFor(rec: Pick<VaultRecord, "issuer" | "vault">, recordId: string): Promise<PointerNote | null> {
  const all = await readPointers().catch(() => []);
  return all.sort((a, b) => a.path.localeCompare(b.path)).find((p) => names(p.pointer, rec, recordId)) ?? null;
}

/** Bring a record in: write a pointer to it in the home vault, pinned to `code` (the hash read now). One already there
 *  for it is re-pinned instead. */
export async function bringIn(rec: Pick<VaultRecord, "issuer" | "vault">, recordId: string, what: { kind: Pointer["kind"]; id: string; name: string; code: string }): Promise<PointerNote> {
  const home = homeVault();
  if (!home || !isMine(home)) throw new Error("You have no home vault of your own to bring it into.");
  const c = clientFor(home);
  const pointer: Pointer = { hub: originOf(rec.issuer), vault: rec.vault, record: recordId, kind: what.kind, id: what.id, name: what.name, code: what.code };
  const all = await readPointers(c);
  const there = all.find((p) => names(p.pointer, rec, recordId));
  if (there) { await repin(there, what.code, c); return { ...there, pointer: { ...there.pointer, code: what.code } }; }
  const host = new URL(pointer.hub).host;
  const path = pointerPath(host, rec.vault, what.kind, what.id);
  // a pointer already at that path names an older record of the same id (deleted and made again there): point it here
  const stale = all.find((p) => stripExt(p.path) === path);
  if (stale) {
    const n = await c.getNote(stale.noteId);
    const updatedAt = (n as { updatedAt?: string } | null)?.updatedAt;
    await c.updateNote(stale.noteId, { metadata: { ...((n?.metadata ?? {}) as object), pointer }, ...(updatedAt ? { if_updated_at: updatedAt } : {}) } as Parameters<typeof c.updateNote>[1]);
    return { ...stale, pointer };
  }
  const n = await c.createNote({ path, content: `${what.name}, from ${rec.vault} at ${host}. Brought in by the Parachute app; see docs/OTHER-PARACHUTES.md.`, tags: [POINTER_TAG], metadata: { pointer } } as Parameters<typeof c.createNote>[0]);
  return { noteId: n.id, path: n.path ?? "", updatedAt: (n as { updatedAt?: string }).updatedAt ?? null, pointer };
}

/** Pin a pointer to new code (the person allowed it): only its `code`, only if the note is as it was read. Whether the
 *  pointer now pins that code (it was written, or already did). */
export async function repin(p: PointerNote, code: string, c: Pick<VaultClient, "getNote" | "updateNote"> | null = homeClient()): Promise<boolean> {
  if (!c) return false;
  if (p.pointer.code === code) return true;
  const n = await c.getNote(p.noteId);
  if (!n) return false;
  const meta = (n.metadata ?? {}) as Record<string, unknown>;
  const now = parsePointer(meta.pointer);
  if (!now.ok || now.pointer.record !== p.pointer.record) return false;
  const updatedAt = (n as { updatedAt?: string }).updatedAt;
  await c.updateNote(n.id, { metadata: { ...meta, pointer: { ...(meta.pointer as object), code } }, ...(updatedAt ? { if_updated_at: updatedAt } : {}) } as Parameters<typeof c.updateNote>[1]);
  return true;
}

/** Where a page's embeds point, every one (hub and vault), whoever's: the same on every device, for the asks' hash. */
export async function embedTargets(embeds: readonly { record: string }[], all?: PointerNote[]): Promise<string[]> {
  if (!embeds.length) return [];
  const pointers = all ?? await readPointers();
  const out = new Set<string>();
  for (const e of embeds) {
    const p = pointers.find((x) => x.noteId === e.record || stripExt(x.path) === stripExt(e.record));
    out.add(p ? `${p.pointer.kind} ${p.pointer.hub} ${p.pointer.vault} ${p.pointer.record}` : `none ${e.record}`);
  }
  return [...out].sort();
}

/** The other vaults a page's embeds come from, as "<vault> at <host>", for its host's card and grant (EMBED.md): pointers
 *  to a vault that isn't the person's own and isn't the host's. */
export async function embedsFrom(host: Pick<VaultRecord, "issuer" | "vault">, embeds: readonly { record: string }[], all?: PointerNote[]): Promise<string[]> {
  if (!embeds.length) return [];
  // no pointers read is no answer: the host's card must not leave out where its embeds come from (it fails closed)
  const pointers = all ?? await readPointers();
  const from = new Set<string>();
  for (const e of embeds) {
    const p = pointers.find((x) => x.noteId === e.record || stripExt(x.path) === stripExt(e.record));
    if (!p || p.pointer.kind !== "component") continue;
    if (p.pointer.hub === originOf(host.issuer) && p.pointer.vault === host.vault) continue;
    const held = listVaults().find((v) => originOf(v.issuer) === p.pointer.hub && v.vault === p.pointer.vault);
    if (held && isMine(held)) continue;
    let h = p.pointer.hub; try { h = new URL(h).host; } catch { /* as written */ }
    from.add(`${p.pointer.vault} at ${h}`);
  }
  return [...from].sort();
}
