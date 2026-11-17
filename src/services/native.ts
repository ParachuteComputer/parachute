// The native side of the broker (src-tauri/src/services.rs): every use of the key, and every signed request, happens
// there. The web side registers an allowed applet's services for its session, then names only the session and a
// service. Rust checks each call against that registration again (docs/design/SERVICES.md). Bytes cross as base64.
//
// In a web build made for the end-to-end tests (VITE_E2E_SIGNER=1) the same calls are answered in JavaScript with a key
// the test gives (e2eNative.ts); that file is not in any other build.
import type { Service, Template } from "../applet/services";

export type SignedEvent = { id: string; pubkey: string; created_at: number; kind: number; tags: string[][]; content: string; sig: string };
export type HttpReq = { method: string; path: string; headers: Record<string, string>; body?: string /* base64 */ };
export type HttpRes = { status: number; headers: Record<string, string>; body: string /* base64 */ };
export type LogLine = { at: number; applet: string; service: string; what: string; id?: string; count?: number };

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
