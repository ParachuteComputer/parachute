// vaults module: what an applet may do across the person's vaults, only for the words its note's `fields.app` names
// (app.ts), which the person allowed on its card. The Vault applet (applets/vault.tsx) is built on it; any applet may
// ask, and its card says so, stressed. An applet in someone else's vault asks the app for nothing (discovery.ts).
//
//   vaults        (read every vault this device holds; change records where the person lets Parachute change them)
//     list()                                   the vaults: {key, name, host, mine, home, level, connector}
//     types({vault})                           its types and tags, with counts and declared fields
//     query({vault, type?, tag?, search?, path?, where?, sort?, limit?, offset?})
//                                              a page of records (no body): {records, more}
//     get({vault, id})                         one record: body, fields, types, tags, links both ways, who and when
//     history({vault, id})                     its kept versions, newest first; version({vault, id, ix}): one of them
//     update({vault, id, bytes})               a change, as JSON text in bytes (past the 8 KB a call carries):
//                                              {if_updated_at, body?, fields?, types?: {add?, remove?}, tags?: {add?, remove?}}
//     create({vault, bytes})                   a new record: {path, body, types?, fields?, tags?}
//     watch({vault, type?}) / unwatch({id})    changes as they land: events `vaults.events` {id, upsert?: record, remove?: id}
//     applets({vault})                         the applets in it, as the app lists them: {id, name, glyph, href, allowed}
//                                              (their code is never handed over; a tap on one goes through `app.open`)
//   sharing       (what reaches a vault; and, each after the person says yes on the app's own sheet over a tap of theirs,
//                 what changes who reaches it)
//     access({vault})                          this app's level there, its applets allowed here, the connector address
//     publish({vault, id, on})                 anyone with its link may read the record (on), or no longer (off: no sheet)
//     revoke({vault, noteId})                  take an applet's access back
//     readOnly({vault})                        let Parachute only read the vault again
//
// What it never does, whatever the card says: change a code record (HTML, TSX, JSX) or one carrying an applet's,
// component's or the app's own name (`applet`, `component`, `parachute-*`: its settings, apps, approvals, keys), give or
// take away such a name, or publish a record (the `publish`/`published` tag or field: that is `sharing`'s, behind its
// sheet), or change a published record without the person's yes on the sheet, or write into `Applets/`, `Parachute/` or
// `.parachute/`, except saved views
// (`Parachute/Views/…`, `parachute-view`), which are the Vault applet's own records. Every call costs the frame's read
// budget; a change to a vault held only for reading is refused and the person is asked (vault/writeAsk.ts).
import { CODE_PATH, isCodeExtension } from "../code.ts";
import { ContractError, ERROR_CODES, hasHidden, hasOnly, plain } from "../contract.ts";
import type { UniModule } from "../router.ts";
import type { AppWord } from "../app.ts";

export type HeldVault = { key: string; name: string; host: string; mine: boolean; home: boolean; level: "read" | "write" | null;
  /** where an AI connects to it (`<vault>/mcp`): the vault's own address, nothing secret */
  connector: string };
/** A record as the module hands it on: record words, types apart from tags. */
export type Rec = {
  id: string; path: string; title: string; createdAt: string | null; updatedAt: string | null;
  types: string[]; tags: string[]; fields: Record<string, unknown>;
  body?: string; createdBy?: string | null; createdVia?: string | null; updatedBy?: string | null; updatedVia?: string | null;
  links?: { dir: "out" | "in"; id: string; path: string; relationship: string }[];
};
export type TypeRow = { name: string; kind: "type" | "tag"; count: number; description: string | null; fields: Record<string, { type?: string; enum?: unknown[]; description?: string }> };
export type Version = { ix: number; at: string; actor: string | null; via: string | null };
export type AccessRow = { level: "read" | "write" | null; mine: boolean; home: boolean; hub: string; connector: string; applets: { noteId: string; name: string; glyph: string; since: string | null; changes: boolean }[] };
export type AppletRow = { id: string; name: string; glyph: string; href: string; allowed: boolean;
  /** a copy of one of Parachute's own kept in the vault (the old Add Capture wrote these): its name, to tell the two apart */
  copyOf?: string };
export type WatchEvent = { upsert?: Rec } | { remove?: string };

/** The shell's side: requests on the vault's own API with the app's sign-in (a change to a vault held for reading
 *  throws the write ask before it is sent), and what the app knows of each vault. */
