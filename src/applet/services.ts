// What an applet may reach beyond its vault: `fields.services` on its record, beside the manifest (docs/design/SERVICES.md).
// The declaration, its card lines and its part of the grant's key, and the checks the shell makes on each call: a
// relay's filters and the events it publishes, an HTTP path. Pure: the shell's broker (src/services) and the native
// side (src-tauri/src/services.rs, which checks each call again) act on what this decides.
//
//   services:
//     - { id: rooms, kind: nostr-relay, url: wss://relay.example, publish: [9, 7], media: true,
//         private: [{ kind: 30078, d: "read-state:", t: read-state }] }
//     - { id: mail, kind: http, url: https://mail.example/mail/, auth: nip98 }
import { hasHidden, hasOnly, plain } from "./contract.ts";

export const SERVICE_KINDS = ["nostr-relay", "http"] as const;
export const HTTP_AUTHS = ["none", "nip98", "token"] as const;
export type HttpAuth = (typeof HTTP_AUTHS)[number];
export type PrivateEntry = { kind: 30078; d: string; t: string };
export type RelayService = { id: string; kind: "nostr-relay"; url: string; publish: number[]; media: boolean; private: PrivateEntry[] };
export type HttpService = { id: string; kind: "http"; url: string; auth: HttpAuth };
export type Service = RelayService | HttpService;

/** The kinds an applet may ask the shell to sign, each with the words its card uses. Any other is refused. */
export const NAMED_KINDS: Record<number, string> = { 9: "messages", 7: "reactions", 40003: "edits of your messages", 5: "deletions", 20002: "typing" };
/** Tags an applet's event may not carry: they are what sign-ins and signed requests are made of. */
export const AUTH_TAGS = ["u", "method", "payload", "challenge", "relay", "server", "expiration"];
export const LIMITS = { services: 6, id: 40, url: 300, publish: 16, private: 2, prefix: 40, word: 40, filters: 10, subs: 100, filterValues: 100, history: 500, tags: 100, content: 64 * 1024, bytes: 25 * 1024 * 1024 };

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const LOOPBACK = ["localhost", "127.0.0.1", "[::1]"];
export const isLoopback = (host: string) => LOOPBACK.includes(host);

const fail = (error: string) => ({ ok: false as const, error });
type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/** A service's address made plain: lower-case host without a trailing dot, punycode, no default port, no user, query
 *  or fragment, and a path of plain segments. `schemes`: the two it may use (secure, and plain to this device only). */
export function normalUrl(raw: unknown, schemes: readonly [string, string], prefix: boolean): Parsed<URL> {
  if (typeof raw !== "string" || !raw || raw.length > LIMITS.url || hasHidden(raw) || /[\s\\]/.test(raw)) return fail("url must be one plain address");
  let u: URL;
  try { u = new URL(raw); } catch { return fail("url must be an address"); }
  if (u.username || u.password || u.search || u.hash || raw.includes("?") || raw.includes("#") || raw.includes("@")) return fail("url can't have a name, password, query or fragment");
  const host = u.hostname.replace(/\.$/, "");
  if (!host) return fail("url needs a host");
  if (u.protocol !== `${schemes[0]}:` && !(u.protocol === `${schemes[1]}:` && isLoopback(host))) return fail(`url must be ${schemes[0]} (or ${schemes[1]} to this device)`);
  // the path as written, before the parser could fold a dot segment or an encoded character into another path
  const written = raw.replace(/^[a-z]+:\/\/[^/]*/i, "") || "/";
  if (/%(?:2e|2f|5c|25)/i.test(written) || written.split("/").some((s) => s === "." || s === "..")) return fail("url's path must be plain");
  if (prefix && !u.pathname.endsWith("/")) return fail("an http service's url ends in / (it is a prefix)");
  u.hostname = host;
  return { ok: true, value: u };
}

/** The origin a service's url shows and is checked by (a relay's is its https twin: its media server). */
export function originOf(s: Pick<Service, "kind" | "url">): string {
  const u = new URL(s.url);
  if (s.kind === "nostr-relay") u.protocol = u.protocol === "wss:" ? "https:" : "http:";
  return u.origin;
}
export const hostLine = (s: Pick<Service, "kind" | "url">) => new URL(originOf(s)).host;

