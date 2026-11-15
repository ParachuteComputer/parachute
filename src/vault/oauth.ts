// Sign-in to a vault on a hub: OAuth 2.1 with PKCE and dynamic client registration, the way Parachute's web app signs
// in (parachute-app src/lib/vault/oauth.ts), on surface-client's discovery, registration and PKCE helpers.
// The app registers itself on each hub as "Parachute"; the hub keeps a new registration pending until its owner
// approves it once (the hub's own approve step). The redirect comes back to this app's own origin, /oauth/callback:
// in the Android shell that is https://tauri.localhost/oauth/callback.

import {
  PendingApprovalError, deriveCodeChallenge, discoverAuthServer, generateCodeVerifier, generateState, registerClient,
  type TokenResponse,
} from "@openparachute/surface-client";
import { vaultUrl, type Address } from "./address";

export const CLIENT_NAME = "Parachute";
/** The scope for one named vault: the hub binds the token to it, with no vault picker on its page. */
export const scopeFor = (vault: string) => `vault:${vault}:read vault:${vault}:write`;
const PENDING_KEY = "parachute.oauth.pending.v1";
const CLIENTS_KEY = "parachute.oauth.clients.v1";
/** A flow older than this is stale: its code verifier is dropped. */
const PENDING_TTL_MS = 30 * 60_000;

export { PendingApprovalError };

export type Pending = {
  issuer: string;
  vault: string;
  tokenEndpoint: string;
  clientId: string;
  codeVerifier: string;
  state: string;
  redirectUri: string;
  startedAt: number;
};

export const redirectUri = (origin: string = window.location.origin) => `${origin}/oauth/callback`;

const isHttp = (raw: unknown): raw is string => {
  if (typeof raw !== "string") return false;
  try { const p = new URL(raw).protocol; return p === "https:" || p === "http:"; } catch { return false; }
};

function readJson<T>(key: string): T | null {
  try { return JSON.parse(localStorage.getItem(key) ?? "null") as T | null; } catch { return null; }
}

function cachedClient(issuer: string, redirect: string): string | null {
  const all = readJson<Record<string, string>>(CLIENTS_KEY) ?? {};
  return typeof all[`${issuer} ${redirect}`] === "string" ? all[`${issuer} ${redirect}`] : null;
}
function cacheClient(issuer: string, redirect: string, clientId: string) {
  const all = readJson<Record<string, string>>(CLIENTS_KEY) ?? {};
  all[`${issuer} ${redirect}`] = clientId;
  try { localStorage.setItem(CLIENTS_KEY, JSON.stringify(all)); } catch { /* registers again next time */ }
}
/** Forget this app's registration on a hub (the hub refused it as unknown). */
export function forgetClient(issuer: string) {
  const all = readJson<Record<string, string>>(CLIENTS_KEY) ?? {};
  for (const k of Object.keys(all)) if (k.startsWith(`${issuer} `)) delete all[k];
  try { localStorage.setItem(CLIENTS_KEY, JSON.stringify(all)); } catch { /* nothing to do */ }
}

/** Start signing in: returns the hub's authorize address to go to. The flow's secrets wait in this app's storage. */
export async function beginSignIn(address: Address, fetchImpl: typeof fetch = fetch.bind(globalThis)): Promise<string> {
  const redirect = redirectUri();
  const meta = await discoverAuthServer(vaultUrl(address.issuer, address.vault), fetchImpl);
  if (!isHttp(meta.authorization_endpoint) || !isHttp(meta.token_endpoint)) throw new Error("The hub's sign-in addresses aren't web addresses.");
  let clientId = cachedClient(meta.issuer, redirect);
  if (!clientId) {
    clientId = (await registerClient(meta.registration_endpoint, { clientName: CLIENT_NAME, redirectUri: redirect }, fetchImpl)).client_id;
    cacheClient(meta.issuer, redirect, clientId);
  }
  const codeVerifier = generateCodeVerifier();
  const state = generateState();
  const pending: Pending = { issuer: meta.issuer, vault: address.vault, tokenEndpoint: meta.token_endpoint, clientId, codeVerifier, state, redirectUri: redirect, startedAt: Date.now() };
  localStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  const url = new URL(meta.authorization_endpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirect);
  url.searchParams.set("code_challenge", await deriveCodeChallenge(codeVerifier));
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  url.searchParams.set("scope", scopeFor(address.vault));
  url.searchParams.set("vault", address.vault);
  return url.toString();
}

export function takePending(now = Date.now()): Pending | null {
  const p = readJson<Pending>(PENDING_KEY);
  localStorage.removeItem(PENDING_KEY);
  if (!p || typeof p.state !== "string" || typeof p.codeVerifier !== "string" || now - (p.startedAt ?? 0) > PENDING_TTL_MS) return null;
  return p;
}

export type SignedIn = { pending: Pending; token: TokenResponse; vault: string };

/** Finish signing in: check the state, trade the code for a token. Used once: the flow's secrets are gone after. */
export async function completeSignIn(code: string, state: string, fetchImpl: typeof fetch = fetch.bind(globalThis)): Promise<SignedIn> {
  const pending = takePending();
  if (!pending) throw new Error("This sign-in has expired or was already used. Start again from Add a vault.");
  if (pending.state !== state) throw new Error("This sign-in doesn't match the one this app started. Start again.");
  const res = await fetchImpl(pending.tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: pending.codeVerifier, client_id: pending.clientId, redirect_uri: pending.redirectUri }).toString(),
  });
  const text = await res.text();
  if (!res.ok) {
    let body: Record<string, unknown> = {};
    try { body = JSON.parse(text) as Record<string, unknown>; } catch { /* not JSON */ }
    if (body.error === "invalid_client" && isHttp(body.approve_url)) throw new PendingApprovalError(body.approve_url);
    if (body.error === "invalid_client") forgetClient(pending.issuer);
    throw new Error(`The hub refused the sign-in (${res.status}${typeof body.error === "string" ? `, ${body.error}` : ""}).`);
  }
  const token = JSON.parse(text) as TokenResponse;
  if (!token.access_token) throw new Error("The hub's answer had no token.");
  // the token must be for the vault asked for: an account-wide or other vault's token is refused, not stored
  const vault = token.vault ?? (typeof token.scope === "string" && token.scope.split(" ").includes(`vault:${pending.vault}:read`) ? pending.vault : null);
  if (vault !== pending.vault) throw new Error(`The hub signed in to something other than the ${pending.vault} vault. Nothing was added.`);
  return { pending, token, vault };
}

/** A fresh access token (and the rotated refresh token) for a record. */
export async function refresh(tokenEndpoint: string, clientId: string, refreshToken: string, fetchImpl: typeof fetch = fetch.bind(globalThis)): Promise<TokenResponse> {
  const res = await fetchImpl(tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId }).toString(),
  });
  if (!res.ok) throw new Error(`refresh failed (${res.status})`);
  const token = (await res.json()) as TokenResponse;
  if (!token.access_token) throw new Error("refresh gave no token");
  return token;
}
