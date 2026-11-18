// TEST ONLY. Uni's sealed cards and secret requests in JavaScript, for the end-to-end tests of the web build (with
// e2eNative.ts, which has no Rust behind it) and for the tests' synthetic Uni, which makes cards and opens answers. The
// app's own checks are Rust's (src-tauri/src/approvals, ported from the Uni app with its tests); this follows the same
// wire (the Uni app's crates/uni-core/src/sealed_card.rs, secret.rs, sealed.rs) closely enough to drive the flow.
import { finalizeEvent, generateSecretKey, getEventHash, getPublicKey, verifyEvent } from "nostr-tools/pure";
import * as nip44 from "nostr-tools/nip44";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import type { SignedEvent } from "./native";

const enc = new TextEncoder();
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
const unhex = (h: string) => Uint8Array.from(h.match(/../g)!.map((x) => parseInt(x, 16)));
const N = BigInt("0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141");
const now = () => Math.floor(Date.now() / 1000);

/** The sealing key the Uni app derives from an identity (here: approval) secret key. */
export function sealSecret(sk: Uint8Array): Uint8Array {
  const prk = hmac(sha256, enc.encode("uni-sealed/v1"), sk);
  for (let c = 1; c < 256; c++) {
    const k = hmac(sha256, prk, new Uint8Array([...enc.encode("uni-sealed-credentials/v1 seal key"), c]));
    const n = BigInt("0x" + hex(k));
    if (n > 0n && n < N) return k;
  }
  throw new Error("no sealing key");
}
export const sealPub = (sk: Uint8Array) => getPublicKey(sealSecret(sk));

/** Sorted keys, no spaces, integers only (Python's json.dumps(sort_keys=True, separators=(",", ":"))). */
export function canonical(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (typeof v === "object") return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`;
  if (typeof v === "number" && !Number.isInteger(v)) throw new Error("integers only");
  return JSON.stringify(v);
}
const sha = (s: string) => hex(sha256(enc.encode(s)));
export const payloadDigest = (action: string, payload: unknown) => sha(`uni-sealed-payload/v1\n${action}\n${canonical(payload)}`);
export const requestDigest = (fields: unknown) => sha(`uni-sealed-request/v1\n${canonical(fields)}`);

const FIELDS = ["v", "rid", "action", "credential", "class", "scope", "ttl_s", "uses", "payload", "payload_digest", "expires", "rpk", "box"];
const CAPS = { routine: [50_400, 200], powerful: [600, 1] } as const;

// ── Uni's side (the tests' synthetic Uni) ──

/** A card Uni would post: the fenced fields, the one-time secret for its answer, and the data key in its box. */
export function makeCard(o: { uni: Uint8Array; sealPubHex: string; room: string; credential: string; action: string; scope: string; payload: unknown; class: "routine" | "powerful"; ttl_s: number; uses?: number; expires?: number }) {
  const rsk = generateSecretKey();
  const esk = generateSecretKey();
  const dek = hex(generateSecretKey());
  const ct_sha256 = hex(generateSecretKey());
  const inner = JSON.stringify({ v: 1, name: o.credential, class: o.class, dek, ct_sha256 });
  const dek_box = nip44.encrypt(inner, nip44.getConversationKey(esk, o.sealPubHex));
  const fields = {
    v: 1, rid: hex(generateSecretKey()).slice(0, 32), action: o.action, credential: o.credential, class: o.class, scope: o.scope,
    ttl_s: o.ttl_s, uses: o.uses ?? 1, payload: o.payload, payload_digest: payloadDigest(o.action, o.payload),
    expires: o.expires ?? now() + 3600, rpk: getPublicKey(rsk), box: { epk: getPublicKey(esk), dek_box, ct_sha256 },
  };
  const content = `Uni asks to use ${o.credential}.\n\n\`\`\`uni-sealed-approval\n${JSON.stringify(fields)}\n\`\`\``;
  const event = finalizeEvent({ kind: 9, created_at: now(), content, tags: [["h", o.room]] }, o.uni) as SignedEvent;
  return { event, fields, rsk, dek, requestDigest: requestDigest(fields) };
}

/** Uni's check of an answer (as uni-ops sealed.py `_reply` does): the wrap opens with the one-time secret, the seal is
 *  signed by `owner`, the rumor is 46042 naming this card, rid and digest match. Returns the rumor's content. */
export function openAnswer(wrap: SignedEvent, rsk: Uint8Array, owner: string, card: { id: string; rid: string; requestDigest: string }) {
  if (wrap.kind !== 1059 || !verifyEvent(wrap as Parameters<typeof verifyEvent>[0])) throw new Error("not a signed wrap");
  const seal = JSON.parse(nip44.decrypt(wrap.content, nip44.getConversationKey(rsk, wrap.pubkey))) as SignedEvent;
  if (seal.kind !== 13 || !verifyEvent(seal as Parameters<typeof verifyEvent>[0])) throw new Error("not a signed seal");
  if (seal.pubkey !== owner) throw new Error("the seal isn't the owner's");
  const rumor = JSON.parse(nip44.decrypt(seal.content, nip44.getConversationKey(rsk, seal.pubkey))) as Omit<SignedEvent, "sig"> & { sig?: string };
  if (rumor.pubkey !== seal.pubkey || rumor.sig !== undefined || rumor.kind !== 46042) throw new Error("not an answer");
  if (!rumor.tags.some((t) => t[0] === "e" && t[1] === card.id)) throw new Error("another card");
  const body = JSON.parse(rumor.content) as { v: number; rid: string; request_digest: string; decision: string; dek?: string };
  if (body.rid !== card.rid || body.request_digest !== card.requestDigest) throw new Error("another request");
  return body;
}

