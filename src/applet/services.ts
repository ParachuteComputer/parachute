// What an applet may reach beyond its vault: `fields.services` on its record, beside the manifest (docs/design/SERVICES.md).
// The declaration, its card lines and its part of the grant's key, and the checks the shell makes on each call: a
// relay's filters and the events it publishes, an HTTP path. Pure: the shell's broker (src/services) and the native
// side (src-tauri/src/services.rs, which checks each call again) act on what this decides.
//
//   services:
//     - { id: rooms, kind: nostr-relay, url: wss://relay.example, publish: [9, 7], media: true,
//         private: [{ kind: 30078, d: "read-state:", t: read-state }] }
//     - { id: mail, kind: http, url: https://mail.example/mail/, auth: nip98 }
import { npubEncode } from "nostr-tools/nip19";
import { hasHidden, hasOnly, plain } from "./contract.ts";
import denied from "./denied-kinds.json";

export const SERVICE_KINDS = ["nostr-relay", "http"] as const;
export const HTTP_AUTHS = ["none", "nip98", "token"] as const;
export type HttpAuth = (typeof HTTP_AUTHS)[number];
export type PrivateEntry = { kind: 30078; d: string; t: string };
/** A room a relay service is limited to (docs/design/KEYRING.md): its NIP-29 id, which is enforced, and the applet's
 *  name for it, which the card shows quoted as the applet's own word. */
export type Room = { id: string; name: string };
/** Answer cards and secret requests from these keys (hex), with the approval key. */
export type Approvals = { from: string[] };
/** Notifications while Parachute is closed: messages that name you, and every message from these keys (hex). `gateway`:
 *  the push gateway (services/push-gateway) that watches the relay and pushes to this phone through its UnifiedPush
 *  distributor; without one, only the phone's own connection (on unless the person turns it off) can tell. */
export type Notify = { mentions: boolean; from: string[]; gateway?: string };
export type RelayService = { id: string; kind: "nostr-relay"; url: string; publish: number[]; media: boolean; private: PrivateEntry[]; rooms?: Room[]; approvals?: Approvals; notify?: Notify };
/** A request whose JSON body's `field` is one of `ops` is signed with the approval key, and only with it; the everyday
 *  key signs only a JSON body whose `field` is a string not in `ops` (docs/design/KEYRING.md). */
export type Approve = { field: string; ops: string[] };
/** `join`: ops that ask to join a private network, signed as you only after this device's join level (the passcode
 *  and the unlock, by default: docs/design/KEYRING.md "Joining a network"). */
export type HttpService = { id: string; kind: "http"; url: string; auth: HttpAuth; approve?: Approve; join?: Approve };
export type Service = RelayService | HttpService;

/** The words a card uses for the kinds it knows. Any other kind a service declares is "kind N events". Every kind the
 *  deny list's ranges let through has words here (services.test.ts holds it). */
export const NAMED_KINDS: Record<number, string> = { 9: "messages", 7: "reactions", 40003: "edits of your messages", 5: "deletions", 20002: "typing", 30023: "articles (it can replace yours)" };
/** Kinds a room relay files by their `h` tag: with `rooms`, these stay in them. Any other kind goes anywhere on the
 *  relay, whatever its tags (Buzz keeps a note or an article as global; a relay without rooms scopes nothing). */
export const ROOM_KINDS = [9, 7, 40003, 5, 20002];
/** Kinds no applet may have signed, declared or not: they would hand over the person's identity, their money or the
 *  shell's own protocols. The list and why each is on it: services.rs `DENIED_KINDS` (a test there holds this file to it). */
export const DENIED = denied as { kinds: number[]; ranges: [number, number][]; except: number[] };
export const deniedKind = (k: number) =>
  DENIED.kinds.includes(k) || (!DENIED.except.includes(k) && DENIED.ranges.some(([a, b]) => k >= a && k <= b));
/** A kind an applet may declare: a whole number a Nostr kind can be, not on the shell's deny list. */
const declarable = (k: unknown): k is number => Number.isInteger(k) && (k as number) >= 0 && (k as number) <= 65535 && !deniedKind(k as number);
/** The card's words for the kinds it posts: those `words` names (of 9, 7, 40003, 20002, 30023, in that order), then
 *  every kind without a name as "kind 1 and 1111 events". Deletions (5) have a line of their own. */
