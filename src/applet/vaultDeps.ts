// The frame's vault module reaches the vault through these, on this app's VaultClient for the applet's own vault.
import { VaultConflictError, type VaultClient } from "@openparachute/surface-client";
import type { VaultDeps, VaultNote } from "./modules/vault";

const row = (n: { id: string; path?: string | null; extension?: string | null; updatedAt?: string | null }) => ({ id: n.id, path: n.path ?? null, extension: n.extension ?? null, updatedAt: n.updatedAt ?? null });

export function vaultDeps(c: VaultClient): VaultDeps {
  return {
    listPaths: async () => (await c.queryNotes({ orderBy: "updated_at", sort: "desc", limit: 500 })).map((n) => row(n as never)),
    getNote: async (ref) => { const n = await c.getNote(ref); if (!n) throw new Error("not found"); return n as VaultNote; },
    search: async (query, limit, pathPrefix) => (await c.queryNotes({ search: query, limit: String(limit), ...(pathPrefix ? { path_prefix: pathPrefix } : {}) }))
      .map((n) => ({ id: n.id, path: n.path ?? null, snippet: "" })),
    listFields: async (prefix, limit) => (await c.queryNotes({ path_prefix: prefix, includeMetadata: true, orderBy: "updated_at", sort: "desc", limit: String(limit) } as never)) as VaultNote[],
    create: async (path, content, tags) => (await c.createNote({ path, content, ...(tags.length ? { tags } : {}) })) as VaultNote,
    save: async (id, content, ifUpdatedAt) => {
      try { return (await c.updateNote(id, { content, if_updated_at: ifUpdatedAt })) as VaultNote; } catch (e) {
        if (e instanceof VaultConflictError) throw new Error("conflict: the note changed since it was read");
        throw e;
      }
    },
  };
}
