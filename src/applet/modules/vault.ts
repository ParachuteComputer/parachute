// vault module (copied from the Uni app's src/interface/modules/vault.ts): a REST subset compatible with surface-client's VaultClient,
// served over the frame. Every read is checked against the granted
// `vault.read` path prefixes, and so is every note that comes back (whatever
// key it was looked up by), so search, tag and id lookups can't leak.
//   GET   /api/vault
//   GET   /api/notes?path_prefix&tag&search&limit&id&path&include_content&include_metadata
//              &order_by&sort&offset&meta[field]&meta[field][op]&include_links
//   GET   /api/notes/:idOrPath?include_content&include_links
//   GET   /api/tags                                      the tags on the notes in its folders, each with its count
// The hub's own query words (T-476, docs/WRITE-AN-APPLET.md "Reading"): order, page and filter by a field, asked of
// the hub with the folder pinned and judged again on what comes back. Ordering by link count is not one of them (it
// counts links to notes outside the folders). A link comes back only when the note at its other end is in the folders
// too; the tags are counted from the folders' own notes, never the vault's whole list.
// Two writes, only for a grant that names them (a contract 2 sealed manifest):
//   POST  /api/notes            {path, content, types?, tags?, metadata?}   a new record, its path inside a `vault.create` folder
//   PATCH /api/notes/:idOrPath  {if_updated_at, content?, metadata?, types?: {add?, remove?}, tags?: {add?, remove?}}
//                                                          a change to a record inside a `vault.update` folder, in one call
// A long note's write comes as bytes beside the request (contract.ts maxWriteBytes), read here as the same JSON text.
// Typed records end to end (T-476): a write may set a record's fields (`metadata`, merged; null removes a key: plain
// values only, never `published`), and give or take away the types its card names for that folder (what it opens
// there, `fields.opens`: "Open book notes in Books/"), so what an applet changes is what an AI reads back. No other
// type or tag (a tag can publish a note to the web: the vault's `publish`, or one its owner named), no links, move or
// force. A new note also gets the tag of the type the applet opens there (opens.ts `tagsFor`). A write never touches a
// code note (HTML, TSX, JSX) or a note tagged `applet`, `component` or `parachute-pointer` (an applet can't rewrite itself, another, a component or a pointer),
// never gives or takes away one of those names or any `parachute-*` one, never changes the fields or tags of a note
// carrying a `parachute-*` name (the app's own: its settings), and is judged on the note as it is read now. A session
// that has ended writes nothing.
// One call beside the REST subset (docs/design/KEYRING.md): `vault.attach {noteId, bytes, type, transcribe?}` adds a
// file to a note the grant lets it change (the same judgment as a PATCH), through the hub's own upload and attach
// routes; `transcribe` asks the hub to transcribe audio. The kit names it `uni.vault.attach(noteId, bytes, type, {transcribe})`.
// And `vault.file {id, path}`: the bytes of a picture attached to a record in its `vault.read` folders, to draw its
// pictures, or of a short sound, to play it (docs/design/PICTURES.md): only one the hub lists as that record's own, the
// same check as `vaults.file` (which hands over pictures alone), and a sound's first bytes its type's.
// The kit names it `uni.vault.file(id, path)`, a Blob; the kit's Note asks it by itself when given the record's `id`.
// And `vault.attachFrom {noteId, from, path}`: a picture already attached to record `from` (one it reads) attached to
// `noteId` too (one it may change, judged as `attach` is), through the hub's attach route: no new bytes, so a picture
// shown on a second record is that record's own as well. It never attaches a file it couldn't already name.

import { CODE_PATH, codeKindOf, isCodeExtension } from "../code.ts";
import { attachedMedia, attachmentLists, FILE_MAX, listedPicture, mediaType, storagePath } from "../files.ts";
import { ContractError, ERROR_CODES, hasHidden, hasOnly, inScope, LIMITS, plain, safePrefix, type ErrorCode } from "../contract.ts";
import type { CallCtx, UniModule } from "../router.ts";
import type { Resolved } from "../needs.ts";
import { tagsFor, type Opens } from "../opens.ts";
import type { FetchResult } from "./frameFetch.ts";
import type { ChosenFile } from "./app.ts";
import type { Manifest, Progress } from "../upload.ts";

