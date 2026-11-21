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
  /** when the record was first made, as its versions keep it (a deleted record's maker isn't kept) */
  made?: string | null;
  /** a put back that re-made a deleted record: putting this back deletes it again */
  recreated?: boolean;
  /** the record's updatedAt when this was read (null: deleted): a put back stops if it changed since */
  seen?: string | null;
};
export type ChangesPage = { changes: Change[]; deletes: "shown" | "hidden"; more: boolean };

/** How many of today's deletions Home's line reads the tombstone of, per vault. */
export const HOME_DELETED = 6;
/** How many records one read of changes looks into (each costs a read of its versions). */
export const CHANGES_RECORDS = 20;
/** How many deleted records it looks into (each a read of its tombstone): with the records, within a frame's reads (60
 *  in ten seconds: one read of changes costs at most 2 + 20 + 12). */
export const CHANGES_DELETED = 12;
const VERSIONS = 50;
const strOr = (x: unknown) => (typeof x === "string" ? x : null);
const titleOf = (path: string) => path.split("/").pop() || path;

type Get = (path: string) => Promise<unknown>;
/** Each item through `f`, a few at a time (a vault's hub is asked for at most `n` reads at once). */
async function few<T>(items: readonly T[], f: (x: T) => Promise<void>, n = 6): Promise<void> {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) await f(items[i++]); }));
}
type Row = { ix: number; at: string; op: string; via: string | null; kind: string | null; by: string | null; path: string | null; made: string | null };
const rowsOf = (raw: unknown): Row[] => {
  const list = plain(raw) && Array.isArray(raw.versions) ? raw.versions : [];
  return list.flatMap((v: unknown): Row[] => (plain(v) && typeof v.version_ix === "number" && typeof v.superseded_at === "string"
    ? [{ ix: v.version_ix, at: v.superseded_at, op: typeof v.op === "string" ? v.op : "update", via: strOr(v.via), kind: strOr(v.via_kind), by: strOr(v.actor), path: strOr(v.path), made: strOr(v.created_at) }] : []));
};
const opOf = (op: string): ChangeOp => (op === "restore" ? "restored" : op === "delete" ? "deleted" : "changed");
/** A list read the hub doesn't give this app (403: admin only; 404: no such route, an older or hosted door). */
const refused = (e: unknown) => [403, 404].includes((e as { status?: number })?.status ?? 0) || /insufficient_scope|\b40[34]\b|not.?found/i.test(String((e as Error)?.message ?? e));

/**
 * The changes in one vault since `since` (ISO), newest first: among the `CHANGES_RECORDS` records changed most lately
 * from `offset` on, and the `CHANGES_DELETED` records deleted most lately from the matching place in the deleted list
 * (`more`: either has more to read). `self(via)`: whether a via is this device's Parachute. `own(rec)`: whether a record
 * is code ("code") or one the app keeps for itself ("app"); both show, as the app's own, and are never put back here,
 * but this device's Parachute keeping its own records is left out.
 */
