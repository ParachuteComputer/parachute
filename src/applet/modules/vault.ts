// vault module (copied from the Uni app's src/interface/modules/vault.ts): a REST subset compatible with surface-client's VaultClient,
// served over the frame. Every read is checked against the granted
// `vault.read` path prefixes, and so is every note that comes back (whatever
// key it was looked up by), so search, tag and id lookups can't leak.
//   GET   /api/vault
//   GET   /api/notes?path_prefix&tag&search&limit&id&path&include_content
//   GET   /api/notes/:idOrPath
// Two writes, only for a grant that names them (a contract 2 sealed manifest):
//   POST  /api/notes            {path, content, types?, tags?, metadata?}   a new record, its path inside a `vault.create` folder
//   PATCH /api/notes/:idOrPath  {if_updated_at, content?, metadata?, types?: {add?, remove?}, tags?: {add?, remove?}}
//                                                          a change to a record inside a `vault.update` folder, in one call
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

import { CODE_PATH, codeKindOf, isCodeExtension } from "../code.ts";
import { FILE_MAX, mediaType } from "../files.ts";
import { ContractError, ERROR_CODES, hasHidden, hasOnly, inScope, LIMITS, plain, safePrefix, type ErrorCode } from "../contract.ts";
import type { CallCtx, UniModule } from "../router.ts";
import type { Resolved } from "../needs.ts";
import { tagsFor, type Opens } from "../opens.ts";
import type { FetchResult } from "./frameFetch.ts";

export type PathRow = { id: string; path: string | null; extension?: string | null; updatedAt?: string | null };
export type VaultNote = { id: string; path?: string | null; extension?: string | null; content?: string | null; tags?: string[] | null; types?: string[] | null; metadata?: Record<string, unknown> | null; createdAt?: string | null; updatedAt?: string | null };
/** A change to a record's types or tags: names to add and to remove. */
export type NameChange = { add?: string[]; remove?: string[] };
/** What a typed write sets beside the text: fields (merged; null removes a key), types and tags. */
export type RecordChange = { metadata?: Record<string, unknown>; types?: NameChange; tags?: NameChange };
export type VaultDeps = {
  listPaths(): Promise<PathRow[]>;
  /** By id or path; rejects when missing. */
  getNote(ref: string): Promise<VaultNote>;
  search(query: string, limit: number, pathPrefix: string | null): Promise<{ id: string; path: string | null; snippet: string }[]>;
  /** The newest notes under a folder with their tags and metadata, no content, in one ask. Absent: fields are read note by note. */
  listFields?(pathPrefix: string, limit: number): Promise<VaultNote[]>;
  /** A new note at `path` with these tags, and these types and fields (refused when one is there). Absent: the host can't write, and every write is 405. */
  create?(path: string, content: string, tags: string[], more?: { types?: string[]; metadata?: Record<string, unknown> }): Promise<VaultNote>;
  /** A change to the note `id` (new content, when given, and `more`), only if it is still at `ifUpdatedAt`; a rejection whose message starts "conflict:" is a conflict. */
  save?(id: string, content: string | undefined, ifUpdatedAt: string, more?: RecordChange): Promise<VaultNote>;
  /** Upload the bytes to the vault's storage and attach them to the note `id`. Absent: the host can't, and attach is not_granted. */
  attach?(id: string, bytes: ArrayBuffer, type: string, transcribe: boolean): Promise<{ id?: string; path: string; mimeType?: string }>;
};
type AttachParams = { noteId: string; bytes: ArrayBuffer; type: string; transcribe: boolean };
type FetchParams = { method: string; path: string; headers: Record<string, string>; body: string | null };

const MAX_BODY = 512 * 1024;
const NOTE_TTL_MS = 10_000;
const CACHE_MAX = 40;
const CACHE_MAX_CONTENT = 200_000;
// include_metadata (true, or a list of fields: either way, all of them) brings each note's tags and metadata (its fields):
// one ask per folder where the host can, else note by note as a tag filter is
const NOTES_PARAMS = ["path_prefix", "tag", "search", "limit", "id", "path", "include_content", "include_metadata"];
const NOTE_PARAMS = ["include_content"];
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

const publicNote = (n: VaultNote, content: boolean) => {
  const out: Record<string, unknown> = { id: n.id, path: n.path ?? null, createdAt: n.createdAt ?? null, updatedAt: n.updatedAt ?? null, tags: n.tags ?? [], ...(n.types ? { types: n.types } : {}), metadata: n.metadata ?? {} };
  if (content) out.content = n.content ?? "";
  return out;
};

