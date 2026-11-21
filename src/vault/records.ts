// The record door. Core 0.9 serves a vault's records at `/api/records` (record words: `body`, `fields`, `records`,
// `types` beside `tags`), and `/api/notes` goes away in 1.0. surface-client's VaultClient speaks only `/api/notes`, so
// this app hands it a fetch that sends every notes call to the record door instead, in record words, and turns the
// answer back into the note shape the app reads. A hub without the door (0.8) gets the call as it was.
//
//   detect    once per vault: `GET <vault>/api/records?limit=1`. 200 is the door; 404 is no door. Anything
//             else (no network, a refused token) decides nothing: that call goes to /api/notes, and the next one asks
//             again. A missing record is also a 404 on the door, so a 404 is only read as "no door" on this probe. A 405, or a 200
//             that isn't JSON (a proxy's page for any address), is no door too; only a JSON 200 is the door.
//   words     in: content→body, metadata→fields, notes→records, content_edit→body_edit; include_content→include_body,
//             include_metadata→include_fields, content_offset/length→body_offset/length. Out: the reverse, and a
//             record's `types` go back into its `tags` (the door lists a type only under `types`; the app's checks read
//             tags). Only a record's own keys are renamed: what is inside `fields` (manifests, settings, the theme) is
//             never touched.
//   types     on the door a type's name is refused in `tags` ("pass it as types"). So a write that names tags (a list,
//             or a change's {add, remove}) asks the
//             vault which names are types (`GET <vault>/api/types`, kept for the session, asked again when the vault
//             refuses one) and sends those in `types`. A name the vault doesn't know stays a plain tag, as on /api/notes.
//   untouched everything not under /api/notes (tags, storage, the live query, the vault's info).

type Door = "records" | "notes";
const doors = new Map<string, Door>();
// A vault found to have the door is remembered on this device (a hub doesn't lose it), so a start asks no vault first
// (T-476: that ask, and its preflight, came before every other read). A 404 or 405 on the door forgets it.
const DOORS_KEY = "parachute.doors.v1";
const remembered = (): Record<string, unknown> => { try { const v = JSON.parse(localStorage.getItem(DOORS_KEY) ?? "{}") as unknown; return v && typeof v === "object" ? v as Record<string, unknown> : {}; } catch { return {}; } };
const remember = (vaultApi: string, door: Door | null) => { try { const m = remembered(); if (door === "records") m[vaultApi] = door; else delete m[vaultApi]; localStorage.setItem(DOORS_KEY, JSON.stringify(m)); } catch { /* this session only */ } };
const asking = new Map<string, Promise<Door | null>>();

/** What this session found out about each vault (for tests). */
export const doorsKnown = () => new Map(doors);
export const forgetDoors = () => { doors.clear(); asking.clear(); typeNames.clear(); try { localStorage.removeItem(DOORS_KEY); } catch { /* none kept */ } };