export type VaultsDeps = {
  list(): HeldVault[];
  /** GET/POST/PATCH under the vault's API (`/records…`, `/types…`), its JSON; a 404 rejects with `not_found`. */
  request(vault: string, method: "GET" | "POST" | "PATCH", path: string, body?: unknown): Promise<unknown>;
  /** A record's GET for what a screen shows (the `get` call), answered at once from what was read before while the hub
   *  is asked behind it (vault/readCache.ts; the frame is told when the answer differs). Given only for an applet that
   *  draws itself again when told (Parachute's own Vault); absent: `request`. A change, and every check one is judged
   *  on (the types that publish, the record as it is), never reads it. */
  read?(vault: string, path: string): Promise<unknown>;
  /** The vault's record door: `records` (core 0.9) or `notes` (0.8). */
  door(vault: string): Promise<"records" | "notes">;
  watch(vault: string, type: string | null, on: (e: WatchEvent) => void): () => void;
  access(vault: string): Promise<AccessRow>;
  /** The applets in a vault, as the app lists them (names only, never their code). */
  applets(vault: string): Promise<AppletRow[]>;
  revoke(vault: string, noteId: string): Promise<void>;
  readOnly(vault: string): Promise<void>;
  /** The app's own yes-or-no sheet over the applet, after a tap of the person's in it: "yes", "no", or "untapped" (no
   *  live tap in the applet, so no sheet was shown). */
  confirm(q: { title: string; body: string; act: string }): Promise<"yes" | "no" | "untapped">;
  emit(event: string, data: unknown): void;
};

export const QUERY_MAX = 200;
export const OPS = ["eq", "ne", "gt", "gte", "lt", "lte", "in", "not_in", "exists"] as const;
const NAME = /^[A-Za-z0-9][A-Za-z0-9_/-]{0,99}$/;
// a field's name; never one that names an object's own machinery (they key plain objects in the shell)
const FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;
const FIELD = { test: (x: string) => FIELD_NAME.test(x) && !["__proto__", "constructor", "prototype"].includes(x) };
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const VIEWS = "Parachute/Views/";
const VIEW_TAG = "parachute-view";
const GUARDED = ["applet", "component", "parachute-pointer"];
/** What makes a record readable by anyone with its link, on the hub (core routes.ts `isNotePublished`): the vault's
 *  `published_tag` (`publish` unless its config names another, which only an admin reads), or the field `published`
 *  set to true. No applet sets either through a change: `sharing`'s publish does, after the person's yes. */
export const PUBLISH_TAGS = ["publish", "published"];
export const PUBLISH_FIELD = "published";
const publishName = (t: string) => PUBLISH_TAGS.includes(t.toLowerCase());
/** Is this record readable by anyone with its link, by the hub's default rule (the `publish` tag, or the field)? A
 *  vault's own published_tag isn't read (docs/VAULT.md); `published` as a tag is refused to changes, not public. */
export const isPublic = (r: { tags: string[]; types?: string[]; fields: Record<string, unknown> }) => [...(r.types ?? []), ...r.tags].some((t) => t === "publish") || r.fields[PUBLISH_FIELD] === true;
/** Words for the app's own sheet from what an applet or a record names: no control, hidden or direction-changing
 *  character, so the sheet reads as it is. */