export function kindWords(publish: readonly number[], words: Record<number, string>): string[] {
  const named = [9, 7, 40003, 20002, 30023].filter((k) => publish.includes(k) && words[k]).map((k) => words[k]);
  const others = publish.filter((k) => !(k in NAMED_KINDS)).sort((a, b) => a - b);
  return [...named, ...(others.length ? [`kind ${joinWords(others.map(String))} events`] : [])];
}
/** The `t` tag of the approval key's enrollment with Uni (src-tauri approvals/seal.rs): no applet's event carries it. */
export const ENROLL_TAG = "uni-sealed-enroll";
/** Tags an applet's event may not carry: they are what sign-ins and signed requests are made of. */
export const AUTH_TAGS = ["u", "method", "payload", "challenge", "relay", "server", "expiration"];
export const LIMITS = { rooms: 12, roomName: 40, trusted: 4, ops: 4, services: 6, id: 40, url: 300, publish: 16, private: 2, prefix: 40, word: 40, filters: 10, subs: 100, filterValues: 100, history: 500, tags: 100, content: 64 * 1024, bytes: 25 * 1024 * 1024 };

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

const HEX_KEY = /^[0-9a-f]{64}$/;
/** A short list of public keys (64 lowercase hex), each once. */
function hexKeys(x: unknown, min: number): string[] | null {
  if (!Array.isArray(x) || x.length < min || x.length > LIMITS.trusted || new Set(x).size !== x.length || !x.every((k) => typeof k === "string" && HEX_KEY.test(k))) return null;
  return [...x].sort();
}
/** A room id as Buzz names one (NIP-29 group id: a UUID, or letters, digits, - and _). */
export const ROOM_ID = /^[A-Za-z0-9_-]{1,64}$/;
function parseRooms(x: unknown): Parsed<Room[]> {
  if (x === undefined) return { ok: true, value: [] };
  if (!Array.isArray(x) || !x.length || x.length > LIMITS.rooms) return fail(`rooms is a list of 1 to ${LIMITS.rooms}`);
  const out: Room[] = [];
  for (const r of x) {
    if (!plain(r) || !hasOnly(r, ["id", "name"]) || typeof r.id !== "string" || !ROOM_ID.test(r.id)) return fail("a room is {id, name}: its id as the relay names it");
    if (typeof r.name !== "string" || !r.name.trim() || [...r.name].length > LIMITS.roomName || hasHidden(r.name) || /[\n\t«»]/.test(r.name)) return fail("a room's name is one short line");
    if (out.some((o) => o.id === r.id)) return fail("rooms names a room twice");
    out.push({ id: r.id, name: r.name.trim() });
  }
  return { ok: true, value: out.sort((a, b) => a.id.localeCompare(b.id)) };
}