// ── the app's side (e2eNative) ──

function fenced(body: string, lang: string): string | null {
  const open = "```" + lang + "\n";
  const at = body.indexOf(open);
  if (at < 0) return null;
  const end = body.indexOf("\n```", at + open.length);
  if (end < 0 || body.indexOf(open, at + open.length) >= 0) throw new Error("This card is incomplete.");
  return body.slice(at + open.length, end);
}

export type Checked = { rows: { f: Record<string, unknown>; dek: string; digest: string }[] };
/** The Uni app's check_card, briefly: author trusted, fields exact, not expired, digests, the box opens, class and caps. */
export function checkCard(ev: SignedEvent, trusted: string[], approvalSk: Uint8Array): Checked {
  if (!verifyEvent(ev as Parameters<typeof verifyEvent>[0]) || ev.kind !== 9 || !trusted.includes(ev.pubkey)) throw new Error("Not signed by Uni.");
  const block = fenced(ev.content, "uni-sealed-approval");
  if (!block) throw new Error("This card is incomplete.");
  const f = JSON.parse(block) as Record<string, unknown>;
  if (Object.keys(f).length !== FIELDS.length || !FIELDS.every((k) => k in f) || f.v !== 1) throw new Error("This card is incomplete.");
  if ((f.expires as number) <= now()) throw new Error("This card has expired.");
  if (payloadDigest(f.action as string, f.payload) !== f.payload_digest) throw new Error("What's shown doesn't match what's approved.");
  const box = f.box as { epk: string; dek_box: string; ct_sha256: string };
  let inner: { v: number; name: string; class: string; dek: string; ct_sha256: string };
  try { inner = JSON.parse(nip44.decrypt(box.dek_box, nip44.getConversationKey(sealSecret(approvalSk), box.epk))); } catch { throw new Error("This card isn't sealed to this device's approval key."); }
  if (inner.name !== f.credential || inner.ct_sha256 !== box.ct_sha256) throw new Error("The key in this card belongs to a different credential.");
  if (inner.class !== f.class) throw new Error("This card misstates the credential's class.");
  const [ttl, uses] = CAPS[f.class as "routine" | "powerful"];
  if ((f.ttl_s as number) > ttl || (f.uses as number) > uses) throw new Error("A credential can't be opened for that long.");
  return { rows: [{ f, dek: inner.dek, digest: requestDigest(f) }] };
}

/** NIP-59 as the Uni app builds it: rumor, seal signed by `sender`, wrap by a one-off key; both layers to `encTo`. */
export function wrap(sender: Uint8Array, route: string, encTo: string, kind: number, content: string, tags: string[][], expiration: number): SignedEvent {
  const rumor = { kind, content, tags, created_at: now(), pubkey: getPublicKey(sender) } as Record<string, unknown>;
  rumor.id = getEventHash(rumor as Parameters<typeof getEventHash>[0]);
  const seal = finalizeEvent({ kind: 13, content: nip44.encrypt(JSON.stringify(rumor), nip44.getConversationKey(sender, encTo)), tags: [], created_at: now() - Math.floor(Math.random() * 172_800) }, sender);
  const oneOff = generateSecretKey();
  return finalizeEvent({ kind: 1059, content: nip44.encrypt(JSON.stringify(seal), nip44.getConversationKey(oneOff, encTo)), tags: [["p", route], ["expiration", String(expiration)]], created_at: now() - Math.floor(Math.random() * 600) }, oneOff) as SignedEvent;
}

export function replyWrap(approvalSk: Uint8Array, card: SignedEvent, row: Checked["rows"][number], decision: "approve" | "deny"): SignedEvent {
  const body = { ...(decision === "approve" ? { dek: row.dek } : {}), v: 1, rid: row.f.rid, request_digest: row.digest, decision };
  return wrap(approvalSk, card.pubkey, row.f.rpk as string, 46042, JSON.stringify(body), [["e", card.id]], row.f.expires as number);
}

export type SecretRequest = { v: number; rid: string; name: string; label: string; purpose: string; store: string; keep_days: number; expires: number; rpk: string };
export function secretRequest(ev: SignedEvent): SecretRequest {
  const open = "```uni-secret-request\n";
  const at = ev.content.lastIndexOf(open);
  const end = at < 0 ? -1 : ev.content.indexOf("\n```", at + open.length);
  if (end < 0) throw new Error("not a secret request");
  return JSON.parse(ev.content.slice(at + open.length, end).trim()) as SecretRequest;
}
export const deliveryWrap = (sk: Uint8Array, ev: SignedEvent, r: SecretRequest, value: string) =>
  wrap(sk, ev.pubkey, r.rpk, 46040, JSON.stringify({ value, v: 1, rid: r.rid, name: r.name }), [["e", ev.id], ["p", ev.pubkey]], now() + 86_400);
export const forgetWrap = (sk: Uint8Array, ev: SignedEvent, r: SecretRequest) =>
  wrap(sk, ev.pubkey, ev.pubkey, 46041, JSON.stringify({ v: 1, name: r.name, rid: r.rid }), [["p", ev.pubkey]], now() + 86_400);
export { unhex, hex };