function parseOne(x: unknown, isHub: (origin: string) => boolean): Parsed<Service> {
  if (!plain(x)) return fail("each service is an object");
  const id = typeof x.id === "string" && x.id.length <= LIMITS.id && ID.test(x.id) ? x.id : null;
  if (!id) return fail("a service's id is short kebab-case");
  if (x.kind === "nostr-relay") {
    if (!hasOnly(x, ["id", "kind", "url", "publish", "media", "private"])) return fail(`${id}: a relay is {id, kind, url, publish?, media?, private?}`);
    const u = normalUrl(x.url, ["wss", "ws"], false);
    if (!u.ok) return fail(`${id}: ${u.error}`);
    const publish = x.publish === undefined ? [] : x.publish;
    if (!Array.isArray(publish) || publish.length > LIMITS.publish || new Set(publish).size !== publish.length) return fail(`${id}: publish is a short list of kinds, each once`);
    for (const k of publish) if (!Number.isInteger(k) || !(k in NAMED_KINDS)) return fail(`${id}: it can't publish kind ${String(k)}; an applet may publish ${Object.keys(NAMED_KINDS).join(", ")}`);
    if (x.media !== undefined && typeof x.media !== "boolean") return fail(`${id}: media is true or false`);
    const priv = x.private === undefined ? [] : x.private;
    if (!Array.isArray(priv) || priv.length > LIMITS.private) return fail(`${id}: private is a short list`);
    const entries: PrivateEntry[] = [];
    for (const p of priv) {
      if (!plain(p) || !hasOnly(p, ["kind", "d", "t"]) || p.kind !== 30078) return fail(`${id}: a private entry is {kind: 30078, d, t}`);
      if (typeof p.d !== "string" || !/^[a-z0-9][a-z0-9_.-]{0,38}:$/.test(p.d)) return fail(`${id}: a private entry's d is a short prefix ending in :`);
      if (typeof p.t !== "string" || !/^[a-z0-9][a-z0-9_-]{0,39}$/.test(p.t)) return fail(`${id}: a private entry's t is one short word`);
      const d = p.d as string;
      if (entries.some((e) => d.startsWith(e.d) || e.d.startsWith(d))) return fail(`${id}: two private entries overlap`);
      entries.push({ kind: 30078, d, t: p.t as string });
    }
    const s: RelayService = { id, kind: "nostr-relay", url: u.value.href.replace(/\/$/, ""), publish: [...publish].sort((a, b) => a - b), media: x.media === true, private: entries };
    if (isHub(originOf(s))) return fail(`${id}: that address is a Parachute hub, which no applet reaches as a service`);
    return { ok: true, value: s };
  }
  if (x.kind === "http") {
    if (!hasOnly(x, ["id", "kind", "url", "auth"])) return fail(`${id}: an http service is {id, kind, url, auth?}`);
    const u = normalUrl(x.url, ["https", "http"], true);
    if (!u.ok) return fail(`${id}: ${u.error}`);
    const auth = x.auth === undefined ? "none" : x.auth;
    if (typeof auth !== "string" || !(HTTP_AUTHS as readonly string[]).includes(auth)) return fail(`${id}: auth is ${HTTP_AUTHS.join(", ")}`);
    const s: HttpService = { id, kind: "http", url: u.value.href, auth: auth as HttpAuth };
    if (isHub(originOf(s))) return fail(`${id}: that address is a Parachute hub, which no applet reaches as a service`);
    return { ok: true, value: s };
  }
  return fail(`${id}: kind is ${SERVICE_KINDS.join(" or ")}`);
}

/** `fields.services`: absent is none; anything wrong refuses the whole list (the applet then reaches no service).
 *  `isHub`: is this origin a Parachute hub the person uses (they are never services). */
export function parseServices(raw: unknown, isHub: (origin: string) => boolean = () => false): { ok: true; services: Service[] } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, services: [] };
  if (!Array.isArray(raw) || raw.length > LIMITS.services) return fail(`services must be a list of at most ${LIMITS.services}`);
  const out: Service[] = [];
  for (const x of raw) {
    const s = parseOne(x, isHub);
    if (!s.ok) return fail(s.error);
    if (out.some((o) => o.id === s.value.id)) return fail(`services names ${s.value.id} twice`);
    out.push(s.value);
  }
  return { ok: true, services: out };
}

// ── the card ──

