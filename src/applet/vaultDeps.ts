// The frame's vault module reaches the vault through these, on this app's VaultClient for the applet's own vault.
// `types` is not in surface-client's payload types (0.3.7); the hub takes it on 0.9 (the record door).
import { VaultConflictError, type CreateNotePayload, type UpdateNotePayload, type VaultClient } from "@openparachute/surface-client";
import type { VaultDeps, VaultNote } from "./modules/vault";
import { mediaType } from "./files";
import { sha256Hex, uploadInParts, type UploadIo } from "./upload";

/** A piece of an upload that sends nothing for this long is cut off and sent again. */
const STALL_MS = 60_000;

/** A stored file's ending, where the media type's own second half isn't the one the hub reads it by. */
const EXTENSION: Record<string, string> = { "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/mpeg": "mp3", "audio/mp3": "mp3" };

const row = (n: { id: string; path?: string | null; extension?: string | null; updatedAt?: string | null }) => ({ id: n.id, path: n.path ?? null, extension: n.extension ?? null, updatedAt: n.updatedAt ?? null });

/** The reads, on a client. */
const reads = (c: VaultClient): Pick<VaultDeps, "listPaths" | "getNote" | "search" | "listFields" | "list" | "query"> => ({
  listPaths: async () => (await c.queryNotes({ orderBy: "updated_at", sort: "desc", limit: 500 })).map((n) => row(n as never)),
  getNote: async (ref, o) => { const n = await c.getNote(ref, o?.links ? { includeLinks: true } : {}); if (!n) throw new Error("not found"); return n as VaultNote; },
  search: async (query, limit, pathPrefix) => (await c.queryNotes({ search: query, limit: String(limit), ...(pathPrefix ? { path_prefix: pathPrefix } : {}) }))
    .map((n) => ({ id: n.id, path: n.path ?? null, snippet: "" })),
  // surface-client's typed words (pathPrefix, not path_prefix: a mix of the two drops the folder)
  listFields: async (prefix, limit) => (await c.queryNotes({ pathPrefix: prefix, includeMetadata: true, orderBy: "updated_at", sort: "desc", limit })).map((n) => n as VaultNote),
  // one ask for a folder's notes with a tag or their content (T-476: they were read one at a time, in a line)
  // the hub's own query words, the folder pinned (the module checked each word, and judges each note it gets back);
  // the wire's words as they are, in the order asked (meta[...] keys are the hub's grammar)
  query: async (prefix, q) => {
    const p = new URLSearchParams({ path_prefix: prefix, include_metadata: "true", limit: String(q.limit) });
    if (q.offset) p.set("offset", String(q.offset));
    if (q.tag) p.set("tag", q.tag);
    if (q.search) p.set("search", q.search);
    if (q.content) p.set("include_content", "true");
    if (q.links) p.set("include_links", "true");
    if (q.orderBy) p.set("order_by", q.orderBy);
    if (q.sort) p.set("sort", q.sort);
    for (const [k, v] of q.meta) p.append(k, v);
    try { return (await c.queryNotes(p)).map((n) => n as VaultNote); } catch (e) {
      // the hub refusing the words (0.8 orders only by an indexed field): said as a 400, for the module to pass on
      if (/\bfailed \(400\)/.test(String((e as Error)?.message))) throw Object.assign(new Error("the hub refused the query"), { status: 400 });
      throw e;
    }
  },
  list: async (prefix, o) => (await c.queryNotes({ ...(prefix ? { pathPrefix: prefix } : {}), ...(o.tag ? { tag: o.tag } : {}), includeMetadata: true, ...(o.content ? { includeContent: true } : {}), orderBy: "updated_at", sort: "desc", limit: o.limit })).map((n) => n as VaultNote),
});

/** `kept`: the same vault's client that answers a read from the copy kept of it (vault/client.ts keptClientFor), for a
 *  frame that draws itself again when the hub's answer differs. */
