// Signed approvals on this device (approvals.ts is the rule): read from and written to the person's home vault, the
// newest number seen for each applet (the floor that keeps an old approval from being put back), the anchor (a root
// key's public half, put here by the person) and the newest key list it signed. The approval is signed natively
// (src-tauri/src/approve.rs) after the device unlock; a device without the person's key (a browser tab) has no
// approvals and keeps its own Allow, as before.
import { nativeNow } from "../services/native";
import { npubDecode } from "../services/npub";
import { homeVault } from "../shell/frameSource";
import { clientFor, keptClientFor } from "../vault/client";
import { isMine } from "../vault/whose";
import { originOf, type VaultRecord } from "../vault/store";
import { stripExt } from "./contract";
import { APPROVAL_TAG, KEYS_PATH, KEYS_TAG, PICK_CODE, approvalContent, approvalPath, checkApproval, checkKeyList, decide, dOf, newestOf, pickIn, pickRead, revokeFloor, trustedKeys, type Content, type Decision, type PickRead, type KeyList, type SignedEvent, type Subject } from "./approvals";
import type { VaultRef } from "./vaultPick";

const SEEN_KEY = "parachute.approvals.seen.v1";
const ANCHOR_KEY = "parachute.anchor.v1";
const LIST_SEEN_KEY = "parachute.keys.seen.v1";
/** The newest approval this device signed for each applet, as signed: read with the home's (each checked as they are),
 *  so a pick made here holds here even when the home couldn't take it. */
const MINE_KEY = "parachute.approvals.mine.v1";
const store = () => (typeof localStorage === "undefined" ? null : localStorage);
const readMap = (k: string): Record<string, unknown> => { try { const v = JSON.parse(store()?.getItem(k) ?? "{}") as unknown; return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {}; } catch { return {}; } };
const writeMap = (k: string, m: Record<string, unknown>) => { try { store()?.setItem(k, JSON.stringify(m)); } catch { /* this session */ } };

/** The highest approval number this device has seen for an applet. */
export const floorOf = (s: Subject): number | null => { const v = readMap(SEEN_KEY)[dOf(s)]; return typeof v === "number" ? v : null; };
export const raiseFloor = (s: Subject, n: number) => { const m = readMap(SEEN_KEY); if (typeof m[dOf(s)] !== "number" || (m[dOf(s)] as number) < n) writeMap(SEEN_KEY, { ...m, [dOf(s)]: n }); };

/** The anchor this device holds for its home (hex), if the person put one here. */
export const anchorNow = (): string | null => { const h = homeVault(); const v = h ? readMap(ANCHOR_KEY)[h.key] : null; return typeof v === "string" && /^[0-9a-f]{64}$/.test(v) ? v : null; };
export function setAnchor(npubOrHex: string | null): void {
  const h = homeVault();
  if (!h) throw new Error("There's no home vault yet.");
  const hex = npubOrHex === null ? null : /^[0-9a-f]{64}$/.test(npubOrHex.trim()) ? npubOrHex.trim() : npubDecode(npubOrHex.trim());
  if (npubOrHex !== null && !hex) throw new Error("That isn't a public key (npub1… or 64 hex characters).");
  const m = { ...readMap(ANCHOR_KEY) };
  if (hex) m[h.key] = hex; else delete m[h.key];
  writeMap(ANCHOR_KEY, m);
}

let own: Promise<string | null> | null = null;
/** The person's key on this device (hex), or null where there is none (a browser tab). */
export function ownKey(): Promise<string | null> {
  own ??= nativeNow().then(async (n) => { if (!n) return null; const k = await n.keyring(); return /^[0-9a-f]{64}$/.test(k.everyday) ? k.everyday : npubDecode(k.everyday); }).catch(() => null);
  return own;
}
/** Forget the key read (a key made, imported or forgotten here). */
export const forgetOwnKey = () => { own = null; };

/** The newest key list in the home vault the anchor signed, newer than any this device has seen. */
async function keyList(home: VaultRecord, anchor: string, kept = false): Promise<KeyList | null> {
  const rows = await (kept ? keptClientFor(home) : clientFor(home)).queryNotes({ tag: KEYS_TAG, includeMetadata: true, limit: 5 }).catch(() => []);
  const seen = readMap(LIST_SEEN_KEY)[anchor];
  let best: KeyList | null = null;
  for (const r of rows) {
    if (stripExt(r.path ?? "") !== KEYS_PATH) continue;
    const l = checkKeyList((r.metadata as Record<string, unknown> | undefined)?.keys, anchor, typeof seen === "number" ? seen : null);
    if (l && (!best || l.seq > best.seq)) best = l;
  }
  if (best) writeMap(LIST_SEEN_KEY, { ...readMap(LIST_SEEN_KEY), [anchor]: best.seq });
  return best;
}

/** The keys whose approvals count here now. */
export async function trustedNow(kept = false): Promise<Set<string>> {
  const home = homeVault(), anchor = anchorNow();
  const list = home && anchor ? await keyList(home, anchor, kept) : null;
  return trustedKeys({ own: await ownKey(), anchor, list });
}

