// The native side of the broker (src-tauri/src/services.rs): every use of the key, and every signed request, happens
// there. The web side registers an allowed applet's services for its session, then names only the session and a
// service. Rust checks each call against that registration again (docs/design/SERVICES.md). Bytes cross as base64.
//
// In a web build made for the end-to-end tests (VITE_E2E_SIGNER=1) the same calls are answered in JavaScript with a key
// the test gives (e2eNative.ts); that file is not in any other build.
import type { Service, Template } from "../applet/services";

export type SignedEvent = { id: string; pubkey: string; created_at: number; kind: number; tags: string[][]; content: string; sig: string };
export type HttpReq = { method: string; path: string; headers: Record<string, string>; body?: string /* base64 */ };
export type HttpRes = { status: number; headers: Record<string, string>; body: string /* base64 */; graced?: boolean };
/** `at`: unix seconds. Oldest first. */
export type LogLine = { at: number; applet: string; service: string; what: string; id?: string; count?: number };
/** How a native call fails: `code` (no_key, no_session, not_granted, out_of_scope, bad_service, bad_event, no_token,
 *  too_large, unreachable, failed, storage, refused, hub_known, hub_listed, hub_probe, hub_unsure, hub_path) and words. */
export type NativeError = { code: string; message: string };

/** One request on Uni's card, as Rust checked it (docs/design/KEYRING.md). Never the data key. */
export type CardRow = {
  rid: string; action: string; credential: string; class: "routine" | "powerful"; scope: string; ttl_s: number; uses: number;
  payload: unknown; request_digest: string; expires: number; answer: { decision: "approve" | "deny"; at: number; until: number | null; sent: boolean } | null;
  always_unlock: boolean; asked: number; reach: string | null; read_key: string | null;
};
/** A card: its rows when every check passed, else the one line why and nothing to tap. */
export type CardView = { kind: "single" | "morning" | null; event_id: string; refused: string | null; rows: CardRow[];
  /** The author (hex), when the grant names it for approvals and only this device's trust is missing: the card may offer it. */
  trust?: string };
/** What an answer hands back to the shell: the wraps to publish (never to the frame), and whether a grace let it through. */
export type Answered = { wraps: { rid: string; wrap: SignedEvent }[]; graced: boolean; summary: string };
/** A secret request, for the shell's sheet: who asks (the trusted list's name), and Uni's words for it. */
export type SecretView = { requester: string; rid: string; name: string; label: string; purpose: string; store: string; keep_days: number; expires: number };
export type Approver = { name: string; pubkey: string };
export type KeyringStatus = { everyday: string; approval: string; same: boolean; seal_pub: string; approvers: Approver[] };

export interface Native {
  /** Register an allowed applet's services for a frame's session. `hubs`: the Parachute hub origins the web side knows
   *  (the person's list, and the hubs of the vaults on this device). Resolves who signs. */
  open(session: string, applet: { name: string; subject: string }, services: Service[], hubs: string[]): Promise<{ pubkey: string }>;
  close(session: string): Promise<void>;
  /** NIP-42: kind 22242 for the session's declared relay and this challenge. */
  relayAuth(session: string, service: string, challenge: string): Promise<SignedEvent>;
  signEvent(session: string, service: string, template: Template): Promise<SignedEvent>;
  http(session: string, service: string, req: HttpReq): Promise<HttpRes>;
  upload(session: string, service: string, body: string, type: string): Promise<unknown>;
  media(session: string, service: string, sha256: string, ext: string): Promise<{ type: string; body: string }>;
  privateOpen(session: string, service: string, event: SignedEvent): Promise<string>;
  privateSave(session: string, service: string, d: string, text: string): Promise<SignedEvent>;
  /** Keep (or with null, forget) a token for an applet's `token` service. */
  tokenSet(subject: string, service: Service, token: string | null): Promise<void>;
  tokenHas(subject: string, service: Service): Promise<boolean>;
  log(subject: string): Promise<LogLine[]>;
  /** Uni's card in this event, checked (author on the grant's list and the device's, the box opens, digests, replay). */
  cardView(session: string, service: string, event: SignedEvent): Promise<CardView>;
  /** Answer rows of a card: the device unlock first (native), the answers kept, the wraps handed back to publish. */
  /** Trust the card's author for approvals on this device: only a key the grant names, behind the device unlock. */
  cardTrust(session: string, service: string, event: SignedEvent, name: string): Promise<void>;
  cardAnswer(session: string, service: string, event: SignedEvent, decision: "approve" | "deny", rids: string[]): Promise<Answered>;
  /** The relay took this row's wrap. */
  cardSent(session: string, service: string, card: string, rid: string): Promise<void>;
  secretView(session: string, service: string, event: SignedEvent): Promise<SecretView>;
  /** Seal what the person typed on the shell's sheet: the wrap to publish. */
  secretSend(session: string, service: string, event: SignedEvent, value: string): Promise<SignedEvent>;
  secretForget(session: string, service: string, event: SignedEvent): Promise<SignedEvent>;
  keyring(): Promise<KeyringStatus>;
}

import { inShell } from "../vault/oauth";
import { shellNative } from "./shellNative";

let e2e: Native | null | undefined;
/** The native side here: the app's on a device; in a test build, the test signer when the test gave a key; else none
 *  (a browser has no key: services that sign need the app). */
export async function nativeNow(): Promise<Native | null> {
  if (inShell()) return shellNative;
  if (import.meta.env.VITE_E2E_SIGNER === "1") {
    if (e2e !== undefined) return e2e;
    const key = (window as unknown as { __parachuteE2EKey?: string }).__parachuteE2EKey;
    if (typeof key !== "string" || !/^[0-9a-f]{64}$/.test(key)) return (e2e = null);
    const { e2eNative } = await import("./e2eNative");
    return (e2e = e2eNative(key));
  }
  return null;
}
