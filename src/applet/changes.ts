// What changed in a vault, and by whom (T-476, docs/VAULT.md "Changes"): one view over the history the vault already
// keeps, no second record of it. Read from three of the hub's answers:
//   records changed since a time (`meta[updated_at][gte]`), each with its kept versions: version k holds the record as
//     it was before write k, stamped with write k's key (`via`, `via_kind`) and person (`actor`), so it is one change,
//     whose "after" is version k+1, or the record as it is now. A burst of writes by one named key is one version.
//   a record made since then: a change of its own (`createdVia`), with no version before it.
//   records deleted since then (`/history/deleted`, write access since core T-476; admin before): the tombstone (the
//     newest version, `op: delete`) is the change. On a hub that refuses the list (403), deletes aren't shown: `deletes:
//     "hidden"` says so.
// Pure: it asks `get` (a GET under the vault's API, its JSON) and counts each read with `charge`.
import { plain } from "./contract.ts";

export type ChangeOp = "created" | "changed" | "deleted" | "restored";
export type Change = {
  /** `<record id>:<version_ix of before>`, or `<record id>:new` for a create */
  key: string;
  id: string; path: string; title: string;
  op: ChangeOp;
  at: string;
  /** the key that wrote (`key:<name>`, `nostr:<pubkey>`, a channel: `api`, `mcp`; null when not recorded) */
  via: string | null;
  /** that key's kind (`person`, `agent`, `app`, `service`), when the hub says */
  kind: string | null;
  /** the person the write was for */
  by: string | null;
  /** this device's Parachute wrote it */
  mine: boolean;
  /** the writer's name, as a person reads it (`writerName`) */
  who: string;
  /** the version holding the record before the change (null: it was made by it) */
  before: number | null;
  /** the version holding it after (null: as it is now, or, for a delete, nothing) */
  after: number | null;
  /** the record is deleted now */
  gone: boolean;
  /** the record is code, or the app's own (an applet's, a component's, `parachute-*`): it can't be put back here */
  own: boolean;
};
export type ChangesPage = { changes: Change[]; deletes: "shown" | "hidden"; more: boolean };

/** How many records one read of changes looks into (each costs a read of its versions). */
export const CHANGES_RECORDS = 24;
/** How many deleted records it looks into (each a read of its tombstone): with the records, within a frame's reads. */
export const CHANGES_DELETED = 16;
const VERSIONS = 50;
const strOr = (x: unknown) => (typeof x === "string" ? x : null);
const titleOf = (path: string) => path.split("/").pop() || path;

type Get = (path: string) => Promise<unknown>;
/** Each item through `f`, a few at a time (a vault's hub is asked for at most `n` reads at once). */
async function few<T>(items: readonly T[], f: (x: T) => Promise<void>, n = 6): Promise<void> {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) await f(items[i++]); }));
}
type Row = { ix: number; at: string; op: string; via: string | null; kind: string | null; by: string | null; path: string | null };
const rowsOf = (raw: unknown): Row[] => {
  const list = plain(raw) && Array.isArray(raw.versions) ? raw.versions : [];
  return list.flatMap((v: unknown): Row[] => (plain(v) && typeof v.version_ix === "number" && typeof v.superseded_at === "string"
    ? [{ ix: v.version_ix, at: v.superseded_at, op: typeof v.op === "string" ? v.op : "update", via: strOr(v.via), kind: strOr(v.via_kind), by: strOr(v.actor), path: strOr(v.path) }] : []));
};
const opOf = (op: string): ChangeOp => (op === "restore" ? "restored" : op === "delete" ? "deleted" : "changed");

/**
 * The changes in one vault since `since` (ISO), newest first, among the `CHANGES_RECORDS` records changed most lately
 * from `offset` on (`more`: there are more to read). `self(via)`: whether a via is this device's Parachute. `own(rec)`:
 * whether a record is code or the app's own.
 */