export type PathRow = { id: string; path: string | null; extension?: string | null; updatedAt?: string | null };
/** One end of a link as the hub summarises it (`include_links`). */
export type LinkEnd = { id: string; path?: string | null; tags?: string[] | null; metadata?: Record<string, unknown> | null; createdAt?: string | null; updatedAt?: string | null };
/** A link on a note, both ways (`include_links`): the note it leaves and the one it reaches, each summarised. */
export type NoteLink = { sourceId: string; targetId: string; relationship?: string | null; metadata?: Record<string, unknown> | null; createdAt?: string | null; sourceNote?: LinkEnd | null; targetNote?: LinkEnd | null };
export type VaultNote = { id: string; path?: string | null; extension?: string | null; content?: string | null; tags?: string[] | null; types?: string[] | null; metadata?: Record<string, unknown> | null; createdAt?: string | null; updatedAt?: string | null; links?: NoteLink[] | null };
/** A folder's notes as the hub orders, pages and filters them (`query`): what the module passes on, checked. */
export type FolderQuery = { limit: number; offset: number; tag: string | null; search: string | null; content: boolean; links: boolean; orderBy: string | null; sort: "asc" | "desc" | null; meta: [string, string][] };
/** A change to a record's types or tags: names to add and to remove. */
export type NameChange = { add?: string[]; remove?: string[] };
/** What a typed write sets beside the text: fields (merged; null removes a key), types and tags. */
export type RecordChange = { metadata?: Record<string, unknown>; types?: NameChange; tags?: NameChange };
export type VaultDeps = {
  listPaths(): Promise<PathRow[]>;
  /** By id or path; rejects when missing. `links`: with its links, both ways (`include_links`). */
  getNote(ref: string, o?: { links?: boolean }): Promise<VaultNote>;
  search(query: string, limit: number, pathPrefix: string | null): Promise<{ id: string; path: string | null; snippet: string }[]>;
  /** The newest notes under a folder with their tags and metadata, no content, in one ask. Absent: fields are read note by note. */
  listFields?(pathPrefix: string, limit: number): Promise<VaultNote[]>;
  /** The newest notes under a folder (with a tag, when given) with their tags, metadata and, when asked, content, in one
   *  ask. Absent, or failing: they are read note by note, as before. */
  list?(pathPrefix: string, o: { limit: number; tag: string | null; content: boolean }): Promise<VaultNote[]>;
  /** The notes under a folder as the hub orders, pages and filters them, with their tags and metadata (and content and
   *  links when asked). Absent: those query words are refused (400). */
  query?(pathPrefix: string, q: FolderQuery): Promise<VaultNote[]>;
  /** The same reads, answered at once from what was read before while the hub is asked behind it (vault/readCache.ts),
   *  for a frame that draws itself again when told the hub's answer differs (the kit's `x-parachute-redraws`). Writes,
   *  and the reads a write is judged on, never use these. */
  kept?: Pick<VaultDeps, "listPaths" | "getNote" | "search" | "listFields" | "list" | "query">;
  /** A new note at `path` with these tags, and these types and fields (refused when one is there). Absent: the host can't write, and every write is 405. */
  create?(path: string, content: string, tags: string[], more?: { types?: string[]; metadata?: Record<string, unknown> }): Promise<VaultNote>;
  /** A change to the note `id` (new content, when given, and `more`), only if it is still at `ifUpdatedAt`; a rejection whose message starts "conflict:" is a conflict. */
  save?(id: string, content: string | undefined, ifUpdatedAt: string, more?: RecordChange): Promise<VaultNote>;
  /** Upload the bytes to the vault's storage and attach them to the note `id`. Absent: the host can't, and attach is not_granted. */
  attach?(id: string, bytes: ArrayBuffer, type: string, transcribe: boolean): Promise<{ id?: string; path: string; mimeType?: string }>;
  /** The note `id`'s attachments as the hub lists them ({path: `<date>/<file>`, mimeType}). Absent (with `file`): no
   *  file is handed to the applet, and `file` is not_granted. */
  attachments?(id: string): Promise<unknown>;
  /** The bytes of a file in the vault's storage (`<date>/<file>`). Asked only for one the hub lists as the note's own. */
  file?(path: string): Promise<Blob>;
  /** Attach a file already in the vault's storage (`<date>/<file>`) to the note `id`. Absent: attachFrom is not_granted. */
  attachPath?(id: string, path: string, mimeType: string): Promise<{ id?: string; path: string; mimeType?: string }>;
  /** A file the person picked, carried onto the note `id` in pieces (upload.ts), the note's `upload` field saying what
   *  landed. Absent: upload is not_granted. */
  upload?(id: string, file: ChosenFile, progress: (p: Progress) => void, closed: () => boolean): Promise<Manifest>;
};
type AttachParams = { noteId: string; bytes: ArrayBuffer; type: string; transcribe: boolean };
type FileParams = { id: string; path: string };
type AttachFromParams = { noteId: string; from: string; path: string };
type UploadParams = { noteId: string; file: string; id: string | null };
/** One refusal for a record outside the folders, one it can't find and a file not attached to it: none tells it more. */
const notAttached = () => new ContractError(ERROR_CODES.outOfScope, "only a file attached to a record it reads");
type FetchParams = { method: string; path: string; headers: Record<string, string>; body: string | null };
/** A list read in pages, kept by its words and the offset its last page ended at: where the hub was read to, the notes
 *  it kept past that page, and every note it has seen (each is listed once). */
type Resume = { at: number; ahead: (VaultNote & { path: string })[]; seen: Set<string>; time: number };

const MAX_BODY = 512 * 1024;
const NOTE_TTL_MS = 10_000;
const CACHE_MAX = 40;
const CACHE_MAX_CONTENT = 200_000;
// include_metadata (true, or a list of fields: either way, all of them) brings each note's tags and metadata (its fields):
// one ask per folder where the host can, else note by note as a tag filter is
const NOTES_PARAMS = ["path_prefix", "tag", "search", "limit", "id", "path", "include_content", "include_metadata", "order_by", "sort", "offset", "include_links"];
const NOTE_PARAMS = ["include_content", "include_links"];
/** The hub's query words beside the folder's: any of them asks the hub (`query`), the folder pinned. */
const HUB_WORDS = ["order_by", "sort", "offset", "include_links"];
/** `meta[field]` or `meta[field][op]` (`[in][]`, `[not_in][]` for a list): the hub's field filter. */
const META = /^meta\[([A-Za-z_][A-Za-z0-9_-]{0,63})\](?:\[(eq|ne|gt|gte|lt|lte|exists)\]|\[(in|not_in)\]\[\])?$/;
/** meta[...] values (a list's each value is one) */
const MAX_META = 40;
/** How far a list may page: the module reads the hub's pages up to offset + limit (see hubList). */
const MAX_OFFSET = 5_000;
/** The hub's page the module reads at a time, and how many more than asked it may read for the notes it drops. */
const HUB_PAGE = 200;
const HUB_PAGE_FULL = 50;
const EXTRA_PAGES = 3;
/** A list going on from where its last page stopped reads this many of the hub's rows again first. */
const RESUME_BACK = 5;
/** How long a list read in pages may wait between pages and still go on (a page refused for the read budget waits). */
const RESUME_TTL_MS = 60_000;
/** Lists going on at once, per applet. */
const RESUMES_MAX = 8;
/** What a list may be ordered by: when it was made or changed, or a field (never link_count: it counts links to notes
 *  outside the folders). */
const orderable = (v: string) => v === "updated_at" || v === "created_at" || (/^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(v) && v !== "link_count");
/** The tags a folder's notes carry are read this many at a time, and at most this many per folder (past that, the counts
 *  are of the first 5,000). */
const TAG_PAGE = 500;
const TAG_MAX = 5_000;
const VAULT_PARAMS = ["include_stats"];
const json = (status: number, statusText: string, data: unknown): FetchResult => {
  const body = JSON.stringify(data);
  return body.length > MAX_BODY
    ? { status: 413, statusText: "too_large", headers: { "content-type": "application/json" }, body: '{"error":"too_large"}' }
    : { status, statusText, headers: { "content-type": "application/json" }, body };
};
const fail = (status: number, code: ErrorCode | "not_found" | "method_not_allowed" | "conflict") => json(status, code, { error: code });
const notFound = () => fail(404, "not_found");
const safeRef = (ref: string) => ref.length > 0 && ref.length <= 300 && !/[\u0000-\u001f\\]/.test(ref) && !ref.split("/").some((s) => s === ".." || s === ".");
/** A path a write may name: plain segments (inScope checks those), no hidden character, no encoded dot or slash, not a code file. */
const writablePath = (p: unknown): p is string => typeof p === "string" && p.length <= 300 && !hasHidden(p) && !/%(?:2e|2f|5c|25)/i.test(p)
  && !CODE_PATH.test(p) && p.trim() === p && !p.split("/").some((s) => s.trim() !== s);
