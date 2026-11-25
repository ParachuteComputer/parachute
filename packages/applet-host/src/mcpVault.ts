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

/** A record (record words) as the note the vault module reads. The record door gives a record's types apart from its
 *  tags; the REST door the module was written on lists both in `tags` (a type is a tag that declares fields), and the
 *  module judges and filters on `tags` (a `person` list, the names no applet may touch): so `tags` holds both. */
export function noteOf(r: Rec): VaultNote {
  const tags = (r.tags as string[] | null | undefined) ?? null;
  const types = (r.types as string[] | null | undefined) ?? null;
  return {
    id: String(r.id), path: (r.path as string | null | undefined) ?? null, extension: (r.extension as string | null | undefined) ?? null,
    ...(r.body !== undefined ? { content: (r.body as string | null) ?? null } : {}),
    tags: tags || types ? [...new Set([...(tags ?? []), ...(types ?? [])])] : null, types,
    metadata: (r.fields as Rec | null | undefined) ?? null, createdAt: (r.createdAt as string | null | undefined) ?? null,
    updatedAt: (r.updatedAt as string | null | undefined) ?? null,
    ...(Array.isArray(r.links) ? { links: r.links as VaultNote["links"] } : {}),
  };
}
/** A list answers an array, or `{records, next_cursor}` when the vault pages it. */
const rows = (r: unknown): Rec[] => (Array.isArray(r) ? (r as Rec[]) : Array.isArray((r as Rec | null)?.records) ? ((r as Rec).records as Rec[]) : []);

const META = /^meta\[([^\]]+)\](?:\[([^\]]+)\](\[\])?)?$/;
const OPS = new Set(["eq", "ne", "gt", "gte", "lt", "lte", "in", "not_in", "exists"]);
const bad = (why: string) => Object.assign(new Error(why), { status: 400 });
/** A value as the REST door reads a shorthand one (routes.ts shorthandValue): true, false, a number written exactly. */
export const shorthandValue = (v: string): string | number | boolean => (v === "true" ? true : v === "false" ? false : Number.isFinite(Number(v)) && String(Number(v)) === v ? Number(v) : v);

/** The module's `meta[field]…` words as query-records' `fields` and `date_filter`, by the REST door's rules
 *  (routes.ts parseMetaBrackets): a value or operators per field, never both; `in` as a list or comma-separated;
 *  `exists` true or false; the record's own `created_at` / `updated_at` by `gte` and `lt` as a date filter. */
export function fieldsFilter(meta: readonly [string, string][]): { fields?: Rec; date_filter?: Rec } | null {
  if (!meta.length) return null;
  const fields: Record<string, unknown> = {};
  const plainOnes = new Set<string>(), opOnes = new Set<string>();
  let date: { field: string; from?: string; to?: string } | null = null;
  for (const [k, v] of meta) {
    const m = META.exec(k);
    if (!m) throw bad(`the query word ${k}`);
    const [, field, op, list] = m;
    if (field === "created_at" || field === "updated_at") {
      if (op !== "gte" && op !== "lt") throw bad(`${field} takes gte and lt`);
      if (date && date.field !== field) throw bad("one date column at a time");
      date = { ...(date ?? { field }), [op === "gte" ? "from" : "to"]: v };
      continue;
    }
    if (!op) {
      if (opOnes.has(field)) throw bad(`meta[${field}] and its operators, both`);
      plainOnes.add(field); fields[field] = shorthandValue(v); continue;
    }
    if (!OPS.has(op) || (list && op !== "in" && op !== "not_in")) throw bad(`the operator ${op}`);
    if (plainOnes.has(field)) throw bad(`meta[${field}] and its operators, both`);
    opOnes.add(field);
    const cur = (fields[field] as Rec | undefined) ?? {};
    if (op === "exists") { if (v !== "true" && v !== "false") throw bad("exists takes true or false"); fields[field] = { ...cur, exists: v === "true" }; continue; }
    if (op === "in" || op === "not_in") {
      const vals = list ? [v] : v.split(",").map((x) => x.trim()).filter(Boolean);
      fields[field] = { ...cur, [op]: [...((cur[op] as unknown[]) ?? []), ...vals.map(shorthandValue)] };
      continue;
    }
    fields[field] = { ...cur, [op]: shorthandValue(v) };
  }
  return { ...(Object.keys(fields).length ? { fields } : {}), ...(date ? { date_filter: date } : {}) };
}

/** A write whose tags include a type: the record door refuses it (`tag_kind`, "pass it as types"), where the REST door
 *  took it. The module only ever adds the types its card names for a folder, so those names go again as `types`. */
async function asTypes<T>(write: (moveToTypes: boolean) => Promise<T>): Promise<T> {
  try { return await write(false); } catch (e) {
    if (e instanceof Refusal && e.error_type === "tag_kind") return write(true);
    throw e;
  }
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
      const filter = fieldsFilter(q.meta);
      return list({ path_prefix: prefix, limit: q.limit, ...(q.offset ? { offset: q.offset } : {}), ...(q.tag ? { tag: q.tag } : {}), ...(q.search ? { search: q.search } : {}),
        ...(q.content ? { include_body: true } : {}), ...(q.links ? { include_links: true } : {}), ...(q.orderBy ? { order_by: q.orderBy } : {}), ...(q.sort ? { sort: q.sort } : {}),
        ...(filter ?? {}) }).catch(badQuery);
    },
    create: async (path, content, tags, more) => {
      const r = await asTypes((move) => {
        const types = [...new Set([...(more?.types ?? []), ...(move ? tags : [])])];
        return call("create-record", { path, body: content, ...(!move && tags.length ? { tags } : {}), ...(types.length ? { types } : {}), ...(more?.metadata ? { fields: more.metadata } : {}) });
      });
      return noteOf((Array.isArray(r) ? r[0] : r) as Rec);
    },
    save: async (id, content, ifUpdatedAt, more) => {
      try {
        return noteOf((await asTypes((move) => {
          const both = (a?: string[], b?: string[]) => [...new Set([...(a ?? []), ...(b ?? [])])];
          const types = move ? { add: both(more?.types?.add, more?.tags?.add), remove: both(more?.types?.remove, more?.tags?.remove) } : more?.types;
          const tags = move ? undefined : more?.tags;
          return call("update-record", { id, ...(content !== undefined ? { body: content } : {}), ...(more?.metadata ? { fields: more.metadata } : {}),
            ...(types && (types.add?.length || types.remove?.length) ? { types } : {}), ...(tags ? { tags } : {}), if_updated_at: ifUpdatedAt });
        })) as Rec);
      } catch (e) {
        // the module reads a conflict by these words (vault.ts save)
        if (e instanceof Refusal && e.error_type === "conflict") throw new Error("conflict: the record changed since it was read");
        throw e;
      }
    },
  };
}