export async function readChanges(opts: {
  get: Get; door: "records" | "notes"; since: string; offset?: number; charge: (n: number) => void;
  /** "code": an applet's or a component's code (shown, never put back here); "app": a record the app keeps for itself
   *  (settings, approvals, saved views: not a change to show); null: the person's own record */
  self: (via: string | null) => boolean; own: (r: { path: string; extension: string | null; names: string[] }) => "code" | "app" | null;
}): Promise<ChangesPage> {
  const { get, door, since, charge, self, own } = opts;
  const offset = opts.offset ?? 0;
  const out: Change[] = [];
  const u = new URLSearchParams({ "meta[updated_at][gte]": since, order_by: "updated_at", sort: "desc", limit: String(CHANGES_RECORDS + 1), offset: String(offset) });
  u.set(door === "records" ? "include_body" : "include_content", "false");
  charge(1);
  const raw = await get(`/${door}?${u.toString()}`);
  const all: unknown[] = Array.isArray(raw) ? raw : plain(raw) && Array.isArray(raw.records) ? raw.records : plain(raw) && Array.isArray(raw.notes) ? raw.notes : [];
  const page = all.slice(0, CHANGES_RECORDS).filter(plain) as Record<string, unknown>[];
  // the app keeping its own records (settings, approvals, saved views), on this device or another, isn't a change to show
  const add = (c: Omit<Change, "key" | "mine" | "title" | "who">, kind: "code" | "app" | null) => { if (kind === "app") return; const mine = self(c.via); out.push({ ...c, key: `${c.id}:${c.before ?? "new"}`, title: titleOf(c.path), mine, who: writerName(c.via, mine) }); };
  charge(page.length);
  await few(page, async (r) => {
    if (typeof r.id !== "string") return;
    const id = r.id, path = typeof r.path === "string" ? r.path : id;
    const names = [...(Array.isArray(r.types) ? r.types : []), ...(Array.isArray(r.tags) ? r.tags : [])].filter((t): t is string => typeof t === "string");
    const ownKind = own({ path, extension: strOr(r.extension), names }), isOwn = ownKind !== null;
    const rows = rowsOf(await get(`/${door}/${encodeURIComponent(id)}/versions?limit=${VERSIONS}`).catch(() => null));
    // newest first: the "after" of row k is the row above it (k+1), or the record as it is now
    rows.forEach((v, i) => {
      if (v.at < since) return;
      add({ id, path: v.path ?? path, op: opOf(v.op), at: v.at, via: v.via, kind: v.kind, by: v.by, before: v.ix, after: i > 0 ? rows[i - 1].ix : null, gone: false, own: isOwn }, ownKind);
    });
    const created = strOr(r.createdAt);
    // a record put back from deletion keeps its first creation time; its making is not a change since then
    if (created && created >= since && !rows.some((v) => v.op === "delete")) {
      add({ id, path: rows.length ? rows[rows.length - 1].path ?? path : path, op: "created", at: created, via: strOr(r.createdVia), kind: null, by: strOr(r.createdBy),
        before: null, after: rows.length ? rows[rows.length - 1].ix : null, gone: false, own: isOwn }, ownKind);
    }
  });
  // what was deleted since: only on the first page (the list is its own, newest deletion first)
  let deletes: ChangesPage["deletes"] = "shown";
  if (offset === 0) {
    charge(1);
    const gone = await get("/history/deleted?limit=100").catch((e: unknown) => {
      if ((e as { status?: number })?.status === 403 || /insufficient_scope|403/.test(String((e as Error)?.message ?? e))) return null;
      throw e;
    });
    if (gone === null) deletes = "hidden";
    else {
      const rows = (plain(gone) && Array.isArray(gone.notes) ? gone.notes : []).filter((n: unknown): n is Record<string, unknown> =>
        plain(n) && typeof n.id === "string" && typeof n.deleted_at === "string" && n.deleted_at >= since).slice(0, CHANGES_DELETED);
      charge(rows.length);
      await few(rows, async (n) => {
        const id = n.id as string, path = typeof n.path === "string" ? n.path : id;
        const ownKind = own({ path, extension: strOr(n.extension), names: [] }), isOwn = ownKind !== null;
        const vs = rowsOf(await get(`/${door}/${encodeURIComponent(id)}/versions?limit=${VERSIONS}`).catch(() => null));
        vs.forEach((v, i) => {
          if (v.at < since) return;
          // the newest version is the tombstone; an earlier one's after is the row above it
          add({ id, path: v.path ?? path, op: opOf(v.op), at: v.at, via: v.via, kind: v.kind, by: v.by, before: v.ix, after: v.op === "delete" ? null : i > 0 ? vs[i - 1].ix : null, gone: true, own: isOwn }, ownKind);
        });
      });
    }
  }
  out.sort((a, b) => (b.at < a.at ? -1 : b.at > a.at ? 1 : a.key.localeCompare(b.key)));
  return { changes: out, deletes, more: all.length > CHANGES_RECORDS };
}