export function createVaultModule(deps: VaultDeps, opts: { now?: () => number; opens?: readonly Opens[]; name?: string } = {}): UniModule {
  const now = opts.now ?? Date.now;
  const opens = opts.opens ?? [];
  const cache = new Map<string, { at: number; note: VaultNote }>();
  const remember = (key: string, note: VaultNote) => {
    cache.delete(key);
    cache.set(key, { at: now(), note });
    while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
  };
  /** Notes by ref, cached 10 s. Each underlying read costs one limiter token; a cache hit is free. */
  async function getNote(ref: string, ctx: CallCtx): Promise<VaultNote> {
    const hit = cache.get(ref);
    if (hit && now() - hit.at < NOTE_TTL_MS) return hit.note;
    ctx.charge(1);
    const note = await deps.getNote(ref);
    if ((note.content?.length ?? 0) <= CACHE_MAX_CONTENT) { remember(ref, note); if (note.id && note.id !== ref) remember(note.id, note); }
    return note;
  }

  async function lookup(ref: string, prefixes: string[], content: boolean, ctx: CallCtx) {
    if (!safeRef(ref)) return null;
    let note: VaultNote;
    try { note = await getNote(ref, ctx); } catch (e) { if (e instanceof ContractError) throw e; return null; }
    // Scope is judged on the note we got back, not on the key it was asked for by.
    return inScope(prefixes, note.path) ? publicNote(note, content) : null;
  }

  async function notes(q: URLSearchParams, granted: string[], ctx: CallCtx): Promise<FetchResult> {
    for (const k of q.keys()) if (!NOTES_PARAMS.includes(k)) return fail(400, "bad_params");
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
      const n = await lookup(key, prefixes, content, ctx);
      return json(200, "OK", n ? [n] : []);
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
        for (const h of await deps.search(search, limit, p)) {
          if (h.path && inScope(prefixes, h.path) && !seen.has(h.id)) { seen.add(h.id); rows.push({ id: h.id, path: h.path }); }
        }
      }
    } else if (fields && !tag && !content && deps.listFields) {
      // one ask per granted folder, each note judged on its own path, as any list is
      const seen = new Set<string>();
      const out: (VaultNote & { path: string })[] = [];
      for (const p of prefixes) {
        ctx.charge(1);
        for (const n of await deps.listFields(p, LIMITS.maxNotes)) {
          if (!n.path || seen.has(n.id) || !inScope(prefixes, n.path) || codeKindOf(n) !== null) continue;
          seen.add(n.id); out.push(n as VaultNote & { path: string });
        }
      }
      out.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "") || a.path.localeCompare(b.path));
      return json(200, "OK", out.slice(0, limit).map((n) => publicNote(n, false)));
    } else {
      rows = (await deps.listPaths())
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
        try { note = await getNote(r.id, ctx); } catch (e) { if (e instanceof ContractError) throw e; continue; }
        if (!inScope(prefixes, note.path) || (tag && !(note.tags ?? []).includes(tag))) continue;
        out.push(publicNote(note, content));
      }
      return json(200, "OK", out);
    }
    return json(200, "OK", rows.slice(0, limit).map((r) => ({ id: r.id, path: r.path, updatedAt: r.updatedAt ?? null })));
  }

  const forget = (...refs: (string | null | undefined)[]) => { for (const r of refs) if (r) cache.delete(r); };

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
          return { id: a.id ?? null, path: a.path, type: a.mimeType ?? v.type, transcribe: v.transcribe };
        },
      },
      fetch: {
        cap: "vault.read",
        validate: (p: unknown) => {
          const o = p as FetchParams | null;
          return o && typeof o === "object" && typeof o.method === "string" && typeof o.path === "string" ? { ok: true, value: o } : { ok: false };
        },
        async run(req: FetchParams, scopes, ctx) {
          const granted = scopes["vault.read"] ?? [];
          if (req.method !== "GET" && req.method !== "POST" && req.method !== "PATCH") return fail(405, "method_not_allowed");
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
            if (pathname === "/api/notes") return await notes(query, granted, ctx);
            if (pathname.startsWith("/api/notes/")) {
              const rest = pathname.slice("/api/notes/".length);
              if (!rest || rest.includes("/")) return notFound();
              let ref: string;
              try { ref = decodeURIComponent(rest); } catch { return fail(400, "bad_request" as ErrorCode); }
              if (!only(NOTE_PARAMS)) return fail(400, "bad_params");
              const n = await lookup(ref, granted, true, ctx);
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