/** A note no applet may change: a code note (HTML, TSX, JSX: an applet's or a component's code), or one tagged `applet`,
 *  `component` or `parachute-pointer` (docs/design/EMBED.md), or a bundle record (and one under its older tag), an
 *  approval or the key list (docs/design/APP-RECORD.md). */
const GUARDED_TAGS = ["applet", "component", "parachute-pointer", "parachute-bundle", "parachute-app", "parachute-approval", "parachute-keys"];
export const isAppletCode = (n: VaultNote) => isCodeExtension(n)
  || (n.tags ?? []).some((t) => GUARDED_TAGS.some((g) => t === g || t.startsWith(`${g}/`)));
const bodyOf = (raw: string | null, keys: readonly string[], required: readonly string[]): Record<string, unknown> | null => {
  if (raw === null) return null;
  let b: unknown;
  try { b = JSON.parse(raw); } catch { return null; }
  if (!plain(b) || !hasOnly(b, keys) || !required.every((k) => k in b)) return null;
  return b;
};
/** A name the app keeps for itself: no applet changes a note that carries it. */
const appsOwnName = (t: string) => /^parachute/i.test(t) || GUARDED_TAGS.some((g) => t === g || t.startsWith(`${g}/`));
/** The names an applet may give or take away on a note at `path`: the types its card says it opens there. */
const namesFor = (opens: readonly Opens[], path: string | null | undefined) => new Set(opens.filter((o) => inScope([o.path], path)).map((o) => o.type));
const MAX_NAMES = 20;
/** A list of type or tag names: 1 to 100 plain characters each, no `#`, at most 20. Null when it isn't one. */
const namesOf = (v: unknown): string[] | null => Array.isArray(v) && v.length <= MAX_NAMES && v.every((t) => typeof t === "string" && t.length > 0 && t.length <= 100 && !hasHidden(t) && !t.includes("#") && t.trim() === t) ? v as string[] : null;
/** `{add?, remove?}` of names. Null when it isn't one. */
const changeOf = (v: unknown): NameChange | null => {
  if (!plain(v) || !hasOnly(v, ["add", "remove"])) return null;
  const add = v.add === undefined ? [] : namesOf(v.add), remove = v.remove === undefined ? [] : namesOf(v.remove);
  return add && remove ? { ...(add.length ? { add } : {}), ...(remove.length ? { remove } : {}) } : null;
};
const FIELD_KEY = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;
/** Fields no applet sets: `published` puts a note on the open web (the hub's /view). */
const KEPT_FIELDS = /^published$/i;
const fieldValue = (v: unknown): boolean => v === null || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v)) || (typeof v === "string" && v.length <= 10_000);
/** Fields an applet may set: a plain object of at most 50 keys, each a plain value or a list of them (null removes the key). */
const fieldsOf = (v: unknown): Record<string, unknown> | null => plain(v) && Object.keys(v).length <= 50
  && Object.entries(v).every(([k, x]) => FIELD_KEY.test(k) && !KEPT_FIELDS.test(k) && (fieldValue(x) || (Array.isArray(x) && x.length <= 100 && x.every((y) => y !== null && fieldValue(y))))) ? v : null;
const namesIn = (c: NameChange | undefined) => [...(c?.add ?? []), ...(c?.remove ?? [])];

const linkEnd = (e: LinkEnd) => ({ id: e.id, path: e.path ?? null, tags: e.tags ?? [], metadata: e.metadata ?? {}, createdAt: e.createdAt ?? null, updatedAt: e.updatedAt ?? null });
/** A note's links that stay inside the folders: the note at the other end is judged on its own path (one the hub
 *  doesn't name is left out), and only what it is told of that note (no link count). */
const linksIn = (n: VaultNote, prefixes: readonly string[]) => (n.links ?? []).flatMap((l) => {
  if (!l || typeof l !== "object") return [];
  const out = l.sourceId === n.id ? l.targetNote : l.targetId === n.id ? l.sourceNote : null;
  const here = l.sourceId === n.id ? l.sourceNote : l.targetNote;
  if (!out || !inScope(prefixes, out.path)) return [];
  return [{ sourceId: l.sourceId, targetId: l.targetId, relationship: l.relationship ?? null, metadata: l.metadata ?? {}, createdAt: l.createdAt ?? null,
    ...(l.sourceId === n.id ? { targetNote: linkEnd(out), ...(here ? { sourceNote: linkEnd({ ...here, path: n.path }) } : {}) } : { sourceNote: linkEnd(out), ...(here ? { targetNote: linkEnd({ ...here, path: n.path }) } : {}) }) }];
});
/** `links`: the folders its links are judged on (asked with include_links); null leaves links out. */
const publicNote = (n: VaultNote, content: boolean, links: readonly string[] | null = null) => {
  const out: Record<string, unknown> = { id: n.id, path: n.path ?? null, createdAt: n.createdAt ?? null, updatedAt: n.updatedAt ?? null, tags: n.tags ?? [], ...(n.types ? { types: n.types } : {}), metadata: n.metadata ?? {} };
  if (content) out.content = n.content ?? "";
  if (links) out.links = linksIn(n, links);
  return out;
};

/** `files`: the files picked on this screen by their handles (`app.pick({bytes: false})`); `emit`: an event to the frame
 *  (an upload's progress). */