/** Whether this device signs approvals: it holds the person's key, and a home of theirs. */
export async function signsHere(): Promise<boolean> { const home = homeVault(); return !!home && isMine(home) && !!(await ownKey()); }
/** Whether this device checks approvals: it holds the person's key (or an anchor), and a home of theirs. */
export async function approvalsHere(): Promise<boolean> {
  const home = homeVault();
  return !!home && isMine(home) && (!!(await ownKey()) || !!anchorNow());
}

export const subjectOf = (rec: Pick<VaultRecord, "issuer" | "vault">, record: string, applet: string): Subject => ({ hub: originOf(rec.issuer), vault: rec.vault, record, applet });

type ApprovalRow = { id: string; updatedAt?: string; metadata?: Record<string, unknown> };
async function rowsFor(home: VaultRecord, s: Subject, kept = false): Promise<ApprovalRow[]> {
  const path = approvalPath(s);
  const rows = await (kept ? keptClientFor(home) : clientFor(home)).queryNotes({ pathPrefix: path, includeMetadata: true, limit: 10 });
  return (rows as (ApprovalRow & { path?: string })[]).filter((r) => stripExt(r.path ?? "") === path);
}

/** The approvals for a subject: the home vault's (from the copy kept of the read, `kept`), and the one this device
 *  signed last. Each is checked by `decide` as any other is. */
async function eventsFor(home: VaultRecord, s: Subject, kept: boolean): Promise<unknown[]> {
  const mine = readMap(MINE_KEY)[dOf(s)];
  return [...(await rowsFor(home, s, kept).catch(() => [])).map((r) => r.metadata?.approval), ...(mine ? [mine] : [])];
}

/** What the approvals in the home vault say about this exact code and asks, on this device. A newer one seen raises
 *  the floor. null: this device doesn't check approvals. Read from the copy kept of the approvals at once (the signed
 *  list as last read, vault/readCache.ts), the home vault asked behind it: the applet screen reads again when its
 *  answer differs, so a taking back stops the applet as soon as that read answers (review finding 16).
 *  `scope`: the asks' hash; for an applet that reaches across vaults, made from the pick the newest approval holds
 *  (docs/ACCESS.md proposal 5): read first, then hashed, then decided. The pick that runs is `content.vaults`. */
export async function approvalFor(s: Subject, code: string, scope: string | ((vaults: VaultRef[] | null) => Promise<string>), now = Date.now()): Promise<Decision | null> {
  const home = homeVault();
  if (!home || !(await approvalsHere())) return null;
  const events = await eventsFor(home, s, true);
  const trusted = await trustedNow(true);
  const asks = typeof scope === "string" ? scope : await scope(pickIn(events, s, trusted, now, floorOf(s)));
  const d = decide(events, s, code, asks, trusted, now, floorOf(s));
  const newest = d.run ? d.content : d.newest;
  if (newest && (d.run || d.why !== "older")) raiseFloor(s, newest.n + (newest.approved ? 0 : 0.5));
  return d;
}

/** Sign (on this device, after its unlock) and write an approval of this exact code, or with `approved: false` the
 *  taking back of one. Throws when it can't be signed (no key, the unlock cancelled, a wrong passcode); `written`
 *  says whether it reached the home vault. */
export async function signApproval(o: { subject: Subject; name: string; approved: boolean; code: string; scope: string; face?: string[]; passcode?: string | null; runs?: "sealed" | "approved-code"; vaults?: readonly VaultRef[] | null;
  /** Told as soon as it is signed, before it is written to the home vault (a pick holds here at once). */ signed?: (c: Content) => void }): Promise<{ ev: SignedEvent; written: boolean }> {
  const home = homeVault();
  const native = await nativeNow();
  if (!home || !native) throw new Error("Approving for every device needs the Parachute app with your key.");
  const content = approvalContent({ subject: o.subject, approved: o.approved, code: o.code, scope: o.scope, now: Date.now(), seen: floorOf(o.subject), face: o.face, device: deviceName(), runs: o.runs, vaults: o.vaults });
  const ev = await native.approvalSign(JSON.stringify(content), dOf(o.subject), o.name, o.passcode ?? null) as SignedEvent;
  raiseFloor(o.subject, content.n + (o.approved ? 0 : 0.5));
  writeMap(MINE_KEY, { ...readMap(MINE_KEY), [dOf(o.subject)]: ev });
  o.signed?.(content);
  // signed: a home Parachute may only read (docs/design/SCOPES.md) still leaves this device's own Allow; the other
  // devices then ask for themselves
  const written = await writeApproval(home, o.subject, o.name, ev).then(() => true, () => false);
  return { ev, written };
}

/** Revoke, wherever the person taps it (the applet's menu, Settings): whatever happens next, this device doesn't allow
 *  the applet again from an approval made before now; and on a device with the person's key the approval is taken back
 *  on every device (signed after the unlock, never the passcode). `applet`: its manifest id, or null when its note is
 *  gone or unread, and the approval in the home vault says which it was. Returns what to tell the person when the
 *  taking back went no further than this device, else null. */