/** Each vault's type names, as last read from its `/api/types`. */
const typeNames = new Map<string, Promise<Set<string>>>();
function typesOf(vaultApi: string, auth: string | null, f: typeof fetch, fresh = false): Promise<Set<string>> {
  const known = typeNames.get(vaultApi);
  if (known && !fresh) return known;
  const p = (async () => {
    const r = await f(`${vaultApi}/types`, { headers: auth ? { authorization: auth } : {} });
    if (!r.ok) throw new Error(`types: ${r.status}`);
    const rows = (await r.json()) as { name?: unknown; kind?: unknown }[];
    return new Set(rows.filter((x) => x?.kind === "type" && typeof x.name === "string").map((x) => x.name as string));
  })();
  typeNames.set(vaultApi, p);
  p.catch(() => { if (typeNames.get(vaultApi) === p) typeNames.delete(vaultApi); });
  return p;
}
/** A write's tags split into the vault's types and its plain tags (each item of a batch too). */
export function splitTypes(b: unknown, types: Set<string>): unknown {
  if (!plain(b)) return b;
  const out: Record<string, unknown> = { ...b };
  if (Array.isArray(b.tags)) {
    const named = (b.tags as unknown[]).filter((t): t is string => typeof t === "string");
    const asTypes = named.filter((t) => types.has(t));
    if (asTypes.length) {
      out.tags = (b.tags as unknown[]).filter((t) => !(typeof t === "string" && types.has(t)));
      out.types = [...new Set([...(Array.isArray(b.types) ? (b.types as unknown[]) : []), ...asTypes])];
    }
  }
  // a change's {add, remove} (PATCH): each side split the same way, into `types: {add, remove}`
  if (plain(b.tags) && !Array.isArray(b.tags)) {
    const was = b.tags as Record<string, unknown>;
    const had = plain(b.types) ? (b.types as Record<string, unknown>) : {};
    const tagsOut: Record<string, unknown> = {}, typesOut: Record<string, unknown> = { ...had };
    let moved = false;
    for (const side of ["add", "remove"]) {
      const list = Array.isArray(was[side]) ? (was[side] as unknown[]) : null;
      if (!list) { if (was[side] !== undefined) tagsOut[side] = was[side]; continue; }
      const asTypes = list.filter((t): t is string => typeof t === "string" && types.has(t));
      const rest = list.filter((t) => !(typeof t === "string" && types.has(t)));
      if (rest.length || !asTypes.length) tagsOut[side] = rest;
      if (asTypes.length) { moved = true; typesOut[side] = [...new Set([...(Array.isArray(had[side]) ? (had[side] as unknown[]) : []), ...asTypes])]; }
    }
    if (moved) { out.tags = tagsOut; out.types = typesOut; }
  }
  if (Array.isArray(b.records)) out.records = b.records.map((x) => splitTypes(x, types));
  return out;
}
const namesTags = (b: unknown): boolean => plain(b) && (Array.isArray(b.tags) || plain(b.tags) || (Array.isArray(b.records) && b.records.some(namesTags)));

const NOTES = /^(.*\/api)\/notes(\/.*)?$/;
const QUERY_IN: Record<string, string> = { include_content: "include_body", include_metadata: "include_fields", content_offset: "body_offset", content_length: "body_length" };
const BODY_IN: Record<string, string> = { content: "body", metadata: "fields", notes: "records", content_edit: "body_edit" };
const KEYS_OUT: Record<string, string> = { body: "content", fields: "metadata", record_id: "note_id", record_path: "note_path", body_total_length: "content_total_length", body_next_offset: "content_next_offset", body_offset: "content_offset", body_length: "content_length" };

const plain = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);

/** A JSON request body in record words (top level, and each item of a batch). */
export function bodyIn(b: unknown): unknown {
  if (!plain(b)) return b;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(b)) out[BODY_IN[k] ?? k] = k === "notes" && Array.isArray(v) ? v.map(bodyIn) : v;
  return out;
}

/** One record, as a note: its own keys renamed, its types among its tags, nothing inside `fields` touched. */
function noteOut(r: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) out[KEYS_OUT[k] ?? k] = v;
  if (Array.isArray(r.types)) {
    const tags = Array.isArray(r.tags) ? r.tags : [];
    out.tags = [...new Set([...(r.types as unknown[]), ...tags])];
  }
  return out;
}
/** A JSON answer from the record door, in note words: a record, a list of them, or `{records, next_cursor, …}`. */
export function answerOut(a: unknown): unknown {
  if (Array.isArray(a)) return a.map((x) => (plain(x) ? noteOut(x) : x));
  if (!plain(a)) return a;
  if (Array.isArray(a.records)) { const { records, ...rest } = a; return { ...rest, notes: answerOut(records) }; }
  return typeof a.id === "string" ? noteOut(a) : a;
}

