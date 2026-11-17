// The pointers in the person's home vault (pointer.ts): read, found for a record, written and re-pinned by the shell.
// Only the home vault's are read (docs/design/EMBED.md), and only when that vault is the person's own.
import type { VaultClient } from "@openparachute/surface-client";
import { homeVault } from "../shell/frameSource";
import { clientFor } from "../vault/client";
import { isMine } from "../vault/whose";
import type { VaultRecord } from "../vault/store";
import { parsePointer, pointerPath, POINTER_TAG, type Pointer } from "./pointer";

export type PointerNote = { noteId: string; path: string; updatedAt: string | null; pointer: Pointer };
const originOf = (issuer: string) => { try { return new URL(issuer).origin; } catch { return issuer; } };

/** The home vault's pointers that parse. */
export async function readPointers(c: Pick<VaultClient, "queryNotes"> | null = homeClient()): Promise<PointerNote[]> {
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
  const there = (await readPointers(c)).find((p) => names(p.pointer, rec, recordId));
  if (there) { await repin(there, what.code, c); return { ...there, pointer: { ...there.pointer, code: what.code } }; }
  const host = new URL(pointer.hub).host;
  const n = await c.createNote({ path: pointerPath(host, rec.vault, what.kind, what.id), content: `${what.name}, from ${rec.vault} at ${host}. Brought in by the Parachute app; see docs/OTHER-PARACHUTES.md.`, tags: [POINTER_TAG], metadata: { pointer } } as Parameters<typeof c.createNote>[0]);
  return { noteId: n.id, path: n.path ?? "", updatedAt: (n as { updatedAt?: string }).updatedAt ?? null, pointer };
}

/** Pin a pointer to new code (the person allowed it): only its `code`, only if the note is as it was read. */
export async function repin(p: PointerNote, code: string, c: Pick<VaultClient, "getNote" | "updateNote"> | null = homeClient()): Promise<void> {
  if (!c || p.pointer.code === code) return;
  const n = await c.getNote(p.noteId);
  if (!n) return;
  const meta = (n.metadata ?? {}) as Record<string, unknown>;
  const now = parsePointer(meta.pointer);
  if (!now.ok || now.pointer.record !== p.pointer.record) return;
  const updatedAt = (n as { updatedAt?: string }).updatedAt;
  await c.updateNote(n.id, { metadata: { ...meta, pointer: { ...(meta.pointer as object), code } }, ...(updatedAt ? { if_updated_at: updatedAt } : {}) } as Parameters<typeof c.updateNote>[1]);
}
