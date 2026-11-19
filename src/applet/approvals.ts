// Signed approvals (docs/design/APP-RECORD.md "Running needs a signed approval"): one record per applet in the person's
// home vault, `Parachute/Approvals/<host>/<vault>/<record id>`, tagged `parachute-approval`, holding one Nostr event
// (kind 30479, never sent to a relay) signed by the person's key after the device unlock. It says "this exact code,
// asking exactly this": the hash of the code and of its asks, both computed by each device from what it is about to
// run. One device approving is enough: every other device that holds the person's key checks the signature, hashes
// the code itself, and runs it. A vault or hub broken into has no key, so it can't make one.
//
// Which keys count: the person's own key (this device's), or, when the device holds the public half of a root key
// (the anchor), the keys of the newest key list that root signed (`Parachute/Keys`, kind 30480). Rotation is #systems'
// (T-487); here the list is only read and checked.
//
// The rule, checked by `decide`: an approval runs code only when its signature holds, its signer is a key that counts,
// it names this record, its number is the highest this device has seen for it (so last month's can't be put back),
// it isn't from the future or past its year, and its two hashes are this code's and these asks'. Pure.
import { verifyEvent } from "nostr-tools/pure";
import { canonical } from "./grant";
import { sha256Hex } from "./needs";
import { stripExt } from "./contract";

export const APPROVAL_KIND = 30479;
export const KEYS_KIND = 30480;
export const APPROVAL_TAG = "parachute-approval";
export const KEYS_TAG = "parachute-keys";
export const APPROVAL_FOLDER = "Parachute/Approvals/";
export const KEYS_PATH = "Parachute/Keys";
/** An approval lasts a year at most. */
export const APPROVAL_DAYS = 365;
/** How far ahead of this device's clock a signing time may be. */
const SKEW_S = 600;

export type SignedEvent = { id: string; pubkey: string; created_at: number; kind: number; tags: string[][]; content: string; sig: string };
/** What an approval is of: the hub's origin, the vault's name there, the applet's record id and its manifest id.
 *  Never a device's own name for a vault, so every device names it the same. */
export type Subject = { hub: string; vault: string; record: string; applet: string };
export type Content = {
  v: 1; subject: Subject; n: number; approved: boolean; code: string; scope: string; at: string; expires: string;
  /** What its card said when it was approved, for the next card to mark what is new. */
  face?: string[];
  /** Which device signed it, in the person's words ("Pixel"). */
  device?: string;
};

export const dOf = (s: Subject) => `${s.hub}|${s.vault}|${s.record}`;
const hostOf = (hub: string) => { try { return new URL(hub).host; } catch { return hub; } };
export const approvalPath = (s: Subject) => `${APPROVAL_FOLDER}${hostOf(hub(s))}/${s.vault}/${s.record}`;
const hub = (s: Subject) => s.hub;

/** The asks' hash: the applet's fields as written (its manifest, what it opens, what it asks of the app, its servers,
 *  its embeds), its note's path, and the subject. The same on every device, whatever it calls the vault. */
export function asksHash(subject: Subject, notePath: string, fields: Record<string, unknown>): Promise<string> {
  const pick = (k: string) => (fields[k] === undefined ? null : fields[k]);
  return sha256Hex(canonical({ v: 1, subject, path: stripExt(notePath), applet: pick("applet"), opens: pick("opens"), app: pick("app"), services: pick("services"), embeds: pick("embeds") }));
}

/** The content a device signs: the next number is the time, or one more than the newest it has seen. */
export function approvalContent(o: { subject: Subject; approved: boolean; code: string; scope: string; now: number; seen: number | null; face?: string[]; device?: string }): Content {
  const nowS = Math.floor(o.now / 1000);
  const at = new Date(o.now);
  return { v: 1, subject: o.subject, n: Math.max(nowS, (o.seen ?? 0) + 1), approved: o.approved, code: o.approved ? o.code : "", scope: o.approved ? o.scope : "",
    at: at.toISOString(), expires: new Date(o.now + APPROVAL_DAYS * 86_400_000).toISOString(), ...(o.face ? { face: o.face.slice(0, 60) } : {}), ...(o.device ? { device: o.device.slice(0, 40) } : {}) };
}

/** Checked afresh from its fields only: nostr-tools remembers an event it verified (a symbol on the object), and a copy
 *  edited after that would carry the mark. */