export async function takeBack(rec: Pick<VaultRecord, "issuer" | "vault">, record: string, name: string, applet: string | null, seen: number | null = null): Promise<string | null> {
  const at = subjectOf(rec, record, applet ?? "");
  raiseFloor(at, revokeFloor(Date.now(), seen, floorOf(at)));
  if (!(await signsHere())) return null;
  try {
    const id = applet ?? await approvedApplet(at);
    // nothing of this applet's was approved for every device: there is nothing to take back
    if (id === null) return null;
    const r = await signApproval({ subject: { ...at, applet: id }, name, approved: false, code: "", scope: "" });
    return r.written ? null : "Stopped on this device. Your other devices keep running it until Parachute can change notes in your home vault.";
  } catch (e) {
    return `Stopped on this device only: ${e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message).replace(/\.$/, "") : "the taking back couldn't be signed"}.`;
  }
}

/** Which applet the approvals kept for this record name: the newest that is the person's own (signed by a key that
 *  counts, for the applet it says), so a row someone else wrote into the vault can't aim the taking back elsewhere.
 *  Throws when the home can't be read. */
async function approvedApplet(at: Subject): Promise<string | null> {
  const home = homeVault();
  if (!home) return null;
  const trusted = await trustedNow();
  let best: { n: number; applet: string } | null = null;
  for (const r of await rowsFor(home, at)) {
    const ev = r.metadata?.approval;
    let said: unknown;
    try { said = (JSON.parse(String((ev as { content?: unknown } | undefined)?.content)) as { subject?: { applet?: unknown } }).subject?.applet; } catch { continue; }
    if (typeof said !== "string" || !said) continue;
    const c = checkApproval(ev, { ...at, applet: said }, trusted, Date.now());
    if (c.ok && (!best || c.content.n > best.n)) best = { n: c.content.n, applet: said };
  }
  return best?.applet ?? null;
}

/** The approvals kept in the home vault for a subject (the events as written; `decide` checks them). */
export async function readApprovals(s: Subject): Promise<unknown[]> {
  const home = homeVault();
  if (!home) return [];
  return (await rowsFor(home, s)).map((r) => r.metadata?.approval);
}

/** Keep a signed approval in the home vault, where the person's other devices read it. */
export const writeApprovalEvent = (home: VaultRecord, s: Subject, name: string, ev: SignedEvent) => writeApproval(home, s, name, ev);

async function writeApproval(home: VaultRecord, s: Subject, name: string, ev: SignedEvent): Promise<void> {
  const c = clientFor(home);
  const [was] = await rowsFor(home, s);
  const body = `${name}: ${JSON.parse(ev.content).approved ? "approved" : "taken back"} (signed). See docs/design/APP-RECORD.md.`;
  if (was) await c.updateNote(was.id, { content: body, metadata: { ...(was.metadata ?? {}), approval: ev }, ...(was.updatedAt ? { if_updated_at: was.updatedAt } : {}) } as Parameters<typeof c.updateNote>[1]);
  else await c.createNote({ path: approvalPath(s), content: body, tags: [APPROVAL_TAG], metadata: { approval: ev } } as Parameters<typeof c.createNote>[0]);
}

// ── picks of Parachute's own applets (docs/ACCESS.md proposal 5) ──

/** The pick signed for an applet (one of Parachute's own names `parachute:<id>`), read from the newest approval that
 *  counts (approvals.ts `pickRead`: unconfirmed where one was seen and none counts now). `undefined`: this device
 *  doesn't check approvals (no key, no anchor), and keeps its own. */
export async function signedPick(s: Subject, now = Date.now()): Promise<PickRead | undefined> {
  const home = homeVault();
  if (!home || !(await approvalsHere())) return undefined;
  const events = await eventsFor(home, s, true);
  const trusted = await trustedNow(true);
  const floor = floorOf(s);
  const { newest } = newestOf(events, s, trusted, now);
  const read = pickRead(newest, floor);
  // the newest seen raises the floor, as for any approval: last week's wider pick can't be put back over it
  if (newest && (floor === null || newest.n >= floor)) raiseFloor(s, newest.n + (newest.approved ? 0 : 0.5));
  return read;
}

/** Sign a pick for one of Parachute's own applets: an approval holding the pick alone. Throws as `signApproval` does. */
export const signPick = (s: Subject, name: string, vaults: readonly VaultRef[] | null, passcode?: string | null, signed?: (c: Content) => void) =>
  signApproval({ subject: s, name, approved: true, code: PICK_CODE, scope: PICK_CODE, vaults, passcode, signed });

/** What this device calls itself on an approval it signs. */
export function deviceName(): string {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  return /Android/i.test(ua) ? "Android" : /Mac/i.test(ua) ? "Mac" : /Linux/i.test(ua) ? "Linux" : /Windows/i.test(ua) ? "Windows" : "a device";
}

/** Whether approving code here asks the passcode (this device's level for it, src-tauri/src/levels.rs). */
export async function passcodeHere(): Promise<boolean> { const n = await nativeNow(); return n ? n.levelsStatus().then((s) => s.levels.code === "passcode", () => false) : false; }
