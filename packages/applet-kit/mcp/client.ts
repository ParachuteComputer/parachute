// The vault a web-kit applet reads and writes (web.ts `linkClient`), reached through an MCP Apps host: each call is the
// host's `tools/call` on the connector the view came from (query-records, create-record, update-record, list-types), so
// the view holds no token and makes no request of its own. It speaks the VaultClient's note words to web.ts (which turns
// them into record words for the applet) and record words to the connector.
import type { VaultClient } from "@openparachute/surface-client";

/** One tool call through the host: resolves the tool's JSON reply, or throws with the vault's own error. */
export type CallTool = (name: string, args: Record<string, unknown>) => Promise<unknown>;
type Rec = Record<string, unknown>;

// the web kit's query words (web.ts IN, VaultClient's NotesQuery) → query-records' parameters
const QUERY: Record<string, string> = {
  pathPrefix: "path_prefix", orderBy: "order_by", metadata: "fields", includeLinks: "include_links",
  includeContent: "include_body", includeMetadata: "include_fields", includeAttachments: "include_attachments",
};
const rename = (o: Rec, map: Record<string, string>): Rec => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => [map[k] ?? k, v]));
// a list answers an array, or {records, next_cursor} when the vault pages it
const rows = (r: unknown): Rec[] => (Array.isArray(r) ? r : Array.isArray((r as Rec)?.records) ? ((r as Rec).records as Rec[]) : []);

/** An error the kit and applets read as the REST door's: a status (404, 409) and the vault's error_type. */
export function vaultError(message: string, data?: Rec): Error {
  const type = String(data?.error_type ?? (/\[(\w+)\]/.exec(message)?.[1] ?? ""));
  const status = type === "conflict" ? 409 : type === "not_found" || /not found/i.test(message) ? 404 : type === "forbidden" ? 403 : 400;
  return Object.assign(new Error(message.replace(/^MCP error -?\d+:\s*/, "")), { status, error_type: type || undefined, data });
}

export function mcpVaultClient(call: CallTool): VaultClient {
  const client = {
    queryNotes: async (q: Rec = {}) => rows(await call("query-records", rename(q, QUERY))),
    getNote: async (id: string, o: { includeLinks?: boolean } = {}) => {
      try { return (await call("query-records", { id, include_body: true, ...(o.includeLinks ? { include_links: true } : {}) })) as Rec; }
      catch (e) { if ((e as { status?: number }).status === 404) return null; throw e; }
    },
    createNote: async (p: Rec) => {
      const { content, metadata, ...rest } = p;
      const r = await call("create-record", { ...rest, ...(content !== undefined ? { body: content } : {}), ...(metadata !== undefined ? { fields: metadata } : {}) });
      return Array.isArray(r) ? r[0] : r;
    },
    updateNote: async (id: string, p: Rec) => {
      const { content, metadata, ...rest } = p;
      return call("update-record", { id, ...rest, ...(content !== undefined ? { body: content } : {}), ...(metadata !== undefined ? { fields: metadata } : {}) });
    },
    listTags: async () => rows(await call("list-types", {})).map((t) => ({ name: String(t.name), count: Number(t.count ?? 0) })),
    // pictures need read-attachment's image blocks: not bridged in this spike (a person's photo shows its initials)
    listAttachments: async () => [],
    fetchAttachmentBlob: async () => { throw vaultError("attachments are not bridged in Claude yet", { error_type: "not_found" }); },
  };
  return client as unknown as VaultClient;
}