/** Is this write this device's Parachute's? It signed in as an app, whose key is named for its client id (`key:<id>`,
 *  or `key:<id>-2` … for another sign-in). */
export const isSelf = (clientId: string | null, via: string | null) =>
  !!clientId && !!via && (via === `key:${clientId}` || (via.startsWith(`key:${clientId}-`) && /^\d+$/.test(via.slice(clientId.length + 5))));

/** A writer's name, as a person reads it. `key:<name>` is its name; an app approved over OAuth is named for its client
 *  id (a long random id) until the hub can name it (docs/VAULT.md, gaps). */
export function writerName(via: string | null, mine: boolean): string {
  if (mine) return "You, in Parachute here";
  if (!via) return "Not recorded";
  if (via.startsWith("key:")) {
    const name = via.slice(4);
    // a client id the hub made (a UUID), and its "-2", "-3" for another sign-in
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:-\d+)?$/i.test(name)) return `An app (${name.slice(0, 8)})`;
    return name;
  }
  if (via.startsWith("nostr:")) return `A key (${via.slice(6, 14)}…)`;
  if (via === "operator") return "Your hub's operator";
  if (via === "api" || via === "mcp") return `A key with no name (${via === "api" ? "REST" : "MCP"})`;
  if (via === "git-import") return "An import";
  return via;
}

/**
 * Today's changes by others in one vault, read lightly for Home's line (a read or two, not one per record): records whose
 * last write since `since` was another writer's, and records another writer deleted since (each tombstone read, at most
 * `CHANGES_DELETED`). Counts records, not every version: Vault's Changes has the rest. `names`: each writer, with when it
 * last wrote.
 */
export async function countChanged(opts: { get: Get; door: "records" | "notes"; since: string; charge: (n: number) => void; self: (via: string | null) => boolean;
  own: (r: { path: string; extension: string | null; names: string[] }) => "code" | "app" | null }): Promise<{ count: number; names: Map<string, string>; more: boolean }> {
  const { get, door, since, charge, self, own } = opts;
  /** each writer's name, and when it last wrote */
  const names = new Map<string, string>();
  const note = (via: string | null, at: string) => { const n = writerName(via, false); if ((names.get(n) ?? "") < at) names.set(n, at); };
  const u = new URLSearchParams({ "meta[updated_at][gte]": since, order_by: "updated_at", sort: "desc", limit: "201" });
  u.set(door === "records" ? "include_body" : "include_content", "false");
  charge(1);
  const raw = await get(`/${door}?${u.toString()}`);
  const all: unknown[] = Array.isArray(raw) ? raw : plain(raw) && Array.isArray(raw.records) ? raw.records : plain(raw) && Array.isArray(raw.notes) ? raw.notes : [];
  let count = 0;
  for (const r of all.slice(0, 200)) {
    if (!plain(r)) continue;
    const via = strOr(r.lastUpdatedVia);
    if (via === null || self(via)) continue;
    // the app keeping its own records, on another device, isn't a change to count
    const names = [...(Array.isArray(r.types) ? r.types : []), ...(Array.isArray(r.tags) ? r.tags : [])].filter((t): t is string => typeof t === "string");
    if (own({ path: typeof r.path === "string" ? r.path : "", extension: strOr(r.extension), names }) === "app") continue;
    count++; note(via, strOr(r.updatedAt) ?? since);
  }
  charge(1);
  const gone = await get("/history/deleted?limit=50").catch(() => null);
  const rows = (plain(gone) && Array.isArray(gone.notes) ? gone.notes : []).filter((n: unknown): n is Record<string, unknown> => plain(n) && typeof n.id === "string" && typeof n.deleted_at === "string" && n.deleted_at >= since).slice(0, CHANGES_DELETED);
  charge(rows.length);
  for (const v of await Promise.all(rows.map((n) => get(`/${door}/${encodeURIComponent(n.id as string)}/versions?limit=1`).then(rowsOf, () => [] as Row[])))) {
    const t = v[0];
    if (!t || t.op !== "delete" || t.via === null || self(t.via) || own({ path: t.path ?? "", extension: null, names: [] }) === "app") continue;
    count++; note(t.via, t.at);
  }
  return { count, names, more: all.length > 200 };
}