const joinWords = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
/** A host as the card shows it: as written, with its punycode beside it when it has letters beyond ASCII. */
export function hostWords(s: Pick<Service, "kind" | "url">): string {
  const host = hostLine(s);
  let shown = host;
  try { shown = decodeURIComponent(host.split(".").map((l) => (l.startsWith("xn--") ? punyDecode(l.slice(4)) : l)).join(".")); } catch { shown = host; }
  const here = isLoopback(new URL(originOf(s)).hostname) ? " on this device" : "";
  return (shown === host ? host : `${shown} (${host})`) + here;
}

export function serviceLines(services: readonly Service[]): { text: string; stress: boolean }[] {
  const out: { text: string; stress: boolean }[] = [];
  for (const s of services) {
    const at = hostWords(s);
    if (s.kind === "nostr-relay") {
      out.push({ text: `Sign in to ${at} as you`, stress: true });
      const posts = s.publish.filter((k) => k !== 5).map((k) => NAMED_KINDS[k]);
      if (posts.length) out.push({ text: `Post as you in your rooms there: ${joinWords(posts)}`, stress: true });
      if (s.publish.includes(5)) out.push({ text: "Delete your messages and reactions there", stress: true });
      if (s.media) out.push({ text: "Send and open files there as you", stress: true });
      for (const p of s.private) out.push({ text: `Keep private notes there (${p.d}…), sealed to your key: other apps of yours may share them`, stress: false });
    } else {
      out.push(s.auth === "nip98" ? { text: `Send requests to ${at} signed as you`, stress: true }
        : s.auth === "token" ? { text: `Use a token you give it for ${at}`, stress: true }
        : { text: `Send requests to ${at}`, stress: false });
    }
    out.push({ text: `What it reads here could reach ${at}`, stress: true });
  }
  return out;
}

/** The services as the grant's key holds them: everything that changes what it reaches, in a fixed order. */
export const servicesKeyPart = (services: readonly Service[]) =>
  services.map((s) => (s.kind === "nostr-relay"
    ? { id: s.id, kind: s.kind, url: s.url, publish: [...s.publish].sort((a, b) => a - b), media: s.media, private: s.private.map((p) => `${p.kind}/${p.d}/${p.t}`).sort() }
    : { id: s.id, kind: s.kind, url: s.url, auth: s.auth })).sort((a, b) => a.id.localeCompare(b.id));

// ── the checks on each call ──

const FILTER_KEYS = ["ids", "authors", "kinds", "since", "until", "limit", "search"];
const strList = (x: unknown, max: number) => Array.isArray(x) && x.length <= LIMITS.filterValues && x.every((v) => typeof v === "string" && v.length > 0 && v.length <= max);

