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
import { parsePick, sortPick, type VaultRef } from "./vaultPick";

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
  /** How applets ran on the device that approved it (gate.ts): a device that runs approved code only, where an applet
   *  could send what it reads to the internet, takes only an approval made under the same warning. */
  runs?: "sealed" | "approved-code";
  /** The vaults it may reach (vaultPick.ts, docs/ACCESS.md proposal 5): only for an applet that reaches across vaults,
   *  and only when the person picked other than the default. Signed with the rest, so only the person's key can widen
   *  it; also in the asks' hash (`asksHash`), so a build that doesn't know picks takes this approval for other asks. */
  vaults?: VaultRef[];
};

export const dOf = (s: Subject) => `${s.hub}|${s.vault}|${s.record}`;
const hostOf = (hub: string) => { try { return new URL(hub).host; } catch { return hub; } };
export const approvalPath = (s: Subject) => `${APPROVAL_FOLDER}${hostOf(hub(s))}/${s.vault}/${s.record}`;
const hub = (s: Subject) => s.hub;

/** The asks' hash: the applet's fields as written (its manifest, what it opens, what it asks of the app, its servers,
 *  its embeds), its note's path, and the subject; and what those resolve to from other notes: what it opens once the
 *  vault's role tags are taken out, and which Parachutes its page's embeds come from. The same on every device,
 *  whatever it calls the vault. */
export function asksHash(subject: Subject, notePath: string, fields: Record<string, unknown>, resolved: { opens?: unknown; from?: readonly string[]; left?: readonly string[] } = {}, vaults: readonly VaultRef[] | null = null): Promise<string> {
  const pick = (k: string) => (fields[k] === undefined ? null : fields[k]);
  // signals only when declared: an approval made before them holds. Not `settings` (a section of Settings, which only
  // reads what the applet may read): a build from before it would hash the same record without it and take a newer
  // device's approval for another one ("other"), and each device's Allow would stop the other's. It is in this
  // device's grant key (grant.ts), and an approval from another device covers it only when its card said it
  // (settingsSection.ts approvalCoversSection), so the card here asks.
  // `left` (discovery.ts): which of these fields the approving device left out of its card and its grant (the vault is
  // someone else's there, or a server is one of its hubs). Only when it left something out, so an approval made where
  // nothing was holds. A device that leaves out less (or more) gets another hash, and asks for itself.
  // `vaults`: the pick (vaultPick.ts), only when there is one, so an approval with none hashes as before; sorted, so the
  // order it was ticked in says nothing
  return sha256Hex(canonical({ v: 1, subject, path: stripExt(notePath), applet: pick("applet"), opens: pick("opens"), app: pick("app"), services: pick("services"), embeds: pick("embeds"), signals: fields.signals,
    ...(vaults ? { vaults: sortPick(vaults) } : {}),
    resolved: { opens: resolved.opens ?? null, from: resolved.from ? [...resolved.from].sort() : [], ...(resolved.left?.length ? { left: [...resolved.left].sort() } : {}) } }));
}

/** The asks' hash of an applet as this device read it (discovery.ts `readApplet`): its fields as written, what it opens
 *  without the vault's role tags, where its embeds point, and what this device left out. */
export const asksOf = (subject: Subject, entry: { path: string; opens: readonly { type: string; path: string; screen?: string }[]; left?: readonly string[] }, fields: Record<string, unknown>, from: readonly string[], vaults: readonly VaultRef[] | null = null): Promise<string> =>
  asksHash(subject, entry.path, fields, { opens: entry.opens.map((o) => ({ type: o.type, path: o.path, screen: o.screen ?? null })), from, left: entry.left }, vaults);