/** The URL of a notes call on the record door, its query in record words. */
export function urlIn(url: string): string {
  const u = new URL(url);
  const m = NOTES.exec(u.pathname);
  if (!m) return url;
  u.pathname = `${m[1]}/records${m[2] ?? ""}`;
  const q = new URLSearchParams();
  for (const [k, v] of u.searchParams) q.append(QUERY_IN[k] ?? k, v);
  u.search = q.toString();
  return u.toString();
}

/** Does this vault have the record door? Asked once per vault; null when the answer said nothing either way. */
function doorOf(vaultApi: string, headers: HeadersInit | undefined, f: typeof fetch): Promise<Door | null> {
  const known = doors.get(vaultApi) ?? (remembered()[vaultApi] === "records" ? "records" : undefined);
  if (known) { doors.set(vaultApi, known); return Promise.resolve(known); }
  const running = asking.get(vaultApi);
  if (running) return running;
  const p = (async () => {
    try {
      const auth = new Headers(headers).get("authorization");
      const r = await f(`${vaultApi}/records?limit=1`, { headers: auth ? { authorization: auth } : {} });
      const isJson = (r.headers.get("content-type") ?? "").includes("json");
      // no door: a 404 or 405 for the route, or a page that isn't JSON (a proxy's answer for any address)
      const door: Door | null = r.ok && isJson ? "records" : r.status === 404 || r.status === 405 || (r.ok && !isJson) ? "notes" : null;
      // a page reached through a redirect (a sign-in portal) says nothing about this hub for good
      if (door && !(door === "notes" && r.redirected)) { doors.set(vaultApi, door); remember(vaultApi, door); }
      return door;
    } catch { return null; }
  })().finally(() => asking.delete(vaultApi));
  asking.set(vaultApi, p);
  return p;
}

/** A fetch for VaultClient: notes calls go through the record door where the hub has one. */
export function recordsFetch(base: typeof fetch = (...a) => fetch(...a)): typeof fetch {
  return async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    let u: URL;
    try { u = new URL(url); } catch { return base(input, init); }
    const m = NOTES.exec(u.pathname);
    if (!m) return base(input, init);
    const door = await doorOf(`${u.origin}${m[1]}`, init?.headers, base);
    if (door !== "records") return base(input, init);
    const vaultApi = `${u.origin}${m[1]}`;
    const auth = new Headers(init?.headers).get("authorization");
    let json: unknown = undefined;
    if (typeof init?.body === "string" && init.body) { try { json = bodyIn(JSON.parse(init.body)); } catch { /* not JSON: as it is */ } }
    const send = async (fresh: boolean) => {
      let body = init?.body;
      if (json !== undefined) body = JSON.stringify(namesTags(json) ? splitTypes(json, await typesOf(vaultApi, auth, base, fresh).catch(() => new Set<string>())) : json);
      return base(urlIn(url), { ...init, body });
    };
    let res = await send(false);
    // the door gone from a hub this device remembered it on (no route: a 405, or a 404 that isn't the door's own JSON "no
    // such record"): asked again next time
    if (res.status === 405 || (res.status === 404 && !(res.headers.get("content-type") ?? "").includes("json"))) { doors.delete(vaultApi); remember(vaultApi, null); }
    // a name became a type since the vault's types were read: read them again, once
    if (res.status >= 400 && res.status < 500 && namesTags(json)) {
      const why = (await res.clone().json().catch(() => null)) as { error_type?: string } | null;
      if (why?.error_type === "tag_kind") res = await send(true);
    }
    if ([204, 205, 304].includes(res.status) || !(res.headers.get("content-type") ?? "").includes("json")) return res;
    const text = await res.text();
    let out = text;
    try { out = JSON.stringify(answerOut(JSON.parse(text))); } catch { /* not JSON after all */ }
    const headers = new Headers(res.headers);
    headers.delete("content-length"); headers.delete("content-encoding");
    return new Response(out, { status: res.status, statusText: res.statusText, headers });
  };
}