/** A relay subscription's filters: NIP-01 keys only (and one-letter tag keys), short lists, history capped. */
export function checkFilters(raw: unknown): Parsed<Record<string, unknown>[]> {
  if (!Array.isArray(raw) || !raw.length || raw.length > LIMITS.filters) return fail(`filters are a list of 1 to ${LIMITS.filters}`);
  const out: Record<string, unknown>[] = [];
  for (const f of raw) {
    if (!plain(f)) return fail("a filter is an object");
    for (const [k, v] of Object.entries(f)) {
      if (/^#[a-zA-Z]$/.test(k)) { if (!strList(v, 200)) return fail(`${k} is a short list of words`); continue; }
      if (!FILTER_KEYS.includes(k)) return fail(`a filter can't have ${k}`);
      if ((k === "ids" || k === "authors") && !(strList(v, 64) && (v as string[]).every((x) => /^[0-9a-f]{64}$/.test(x)))) return fail(`${k} are hex ids`);
      if (k === "kinds" && !(Array.isArray(v) && v.length <= LIMITS.filterValues && v.every((n) => Number.isInteger(n) && n >= 0 && n <= 65535))) return fail("kinds are numbers");
      if ((k === "since" || k === "until") && !(Number.isInteger(v) && (v as number) >= 0)) return fail(`${k} is a time`);
      if (k === "limit" && !(Number.isInteger(v) && (v as number) >= 0 && (v as number) <= LIMITS.history)) return fail(`limit is at most ${LIMITS.history}`);
      if (k === "search" && !(typeof v === "string" && v.length <= 200)) return fail("search is a short line");
    }
    out.push({ ...f });
  }
  return { ok: true, value: out };
}

export type Template = { kind: number; content: string; tags: string[][] };
/** An event the applet asks the shell to sign: a kind it may publish there, plain tags (none shaped like auth), and
 *  for a deletion only `e` (and `h`) tags. The shell sets who and when. */
export function checkPublish(s: RelayService, raw: unknown): Parsed<Template> {
  if (!plain(raw) || !hasOnly(raw, ["kind", "content", "tags"])) return fail("an event is {kind, content, tags}");
  const kind = raw.kind;
  if (!Number.isInteger(kind) || !(kind as number in NAMED_KINDS) || !s.publish.includes(kind as number)) return fail(`it may not publish kind ${String(kind)} there`);
  const content = raw.content === undefined ? "" : raw.content;
  if (typeof content !== "string" || new TextEncoder().encode(content).length > LIMITS.content) return fail("content is text, at most 64 KiB");
  const tags = raw.tags === undefined ? [] : raw.tags;
  if (!Array.isArray(tags) || tags.length > LIMITS.tags) return fail(`tags are a list of at most ${LIMITS.tags}`);
  for (const t of tags) {
    if (!Array.isArray(t) || !t.length || t.length > 12 || !t.every((v) => typeof v === "string" && v.length <= 1024)) return fail("a tag is a short list of words");
    if (AUTH_TAGS.includes(t[0])) return fail(`a ${t[0]} tag is for sign-ins, not posts`);
    if (kind === 5 && t[0] !== "e" && t[0] !== "h") return fail("a deletion names its events by e tags only");
    if (t[0] === "e" && !/^[0-9a-f]{64}$/.test(t[1] ?? "")) return fail("an e tag names an event id");
  }
  if (kind === 5 && !tags.some((t) => t[0] === "e")) return fail("a deletion names the events it deletes");
  return { ok: true, value: { kind: kind as number, content, tags: tags.map((t) => [...t]) } };
}

/** The address of a request to an http service: its url followed by `path` as written (never resolved against it), a
 *  path of plain segments with maybe a query, which must land under the url's prefix on its origin. */
export function requestUrl(s: HttpService, path: unknown): Parsed<string> {
  if (typeof path !== "string" || path.length > 2000 || /[\u0000- \u007f\\#]/.test(path)) return fail("a path is plain text");
  const [p] = path.split("?");
  if (/%(?:2e|2f|5c|25)/i.test(p) || p.split("/").some((x) => x === "." || x === "..")) return fail("a path's segments must be plain");
  const full = s.url + path.replace(/^\//, "");
  let u: URL;
  try { u = new URL(full); } catch { return fail("not an address"); }
  const base = new URL(s.url);
  if (u.origin !== base.origin || !u.pathname.startsWith(base.pathname) || u.username || u.password) return fail("outside what it may reach");
  return { ok: true, value: u.href };
}

export const METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"];
export const REQUEST_HEADERS = ["content-type", "accept", "if-match", "if-none-match", "range"];
export const RESPONSE_HEADERS = ["content-type", "content-length", "etag", "last-modified", "location"];

// ── punycode, decoding only (for the card: a look-alike host is shown as written and as punycode) ──
function punyDecode(input: string): string {
  const base = 36, tMin = 1, tMax = 26, skew = 38, damp = 700;
  const out: number[] = [];
  let i = 0, n = 128, bias = 72;
  const basic = input.lastIndexOf("-");
  for (let j = 0; j < Math.max(basic, 0); j++) out.push(input.charCodeAt(j));
  const adapt = (delta: number, num: number, first: boolean) => {
    delta = first ? Math.floor(delta / damp) : delta >> 1;
    delta += Math.floor(delta / num);
    let k = 0;
    for (; delta > ((base - tMin) * tMax) >> 1; k += base) delta = Math.floor(delta / (base - tMin));
    return k + Math.floor(((base - tMin + 1) * delta) / (delta + skew));
  };
  for (let idx = basic > 0 ? basic + 1 : 0; idx < input.length;) {
    const old = i;
    for (let w = 1, k = base; ; k += base) {
      const c = input.charCodeAt(idx++);
      const digit = c - 48 < 10 ? c - 22 : c - 65 < 26 ? c - 65 : c - 97 < 26 ? c - 97 : base;
      if (digit >= base) throw new Error("bad punycode");
      i += digit * w;
      const t = k <= bias ? tMin : k >= bias + tMax ? tMax : k - bias;
      if (digit < t) break;
      w *= base - t;
    }
    bias = adapt(i - old, out.length + 1, old === 0);
    n += Math.floor(i / (out.length + 1));
    i %= out.length + 1;
    out.splice(i++, 0, n);
  }
  return String.fromCodePoint(...out);
}