function parseOne(x: unknown, isHub: (origin: string) => boolean): Parsed<Service> {
  if (!plain(x)) return fail("each service is an object");
  const id = typeof x.id === "string" && x.id.length <= LIMITS.id && ID.test(x.id) ? x.id : null;
  if (!id) return fail("a service's id is short kebab-case");
  if (x.kind === "nostr-relay") {
    if (!hasOnly(x, ["id", "kind", "url", "publish", "media", "private", "rooms", "approvals", "notify"])) return fail(`${id}: a relay is {id, kind, url, publish?, media?, private?, rooms?, approvals?, notify?}`);
    const u = normalUrl(x.url, ["wss", "ws"], false);
    if (!u.ok) return fail(`${id}: ${u.error}`);
    const publish = x.publish === undefined ? [] : x.publish;
    if (!Array.isArray(publish) || publish.length > LIMITS.publish || new Set(publish).size !== publish.length) return fail(`${id}: publish is a short list of kinds, each once`);
    for (const k of publish) if (!declarable(k)) return fail(Number.isInteger(k) && deniedKind(k) ? `${id}: no applet may publish kind ${k}: it would sign as you in a way the shell keeps for itself` : `${id}: publish is a list of kinds`);
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
    const rooms = parseRooms(x.rooms);
    if (!rooms.ok) return fail(`${id}: ${rooms.error}`);
    let approvals: Approvals | undefined;
    if (x.approvals !== undefined) {
      if (!plain(x.approvals) || !hasOnly(x.approvals, ["from"])) return fail(`${id}: approvals is {from: [keys]}`);
      const from = hexKeys(x.approvals.from, 1);
      if (!from) return fail(`${id}: approvals.from is a list of 1 to ${LIMITS.trusted} public keys (hex)`);
      approvals = { from };
    }
    let notify: Notify | undefined;
    if (x.notify !== undefined) {
      if (!plain(x.notify) || !hasOnly(x.notify, ["mentions", "from", "gateway"])) return fail(`${id}: notify is {mentions?, from?, gateway?}`);
      if (x.notify.mentions !== undefined && typeof x.notify.mentions !== "boolean") return fail(`${id}: notify.mentions is true or false`);
      const from = x.notify.from === undefined ? [] : hexKeys(x.notify.from, 0);
      if (!from) return fail(`${id}: notify.from is a list of at most ${LIMITS.trusted} public keys (hex)`);
      if (x.notify.mentions !== true && !from.length) return fail(`${id}: notify says what to tell you about: mentions, or from`);
      let gateway: string | undefined;
      if (x.notify.gateway !== undefined) {
        const g = normalUrl(x.notify.gateway, ["https", "http"], true);
        if (!g.ok) return fail(`${id}: notify.gateway: ${g.error.replace("an http service's url", "a gateway's url")}`);
        if (isHub(g.value.origin)) return fail(`${id}: notify.gateway is a Parachute hub, which no applet reaches as a service`);
        gateway = g.value.href;
      }
      notify = { mentions: x.notify.mentions === true, from, ...(gateway ? { gateway } : {}) };
    }
    const s: RelayService = { id, kind: "nostr-relay", url: u.value.href.replace(/\/$/, ""), publish: [...publish].sort((a, b) => a - b), media: x.media === true, private: entries,
      ...(rooms.value.length ? { rooms: rooms.value } : {}), ...(approvals ? { approvals } : {}), ...(notify ? { notify } : {}) };
    if (isHub(originOf(s))) return fail(`${id}: that address is a Parachute hub, which no applet reaches as a service`);
    return { ok: true, value: s };
  }
  if (x.kind === "http") {
    if (!hasOnly(x, ["id", "kind", "url", "auth", "approve", "join"])) return fail(`${id}: an http service is {id, kind, url, auth?, approve?, join?}`);
    const u = normalUrl(x.url, ["https", "http"], true);
    if (!u.ok) return fail(`${id}: ${u.error}`);
    const auth = x.auth === undefined ? "none" : x.auth;
    if (typeof auth !== "string" || !(HTTP_AUTHS as readonly string[]).includes(auth)) return fail(`${id}: auth is ${HTTP_AUTHS.join(", ")}`);
    const opsLine = (name: "approve" | "join"): { ok: true; value?: Approve } | { ok: false; error: string } => {
      const a = x[name];
      if (a === undefined) return { ok: true };
      if (auth !== "nip98") return { ok: false, error: `${id}: ${name} needs auth nip98 (your key signs those requests)` };
      if (!plain(a) || !hasOnly(a, ["field", "ops"]) || typeof a.field !== "string" || !/^[a-z][a-zA-Z0-9_]{0,39}$/.test(a.field)) return { ok: false, error: `${id}: ${name} is {field, ops}: the JSON body's field that names the op` };
      if (!Array.isArray(a.ops) || !a.ops.length || a.ops.length > LIMITS.ops || new Set(a.ops).size !== a.ops.length || !a.ops.every((o) => typeof o === "string" && /^[a-z][a-z0-9._-]{0,39}$/.test(o))) return { ok: false, error: `${id}: ${name}.ops is a short list of op names` };
      return { ok: true, value: { field: a.field, ops: [...(a.ops as string[])].sort() } };
    };
    const a = opsLine("approve"), j = opsLine("join");
    if (!a.ok) return fail(a.error);
    if (!j.ok) return fail(j.error);
    const approve = a.value, join = j.value;
    // one op, one meaning (services.rs refuses the same)
    if (approve && join && (approve.field !== join.field || approve.ops.some((o) => join.ops.includes(o)))) return fail(`${id}: approve and join name their ops in one field, each op in one of them`);
    const s: HttpService = { id, kind: "http", url: u.value.href, auth: auth as HttpAuth, ...(approve ? { approve } : {}), ...(join ? { join } : {}) };
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

/** "npub1…" for a hex key, in full: the card shows exactly whom it trusts. */
export const npubOf = (hex: string): string => { try { return npubEncode(hex); } catch { return hex; } };
const shortId = (id: string) => (id.length > 12 ? `${id.slice(0, 8)}…` : id);
/** Where in a relay it may act: its rooms, or only the ones it names (each quoted as the applet's word, with its id). */
export const roomsWords = (s: RelayService) => (s.rooms?.length
  ? `only in ${joinWords(s.rooms.map((r) => `«${r.name}» (${shortId(r.id)})`))}, named by the applet`
  : "in your rooms");
/** What it posts, split by where it goes: room kinds in its rooms, every other kind anywhere on the relay. */
export const postsSplit = (s: RelayService, words: Record<number, string>) => ({
  rooms: kindWords(s.publish.filter((k) => ROOM_KINDS.includes(k)), words),
  anywhere: kindWords(s.publish.filter((k) => !ROOM_KINDS.includes(k)), words),
});

export type LineOptions = {
  /** The trusted list's name for a key ("Uni"), or null when it isn't on the list (docs/design/KEYRING.md). */
  approverName?: (hex: string) => string | null;
};
/** An approval-op line: what the shell knows of any op (a request held for your OK, docs/design/KEYRING.md "Held
 *  sends"), where, and the ops as the applet named them; the unlock prompt says the same (src-tauri services.rs
 *  `approve_reason`). No meaning is claimed for an op's name. `third`: as the card says it ("approves …"), not as a
 *  grant's list does ("approve …"). */
export function approveWords(ops: readonly string[], at: string, third = false): string {
  return `${third ? "approves" : "approve"}, at ${at}, what waits for your OK (${joinWords([...ops])})`;
}
export const EVERYDAY = "With your everyday key: ";
export const HIGH_RISK = "High risk. With your key: ";

export function serviceLines(services: readonly Service[], opts: LineOptions = {}): { text: string; stress: boolean }[] {
  const out: { text: string; stress: boolean }[] = [];
  const who = (hex: string) => opts.approverName?.(hex) ?? `a key you haven't trusted on this device (${npubOf(hex)})`;
  for (const s of services) {
    const at = hostWords(s);
    if (s.kind === "nostr-relay") {
      out.push({ text: `${EVERYDAY}sign in to ${at} as you`, stress: true });
      const posts = postsSplit(s, NAMED_KINDS);
      if (posts.rooms.length) out.push({ text: `${EVERYDAY}post as you ${roomsWords(s)} there: ${joinWords(posts.rooms)}`, stress: true });
      if (posts.anywhere.length) out.push({ text: `${EVERYDAY}post as you anywhere there: ${joinWords(posts.anywhere)}`, stress: true });
      // a deletion is of the person's own events of a kind it posts (broker.ts reads each first)
      const deletes = kindWords(s.publish, { 9: "messages", 7: "reactions", 40003: "edits", 30023: "articles" });
      if (s.publish.includes(5)) out.push({ text: `${EVERYDAY}delete your ${joinWords(deletes.length ? deletes : ["messages"])} there${s.rooms?.length ? `, ${roomsWords(s)}` : ""}`, stress: true });
      if (s.rooms?.length) out.push({ text: `It reads only those rooms there${s.media || s.private.length ? "; files and private notes there aren't limited to them" : ""}`, stress: false });
      if (s.media) out.push({ text: `${EVERYDAY}send and open files there as you`, stress: true });
      for (const p of s.private) out.push({ text: `Keep private notes there (${p.d}…), sealed to your key: other apps of yours may share them`, stress: false });
      if (s.approvals) {
        out.push({ text: `${HIGH_RISK}answer approval cards and secret requests there from ${joinWords(s.approvals.from.map(who))}. Powerful ones ask for your device unlock`, stress: true });
        out.push({ text: "It sees what each card asks (the job, never a key), and that could reach the servers it uses", stress: false });
      }
      if (s.notify) {
        const what = [s.notify.mentions ? "that name you" : "", s.notify.from.length ? `from ${joinWords(s.notify.from.map(who))}` : ""].filter(Boolean).join(", and every message ");
        const gw = s.notify.gateway ? hostWords({ kind: "http", url: s.notify.gateway }) : null;
        out.push({ text: `Tell you about messages ${roomsWords(s)} there ${what}, even when Parachute is closed${gw ? `, through ${gw}` : ""}`, stress: false });
        if (gw) out.push({ text: `${gw} gets your public key and where to reach this phone. It reads the rooms their admins added it to, and sends this phone only which room and message, sealed`, stress: true });
      }
    } else {
      out.push(s.auth === "nip98" ? { text: `${EVERYDAY}send requests to ${at} signed as you`, stress: true }
        : s.auth === "token" ? { text: `Use a token you give it for ${at}`, stress: true }
        : { text: `Send requests to ${at}`, stress: false });
      if (s.approve) out.push({ text: `${HIGH_RISK}${approveWords(s.approve.ops, at)}`, stress: true });
      if (s.join) out.push({ text: `${HIGH_RISK}ask ${at} to let this device join a private network (${joinWords(s.join.ops)}), each time after what Settings → Security asks for joining (your passcode and unlock, unless you changed it)`, stress: true });
    }
    out.push({ text: `What it reads here could reach ${at}`, stress: true });
  }
  return out;
}

/** The services as the grant's key holds them: everything that changes what it reaches, in a fixed order. The fields
 *  added for the keyring are there only when declared, so the key of a grant made before them holds. */
export const servicesKeyPart = (services: readonly Service[]) =>
  services.map((s) => (s.kind === "nostr-relay"
    ? { id: s.id, kind: s.kind, url: s.url, publish: [...s.publish].sort((a, b) => a - b), media: s.media, private: s.private.map((p) => `${p.kind}/${p.d}/${p.t}`).sort(),
        ...(s.rooms?.length ? { rooms: s.rooms.map((r) => `${r.id}/${r.name}`).sort() } : {}),
        ...(s.approvals ? { approvals: [...s.approvals.from].sort() } : {}),
        ...(s.notify ? { notify: { mentions: s.notify.mentions, from: [...s.notify.from].sort(), ...(s.notify.gateway ? { gateway: s.notify.gateway } : {}) } } : {}) }
    : { id: s.id, kind: s.kind, url: s.url, auth: s.auth, ...(s.approve ? { approve: { field: s.approve.field, ops: [...s.approve.ops].sort() } } : {}),
        ...(s.join ? { join: { field: s.join.field, ops: [...s.join.ops].sort() } } : {}) })).sort((a, b) => a.id.localeCompare(b.id));

// ── the checks on each call ──

const FILTER_KEYS = ["ids", "authors", "kinds", "since", "until", "limit", "search"];
const strList = (x: unknown, max: number) => Array.isArray(x) && x.length <= LIMITS.filterValues && x.every((v) => typeof v === "string" && v.length > 0 && v.length <= max);

/** Room metadata (NIP-29: group, admins, members, roles), read by `#d`. */
const ROOM_META = [39000, 39001, 39002, 39003];
/** Is this filter inside a relay service's rooms? Every one must name rooms by `#h` within the list; or read their
 *  metadata (only room-metadata kinds, `#d` within the list); or read profiles (kind 0 only, by `authors`). */
export function inRooms(f: Record<string, unknown>, rooms: readonly Room[]): boolean {
  const ids = new Set(rooms.map((r) => r.id));
  const within = (v: unknown) => Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "string" && ids.has(x));
  const kinds = f.kinds as number[] | undefined;
  if (f["#h"] !== undefined) return within(f["#h"]) && f.search === undefined;
  if (f["#d"] !== undefined) return within(f["#d"]) && !!kinds?.length && kinds.every((k) => ROOM_META.includes(k)) && f.search === undefined && f.ids === undefined;
  return !!kinds?.length && kinds.every((k) => k === 0) && Array.isArray(f.authors) && f.authors.length > 0 && f.search === undefined && f.ids === undefined
    && Object.keys(f).every((k) => ["kinds", "authors", "limit", "since", "until"].includes(k));
}

/** A relay subscription's filters: NIP-01 keys only (and one-letter tag keys), short lists, history capped; with
 *  `rooms`, each inside them. */
export function checkFilters(raw: unknown, rooms?: readonly Room[]): Parsed<Record<string, unknown>[]> {
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
    if (rooms?.length && !inRooms(f, rooms)) return fail("it may read only its rooms there");
    out.push({ ...f });
  }
  return { ok: true, value: out };
}