export function vaultDeps(c: VaultClient, kept?: VaultClient): VaultDeps {
  return {
    ...reads(c),
    ...(kept ? { kept: reads(kept) } : {}),
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
      // the hub types a stored file by its name: audio/mp4 named .mp4 would be served as a video, audio/mpeg as .mpeg
      // as nothing at all, so a sound recorded on a Mac or iPhone (audio/mp4) wouldn't play back (vault.file)
      const base = mediaType(type) ?? "";
      const ext = EXTENSION[base] ?? ((base.split("/")[1] ?? "").replace(/[^a-z0-9]/g, "").slice(0, 8) || "bin");
      const up = await c.uploadStorageFile(new File([bytes], `${type.startsWith("audio/") ? "voice" : "file"}.${ext}`, { type }));
      const a = await c.addAttachment(id, { path: up.path, mimeType: type, ...(transcribe ? { transcribe: true } : {}) });
      return { id: a.id, path: a.path ?? up.path, mimeType: a.mimeType ?? type };
    },
    // a note's pictures (vault.ts `file` asks only for one the note's list names), with this device's sign-in
    attachments: (id) => c.listAttachments(id),
    file: (path) => c.fetchAttachmentBlob(`/api/storage/${path.split("/").map(encodeURIComponent).join("/")}`),
    // a file already in storage onto another note (the hub's attach route alone: no new bytes)
    attachPath: async (id, path, mimeType) => { const a = await c.addAttachment(id, { path, mimeType }); return { id: a.id, path: a.path ?? path, mimeType: a.mimeType ?? mimeType }; },
    // a picked file onto the note, in pieces (upload.ts): the hub's own upload and attach routes, and the note's
    // `upload` field (fields merge on the hub: nothing else of the note changes)
    upload: (id, chosen, progress, closed) => {
      const io: UploadIo = {
        read: async () => { const n = await c.getNote(id); if (!n) throw Object.assign(new Error("the record is gone"), { status: 404 }); return { upload: (n.metadata as Record<string, unknown> | undefined)?.upload ?? null, updatedAt: n.updatedAt ?? null }; },
        // a piece that stops moving for a minute (a phone between networks) is cut off and tried again
        put: (piece, name, type, onSent) => new Promise((resolve, reject) => {
          const stop = new AbortController();
          let still: ReturnType<typeof setTimeout> = setTimeout(() => stop.abort(), STALL_MS);
          const moved = () => { clearTimeout(still); still = setTimeout(() => stop.abort(), STALL_MS); };
          // all of it sent: the hub is storing it, which may take a while; it is cut off only after five minutes
          c.uploadStorageFile(new File([piece], name, { type }), { signal: stop.signal, onProgress: ({ loaded, total }) => {
            if (loaded >= total) { clearTimeout(still); still = setTimeout(() => stop.abort(), 5 * STALL_MS); } else moved();
            onSent(loaded);
          } })
            .then((r) => resolve({ path: r.path }), (e: unknown) => reject(stop.signal.aborted ? Object.assign(new Error("the connection stalled"), { status: 0 }) : e))
            .finally(() => clearTimeout(still));
        }),
        attach: async (path, mimeType) => { const a = await c.addAttachment(id, { path, mimeType }); return { id: a.id ?? null }; },
        attached: async (path) => { const l = await c.listAttachments(id) as unknown; return Array.isArray(l) && l.some((a) => (a as { path?: unknown })?.path === path); },
        write: async (upload, at) => { await c.updateNote(id, { metadata: { upload }, ...(at ? { if_updated_at: at } : { force: true }) } as UpdateNotePayload); },
        hash: sha256Hex,
        online: () => typeof navigator === "undefined" || navigator.onLine !== false,
        // back online, or a few seconds gone (the screen may have closed meanwhile: the upload looks again)
        whenOnline: () => new Promise<void>((r) => {
          const back = () => { clearTimeout(t); r(); };
          const t = setTimeout(() => { removeEventListener("online", back); r(); }, 5000);
          addEventListener("online", back, { once: true });
        }),
        sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
        closed,
      };
      return uploadInParts(chosen.file, chosen.name, chosen.type, io, progress);
    },
  };
}
