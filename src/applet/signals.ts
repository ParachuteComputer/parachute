// An applet's signals (docs/design/APP-RECORD.md "Signals"): what counts as something for the person, declared in
// `fields.signals` beside its manifest. The count is the badge on the bar; on a phone, the same count is the
// notification while Parachute is closed. Pure.
//
//   "signals": [
//     { "id": "for-you", "name": "mentions and messages from Uni", "from": { "service": "rooms" } },
//     { "id": "unread", "name": "unread mail", "from": { "service": "mail", "feed": "unread" }, "via": "https://push.example/" },
//     { "id": "new", "name": "new ideas from others", "from": { "vault": "here", "path": "Ideas/", "others": true }, "via": "https://push.example/" }
//   ]
//
// Who counts each, and when:
//   a relay service with `notify`   its push gateway, while the app is closed: a message it would tell you about adds one
//   an http service's feed          the applet, while it runs (`parachute.signal`); later the service itself, through the gateway
//   notes in its own vault          the app, while it is open: notes in that folder (made after you last opened the
//                                   applet, by someone else with `others`)
// Opening the applet makes the count 0. `via` (a push gateway) is where the count goes, so the person's other devices
// and closed phone have it: an opaque id for the applet, the signal's id and the number, nothing else.
import { plain, hasOnly, hasHidden, safePrefix } from "./contract.ts";
import type { Manifest } from "./manifest.ts";
import { hostWords, normalUrl, type Service } from "./services.ts";

export const SIGNAL_LIMITS = { signals: 4, id: 40, name: 60, path: 200 };
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TYPE = /^[a-z0-9][a-z0-9_-]*(?:\/[a-z0-9][a-z0-9_-]*)*$/;

export type SignalFrom =
  | { kind: "relay"; service: string }
  | { kind: "feed"; service: string; feed: string }
  | { kind: "vault"; path: string; type?: string; others?: true };
export type Signal = { id: string; name: string; from: SignalFrom; via?: string };

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };
const fail = (error: string) => ({ ok: false as const, error });
const line = (s: unknown, max: number): s is string => typeof s === "string" && s.trim().length > 0 && s.length <= max && !/[\n\r\t]/.test(s) && !hasHidden(s);

/** `fields.signals`, checked against the applet's own manifest and services. `theirs`: an applet in someone else's
 *  vault, which reaches no service: it may count only notes in its vault, and only while the app is open. */
export function parseSignals(raw: unknown, m: Manifest, services: readonly Service[], theirs = false, isHub: (origin: string) => boolean = () => false): Parsed<Signal[]> {
  if (raw === undefined) return { ok: true, value: [] };
  if (!Array.isArray(raw) || raw.length > SIGNAL_LIMITS.signals) return fail(`signals is a list of at most ${SIGNAL_LIMITS.signals}`);
  const out: Signal[] = [];
  for (const x of raw) {
    if (!plain(x) || !hasOnly(x, ["id", "name", "from", "via"])) return fail("a signal is {id, name, from, via?}");
    if (typeof x.id !== "string" || x.id.length > SIGNAL_LIMITS.id || !ID.test(x.id)) return fail("a signal's id is lower-case words joined by -");
    if (out.some((s) => s.id === x.id)) return fail(`two signals are called ${x.id}`);
    if (!line(x.name, SIGNAL_LIMITS.name)) return fail(`${x.id}: name is one line of at most ${SIGNAL_LIMITS.name} characters`);
    if (!plain(x.from)) return fail(`${x.id}: from says what it counts`);
    const f = x.from;
    let from: SignalFrom;
    let via: string | undefined;
    if (f.service !== undefined) {
      const s = services.find((v) => v.id === f.service);
      if (theirs || !s) return fail(`${x.id}: from.service is one of the applet's own services`);
      if (s.kind === "nostr-relay") {
        if (!hasOnly(f, ["service"])) return fail(`${x.id}: a relay's signal is {service}: what its notify tells you about`);
        if (!s.notify?.gateway) return fail(`${x.id}: ${s.id} names no push gateway in notify, so nothing counts it`);
        if (x.via !== undefined && x.via !== s.notify.gateway) return fail(`${x.id}: a relay's signal goes through its notify's gateway`);
        from = { kind: "relay", service: s.id };
        via = s.notify.gateway;
      } else {
        if (!hasOnly(f, ["service", "feed"]) || typeof f.feed !== "string" || f.feed.length > SIGNAL_LIMITS.id || !ID.test(f.feed)) return fail(`${x.id}: an http service's signal is {service, feed}`);
        from = { kind: "feed", service: s.id, feed: f.feed };
      }
    } else if (f.vault !== undefined) {
      if (f.vault !== "here" || !hasOnly(f, ["vault", "path", "type", "others"])) return fail(`${x.id}: a vault's signal is {vault: "here", path, type?, others?}`);
      const path = safePrefix(f.path);
      if (!path || path.length > SIGNAL_LIMITS.path || hasHidden(path)) return fail(`${x.id}: from.path is a folder, like Ideas/`);
      if (!m.allow.some((r) => r.verbs.includes("read") && path.startsWith(r.path))) return fail(`${x.id}: it can count only notes it may read (${path} isn't one of its folders)`);
      if (f.type !== undefined && (typeof f.type !== "string" || f.type.length > 60 || !TYPE.test(f.type))) return fail(`${x.id}: from.type is a tag`);
      if (f.others !== undefined && f.others !== true) return fail(`${x.id}: from.others is true or left out`);
      from = { kind: "vault", path, ...(f.type ? { type: f.type as string } : {}), ...(f.others ? { others: true as const } : {}) };
    } else return fail(`${x.id}: from is {service} or {vault: "here", path}`);
    if (from.kind !== "relay" && x.via !== undefined) {
      if (theirs) return fail(`${x.id}: an applet in someone else's vault sends counts nowhere (via)`);
      const g = normalUrl(x.via, ["https", "http"], true);
      if (!g.ok) return fail(`${x.id}: via: ${g.error.replace("an http service's url", "a gateway's url")}`);
      if (isHub(g.value.origin)) return fail(`${x.id}: via is a Parachute hub`);
      via = g.value.href;
    }
    out.push({ id: x.id, name: x.name.trim(), from, ...(via ? { via } : {}) });
  }
  return { ok: true, value: out };
}

/** The card's rows for its signals. */
export function signalLines(signals: readonly Signal[]): { text: string; stress: boolean }[] {
  const out: { text: string; stress: boolean }[] = [];
  for (const s of signals) {
    const where = s.from.kind === "vault" ? ` (notes in ${s.from.path}${s.from.others ? " that someone else added" : ""})` : "";
    out.push({ text: `Show a count on the bar: ${s.name}${where}`, stress: false });
    if (s.via && s.from.kind !== "relay") {
      const gw = hostWords({ kind: "http", url: s.via });
      out.push({ text: `Send the count to ${gw}, which tells your phone while Parachute is closed. It gets your public key and the number, never what was counted`, stress: true });
    }
  }
  return out;
}

/** The signals as the grant's key holds them (absent when none, so other keys stay as they were). */
export const signalsKeyPart = (signals: readonly Signal[]) => [...signals].sort((a, b) => a.id.localeCompare(b.id)).map((s) => ({ id: s.id, name: s.name, from: s.from, via: s.via ?? null }));