/** The content a device signs: the next number is the time, or one more than the newest it has seen. */
export function approvalContent(o: { subject: Subject; approved: boolean; code: string; scope: string; now: number; seen: number | null; face?: string[]; device?: string; runs?: "sealed" | "approved-code"; vaults?: readonly VaultRef[] | null }): Content {
  const nowS = Math.floor(o.now / 1000);
  const at = new Date(o.now);
  return { v: 1, subject: o.subject, n: Math.max(nowS, Math.floor(o.seen ?? 0) + 1), ...(o.runs ? { runs: o.runs } : {}), approved: o.approved, code: o.approved ? o.code : "", scope: o.approved ? o.scope : "",
    at: at.toISOString(), expires: new Date(o.now + APPROVAL_DAYS * 86_400_000).toISOString(), ...(o.face ? { face: o.face.slice(0, 60) } : {}), ...(o.device ? { device: o.device.slice(0, 40) } : {}),
    ...(o.approved && o.vaults ? { vaults: sortPick(o.vaults) } : {}) };
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
    // a pick that can't be read makes the whole approval unreadable: never read as "no pick", nor as some of it
    if ("vaults" in c) { const v = parsePick(c.vaults); if (!v) return null; return { ...c, vaults: v }; }
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

/** What the approvals in the vault say about this code, given the highest number this device has seen (`floor`; a
 *  taking back seen is kept half a step higher, so an approval with its number can't be put back over it). */
/** The newest approval among these that counts (signed by a key that counts, for this applet, in its year), and why
 *  each other was refused. */
export function newestOf(events: readonly unknown[], subject: Subject, trusted: ReadonlySet<string>, now: number): { newest: Content | null; refused: string[] } {
  const refused: string[] = [];
  let newest: Content | null = null;
  for (const ev of events) {
    const r = checkApproval(ev, subject, trusted, now);
    if (!r.ok) { refused.push(r.why); continue; }
    // two with one number (two devices in one second): the taking back wins
    if (!newest || r.content.n > newest.n || (r.content.n === newest.n && !r.content.approved)) newest = r.content;
  }
  return { newest, refused };
}

/** The pick the newest approval holds, for hashing its asks before `decide` (docs/ACCESS.md proposal 5, "The
 *  approval's hash"): a device reads the pick from the approval it checks, never from a copy of its own. null: none
 *  (no approval, a taking back, one older than this device has seen, or one made with no pick). */
export function pickIn(events: readonly unknown[], subject: Subject, trusted: ReadonlySet<string>, now: number, floor: number | null): VaultRef[] | null {
  const { newest } = newestOf(events, subject, trusted, now);
  if (!newest || !newest.approved || (floor !== null && newest.n < floor)) return null;
  return newest.vaults ?? null;
}

/** What an applet that reaches across vaults may reach on a device that checks approvals (docs/ACCESS.md proposal 5):
 *  the newest approval's pick (null: the default) when it is approved and not older than this device has seen; the
 *  default when this device has seen none for it (a device new to it can't tell "never picked" from "deleted", as for
 *  any approval); else `unconfirmed`, and it reaches nothing. An approval deleted, put back or garbled by someone without
 *  the key never turns a pick into the default, which holds the home the person may have left out (review finding 1). */
export type PickRead = { pick: VaultRef[] | null } | { unconfirmed: true };
export function pickRead(newest: Content | null, floor: number | null): PickRead {
  if (!newest) return floor === null ? { pick: null } : { unconfirmed: true };
  if ((floor !== null && newest.n < floor) || !newest.approved) return { unconfirmed: true };
  return { pick: newest.vaults ?? null };
}
/** The same, from what `decide` said of an applet with a card (`floor`: this device's, after that read). */
export function pickOfDecision(d: Decision, floor: number | null): PickRead {
  if (d.run) return { pick: d.content.vaults ?? null };
  return d.why === "none" && floor === null ? { pick: null } : { unconfirmed: true };
}

/** Parachute's own applets (no card, no code of their own to hash) keep a pick alone, in an approval of the same shape
 *  named `parachute:<id>`: approved, with this code and scope. */
export const PICK_CODE = "pick";

export function decide(events: readonly unknown[], subject: Subject, code: string, scope: string, trusted: ReadonlySet<string>, now: number, floor: number | null): Decision {
  const { newest, refused } = newestOf(events, subject, trusted, now);
  if (!newest) return { run: false, why: "none", newest: null, refused };
  // a client that saw a newer one keeps that as its floor: an older one put back (October's, or one taken back) is refused
  if (floor !== null && newest.n < floor) return { run: false, why: "older", newest, refused };
  if (!newest.approved) return { run: false, why: "withdrawn", newest, refused };
  if (newest.code !== code || newest.scope !== scope) return { run: false, why: "other", newest, refused };
  return { run: true, content: newest };
}

/** The floor a Revoke leaves on this device, whatever becomes of its taking back: past now, past what the screen read
 *  (`seen`), and past anything this device has already seen (`floor`: an approval from a device whose clock runs ahead,
 *  or one signed a second ahead after a Revoke and an Allow in a row). No approval made before the Revoke passes it. */
export const revokeFloor = (nowMs: number, seen: number | null, floor: number | null): number => Math.max(Math.floor(nowMs / 1000), seen ?? 0, floor ?? 0) + 0.5;

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