export const sheetText = (x: string) => x.replace(/[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, "").slice(0, 200);
/** The person's yes, said as a contract error otherwise. */
async function askFirst(deps: VaultsDeps, q: { title: string; body: string; act: string }) {
  const a = await deps.confirm(q);
  if (a === "untapped") throw new ContractError(ERROR_CODES.failed, "needs_tap: it asks while you tap in it");
  if (a !== "yes") throw new ContractError(ERROR_CODES.failed, "not_confirmed: the person said no");
}
/** A name the app keeps for itself (an applet's, a component's, the app's own), but a saved view's. */
export const appsOwn = (t: string) => t !== VIEW_TAG && (/^parachute/i.test(t) || GUARDED.some((g) => t === g || t.startsWith(`${g}/`)));
const str = (x: unknown, max = 300): x is string => typeof x === "string" && x.length > 0 && x.length <= max && !hasHidden(x);
const vaultOk = (x: unknown): x is string => str(x, 200);
const strOr = (x: unknown) => (typeof x === "string" ? x : null);
/** A path a write may name: plain segments, not a code file, not the app's own folders (but saved views). */
export function writablePath(p: unknown): p is string {
  if (!str(p, 300) || /%(?:2e|2f|5c|25)/i.test(p) || CODE_PATH.test(p) || p.trim() !== p || p.startsWith("/")) return false;
  const segs = p.split("/");
  if (segs.some((s) => !s || s === "." || s === ".." || s.trim() !== s)) return false;
  if (p.startsWith(VIEWS)) return segs.length >= 3;
  return !/^(?:applets|parachute|\.parachute)$/i.test(segs[0]) && !segs[0].startsWith(".");
}
const title = (path: string) => path.split("/").pop() ?? path;

/** A record from either door's answer: record words (body, fields, types) or note words (content, metadata, tags). */
export function recOf(raw: unknown, typeNames?: ReadonlySet<string>): Rec | null {
  if (!plain(raw) || typeof raw.id !== "string") return null;
  const path = typeof raw.path === "string" ? raw.path : raw.id;
  const tagsIn = Array.isArray(raw.tags) ? raw.tags.filter((t): t is string => typeof t === "string") : [];
  const typesIn = Array.isArray(raw.types) ? raw.types.filter((t): t is string => typeof t === "string") : [];
  // a door that lists types under tags (0.8): the vault's typed names are its types
  const types = typesIn.length || !typeNames ? typesIn : tagsIn.filter((t) => typeNames.has(t));
  const tags = tagsIn.filter((t) => !types.includes(t));
  const fields = plain(raw.fields) ? raw.fields : plain(raw.metadata) ? raw.metadata : {};
  const out: Rec = {
    id: raw.id, path, title: title(path),
    createdAt: strOr(raw.createdAt), updatedAt: strOr(raw.updatedAt), types, tags, fields: { ...fields },
  };
  const body = typeof raw.body === "string" ? raw.body : typeof raw.content === "string" ? raw.content : undefined;
  if (body !== undefined) out.body = body;
  if ("createdBy" in raw) { out.createdBy = strOr(raw.createdBy); out.createdVia = strOr(raw.createdVia); out.updatedBy = strOr(raw.lastUpdatedBy); out.updatedVia = strOr(raw.lastUpdatedVia); }
  if (Array.isArray(raw.links)) {
    out.links = raw.links.flatMap((l) => {
      if (!plain(l)) return [];
      const outbound = l.sourceId === raw.id;
      const other = outbound ? l.targetNote : l.sourceNote;
      const id = outbound ? l.targetId : l.sourceId;
      if (typeof id !== "string" || id === raw.id) return [];
      return [{ dir: outbound ? "out" as const : "in" as const, id, path: plain(other) && typeof other.path === "string" ? other.path : id, relationship: typeof l.relationship === "string" ? l.relationship : "link" }];
    });
  }
  return out;
}

/** A record no applet may change: code, or one carrying an applet's, a component's or the app's own name. */
export const guarded = (r: { path: string; types: string[]; tags: string[]; extension?: unknown }) =>
  isCodeExtension({ path: r.path, extension: typeof r.extension === "string" ? r.extension : null }) || [...r.types, ...r.tags].some(appsOwn);

type Where = { field: string; op: (typeof OPS)[number]; value: unknown };
type Query = { vault: string; type?: string; tag?: string; search?: string; path?: string; where: Where[]; sort?: { by: string; dir: "asc" | "desc" }; limit: number; offset: number };
const scalar = (v: unknown) => typeof v === "string" ? v.length <= 500 : typeof v === "number" ? Number.isFinite(v) : typeof v === "boolean";

function queryOf(p: unknown): Query | null {
  if (!plain(p) || !hasOnly(p, ["vault", "type", "tag", "search", "path", "where", "sort", "limit", "offset"]) || !vaultOk(p.vault)) return null;
  const q: Query = { vault: p.vault, where: [], limit: 50, offset: 0 };
  for (const k of ["type", "tag"] as const) if (p[k] !== undefined) { if (typeof p[k] !== "string" || !NAME.test(p[k] as string)) return null; q[k] = p[k] as string; }
  if (p.search !== undefined) { if (typeof p.search !== "string" || p.search.length > 300 || hasHidden(p.search)) return null; if (p.search.trim()) q.search = p.search.trim(); }
  if (p.path !== undefined) { if (!str(p.path, 300) || !p.path.endsWith("/") || p.path.split("/").some((s) => s === "..")) return null; q.path = p.path; }
  if (p.where !== undefined) {
    if (!Array.isArray(p.where) || p.where.length > 8) return null;
    for (const w of p.where) {
      if (!plain(w) || !hasOnly(w, ["field", "op", "value"]) || typeof w.field !== "string" || !FIELD.test(w.field) || !(OPS as readonly string[]).includes(w.op as string)) return null;
      const op = w.op as Where["op"];
      const ok = op === "exists" ? typeof w.value === "boolean" : op === "in" || op === "not_in" ? Array.isArray(w.value) && w.value.length <= 50 && w.value.every(scalar) : scalar(w.value);
      if (!ok) return null;
      q.where.push({ field: w.field, op, value: w.value });
    }
  }
  if (p.sort !== undefined) {
    if (!plain(p.sort) || !hasOnly(p.sort, ["by", "dir"]) || typeof p.sort.by !== "string" || !(FIELD.test(p.sort.by)) || (p.sort.dir !== "asc" && p.sort.dir !== "desc")) return null;
    q.sort = { by: p.sort.by, dir: p.sort.dir };
  }
  if (p.limit !== undefined) { if (!Number.isInteger(p.limit) || (p.limit as number) < 1 || (p.limit as number) > QUERY_MAX) return null; q.limit = p.limit as number; }
  if (p.offset !== undefined) { if (!Number.isInteger(p.offset) || (p.offset as number) < 0 || (p.offset as number) > 1_000_000) return null; q.offset = p.offset as number; }
  return q;
}

/** The list call's address on the vault's API, for either door. Sorting by a field asks the hub to (it scans). */
export function queryPath(q: Query, door: "records" | "notes"): string {
  const u = new URLSearchParams();
  const tag = q.type ?? q.tag;
  if (tag) u.set("tag", tag);
  if (q.search) u.set("search", q.search);
  if (q.path) u.set("path_prefix", q.path);
  // field filters as the hub's JSON form, which keeps a value's type (`true`, `5`), unlike meta[field][op]=text
  if (q.where.length) {
    const m: Record<string, Record<string, unknown>> = Object.create(null);
    for (const w of q.where) (m[w.field] ??= Object.create(null))[w.op] = w.value;
    u.set("metadata", JSON.stringify(m));
  }
  if (q.sort && !q.search) {
    const by = q.sort.by === "updated" ? "updated_at" : q.sort.by === "created" ? "created_at" : q.sort.by;
    // the hub has no order by name or path: those are left to the newest first
    if (by !== "title" && by !== "path") { u.set("order_by", by); u.set("sort", q.sort.dir); } else { u.set("order_by", "updated_at"); u.set("sort", "desc"); }
  } else if (!q.search) { u.set("order_by", "updated_at"); u.set("sort", "desc"); }
  u.set("limit", String(q.limit + 1));
  if (q.offset) u.set("offset", String(q.offset));
  u.set(door === "records" ? "include_fields" : "include_metadata", "true");
  return `/${door}?${u.toString()}`;
}

type NameChange = { add?: string[]; remove?: string[] };
const namesOf = (v: unknown): string[] | null => Array.isArray(v) && v.length <= 20 && v.every((t) => typeof t === "string" && NAME.test(t)) ? v as string[] : null;
const changeOf = (v: unknown): NameChange | null => {
  if (!plain(v) || !hasOnly(v, ["add", "remove"])) return null;
  const add = v.add === undefined ? [] : namesOf(v.add), remove = v.remove === undefined ? [] : namesOf(v.remove);
  return add && remove ? { ...(add.length ? { add } : {}), ...(remove.length ? { remove } : {}) } : null;
};
const fieldValue = (v: unknown): boolean => v === null || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v)) || (typeof v === "string" && v.length <= 10_000);
/** Fields a change may set: at most 50, each a plain value or a list of them; null removes it. */
const fieldsOf = (v: unknown): Record<string, unknown> | null => plain(v) && Object.keys(v).length <= 50
  && Object.entries(v).every(([k, x]) => FIELD.test(k) && (fieldValue(x) || (Array.isArray(x) && x.length <= 100 && x.every((y) => y !== null && fieldValue(y))))) ? v : null;