const sound = (e: SignedEvent) => { try { return verifyEvent({ id: e.id, pubkey: e.pubkey, created_at: e.created_at, kind: e.kind, tags: e.tags, content: e.content, sig: e.sig }); } catch { return false; } };
const isHex64 = (x: unknown): x is string => typeof x === "string" && /^[0-9a-f]{64}$/.test(x);
function contentOf(ev: SignedEvent): Content | null {
  try {
    const c = JSON.parse(ev.content) as Content;
    if (!c || c.v !== 1 || typeof c.approved !== "boolean" || !Number.isSafeInteger(c.n) || c.n <= 0) return null;
    const s = c.subject;
    if (!s || typeof s.hub !== "string" || typeof s.vault !== "string" || typeof s.record !== "string" || typeof s.applet !== "string") return null;
    if (typeof c.code !== "string" || typeof c.scope !== "string" || isNaN(Date.parse(c.at)) || isNaN(Date.parse(c.expires))) return null;
    return c;
  } catch { return null; }
}

/** One approval read from the vault, checked against everything but this code: why it doesn't count, or its content. */
export function checkApproval(ev: unknown, subject: Subject, trusted: ReadonlySet<string>, now: number): { ok: true; content: Content; by: string } | { ok: false; why: string } {
  const e = ev as SignedEvent;
  if (!e || typeof e !== "object" || e.kind !== APPROVAL_KIND || !isHex64(e.pubkey)) return { ok: false, why: "it isn't an approval" };
  if (!trusted.has(e.pubkey)) return { ok: false, why: "it isn't signed by a key of yours" };
  if (!Array.isArray(e.tags) || typeof e.content !== "string" || !sound(e)) return { ok: false, why: "its signature doesn't hold" };
  const c = contentOf(e);
  if (!c) return { ok: false, why: "it can't be read" };
  const d = e.tags.find((t) => t[0] === "d")?.[1];
  if (d !== dOf(subject) || dOf(c.subject) !== dOf(subject) || c.subject.applet !== subject.applet) return { ok: false, why: "it is for another applet" };
  const nowS = Math.floor(now / 1000);
  if (c.n > nowS + SKEW_S || e.created_at > nowS + SKEW_S) return { ok: false, why: "it is dated in the future" };
  const exp = Date.parse(c.expires), at = Date.parse(c.at);
  if (exp <= now || exp - at > (APPROVAL_DAYS + 1) * 86_400_000) return { ok: false, why: "its year has run out" };
  return { ok: true, content: c, by: e.pubkey };
}

export type Decision =
  | { run: true; content: Content }
  /** `withdrawn`: the newest says no. `other`: the newest approves other code or asks (this one changed since). */
  | { run: false; why: "none" | "withdrawn" | "other" | "older"; newest: Content | null; refused: string[] };

/** What the approvals in the vault say about this code, given the highest number this device has seen (`floor`). */
export function decide(events: readonly unknown[], subject: Subject, code: string, scope: string, trusted: ReadonlySet<string>, now: number, floor: number | null): Decision {
  const refused: string[] = [];
  let newest: Content | null = null;
  for (const ev of events) {
    const r = checkApproval(ev, subject, trusted, now);
    if (!r.ok) { refused.push(r.why); continue; }
    if (!newest || r.content.n > newest.n) newest = r.content;
  }
  if (!newest) return { run: false, why: "none", newest: null, refused };
  // a client that saw a newer one keeps that as its floor: an older one put back (October's, or one taken back) is refused
  if (floor !== null && newest.n < floor) return { run: false, why: "older", newest, refused };
  if (!newest.approved) return { run: false, why: "withdrawn", newest, refused };
  if (newest.code !== code || newest.scope !== scope) return { run: false, why: "other", newest, refused };
  return { run: true, content: newest };
}

// ── the key list ──

export type KeyList = { v: 1; seq: number; at: string; keys: { key: string; name?: string }[] };
/** The keys of a key list signed by the anchor (the root key's public half), or null. `floor`: the newest seq this
 *  device has seen: an older list put back doesn't count. */
export function checkKeyList(ev: unknown, anchor: string, floor: number | null): KeyList | null {
  const e = ev as SignedEvent;
  if (!e || e.kind !== KEYS_KIND || e.pubkey !== anchor) return null;
  if (!Array.isArray(e.tags) || typeof e.content !== "string" || !sound(e)) return null;
  try {
    const c = JSON.parse(e.content) as KeyList;
    if (c.v !== 1 || !Number.isSafeInteger(c.seq) || (floor !== null && c.seq < floor) || !Array.isArray(c.keys) || c.keys.length > 20) return null;
    const keys = c.keys.filter((k) => k && isHex64(k.key)).map((k) => ({ key: k.key, ...(typeof k.name === "string" ? { name: k.name.slice(0, 60) } : {}) }));
    return { v: 1, seq: c.seq, at: String(c.at), keys };
  } catch { return null; }
}

/** The keys whose approvals count on this device: with an anchor, the newest list it signed (or, before one is read,
 *  the anchor itself); without one, the person's key this device holds. */
export function trustedKeys(o: { own: string | null; anchor: string | null; list: KeyList | null }): Set<string> {
  if (o.anchor) return new Set(o.list ? o.list.keys.map((k) => k.key) : [o.anchor]);
  return new Set(o.own ? [o.own] : []);
}