/** A character a bot's parser may drop before a command: Unicode White_Space, C0/C1 controls, and invisible format
 *  characters. The same set as Rust's `droppable` (services.rs), written out (JS's \s isn't Unicode's White_Space). */
const DROPPABLE = /[\u0000-\u0020\u007f-\u00a0\u00ad\u034f\u1680\u180e\u2000-\u200f\u2028-\u202f\u205f-\u206f\u3000\ufeff]/;
const droppable = (c: string) => DROPPABLE.test(c);
const trimStartWhile = (t: string, f: (c: string) => boolean) => { let i = 0; while (i < t.length && f(t[i])) i++; return t.slice(i); };

/** Text a bot may take as the owner's approval (Hermes's `/approve`, `/deny`; only an applet holding the approvals
 *  grant posts it, during a tap: docs/design/KEYRING.md): the same steps as Rust's `is_command_approval`, line for line (drop
 *  droppable characters; a leading mention — `@…`, `nostr:npub1…`, `npub1…`, a 64-hex key — up to a droppable
 *  character, `:` or `,`, then any of those; at most 8 times), then `/approve` or `/deny`, case ignored. */
export function isCommandApproval(content: string): boolean {
  let t = content;
  for (let n = 0; n < 8; n++) {
    t = trimStartWhile(t, droppable);
    const skip = t.toLowerCase().startsWith("nostr:") ? 6 : 0;
    let end = t.length;
    for (let i = skip; i < t.length; i++) if (droppable(t[i]) || t[i] === ":" || t[i] === ",") { end = i; break; }
    const word = t.slice(0, end), lower = word.toLowerCase();
    const mention = lower.startsWith("@") || lower.startsWith("nostr:npub1") || lower.startsWith("npub1") || (word.length === 64 && /^[0-9a-fA-F]+$/.test(word));
    if (!mention || !word) break;
    t = trimStartWhile(t.slice(end), (c) => droppable(c) || c === ":" || c === ",");
  }
  t = t.toLowerCase();
  return t.startsWith("/approve") || t.startsWith("/deny");
}