export function createVaultModule(deps: VaultDeps, opts: { now?: () => number; opens?: readonly Opens[]; name?: string; files?: (handle: string) => ChosenFile | undefined; emit?: (event: string, data: unknown) => void } = {}): UniModule {
  const now = opts.now ?? Date.now;
  const opens = opts.opens ?? [];
  /** Each note's attachments as the hub listed them in the last 10 s: a note's pictures ask once, not once each. */
  const lists = attachmentLists((id) => deps.attachments!(id));
  const cache = new Map<string, { at: number; note: VaultNote }>();
  /** Where each list read in pages stopped, by its words and the offset its last page ended at (one folder, no search;
   *  the last few), kept a minute: its next page goes on from there. */
  const resumes = new Map<string, Resume>();
  /** Writes of its own so far: a list page that began before one keeps no resume (what it read may be older). */
  let writes = 0;
  const remember = (key: string, note: VaultNote) => {
    cache.delete(key);
    cache.set(key, { at: now(), note });
    while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
  };
  type Reads = Pick<VaultDeps, "listPaths" | "getNote" | "search" | "listFields" | "list" | "query">;
  /** Notes by ref, cached 10 s. Each underlying read costs one limiter token; a cache hit is free. A read from the kept
   *  copies (`d` is deps.kept) uses this cache too, and is never put in it (its copy may be older than the hub's). */
  async function getNote(ref: string, ctx: CallCtx, d: Reads = deps, links = false): Promise<VaultNote> {
    // with its links: asked each time (the cache keeps notes without them)
    if (links) { ctx.charge(1); return d.getNote(ref, { links: true }); }
    const hit = cache.get(ref);
    if (hit && now() - hit.at < NOTE_TTL_MS) return hit.note;
    if (d !== deps) { ctx.charge(1); return d.getNote(ref); }
    ctx.charge(1);
    const note = await deps.getNote(ref);
    if ((note.content?.length ?? 0) <= CACHE_MAX_CONTENT) { remember(ref, note); if (note.id && note.id !== ref) remember(note.id, note); }
    return note;
  }

  /** `links`: the folders its links are judged on, when asked with include_links. */
  async function lookup(ref: string, prefixes: string[], content: boolean, ctx: CallCtx, d: Reads = deps, links: readonly string[] | null = null) {
    if (!safeRef(ref)) return null;
    let note: VaultNote;
    try { note = await getNote(ref, ctx, d, !!links); } catch (e) { if (e instanceof ContractError) throw e; return null; }
    // Scope is judged on the note we got back, not on the key it was asked for by.
    return inScope(prefixes, note.path) ? publicNote(note, content, links) : null;
  }

  /** A list in the hub's own words (order_by, sort, offset, meta[...], include_links): asked of the hub one folder at a
   *  time with the folder pinned, each note judged again on its own path. The page is cut after that judging, never by
   *  the hub: the hub's folder is a case-blind string prefix (and a tag takes in its subtypes), so its limit and offset
   *  would count notes the applet never sees, and where a page ends would tell of them. It reads the hub's pages until
   *  it has offset + limit of its own (a bounded number), and is charged by what was asked, not by how many it read.
   *  A list read in pages (one folder, no search) goes on where its last page stopped, when the next asks for the offset
   *  that page ended at, with the same words, within a minute: the hub is read on from there (a few rows back, for a
   *  note removed meanwhile), not again from its first row, and it is charged for the page it asked for. It reads no
   *  further into the hub than a read from the start would, so with nothing changed it hands back just what that read
   *  would; each note comes once. A call that fails leaves where it was for a retry.
   *  Ordering by a field takes one folder (path_prefix, or a grant of one): two folders' fields can't be put together. */
  async function hubList(q: URLSearchParams, prefixes: string[], granted: string[], limit: number, content: boolean, ctx: CallCtx, d: Reads): Promise<FetchResult> {
    if (!d.query) return fail(400, "bad_params");
    const rawOrder = q.get("order_by"), rawSort = q.get("sort"), rawOffset = q.get("offset"), rawLinks = q.get("include_links");
    if (rawOrder !== null && !orderable(rawOrder)) return fail(400, "bad_params");
    if (rawSort !== null && rawSort !== "asc" && rawSort !== "desc") return fail(400, "bad_params");
    if (rawOffset !== null && (!/^\d{1,9}$/.test(rawOffset) || Number(rawOffset) > MAX_OFFSET)) return fail(400, "bad_params");
    if (rawLinks !== null && rawLinks !== "true" && rawLinks !== "false") return fail(400, "bad_params");
    const offset = rawOffset === null ? 0 : Number(rawOffset);
    const meta: [string, string][] = [];
    for (const [k, v] of q) {
      if (!META.test(k)) continue;
      if (v.length > 500 || hasHidden(v)) return fail(400, "bad_params");
      meta.push([k, v]);
    }
    if (meta.length > MAX_META) return fail(400, "bad_params");
    const search = q.get("search");
    if (search !== null && search.length > 500) return fail(400, "bad_params");
    // the hub's search ranks by itself and pages nothing (it drops offset and order_by): one page, as asked
    if (search && (rawOrder !== null || rawSort !== null || offset > 0)) return fail(400, "bad_params");
    // no order named: newest changed first, as every other list here
    const orderBy = rawOrder ?? "updated_at";
    const sort: "asc" | "desc" = rawSort === "desc" || (rawSort === null && rawOrder === null) ? "desc" : "asc";
    const byField = orderBy !== "updated_at" && orderBy !== "created_at";
    if (prefixes.length > 1 && byField) return fail(400, "bad_params");
    const links = rawLinks === "true";
    const tag = q.get("tag")?.replace(/^#/, "") || null;
    const want = offset + limit;
    // a search is one page, so it is read whole (bodies and links for the notes it keeps are read after, one by one);
    // a list's page with bodies or links is smaller (what the hub sends for it is bigger)
    const later = !!search && (content || links);
    const size = !later && (content || links) ? HUB_PAGE_FULL : HUB_PAGE;
    // the last page of this same list ended at this offset, a moment ago: go on from there
    const key = prefixes.length === 1 && !search ? JSON.stringify([prefixes[0], tag, content, links, orderBy, sort, meta, d === deps.kept]) : null;
    const slot = key !== null ? `${key}@${offset}` : null;
    const last = slot !== null ? resumes.get(slot) : undefined;
    const go = last && now() - last.time < RESUME_TTL_MS ? last : null;
    /** Where `mine` starts in its own list: 0, or the offset it goes on from. */
    const from = go ? offset : 0;
    // charged by what was asked: one page going on
    const pages = search ? 1 : Math.ceil((want - from) / size);
    // never further into the hub than a read of this page from the start goes (its pages and EXTRA_PAGES more): going on
    // hands back what that read would, no more
    const bound = ((search ? 1 : Math.ceil(want / size)) + EXTRA_PAGES) * size;
    // its own copy: a call that fails puts the resume back as it was, for the kit's retry
    const seen = new Set<string>(go?.seen);
    const writesAtStart = writes;
    const out: (VaultNote & { path: string })[] = [];
    try {
      for (const p of prefixes) {
        ctx.charge(pages);
        // taken once charged (before anything waits, so a second call for the same page reads from the start)
        if (go) resumes.delete(slot!);
        const mine: (VaultNote & { path: string })[] = go ? [...go.ahead] : [];
        // a few pages more than asked, for the notes the judging drops; then what it has
        // (past EXTRA_PAGES of notes it drops ahead of the last one asked for, a page comes back short, and a search's past
        // HUB_PAGE less its limit; and a note changed
        // while it reads moves to the front, so one other may be missed: a list read in pages, as any is)
        // where the hub was read to; going on, its first read starts RESUME_BACK rows back, so up to that many notes
        // removed behind it move none past it (each listed once; more, and as many past RESUME_BACK are missed until the
        // list is read again, as a read from the start misses one for each note removed before its page)
        let at = go ? go.at : 0;
        for (let first = true; from + mine.length < want && at < bound; first = false) {
          const asked = go && first ? Math.max(0, at - RESUME_BACK) : at;
          const lim = Math.min(size, bound - asked);
          // a search too is asked for a whole page and cut after judging: the hub ranks it and drops offset, never limit
          const rows = await d.query(p, { limit: lim, offset: asked, tag, search: search || null, content: content && !later, links: links && !later, orderBy, sort, meta });
          at = Math.max(at, asked + rows.length);
          for (const n of rows) {
            if (!n || !n.path || seen.has(n.id) || !inScope(prefixes, n.path) || codeKindOf(n) !== null || (tag && !(n.tags ?? []).includes(tag))) continue;
            seen.add(n.id); mine.push(n as VaultNote & { path: string });
          }
          if (search || rows.length < lim) break;
        }
        out.push(...mine.slice(0, want - from));
        // a page that came back short: where its list stands isn't the offset the next page will ask for; that one
        // reads from the start
        if (key !== null && from + mine.length >= want && writes === writesAtStart) {
          const next = `${key}@${want}`;
          resumes.delete(next);
          for (const [k, r] of resumes) if (now() - r.time >= RESUME_TTL_MS) resumes.delete(k);
          resumes.set(next, { at, ahead: mine.slice(want - from), seen, time: now() });
          while (resumes.size > RESUMES_MAX) resumes.delete(resumes.keys().next().value as string);
        }
      }
    } catch (e) {
      if (go && slot !== null && !resumes.has(slot) && writes === writesAtStart) {
        resumes.set(slot, go);
        while (resumes.size > RESUMES_MAX) resumes.delete(resumes.keys().next().value as string);
      }
      if (e instanceof ContractError) throw e;
      // the hub refusing the words (on 0.8, a field it doesn't index): the applet's to fix, not a failure
      return (e as { status?: number })?.status === 400 ? fail(400, "bad_params") : fail(502, "failed");
    }
    // two folders, one order: put together as the hub ordered each (by when made or changed), ties by id as the hub breaks them
    if (prefixes.length > 1) {
      const key = orderBy === "created_at" ? "createdAt" : "updatedAt";
      const dir = sort === "desc" ? -1 : 1;
      out.sort((a, b) => dir * ((a[key] ?? "").localeCompare(b[key] ?? "") || a.id.localeCompare(b.id)));
    }
    // bodies and links read one by one after a search: at most maxScan of them, as a search with bodies always was
    let page = out.slice(offset - from, (later ? Math.min(want, offset + LIMITS.maxScan) : want) - from);
    if (later) {
      const full: (VaultNote & { path: string })[] = [];
      for (const n of page) {
        try { const x = await getNote(n.id, ctx, d, links); if (inScope(prefixes, x.path)) full.push({ ...x, path: x.path as string }); } catch (e) { if (e instanceof ContractError) throw e; }
      }
      page = full;
    }
    return json(200, "OK", page.map((n) => publicNote(n, content, links ? granted : null)));
  }

  /** GET /api/tags: the tags on the notes in its folders, each with how many of those notes carry it. Never the vault's
   *  own list: a tag only on notes outside the folders isn't named. */
  async function tags(q: URLSearchParams, granted: string[], ctx: CallCtx, d: Reads): Promise<FetchResult> {
    if ([...q.keys()].length) return fail(400, "bad_params");
    if (!d.query) return fail(400, "bad_params");
    const counts = new Map<string, number>();
    const seen = new Set<string>();
    try {
      for (const p of granted) {
        // charged once a folder, whatever it holds: how many pages it took mustn't tell of notes it then drops
        ctx.charge(1);
        for (let offset = 0; offset < TAG_MAX; offset += TAG_PAGE) {
          const page = await d.query(p, { limit: TAG_PAGE, offset, tag: null, search: null, content: false, links: false, orderBy: "updated_at", sort: "asc", meta: [] });
          for (const n of page) {
            if (!n || !n.path || seen.has(n.id) || !inScope(granted, n.path) || codeKindOf(n) !== null) continue;
            seen.add(n.id);
            for (const t of new Set([...(n.tags ?? []), ...(n.types ?? [])])) if (typeof t === "string" && t) counts.set(t, (counts.get(t) ?? 0) + 1);
          }
          if (page.length < TAG_PAGE) break;
        }
      }
    } catch (e) {
      if (e instanceof ContractError) throw e;
      return fail(502, "failed");
    }
    return json(200, "OK", [...counts].sort((a, b) => a[0].localeCompare(b[0])).map(([name, count]) => ({ name, count })));
  }

  async function notes(q: URLSearchParams, granted: string[], ctx: CallCtx, d: Reads = deps): Promise<FetchResult> {
    for (const k of q.keys()) if (!NOTES_PARAMS.includes(k) && !META.test(k)) return fail(400, "bad_params");
    let prefixes = granted;
    const asked = q.get("path_prefix");
    if (asked) {
      const sp = safePrefix(asked);
      if (!sp || !granted.some((g) => sp.startsWith(g))) return fail(403, "out_of_scope");
      prefixes = [sp];
    }
    const rawLimit = q.get("limit");
    let limit: number = LIMITS.maxNotes;
    if (rawLimit !== null) {
      if (!/^\d{1,9}$/.test(rawLimit) || Number(rawLimit) < 1) return fail(400, "bad_params");
      limit = Math.min(LIMITS.maxNotes, Number(rawLimit));
    }
    const content = q.get("include_content") === "true";
    const fields = q.has("include_metadata") && q.get("include_metadata") !== "false";

    const key = q.get("id") ?? q.get("path");
    if (key !== null) {
      const links = q.get("include_links");
      if (links !== null && links !== "true" && links !== "false") return fail(400, "bad_params");
      const n = await lookup(key, prefixes, content, ctx, d, links === "true" ? granted : null);
      return json(200, "OK", n ? [n] : []);
    }
    if (HUB_WORDS.some((k) => q.has(k)) || [...q.keys()].some((k) => META.test(k))) return hubList(q, prefixes, granted, limit, content, ctx, d);
    const tagAsked = q.get("tag")?.replace(/^#/, "") || null;
    // a tag or the notes' content, without a search: one ask per granted folder, the hub filtering by tag (each note
    // still judged on its own path and tags, as any list is). Read note by note (below) where the host can't.
    if ((tagAsked || content) && !q.get("search") && d.list) {
      const got = await (async () => {
        const seen = new Set<string>();
        const out: (VaultNote & { path: string })[] = [];
        for (const p of prefixes) {
          ctx.charge(1);
          for (const n of await d.list!(p, { limit, tag: tagAsked, content })) {
            if (!n.path || seen.has(n.id) || !inScope(prefixes, n.path) || codeKindOf(n) !== null || (tagAsked && !(n.tags ?? []).includes(tagAsked))) continue;
            seen.add(n.id); out.push(n as VaultNote & { path: string });
          }
        }
        return out;
      })().catch((e: unknown) => { if (e instanceof ContractError) throw e; return null; });
      if (got) {
        got.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "") || a.path.localeCompare(b.path));
        return json(200, "OK", got.slice(0, limit).map((n) => publicNote(n, content)));
      }
    }

    const tag = q.get("tag")?.replace(/^#/, "") || null;
    const search = q.get("search");
    let rows: { id: string; path: string; updatedAt?: string | null }[];
    if (search) {
      if (search.length > 500) return fail(400, "bad_params");
      const seen = new Set<string>();
      rows = [];
      for (const p of prefixes) {
        ctx.charge(1);
        for (const h of await d.search(search, limit, p)) {
          if (h.path && inScope(prefixes, h.path) && !seen.has(h.id)) { seen.add(h.id); rows.push({ id: h.id, path: h.path }); }
        }
      }
    } else if (fields && !tag && !content && d.listFields) {
      // one ask per granted folder, each note judged on its own path, as any list is
      const seen = new Set<string>();
      const out: (VaultNote & { path: string })[] = [];
      for (const p of prefixes) {
        ctx.charge(1);
        for (const n of await d.listFields(p, LIMITS.maxNotes)) {
          if (!n.path || seen.has(n.id) || !inScope(prefixes, n.path) || codeKindOf(n) !== null) continue;
          seen.add(n.id); out.push(n as VaultNote & { path: string });
        }
      }
      out.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "") || a.path.localeCompare(b.path));
      return json(200, "OK", out.slice(0, limit).map((n) => publicNote(n, false)));
    } else {
      rows = (await d.listPaths())
        .filter((r): r is PathRow & { path: string } => !!r.path && inScope(prefixes, r.path) && codeKindOf(r) === null)
        .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "") || a.path.localeCompare(b.path));
    }
    if (tag || content || fields) {
      // Tags and bodies need the notes themselves (the deps expose no tag filter, so
      // this is a bounded scan): read at most maxScan, charge each read, judge scope again on what comes back.
      const out: Record<string, unknown>[] = [];
      for (const r of rows.slice(0, LIMITS.maxScan)) {
        if (out.length >= limit) break;
        let note: VaultNote;
        try { note = await getNote(r.id, ctx, d); } catch (e) { if (e instanceof ContractError) throw e; continue; }
        if (!inScope(prefixes, note.path) || (tag && !(note.tags ?? []).includes(tag))) continue;
        out.push(publicNote(note, content));
      }
      return json(200, "OK", out);
    }
    return json(200, "OK", rows.slice(0, limit).map((r) => ({ id: r.id, path: r.path, updatedAt: r.updatedAt ?? null })));
  }

  // a write of its own: the notes it keeps for its lists going on may be older now, so those lists read from the start
  const forget = (...refs: (string | null | undefined)[]) => { for (const r of refs) if (r) cache.delete(r); resumes.clear(); writes++; };

  /** POST /api/notes {path, content, types?, tags?, metadata?}: a new record inside a folder the grant lets it add to. */
  async function create(body: string | null, scopes: Resolved, ctx: CallCtx): Promise<FetchResult> {
    const folders = scopes["vault.create"] ?? [];
    if (!folders.length || !deps.create) return fail(403, "not_granted");
    const b = bodyOf(body, ["path", "content", "types", "tags", "metadata"], ["path", "content"]);
    if (!b || !writablePath(b.path) || typeof b.content !== "string") return fail(400, "bad_params");
    const types = b.types === undefined ? [] : namesOf(b.types), tags = b.tags === undefined ? [] : namesOf(b.tags);
    const metadata = b.metadata === undefined ? undefined : fieldsOf(b.metadata);
    if (!types || !tags || metadata === null) return fail(400, "bad_params");
    if (!inScope(folders, b.path)) return fail(403, "out_of_scope");
    const named = namesFor(opens, b.path);
    if ([...types, ...tags].some((t) => !named.has(t) || appsOwnName(t))) return fail(403, "not_granted");
    if (ctx.closed()) return fail(502, "failed");
    ctx.charge(1);
    try {
      const note = await deps.create(b.path, b.content, [...new Set([...tagsFor(opens, b.path), ...tags])],
        types.length || (metadata && Object.keys(metadata).length) ? { ...(types.length ? { types } : {}), ...(metadata && Object.keys(metadata).length ? { metadata } : {}) } : undefined);
      forget(note.id, note.path, b.path);
      return json(201, "Created", publicNote({ ...note, path: note.path ?? b.path }, false));
    } catch (e) {
      if (e instanceof ContractError) throw e;
      return /exist|conflict/i.test(String(e)) ? fail(409, "conflict") : fail(502, "failed");
    }
  }

  /** PATCH /api/notes/:ref {if_updated_at, content?, metadata?, types?, tags?}: a change to a record inside a folder
   *  the grant lets it change, in one call, judged on the note as read now. */
  async function update(ref: string, body: string | null, scopes: Resolved, ctx: CallCtx): Promise<FetchResult> {
    const folders = scopes["vault.update"] ?? [];
    if (!folders.length || !deps.save) return fail(403, "not_granted");
    const b = bodyOf(body, ["content", "if_updated_at", "metadata", "types", "tags"], ["if_updated_at"]);
    if (!b || typeof b.if_updated_at !== "string" || !b.if_updated_at || (b.content !== undefined && typeof b.content !== "string")) return fail(400, "bad_params");
    const metadata = b.metadata === undefined ? undefined : fieldsOf(b.metadata);
    const types = b.types === undefined ? undefined : changeOf(b.types), tags = b.tags === undefined ? undefined : changeOf(b.tags);
    if (metadata === null || types === null || tags === null) return fail(400, "bad_params");
    const more: RecordChange = { ...(metadata && Object.keys(metadata).length ? { metadata } : {}), ...(types && namesIn(types).length ? { types } : {}), ...(tags && namesIn(tags).length ? { tags } : {}) };
    const typed = Object.keys(more).length > 0;
    if (b.content === undefined && !typed) return fail(400, "bad_params");
    if (!safeRef(ref)) return notFound();
    ctx.charge(1);
    let note: VaultNote;
    try { note = await deps.getNote(ref); } catch (e) { if (e instanceof ContractError) throw e; return notFound(); }
    // a note it can't even read is absent (no existence oracle); one it reads but may not change is refused
    if (!inScope(folders, note.path) || isAppletCode(note)) return inScope(scopes["vault.read"] ?? [], note.path) ? fail(403, "out_of_scope") : notFound();
    // the app's own notes (its settings) keep their fields and names
    if (typed && [...(note.tags ?? []), ...(note.types ?? [])].some(appsOwnName)) return fail(403, "out_of_scope");
    const named = namesFor(opens, note.path);
    if ([...namesIn(more.types), ...namesIn(more.tags)].some((t) => !named.has(t) || appsOwnName(t))) return fail(403, "not_granted");
    if (ctx.closed()) return fail(502, "failed");
    try {
      const saved = await deps.save(note.id, b.content as string | undefined, b.if_updated_at, typed ? more : undefined);
      forget(ref, note.id, note.path, saved.id, saved.path);
      return json(200, "OK", publicNote({ ...saved, path: saved.path ?? note.path }, false));
    } catch (e) {
      if (e instanceof ContractError) throw e;
      return /^(error:\s*)?conflict:/i.test(String(e)) ? fail(409, "conflict") : fail(502, "failed");
    }
  }

  return {
    namespace: "vault",
    methods: {
      attach: {
        cap: "vault.update",
        validate: (p: unknown) => {
          if (!plain(p) || !hasOnly(p, ["noteId", "bytes", "type", "transcribe"]) || typeof p.noteId !== "string" || !safeRef(p.noteId)) return { ok: false };
          const type = mediaType(p.type);
          if (!type || !(p.bytes instanceof ArrayBuffer) || !p.bytes.byteLength || p.bytes.byteLength > FILE_MAX || (p.transcribe !== undefined && typeof p.transcribe !== "boolean")) return { ok: false };
          return { ok: true, value: { noteId: p.noteId, bytes: p.bytes, type, transcribe: p.transcribe === true } };
        },
        async run(v: AttachParams, scopes, ctx) {
          if (!deps.attach) throw new ContractError(ERROR_CODES.notGranted, "this vault takes no files from applets here");
          const folders = scopes["vault.update"] ?? [];
          ctx.charge(1);
          let note: VaultNote;
          try { note = await deps.getNote(v.noteId); } catch (e) { if (e instanceof ContractError) throw e; throw new ContractError(ERROR_CODES.outOfScope, "it may attach files only to notes it may change"); }
          // judged as a PATCH is: on the note as read now, never a code note or one the app guards
          if (!inScope(folders, note.path) || isAppletCode(note)) throw new ContractError(ERROR_CODES.outOfScope, "it may attach files only to notes it may change");
          if (ctx.closed()) throw new ContractError(ERROR_CODES.failed);
          const a = await deps.attach(note.id, v.bytes, v.type, v.transcribe).catch((e: unknown) => { throw new ContractError(ERROR_CODES.failed, `the vault didn't take it: ${e instanceof Error ? e.message.slice(0, 200) : "it failed"}`); });
          forget(v.noteId, note.id, note.path);
          lists.forget(note.id);
          return { id: a.id ?? null, path: a.path, type: a.mimeType ?? v.type, transcribe: v.transcribe };
        },
      },
      // a file the person picked on this screen (its handle), carried onto a note it may change, judged as attach is;
      // `id` names its progress events (`vault.upload` {id, sent, size}). The applet never holds the bytes.
      upload: {
        cap: "vault.update",
        validate: (p: unknown) => (plain(p) && hasOnly(p, ["noteId", "file", "id"]) && typeof p.noteId === "string" && safeRef(p.noteId)
          && typeof p.file === "string" && /^f\d{1,9}$/.test(p.file) && (p.id === undefined || (typeof p.id === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(p.id)))
          ? { ok: true, value: { noteId: p.noteId, file: p.file, id: typeof p.id === "string" ? p.id : null } } : { ok: false }),
        async run(v: UploadParams, scopes, ctx) {
          if (!deps.upload || !opts.files) throw new ContractError(ERROR_CODES.notGranted, "this vault takes no files from applets here");
          const chosen = opts.files(v.file);
          if (!chosen) throw new ContractError(ERROR_CODES.outOfScope, "only a file picked on this screen");
          ctx.charge(1);
          let note: VaultNote;
          try { note = await deps.getNote(v.noteId); } catch (e) { if (e instanceof ContractError) throw e; throw new ContractError(ERROR_CODES.outOfScope, "it may attach files only to notes it may change"); }
          if (!inScope(scopes["vault.update"] ?? [], note.path) || isAppletCode(note)) throw new ContractError(ERROR_CODES.outOfScope, "it may attach files only to notes it may change");
          if (ctx.closed()) throw new ContractError(ERROR_CODES.failed);
          const say = (p: Progress) => { if (v.id && !ctx.closed()) opts.emit?.("vault.upload", { id: v.id, sent: p.sent, size: p.size }); };
          try {
            return await deps.upload(note.id, chosen, say, ctx.closed);
          } catch (e) {
            throw new ContractError(ERROR_CODES.failed, `the vault didn't take it: ${e instanceof Error ? e.message.slice(0, 200) : "it failed"}`);
          } finally {
            forget(v.noteId, note.id, note.path);
            lists.forget(note.id);
          }
        },
      },
      attachFrom: {
        cap: "vault.update",
        validate: (p: unknown) => (plain(p) && hasOnly(p, ["noteId", "from", "path"]) && typeof p.noteId === "string" && safeRef(p.noteId)
          && typeof p.from === "string" && safeRef(p.from) && typeof p.path === "string" ? { ok: true, value: { noteId: p.noteId, from: p.from, path: p.path } } : { ok: false }),
        async run(v: AttachFromParams, scopes, ctx) {
          const want = storagePath(v.path);
          if (!want) throw notAttached();
          if (!deps.attachments || !deps.attachPath) throw new ContractError(ERROR_CODES.notGranted, "this vault takes no files from applets here");
          // the file: one attached to a record it reads, as the hub lists it now
          ctx.charge(1);
          let from: VaultNote;
          try { from = await deps.getNote(v.from); } catch (e) { if (e instanceof ContractError) throw e; throw notAttached(); }
          if (!inScope(scopes["vault.read"] ?? [], from.path)) throw notAttached();
          let had: unknown[];
          try { had = await lists(from.id, () => ctx.charge(1), true); } catch (e) { if (e instanceof ContractError) throw e; throw new ContractError(ERROR_CODES.failed); }
          // a picture only: one it could read itself (vault.file), never a document carried to a record others may see
          const att = had.find((a): a is Record<string, unknown> => plain(a) && a.path === want);
          const type = att && listedPicture(att, want);
          if (!att || !type) throw notAttached();
          // the record it goes onto: judged as attach is, on the note as read now
          ctx.charge(1);
          let note: VaultNote;
          try { note = await deps.getNote(v.noteId); } catch (e) { if (e instanceof ContractError) throw e; throw new ContractError(ERROR_CODES.outOfScope, "it may attach files only to notes it may change"); }
          if (!inScope(scopes["vault.update"] ?? [], note.path) || isAppletCode(note)) throw new ContractError(ERROR_CODES.outOfScope, "it may attach files only to notes it may change");
          // there already: nothing to do (a save that attaches each time it is made stays one attachment)
          let has: unknown[];
          try { has = await lists(note.id, () => ctx.charge(1), true); } catch (e) { if (e instanceof ContractError) throw e; throw new ContractError(ERROR_CODES.failed); }
          const there = has.find((a): a is Record<string, unknown> => plain(a) && a.path === want);
          if (there) return { id: typeof there.id === "string" ? there.id : null, path: want, type };
          if (ctx.closed()) throw new ContractError(ERROR_CODES.failed);
          const a = await deps.attachPath(note.id, want, type).catch((e: unknown) => { throw new ContractError(ERROR_CODES.failed, `the vault didn't take it: ${e instanceof Error ? e.message.slice(0, 200) : "it failed"}`); });
          forget(v.noteId, note.id, note.path);
          lists.forget(note.id);
          return { id: a.id ?? null, path: a.path ?? want, type: a.mimeType ?? type };
        },
      },
      file: {
        cap: "vault.read",
        validate: (p: unknown) => (plain(p) && hasOnly(p, ["id", "path"]) && typeof p.id === "string" && safeRef(p.id) && typeof p.path === "string"
          ? { ok: true, value: { id: p.id, path: p.path } } : { ok: false }),
        // no more reach than a read: a picture the hub lists as attached to a note in its folders, judged on the note
        // as the hub gives it back (whatever it was asked for by), under the sign-in its reads use
        async run({ id, path }: FileParams, scopes, ctx) {
          // each call costs one, as vaults.file does: the bytes are read every time, whatever is kept
          ctx.charge(1);
          const want = storagePath(path);
          if (!want) throw notAttached();
          if (!deps.attachments || !deps.file) throw new ContractError(ERROR_CODES.notGranted, "this screen hands over no files");
          let note: VaultNote;
          try { note = await getNote(id, ctx); } catch (e) { if (e instanceof ContractError) throw e; throw notAttached(); }
          if (!inScope(scopes["vault.read"] ?? [], note.path)) throw notAttached();
          let list: unknown[];
          try { list = await lists(note.id, () => ctx.charge(1)); } catch (e) { if (e instanceof ContractError) throw e; throw new ContractError(ERROR_CODES.failed); }
          return attachedMedia(want, list, (p) => deps.file!(p), (e) => (e instanceof ContractError ? e : new ContractError(ERROR_CODES.failed)));
        },
      },
      fetch: {
        // each method its own grant, checked below: a read needs `vault.read`, a new record `vault.create`, a change
        // `vault.update`. (It was `vault.read` for all, so an applet granted only to add, Home's line into Inbox/, was
        // refused every write.)
        cap: null,
        validate: (p: unknown) => {
          const o = p as FetchParams | null;
          return o && typeof o === "object" && typeof o.method === "string" && typeof o.path === "string" ? { ok: true, value: o } : { ok: false };
        },
        async run(req: FetchParams, scopes, ctx) {
          const granted = scopes["vault.read"] ?? [];
          if (req.method !== "GET" && req.method !== "POST" && req.method !== "PATCH") return fail(405, "method_not_allowed");
          if (req.method === "GET" && !granted.length) return fail(403, "not_granted");
          if (!req.path.startsWith("/") || req.path.startsWith("//") || /[\\\u0000-\u001f]/.test(req.path)) return fail(400, "bad_request" as ErrorCode);
          const cut = req.path.indexOf("?");
          const pathname = cut < 0 ? req.path : req.path.slice(0, cut);
          const query = new URLSearchParams(cut < 0 ? "" : req.path.slice(cut + 1));
          try {
            const only = (allowed: string[]) => [...query.keys()].every((k) => allowed.includes(k));
            if (req.method === "POST") return pathname === "/api/notes" && only([]) ? await create(req.body, scopes, ctx) : fail(405, "method_not_allowed");
            if (req.method === "PATCH") {
              const rest = pathname.startsWith("/api/notes/") ? pathname.slice("/api/notes/".length) : "";
              if (!rest || rest.includes("/") || !only([])) return fail(405, "method_not_allowed");
              let ref: string;
              try { ref = decodeURIComponent(rest); } catch { return fail(400, "bad_request" as ErrorCode); }
              return await update(ref, req.body, scopes, ctx);
            }
            if (pathname === "/api/vault") return only(VAULT_PARAMS) ? json(200, "OK", { name: opts.name ?? "vault", scope: granted }) : fail(400, "bad_params");
            // a frame that draws itself again when told (the kit's onFresh) may be answered from the kept copies
            const d: Reads = req.method === "GET" && req.headers?.["x-parachute-redraws"] === "1" && deps.kept ? deps.kept : deps;
            if (pathname === "/api/notes") return await notes(query, granted, ctx, d);
            if (pathname === "/api/tags") return await tags(query, granted, ctx, d);
            if (pathname.startsWith("/api/notes/")) {
              const rest = pathname.slice("/api/notes/".length);
              if (!rest || rest.includes("/")) return notFound();
              let ref: string;
              try { ref = decodeURIComponent(rest); } catch { return fail(400, "bad_request" as ErrorCode); }
              if (!only(NOTE_PARAMS)) return fail(400, "bad_params");
              const links = query.get("include_links");
              if (links !== null && links !== "true" && links !== "false") return fail(400, "bad_params");
              const n = await lookup(ref, granted, true, ctx, d, links === "true" ? granted : null);
              return n ? json(200, "OK", n) : notFound();
            }
            return notFound();
          } catch (e) {
            if (e instanceof ContractError && e.code === ERROR_CODES.rateLimited) return fail(429, "rate_limited");
            return fail(502, "failed");
          }
        },
      },
    },
  };
}