const BODY_MAX = 1_000_000;
const jsonOf = (bytes: unknown): Record<string, unknown> | null => {
  // an ArrayBuffer, from whichever realm made it
  if (Object.prototype.toString.call(bytes) !== "[object ArrayBuffer]" || (bytes as ArrayBuffer).byteLength > BODY_MAX + 100_000) return null;
  try { const v = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes as ArrayBuffer))); return plain(v) ? v : null; } catch { return null; }
};
type Change = { if_updated_at: string; body?: string; fields?: Record<string, unknown>; types?: NameChange; tags?: NameChange };
function changeIn(v: Record<string, unknown>): Change | null {
  if (!hasOnly(v, ["if_updated_at", "body", "fields", "types", "tags"]) || !str(v.if_updated_at, 64)) return null;
  const c: Change = { if_updated_at: v.if_updated_at };
  if (v.body !== undefined) { if (typeof v.body !== "string" || v.body.length > BODY_MAX) return null; c.body = v.body; }
  if (v.fields !== undefined) { const f = fieldsOf(v.fields); if (!f) return null; c.fields = f; }
  for (const k of ["types", "tags"] as const) if (v[k] !== undefined) { const n = changeOf(v[k]); if (!n) return null; c[k] = n; }
  return c;
}
type New = { path: string; body: string; types: string[]; tags: string[]; fields?: Record<string, unknown> };
function newIn(v: Record<string, unknown>): New | null {
  if (!hasOnly(v, ["path", "body", "types", "tags", "fields"]) || !writablePath(v.path) || typeof v.body !== "string" || v.body.length > BODY_MAX) return null;
  const types = v.types === undefined ? [] : namesOf(v.types), tags = v.tags === undefined ? [] : namesOf(v.tags);
  // a saved view keeps its settings in one field, `view`: a small object of its own
  const view = typeof v.path === "string" && v.path.startsWith(VIEWS) && plain(v.fields) && plain(v.fields.view) && Object.keys(v.fields).length === 1 && JSON.stringify(v.fields.view).length <= 4000;
  const fields = v.fields === undefined ? undefined : view ? v.fields as Record<string, unknown> : fieldsOf(v.fields);
  if (!types || !tags || fields === null) return null;
  return { path: v.path, body: v.body, types, tags, ...(fields ? { fields } : {}) };
}

const refuse = (why: string) => new ContractError(ERROR_CODES.outOfScope, why);
const failed = (e: unknown) => {
  if (e instanceof ContractError) return e;
  const m = e instanceof Error ? e.message : String(e);
  // the person is asked to let Parachute change that vault: the applet hears it as refused, in the app's words
  if ((e as { name?: string })?.name === "NeedsWriteError") return new ContractError(ERROR_CODES.notGranted, m.slice(0, 300));
  if (/conflict/i.test(m)) return new ContractError(ERROR_CODES.failed, "conflict: it changed since it was read");
  if (/not.?found|404/i.test(m)) return new ContractError(ERROR_CODES.failed, "not_found");
  return new ContractError(ERROR_CODES.failed, m.slice(0, 300));
};