export async function readChanges(opts: {
  get: Get; door: "records" | "notes"; since: string; offset?: number; charge: (n: number) => void;
  self: (via: string | null) => boolean; own: (r: { path: string; extension: string | null; names: string[] }) => "code" | "app" | null;
  /** The names of the people behind these writers, asked once for the page (`writer`); absent or failing: by key only. */
  people?: People;
}): Promise<ChangesPage> {
  const { get, door, since, charge, self, own } = opts;
  const offset = opts.offset ?? 0;
  const out: Change[] = [];
  // the most it can read, charged before the first read: refused now, nothing has been asked of the hub
  charge(2 + CHANGES_RECORDS + CHANGES_DELETED);
  const u = new URLSearchParams({ "meta[updated_at][gte]": since, order_by: "updated_at", sort: "desc", limit: String(CHANGES_RECORDS + 1), offset: String(offset) });
  u.set(door === "records" ? "include_body" : "include_content", "false");
  const raw = await get(`/${door}?${u.toString()}`);
  const all: unknown[] = Array.isArray(raw) ? raw : plain(raw) && Array.isArray(raw.records) ? raw.records : plain(raw) && Array.isArray(raw.notes) ? raw.notes : [];
  const page = all.slice(0, CHANGES_RECORDS).filter(plain) as Record<string, unknown>[];
  const add = (c: Omit<Change, "key" | "mine" | "title" | "who" | "own">, kind: "code" | "app" | null) => {
    const mine = self(c.via);
    // this device's Parachute keeping its own records (settings, approvals, saved views) isn't a change to show
    if (kind === "app" && mine) return;
    out.push({ ...c, own: kind !== null, key: `${c.id}:${c.before ?? "new"}`, title: titleOf(c.path), mine, who: "" });
  };
  /** A record's kept versions, newest first, as changes since then. */
  const fromRows = (id: string, path: string, rows: Row[], kind: "code" | "app" | null, gone: boolean, seen: string | null) => rows.forEach((v, i) => {
    if (v.at < since) return;
    const older = rows[i + 1];
    // a put back that re-made a deleted record: putting it back deletes it again
    const recreated = v.op === "restore" && older?.op === "delete";
    // a deletion's after is nothing; any other's is the version above it, or the record as it is now
    add({ id, path: v.path ?? path, op: opOf(v.op), at: v.at, via: v.via, kind: v.kind, by: v.by, before: v.ix, after: v.op === "delete" || i === 0 ? null : rows[i - 1].ix,
      gone, made: v.made, seen, ...(recreated ? { recreated: true } : {}) }, kind);
  });
  await few(page, async (r) => {
    if (typeof r.id !== "string") return;
    const id = r.id, path = typeof r.path === "string" ? r.path : id;
    const names = [...(Array.isArray(r.types) ? r.types : []), ...(Array.isArray(r.tags) ? r.tags : [])].filter((t): t is string => typeof t === "string");
    const kind = own({ path, extension: strOr(r.extension), names });
    const rows = rowsOf(await get(`/${door}/${encodeURIComponent(id)}/versions?limit=${VERSIONS}`).catch(() => null));
    fromRows(id, path, rows, kind, false, strOr(r.updatedAt));
    const created = strOr(r.createdAt);
    // a record put back from deletion keeps its first creation time; its making is not a change since then
    if (created && created >= since && !rows.some((v) => v.op === "delete")) {
      add({ id, path: rows.length ? rows[rows.length - 1].path ?? path : path, op: "created", at: created, via: strOr(r.createdVia), kind: null, by: strOr(r.createdBy),
        before: null, after: rows.length ? rows[rows.length - 1].ix : null, gone: false, made: created, seen: strOr(r.updatedAt) }, kind);
    }
  });
  // what was deleted since, newest deletion first, paged beside the records
  let deletes: ChangesPage["deletes"] = "shown";
  let moreGone = false;
  const dOffset = Math.round(offset / CHANGES_RECORDS) * CHANGES_DELETED;
  const gone = await get(`/history/deleted?limit=${CHANGES_DELETED + 1}&offset=${dOffset}`).catch((e: unknown) => { if (refused(e)) return null; throw e; });
  if (gone === null) deletes = "hidden";
  else {
    const listed = (plain(gone) && Array.isArray(gone.notes) ? gone.notes : []).filter((n: unknown): n is Record<string, unknown> => plain(n) && typeof n.id === "string");
    // newest deletion first: those deleted since come first; one past the page that is still since means more
    const rows = listed.filter((n) => typeof n.deleted_at === "string" && n.deleted_at >= since);
    moreGone = rows.length > CHANGES_DELETED;
    const take = rows.slice(0, CHANGES_DELETED);
    await few(take, async (n) => {
      const id = n.id as string, path = typeof n.path === "string" ? n.path : id;
      const vs = rowsOf(await get(`/${door}/${encodeURIComponent(id)}/versions?limit=${VERSIONS}`).catch(() => null));
      fromRows(id, path, vs, own({ path, extension: strOr(n.extension), names: [] }), true, null);
    });
  }
  // a record deleted between the two reads is in both: once
  const named = await namesOf(opts.people, out.map((c) => c.by));
  for (const c of out) c.who = writer(c.by, c.via, c.mine, named);
  const once = [...new Map(out.map((c) => [c.key, c])).values()];
  once.sort((a, b) => (b.at < a.at ? -1 : b.at > a.at ? 1 : a.key.localeCompare(b.key)));
  return { changes: once, deletes, more: all.length > CHANGES_RECORDS || moreGone };
}

/** Is this write this device's Parachute's? It signed in as an app, whose key is named for its client id (`key:<id>`,
 *  or `key:<id>-2` … for another sign-in). */
export const isSelf = (clientId: string | null, via: string | null) =>
  !!clientId && !!via && (via === `key:${clientId}` || (via.startsWith(`key:${clientId}-`) && /^\d+$/.test(via.slice(clientId.length + 5))));

/** The people of a vault by the `by` stamp their writes carry (the hub's `names`, docs/design/SHARING.md): each one's
 *  name there, and whether it is the person reading. */
