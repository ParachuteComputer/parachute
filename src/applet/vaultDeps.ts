// The frame's vault module reaches the vault through these, on this app's VaultClient for the applet's own vault.
// `types` is not in surface-client's payload types (0.3.7); the hub takes it on 0.9 (the record door).
import { VaultConflictError, type CreateNotePayload, type UpdateNotePayload, type VaultClient } from "@openparachute/surface-client";
import type { VaultDeps, VaultNote } from "./modules/vault";

const row = (n: { id: string; path?: string | null; extension?: string | null; updatedAt?: string | null }) => ({ id: n.id, path: n.path ?? null, extension: n.extension ?? null, updatedAt: n.updatedAt ?? null });

export function vaultDeps(c: VaultClient): VaultDeps {
  return {
    listPaths: async () => (await c.queryNotes({ orderBy: "updated_at", sort: "desc", limit: 500 })).map((n) => row(n as never)),
    getNote: async (ref) => { const n = await c.getNote(ref); if (!n) throw new Error("not found"); return n as VaultNote; },
    search: async (query, limit, pathPrefix) => (await c.queryNotes({ search: query, limit: String(limit), ...(pathPrefix ? { path_prefix: pathPrefix } : {}) }))
      .map((n) => ({ id: n.id, path: n.path ?? null, snippet: "" })),
    // surface-client's typed words (pathPrefix, not path_prefix: a mix of the two drops the folder)
    listFields: async (prefix, limit) => (await c.queryNotes({ pathPrefix: prefix, includeMetadata: true, orderBy: "updated_at", sort: "desc", limit })).map((n) => n as VaultNote),
    // types and fields ride the same call (T-476): on core 0.9's record door they land as `types` and `fields`
    create: async (path, content, tags, more) => (await c.createNote({ path, content, ...(tags.length ? { tags } : {}), ...(more?.types?.length ? { types: more.types } : {}), ...(more?.metadata ? { metadata: more.metadata } : {}) } as CreateNotePayload)) as VaultNote,
    save: async (id, content, ifUpdatedAt, more) => {
      try { return (await c.updateNote(id, { ...(content !== undefined ? { content } : {}), ...more, if_updated_at: ifUpdatedAt } as UpdateNotePayload)) as VaultNote; } catch (e) {
        if (e instanceof VaultConflictError) throw new Error("conflict: the note changed since it was read");
        throw e;
      }
    },
    // the hub's own two steps: the file into the vault's storage (multipart), then onto the note; `transcribe` asks the
    // hub to transcribe audio (core 0.8 and 0.9 alike; on 0.9 the attach goes to the record door, vault/records.ts)
    attach: async (id, bytes, type, transcribe) => {
      const ext = (type.split("/")[1] ?? "").replace(/[^a-z0-9]/g, "").slice(0, 8) || "bin";
      const up = await c.uploadStorageFile(new File([bytes], `${type.startsWith("audio/") ? "voice" : "file"}.${ext}`, { type }));
      const a = await c.addAttachment(id, { path: up.path, mimeType: type, ...(transcribe ? { transcribe: true } : {}) });
      return { id: a.id, path: a.path ?? up.path, mimeType: a.mimeType ?? type };
    },
  };
}