export type Template = { kind: number; content: string; tags: string[][] };
/** An event the applet asks the shell to sign: a kind it may publish there, plain tags (none shaped like auth), and
 *  for a deletion only `e` (and `h`) tags. The shell sets who and when. */
export function checkPublish(s: RelayService, raw: unknown): Parsed<Template> {
  if (!plain(raw) || !hasOnly(raw, ["kind", "content", "tags"])) return fail("an event is {kind, content, tags}");
  const kind = raw.kind;
  if (!declarable(kind) || !s.publish.includes(kind)) return fail(`it may not publish kind ${String(kind)} there`);
  const content = raw.content === undefined ? "" : raw.content;
  if (typeof content !== "string" || new TextEncoder().encode(content).length > LIMITS.content) return fail("content is text, at most 64 KiB");
  const tags = raw.tags === undefined ? [] : raw.tags;
  if (!Array.isArray(tags) || tags.length > LIMITS.tags) return fail(`tags are a list of at most ${LIMITS.tags}`);
  for (const t of tags) {
    if (!Array.isArray(t) || !t.length || t.length > 12 || !t.every((v) => typeof v === "string" && v.length <= 1024)) return fail("a tag is a short list of words");
    if (AUTH_TAGS.includes(t[0])) return fail(`a ${t[0]} tag is for sign-ins, not posts`);
    // the approval key's enrollment with Uni (services.rs refuses the same)
    if (t[0] === "t" && t[1] === ENROLL_TAG) return fail("that t tag is the shell's own");
    if (kind === 5 && t[0] !== "e" && t[0] !== "h") return fail("a deletion names its events by e tags only");
    if (t[0] === "e" && !/^[0-9a-f]{64}$/.test(t[1] ?? "")) return fail("an e tag names an event id");
  }
  if (kind === 5 && !tags.some((t) => t[0] === "e")) return fail("a deletion names the events it deletes");
  if (s.rooms?.length) {
    // exactly one room, one of its own: Buzz files an event by its h tag
    const hs = tags.filter((t) => t[0] === "h");
    if (hs.length !== 1 || !s.rooms.some((r) => r.id === hs[0][1])) return fail("it may post only in its rooms there");
  }
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