export function createVaultsModule(allowed: readonly AppWord[], deps: VaultsDeps): UniModule & { stop(): void } {
  const need = (w: AppWord) => { if (!allowed.includes(w)) throw new ContractError(ERROR_CODES.notGranted); };
  const held = (vault: string) => { const v = deps.list().find((x) => x.key === vault); if (!v) throw refuse("this device holds no such vault"); return v; };
  /** Each vault's type names, as last read (a 0.8 door lists them among tags). */
  const typeNames = new Map<string, Set<string>>();
  const watches = new Map<string, () => void>();
  let watchN = 0;
  // ids of this module's own: a module made again (the applet's record re-read) never answers to an old id
  const prefix = Math.random().toString(36).slice(2, 8);
  const one = <T>(validate: (p: Record<string, unknown>) => T | null, word: AppWord = "vaults") => (p: unknown) => {
    need(word);
    if (!plain(p)) return { ok: false as const };
    const v = validate(p);
    return v === null ? { ok: false as const } : { ok: true as const, value: v };
  };
  const vaultOnly = (keys: string[] = []) => (p: Record<string, unknown>) => hasOnly(p, ["vault", ...keys]) && vaultOk(p.vault) ? p as { vault: string } & Record<string, unknown> : null;

  /** The vault's types and tags. `shows`: only to draw a record (which names are types), from the copy kept of the read
   *  where the shell keeps one; never for what a change is judged on (the types that publish). */
  async function types(vault: string, shows = false): Promise<TypeRow[]> {
    const door = await deps.door(vault);
    const path = door === "records" ? "/types?include_schema=true" : "/tags?include_schema=true";
    const raw = await (shows && deps.read ? deps.read(vault, path) : deps.request(vault, "GET", path));
    const rows = Array.isArray(raw) ? raw : plain(raw) && Array.isArray(raw.tags) ? raw.tags : [];
    const out: TypeRow[] = rows.flatMap((r: unknown) => {
      if (!plain(r) || typeof r.name !== "string") return [];
      const fields = plain(r.fields) ? r.fields as TypeRow["fields"] : plain(r.schema) && plain((r.schema as Record<string, unknown>).fields) ? (r.schema as { fields: TypeRow["fields"] }).fields : {};
      const kind = r.kind === "type" || (r.kind === undefined && Object.keys(fields).length > 0) ? "type" : "tag";
      return [{ name: r.name, kind, count: typeof r.count === "number" ? r.count : 0, description: strOr(r.description), fields }];
    });
    // only the hub's answer is kept for the checks that read the names (a copy's draws one record, no more)
    if (!shows || !deps.read) typeNames.set(vault, new Set(out.filter((t) => t.kind === "type").map((t) => t.name)));
    return out;
  }
  /** Type names whose schema gives `published` a default: the hub fills it in on a create or when the type is added,
   *  which would publish without the sheet (core applySchemaDefaults). */
  const publishingTypes = async (vault: string) => new Set((await types(vault)).filter((t) => t.fields && Object.prototype.hasOwnProperty.call(t.fields, PUBLISH_FIELD) && (t.fields[PUBLISH_FIELD] as { default?: unknown })?.default !== undefined).map((t) => t.name));
  const namesFor = async (vault: string, shows = false) => typeNames.get(vault) ?? new Set((await types(vault, shows)).filter((t) => t.kind === "type").map((t) => t.name));
  /** Records a change found changed meanwhile: their next read for what shows is the hub's (the copy is from before). */
  const changedMeanwhile = new Set<string>();
  /** A record's GET for what shows: from what was read before, where the shell keeps it. */
  const shown = (vault: string, path: string) => (deps.read ? deps.read(vault, path) : deps.request(vault, "GET", path));
  /** A record: as it is now (`shows`: for what shows, which may be what was read before). */
  async function getRec(vault: string, id: string, body: boolean, shows = false): Promise<Rec & { extension?: unknown }> {
    const door = await deps.door(vault);
    const fresh = !shows || changedMeanwhile.delete(`${vault} ${id}`);
    const raw = await (fresh ? (v: string, p: string) => deps.request(v, "GET", p) : shown)(vault, `/${door}/${encodeURIComponent(id)}?include_links=true${body ? "" : door === "records" ? "&include_body=false" : "&include_content=false"}`);
    const r = recOf(raw, await namesFor(vault, shows));
    if (!r) throw new ContractError(ERROR_CODES.failed, "not_found");
    return { ...r, extension: plain(raw) ? raw.extension : undefined };
  }
  /** On a door that keeps types among tags (0.8), a type's change is a tag's. */
  const bodyFor = (door: "records" | "notes", c: Partial<Change> & { path?: string; types?: unknown; tags?: unknown }) => {
    const out: Record<string, unknown> = {};
    if (c.path !== undefined) out.path = c.path;
    if (c.body !== undefined) out[door === "records" ? "body" : "content"] = c.body;
    if (c.fields !== undefined) out[door === "records" ? "fields" : "metadata"] = c.fields;
    if (c.if_updated_at !== undefined) out.if_updated_at = c.if_updated_at;
    if (door === "records") { if (c.types !== undefined) out.types = c.types; if (c.tags !== undefined) out.tags = c.tags; return out; }
    // notes words: one list of tags
    const t = c.types as NameChange | string[] | undefined, g = c.tags as NameChange | string[] | undefined;
    if (Array.isArray(t) || Array.isArray(g)) out.tags = [...(Array.isArray(t) ? t : []), ...(Array.isArray(g) ? g : [])];
    else if (t || g) out.tags = { add: [...(t?.add ?? []), ...(g?.add ?? [])], remove: [...(t?.remove ?? []), ...(g?.remove ?? [])] };
    return out;
  };

  return {
    stop() { for (const s of watches.values()) s(); watches.clear(); },
    namespace: "vaults",
    methods: {
      list: { cap: null, validate: one((p) => (hasOnly(p, []) ? {} : null)), run: async () => deps.list() },
      types: {
        cap: null, validate: one(vaultOnly()),
        run: async ({ vault }: { vault: string }, _s, ctx) => { held(vault); ctx.charge(1); return types(vault).catch((e) => { throw failed(e); }); },
      },
      query: {
        cap: null, validate: one(queryOf),
        async run(q: Query, _s, ctx) {
          held(q.vault); ctx.charge(1);
          try {
            const door = await deps.door(q.vault);
            const names = await namesFor(q.vault);
            const raw = await deps.request(q.vault, "GET", queryPath(q, door));
            const all: unknown[] = Array.isArray(raw) ? raw : plain(raw) && Array.isArray(raw.records) ? raw.records : plain(raw) && Array.isArray(raw.notes) ? raw.notes : [];
            // `more` and `read` count the hub's rows (code is left out of what shows, not out of the paging)
            const page = all.slice(0, q.limit);
            const rows = page.filter((x) => !(plain(x) && isCodeExtension({ path: typeof x.path === "string" ? x.path : "", extension: typeof x.extension === "string" ? x.extension : null })))
              .map((x) => recOf(x, names)).filter((x): x is Rec => !!x);
            return { records: rows, more: all.length > q.limit, read: page.length };
          } catch (e) { throw failed(e); }
        },
      },
      get: {
        cap: null, validate: one((p) => (vaultOnly(["id"])(p) && typeof p.id === "string" && ID.test(p.id) ? p as { vault: string; id: string } : null)),
        async run({ vault, id }: { vault: string; id: string }, _s, ctx) {
          held(vault); ctx.charge(1);
          try { const { extension: _e, ...r } = await getRec(vault, id, true, true); return r; } catch (e) { throw failed(e); }
        },
      },
      history: {
        cap: null, validate: one((p) => (vaultOnly(["id"])(p) && typeof p.id === "string" && ID.test(p.id) ? p as { vault: string; id: string } : null)),
        async run({ vault, id }: { vault: string; id: string }, _s, ctx) {
          held(vault); ctx.charge(1);
          const door = await deps.door(vault);
          // a hub that keeps no history (404) has none; any other failure is said, not shown as none
          const raw = await deps.request(vault, "GET", `/${door}/${encodeURIComponent(id)}/versions?limit=50`).catch((e: unknown) => {
            if ((e as { status?: number })?.status === 404 || (e as { name?: string })?.name === "VaultNotFoundError") return null;
            throw failed(e);
          });
          const list = plain(raw) && Array.isArray(raw.versions) ? raw.versions : [];
          return list.flatMap((v: unknown): Version[] => (plain(v) && typeof v.superseded_at === "string" && typeof v.version_ix === "number"
            ? [{ ix: v.version_ix, at: v.superseded_at, actor: strOr(v.actor), via: strOr(v.via) }] : []));
        },
      },
      version: {
        cap: null, validate: one((p) => (vaultOnly(["id", "ix"])(p) && typeof p.id === "string" && ID.test(p.id) && Number.isInteger(p.ix) && (p.ix as number) >= 0 ? p as { vault: string; id: string; ix: number } : null)),
        async run({ vault, id, ix }: { vault: string; id: string; ix: number }, _s, ctx) {
          held(vault); ctx.charge(1);
          const door = await deps.door(vault);
          const raw = await deps.request(vault, "GET", `/${door}/${encodeURIComponent(id)}/versions/${ix}`).catch((e) => { throw failed(e); });
          const v = plain(raw) && plain(raw.version) ? raw.version : raw;
          if (!plain(v)) throw new ContractError(ERROR_CODES.failed, "not_found");
          const body = typeof v.body === "string" ? v.body : typeof v.content === "string" ? v.content : "";
          const fields = plain(v.fields) ? v.fields : plain(v.metadata) ? v.metadata : null;
          return { ix, body, fields, at: strOr(v.superseded_at) };
        },
      },
      update: {
        cap: null,
        validate: one((p) => {
          if (!vaultOnly(["id", "bytes"])(p) || typeof p.id !== "string" || !ID.test(p.id)) return null;
          const j = jsonOf(p.bytes);
          const c = j ? changeIn(j) : null;
          return c ? { vault: p.vault as string, id: p.id, change: c } : null;
        }),
        async run({ vault, id, change }: { vault: string; id: string; change: Change }, _s, ctx) {
          const v = held(vault); ctx.charge(2);
          const named = [...(change.types?.add ?? []), ...(change.types?.remove ?? []), ...(change.tags?.add ?? []), ...(change.tags?.remove ?? [])];
          if (named.some(appsOwn)) throw refuse("an applet can't give or take away the app's own names");
          if (named.some(publishName) || (change.fields && PUBLISH_FIELD in change.fields)) throw refuse("publishing is sharing's, and the person says yes to it");
          const adding = [...(change.types?.add ?? []), ...(change.tags?.add ?? [])];
          if (adding.length) { const p = await publishingTypes(vault); if (adding.some((t) => p.has(t))) throw refuse("that type publishes what it is given: publishing is sharing's"); }
          let now: Rec & { extension?: unknown };
          try { now = await getRec(vault, id, false); } catch (e) { throw failed(e); }
          // judged on the record as it is now: never code, an applet, a component or the app's own (but a saved view)
          if (guarded(now) || (!now.path.startsWith(VIEWS) && /^(?:applets|parachute|\.parachute)\//i.test(now.path))) throw refuse("this record is the app's own: no applet changes it");
          if (now.path.startsWith(VIEWS) && change.types?.remove?.length) throw refuse("a saved view keeps its names");
          // the change is to the version judged above, or none
          if (change.if_updated_at !== now.updatedAt) { changedMeanwhile.add(`${vault} ${id}`); throw new ContractError(ERROR_CODES.failed, "conflict: it changed since it was read"); }
          // what is written into a published record anyone with its link reads: the person says yes first
          if (isPublic(now)) await askFirst(deps, { title: `Change “${sheetText(now.path)}”?`, body: `It is published from ${sheetText(v.name)} (${sheetText(v.host)}): anyone with its link reads what is written there.`, act: "Change it" });
          const door = await deps.door(vault);
          try {
            const raw = await deps.request(vault, "PATCH", `/${door}/${encodeURIComponent(now.id)}`, bodyFor(door, change));
            return recOf(raw, await namesFor(vault));
          } catch (e) { throw failed(e); }
        },
      },
      create: {
        cap: null,
        validate: one((p) => {
          if (!vaultOnly(["bytes"])(p)) return null;
          const j = jsonOf(p.bytes);
          const n = j ? newIn(j) : null;
          return n ? { vault: p.vault as string, rec: n } : null;
        }),
        async run({ vault, rec }: { vault: string; rec: New }, _s, ctx) {
          held(vault); ctx.charge(2);
          const view = rec.path.startsWith(VIEWS);
          if ([...rec.types, ...rec.tags].some((t) => appsOwn(t))) throw refuse("an applet can't give the app's own names");
          if ([...rec.types, ...rec.tags].some(publishName) || (rec.fields && PUBLISH_FIELD in rec.fields)) throw refuse("publishing is sharing's, and the person says yes to it");
          if (rec.types.length || rec.tags.length) { const p = await publishingTypes(vault); if ([...rec.types, ...rec.tags].some((t) => p.has(t))) throw refuse("that type publishes what it is given: publishing is sharing's"); }
          // a saved view is a record of its own kind, in its own folder, and nothing else goes there
          if (view !== rec.tags.includes(VIEW_TAG)) throw refuse("saved views live in Parachute/Views/, tagged parachute-view");
          const door = await deps.door(vault);
          try {
            const raw = await deps.request(vault, "POST", `/${door}`, bodyFor(door, { path: rec.path, body: rec.body, ...(rec.fields ? { fields: rec.fields } : {}), types: rec.types, tags: rec.tags } as never));
            return recOf(raw, await namesFor(vault));
          } catch (e) { throw failed(e); }
        },
      },
      watch: {
        cap: null, validate: one((p) => (vaultOnly(["type"])(p) && (p.type === undefined || (typeof p.type === "string" && NAME.test(p.type))) ? p as { vault: string; type?: string } : null)),
        async run({ vault, type }: { vault: string; type?: string }, _s, ctx) {
          held(vault); ctx.charge(1);
          if (watches.size >= 8) throw new ContractError(ERROR_CODES.tooManyPending, "eight watches at most");
          const id = `w${prefix}${++watchN}`;
          const names = await namesFor(vault).catch(() => new Set<string>());
          // the frame that asked went while the vault's names were read: no watch for it
          if (ctx.closed()) throw new ContractError(ERROR_CODES.failed, "the applet's screen went");
          const stop = deps.watch(vault, type ?? null, (e) => {
            // the frame that asked is gone: nothing more goes to it
            if (ctx.closed()) { watches.get(id)?.(); watches.delete(id); return; }
            if ("upsert" in e && e.upsert) {
              const r = recOf(e.upsert, names);
              const raw = e.upsert as unknown as Record<string, unknown>;
              if (r && !isCodeExtension({ path: r.path, extension: typeof raw.extension === "string" ? raw.extension : null })) deps.emit("vaults.events", { id, upsert: r });
            } else if ("remove" in e && e.remove) deps.emit("vaults.events", { id, remove: e.remove });
          });
          watches.set(id, stop);
          return { id };
        },
      },
      unwatch: {
        cap: null, validate: one((p) => (hasOnly(p, ["id"]) && typeof p.id === "string" && /^w[a-z0-9]{1,6}\d{1,9}$/.test(p.id) ? p as { id: string } : null)),
        run: async ({ id }: { id: string }) => { watches.get(id)?.(); watches.delete(id); return null; },
      },
      applets: {
        cap: null, validate: one(vaultOnly()),
        run: async ({ vault }: { vault: string }, _s, ctx) => { held(vault); ctx.charge(1); return deps.applets(vault); },
      },
      access: {
        cap: null, validate: one(vaultOnly(), "sharing"),
        run: async ({ vault }: { vault: string }, _s, ctx) => { held(vault); ctx.charge(1); return deps.access(vault); },
      },
      publish: {
        cap: null, validate: one((p) => (vaultOnly(["id", "on"])(p) && typeof p.id === "string" && ID.test(p.id) && typeof p.on === "boolean" ? p as { vault: string; id: string; on: boolean } : null), "sharing"),
        async run({ vault, id, on }: { vault: string; id: string; on: boolean }, _s, ctx) {
          const v = held(vault); ctx.charge(2);
          let now: Rec & { extension?: unknown };
          try { now = await getRec(vault, id, false); } catch (e) { throw failed(e); }
          if (guarded(now) || (!now.path.startsWith(VIEWS) && /^(?:applets|parachute|\.parachute)\//i.test(now.path)) || now.path.startsWith(VIEWS)) throw refuse("this record is the app's own: no applet changes it");
          // nothing to do: says so; and in any case hands back nothing of the record (sharing alone reads no fields)
          if (isPublic(now) === on) return { published: on, changed: false };
          // making it readable by anyone is the person's to say, on the app's own sheet; taking that back isn't asked
          if (on) await askFirst(deps, { title: `Publish “${sheetText(now.path)}”?`, body: `Anyone with its link can read “${sheetText(now.path)}”, from ${sheetText(v.name)} (${sheetText(v.host)}), without signing in. You can unpublish it later.`, act: "Publish" });
          const door = await deps.door(vault);
          // the field works whatever tag a vault names for publishing; off takes away the field and the default tags
          const fields = door === "records" ? "fields" : "metadata";
          const body = on ? { [fields]: { [PUBLISH_FIELD]: true }, if_updated_at: now.updatedAt }
            // the records door keeps a type apart from tags; the notes door (0.8) has only tags, a type's name among them
            : door === "records"
              ? { fields: { [PUBLISH_FIELD]: null }, ...(now.tags.some(publishName) ? { tags: { remove: now.tags.filter(publishName) } } : {}),
                ...(now.types.some(publishName) ? { types: { remove: now.types.filter(publishName) } } : {}), if_updated_at: now.updatedAt }
              : { metadata: { [PUBLISH_FIELD]: null }, ...([...now.tags, ...now.types].some(publishName) ? { tags: { remove: [...now.tags, ...now.types].filter(publishName) } } : {}), if_updated_at: now.updatedAt };
          try {
            await deps.request(vault, "PATCH", `/${door}/${encodeURIComponent(now.id)}`, body);
            return { published: on, changed: true };
          } catch (e) { throw failed(e); }
        },
      },
      revoke: {
        cap: null, validate: one((p) => (vaultOnly(["noteId"])(p) && typeof p.noteId === "string" && ID.test(p.noteId) ? p as { vault: string; noteId: string } : null), "sharing"),
        async run({ vault, noteId }: { vault: string; noteId: string }, _s, ctx) {
          const v = held(vault); ctx.charge(1);
          const a = (await deps.access(vault)).applets.find((x) => x.noteId === noteId);
          if (!a) throw refuse("no applet allowed there by that note");
          await askFirst(deps, { title: `Revoke ${sheetText(a.name)}?`, body: `${sheetText(a.name)} stops in ${sheetText(v.name)} (${sheetText(v.host)}), and asks again before it runs. With your key, your other devices take it back too.`, act: "Revoke" });
          await deps.revoke(vault, noteId);
          return null;
        },
      },
      readOnly: {
        cap: null, validate: one(vaultOnly(), "sharing"),
        async run({ vault }: { vault: string }, _s, ctx) {
          const v = held(vault); ctx.charge(1);
          await askFirst(deps, { title: `Let Parachute only read ${sheetText(v.name)}?`, body: `${sheetText(v.name)} (${sheetText(v.host)}): a change there, yours or an applet's, asks you again on your hub.`, act: "Read only" });
          await deps.readOnly(vault);
          return null;
        },
      },
    },
  };
}
