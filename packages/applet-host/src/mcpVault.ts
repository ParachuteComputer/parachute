// The applet's vault, reached through an MCP Apps host (Claude, ChatGPT, the reference host): each read and write is
// the host's `tools/call` on the connector the view came from (query-records, create-record, update-record), so the
// view holds no token and makes no request of its own. It is the app's own vault module (src/applet/modules/vault.ts)
// that judges every call against the applet's folders, as in the app; these are only its legs (VaultDeps), in record
// words to the connector and note words back to the module. Attachments, uploads and voice don't cross: absent here,
// so the module answers not_granted / 405, as on a host that can't.
import type { FolderQuery, VaultDeps, VaultNote } from "../../../src/applet/modules/vault";

/** One tool call through the host: the tool's JSON reply, or a thrown `Refusal`. */
export type CallTool = (name: string, args: Record<string, unknown>) => Promise<unknown>;
type Rec = Record<string, unknown>;

/** A tool's refusal (core's one way to refuse, T-476): `{error_type, message, ...}`. */
export class Refusal extends Error {
  constructor(readonly error_type: string, message: string, readonly fields: Rec = {}) { super(message); }
}

/** A record (record words) as the note the vault module reads. */
export function noteOf(r: Rec): VaultNote {
  return {
    id: String(r.id), path: (r.path as string | null | undefined) ?? null, extension: (r.extension as string | null | undefined) ?? null,
    ...(r.body !== undefined ? { content: (r.body as string | null) ?? null } : {}),
    tags: (r.tags as string[] | null | undefined) ?? null, types: (r.types as string[] | null | undefined) ?? null,
    metadata: (r.fields as Rec | null | undefined) ?? null, createdAt: (r.createdAt as string | null | undefined) ?? null,
    updatedAt: (r.updatedAt as string | null | undefined) ?? null,
    ...(Array.isArray(r.links) ? { links: r.links as VaultNote["links"] } : {}),
  };
}
/** A list answers an array, or `{records, next_cursor}` when the vault pages it. */
const rows = (r: unknown): Rec[] => (Array.isArray(r) ? (r as Rec[]) : Array.isArray((r as Rec | null)?.records) ? ((r as Rec).records as Rec[]) : []);

const META = /^meta\[([^\]]+)\](?:\[(eq|ne|gt|gte|lt|lte|exists)\]|\[(in|not_in)\]\[\])?$/;
/** A value from the module's query words (a string, as the URL carried it) as the field filter takes it: a number for
 *  a comparison, a boolean for exists, the string otherwise. */
const valueFor = (op: string | undefined, v: string): unknown => (op === "exists" ? v === "true" : op && /^(gt|gte|lt|lte)$/.test(op) && v.trim() !== "" && !isNaN(Number(v)) ? Number(v) : v);

/** The module's `meta[field]…` words as query-records' `fields` filter. */
export function fieldsFilter(meta: readonly [string, string][]): Rec | null {
  if (!meta.length) return null;
  const out: Record<string, Rec | unknown> = {};
  for (const [k, v] of meta) {
    const m = META.exec(k);
    if (!m) throw Object.assign(new Error(`the query word ${k}`), { status: 400 });
    const [, field, op, listOp] = m;
    if (listOp) { const cur = (out[field] as Rec | undefined) ?? {}; out[field] = { ...cur, [listOp]: [...((cur[listOp] as unknown[]) ?? []), v] }; continue; }
    if (!op) { out[field] = v; continue; }
    out[field] = { ...((out[field] as Rec | undefined) ?? {}), [op]: valueFor(op, v) };
  }
  return out;
}

/** The vault module's legs over `call`. */
export function mcpVaultDeps(call: CallTool): VaultDeps {
  const list = async (args: Rec) => rows(await call("query-records", args)).map(noteOf);
  const badQuery = (e: unknown) => {
    // the vault refusing the words (a field it can't filter on): a 400 for the module to pass on
    if (e instanceof Refusal && /^(invalid_query|unknown_parameter|invalid_search_syntax|cursor_invalid)$/.test(e.error_type)) throw Object.assign(new Error("the vault refused the query"), { status: 400 });
    throw e;
  };
  return {
    listPaths: async () => (await list({ order_by: "updated_at", sort: "desc", limit: 500 })).map((n) => ({ id: n.id, path: n.path ?? null, extension: n.extension ?? null, updatedAt: n.updatedAt ?? null })),
    getNote: async (ref, o) => {
      try { return noteOf((await call("query-records", { id: ref, include_body: true, ...(o?.links ? { include_links: true } : {}) })) as Rec); } catch (e) {
        if (e instanceof Refusal && e.error_type === "not_found") throw new Error("not found");
        throw e;
      }
    },
    search: async (query, limit, pathPrefix) => (await list({ search: query, limit, ...(pathPrefix ? { path_prefix: pathPrefix } : {}) })).map((n) => ({ id: n.id, path: n.path ?? null, snippet: "" })),
    listFields: (prefix, limit) => list({ path_prefix: prefix, order_by: "updated_at", sort: "desc", limit }),
    list: (prefix, o) => list({ ...(prefix ? { path_prefix: prefix } : {}), ...(o.tag ? { tag: o.tag } : {}), ...(o.content ? { include_body: true } : {}), order_by: "updated_at", sort: "desc", limit: o.limit }),
    query: async (prefix, q: FolderQuery) => {
      const fields = fieldsFilter(q.meta);
      return list({ path_prefix: prefix, limit: q.limit, ...(q.offset ? { offset: q.offset } : {}), ...(q.tag ? { tag: q.tag } : {}), ...(q.search ? { search: q.search } : {}),
        ...(q.content ? { include_body: true } : {}), ...(q.links ? { include_links: true } : {}), ...(q.orderBy ? { order_by: q.orderBy } : {}), ...(q.sort ? { sort: q.sort } : {}),
        ...(fields ? { fields } : {}) }).catch(badQuery);
    },
    create: async (path, content, tags, more) => {
      const r = await call("create-record", { path, body: content, ...(tags.length ? { tags } : {}), ...(more?.types?.length ? { types: more.types } : {}), ...(more?.metadata ? { fields: more.metadata } : {}) });
      return noteOf((Array.isArray(r) ? r[0] : r) as Rec);
    },
    save: async (id, content, ifUpdatedAt, more) => {
      try {
        return noteOf((await call("update-record", { id, ...(content !== undefined ? { body: content } : {}), ...(more?.metadata ? { fields: more.metadata } : {}),
          ...(more?.types ? { types: more.types } : {}), ...(more?.tags ? { tags: more.tags } : {}), if_updated_at: ifUpdatedAt })) as Rec);
      } catch (e) {
        // the module reads a conflict by these words (vault.ts save)
        if (e instanceof Refusal && e.error_type === "conflict") throw new Error("conflict: the record changed since it was read");
        throw e;
      }
    },
  };
}