export type PeopleNames = Record<string, { name: string | null; you: boolean }>;
export type People = (bys: string[]) => Promise<PeopleNames>;

/** Ask `people` once for these stamps; nothing when there is no one to ask or it fails (the names are only shown). */
export async function namesOf(people: People | undefined, bys: (string | null)[]): Promise<PeopleNames> {
  const asked = [...new Set(bys.filter((b): b is string => !!b))];
  if (!people || !asked.length) return {};
  try { return await people(asked); } catch { return {}; }
}

const APP_CLIENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:-\d+)?$/i;

/**
 * Who wrote, by one rule at every place a writer is named (Changes, a record's History, its made and changed by, Home's
 * line; docs/design/SHARING.md):
 *   this device's Parachute wrote it: "You, in Parachute here";
 *   a named key (an AI): its name, and on someone else's behalf "Aaron's claude";
 *   someone else, through an app (a sign-in, named for its client id): their name, "Bo";
 *   otherwise as the key reads (`writerName`): your own other sign-ins stay "An app (…)", since the hub can't yet say
 *   which app a sign-in is (yours on another device, or a connector).
 */
export function writer(by: string | null, via: string | null, mine: boolean, names: PeopleNames | null | undefined): string {
  if (mine) return writerName(via, true);
  const person = by ? names?.[by] : undefined;
  const other = person && !person.you && person.name ? person.name : null;
  if (other && via?.startsWith("key:")) return APP_CLIENT.test(via.slice(4)) ? other : `${other}'s ${via.slice(4)}`;
  if (other && (via === null || via === "api" || via === "mcp" || via.startsWith("nostr:"))) return other;
  return writerName(via, false);
}

/** A writer's name, as a person reads it. `key:<name>` is its name; an app approved over OAuth is named for its client
 *  id (a long random id) until the hub can name it (docs/VAULT.md, gaps). */
export function writerName(via: string | null, mine: boolean): string {
  if (mine) return "You, in Parachute here";
  if (!via) return "Not recorded";
  if (via.startsWith("key:")) {
    const name = via.slice(4);
    // a client id the hub made (a UUID), and its "-2", "-3" for another sign-in
    if (APP_CLIENT.test(name)) return `An app (${name.slice(0, 8)})`;
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
 * `HOME_DELETED`). Counts records, not every version: Vault's Changes has the rest. `names`: each writer, with when it
 * last wrote.
 */
export async function countChanged(opts: { get: Get; door: "records" | "notes"; since: string; charge: (n: number) => void; self: (via: string | null) => boolean;
  own: (r: { path: string; extension: string | null; names: string[] }) => "code" | "app" | null; people?: People }): Promise<{ count: number; names: Map<string, string>; more: boolean }> {
  const { get, door, since, charge, self, own } = opts;
  /** each write's stamps and when, named once all are read */
  const seen: { by: string | null; via: string | null; at: string }[] = [];
  const note = (by: string | null, via: string | null, at: string) => { seen.push({ by, via, at }); };
  const u = new URLSearchParams({ "meta[updated_at][gte]": since, order_by: "updated_at", sort: "desc", limit: "201" });
  u.set(door === "records" ? "include_body" : "include_content", "false");
  // the most it reads, charged first (six vaults fit a frame's 60 reads)
  charge(2 + HOME_DELETED);
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
    count++; note(strOr(r.lastUpdatedBy), via, strOr(r.updatedAt) ?? since);
  }
  const gone = await get("/history/deleted?limit=50").catch(() => null);
  const listed = (plain(gone) && Array.isArray(gone.notes) ? gone.notes : []).filter((n: unknown): n is Record<string, unknown> => plain(n) && typeof n.id === "string" && typeof n.deleted_at === "string" && n.deleted_at >= since);
  const rows = listed.slice(0, HOME_DELETED);
  for (const v of await Promise.all(rows.map((n) => get(`/${door}/${encodeURIComponent(n.id as string)}/versions?limit=1`).then(rowsOf, () => [] as Row[])))) {
    const t = v[0];
    if (!t || t.op !== "delete" || t.via === null || self(t.via) || own({ path: t.path ?? "", extension: null, names: [] }) === "app") continue;
    count++; note(t.by, t.via, t.at);
  }
  /** each writer's name, and when it last wrote */
  const names = new Map<string, string>();
  const people = await namesOf(opts.people, seen.map((w) => w.by));
  for (const w of seen) { const n = writer(w.by, w.via, false, people); if ((names.get(n) ?? "") < w.at) names.set(n, w.at); }
  return { count, names, more: all.length > 200 || listed.length > HOME_DELETED };
}
