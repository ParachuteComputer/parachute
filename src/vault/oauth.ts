// Sign-in to a vault on a hub: OAuth 2.1 with PKCE and dynamic client registration, the way Parachute's web app signs
// in (parachute-app src/lib/vault/oauth.ts), on surface-client's discovery, registration and PKCE helpers.
// The app registers itself on each hub as "Parachute"; the hub keeps a new registration pending until its owner
// approves it once (the hub's own approve step). In a browser the redirect comes back to the page's own origin,
// /oauth/callback; in the shell, to a loopback address the shell catches (SHELL_RETURN below).

import {
  PendingApprovalError, deriveCodeChallenge, discoverAuthServer, generateCodeVerifier, generateState, registerClient,
  type TokenResponse,
} from "@openparachute/surface-client";
import { isLoopback, vaultUrl, type Address } from "./address";

export const CLIENT_NAME = "Parachute";
/** The scope for one named vault: the hub binds the token to it, with no vault picker on its page. */
export const scopeFor = (vault: string) => `vault:${vault}:read vault:${vault}:write`;
const PENDING_KEY = "parachute.oauth.pending.v1";
const CLIENTS_KEY = "parachute.oauth.clients.v1";
/** A flow older than this is stale: its code verifier is dropped. */
const PENDING_TTL_MS = 30 * 60_000;

export { PendingApprovalError };
import { limitedFetch } from "./limited";

export type Pending = {
  issuer: string;
  vault: string;
  tokenEndpoint: string;
  /** where Sign out ends the sign-in, when the hub names one on its own origin */
  revocationEndpoint?: string;
  clientId: string;
  codeVerifier: string;
  state: string;
  redirectUri: string;
  startedAt: number;
  /** whose the person said it is, on Add a vault (vault/whose.ts): kept when the sign-in comes back */
  whose?: "mine" | "theirs";
};

/** In the shell, the loopback address the shell catches (src-tauri/src/lib.rs SIGNIN_RETURN): a hub keeps the name
 *  "Parachute" for redirects only this device can receive. In a browser, this page's own origin. */
export const SHELL_RETURN = "http://127.0.0.1:47219/oauth/callback";
export const inShell = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
export const redirectUri = (origin: string = window.location.origin) => (inShell() ? SHELL_RETURN : `${origin}/oauth/callback`);

const isHttp = (raw: unknown): raw is string => {
  if (typeof raw !== "string") return false;
  try { const p = new URL(raw).protocol; return p === "https:" || p === "http:"; } catch { return false; }
};
/** An address on the hub's own origin: https, or http only on this machine. */
export const onOrigin = (raw: unknown, origin: string): raw is string => {
  if (!isHttp(raw)) return false;
  const u = new URL(raw);
  return u.origin === origin && (u.protocol === "https:" || isLoopback(u.hostname));
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
export async function beginSignIn(address: Address, fetchImpl: typeof fetch = fetch.bind(globalThis), whose?: "mine" | "theirs"): Promise<string> {
  const redirect = redirectUri();
  const meta = await discoverAuthServer(vaultUrl(address.issuer, address.vault), fetchImpl);
  // the hub must name itself as the address typed (RFC 8414 3.3), and keep its sign-in on that origin
  let named = "";
  try { named = new URL(String(meta.issuer)).origin; } catch { /* not an address: refused below */ }
  if (named !== address.issuer) throw new Error(`That hub calls itself ${String(meta.issuer).slice(0, 80)}, not ${address.issuer}. Nothing was added.`);
  if (![meta.authorization_endpoint, meta.token_endpoint, meta.registration_endpoint].every((e) => onOrigin(e, address.issuer))) throw new Error("The hub's sign-in addresses aren't on the hub itself. Nothing was added.");
  // a sign-in that never came back may have died on a registration the hub no longer knows: register again
  const stale = readJson<Pending>(PENDING_KEY);
  if (stale && stale.issuer === address.issuer) forgetClient(address.issuer);
  let clientId = cachedClient(address.issuer, redirect);
  if (!clientId) {
    clientId = (await registerClient(meta.registration_endpoint, { clientName: CLIENT_NAME, redirectUri: redirect }, fetchImpl)).client_id;
    cacheClient(address.issuer, redirect, clientId);
  }
  const codeVerifier = generateCodeVerifier();
  const state = generateState();
  // the vault's own metadata may leave out where to revoke; the hub's names it
  let revocation = (meta as { revocation_endpoint?: unknown }).revocation_endpoint;
  if (!onOrigin(revocation, address.issuer)) revocation = await discoverAuthServer(address.issuer, fetchImpl).then((m) => (m as { revocation_endpoint?: unknown }).revocation_endpoint, () => undefined);
  const pending: Pending = { issuer: address.issuer, vault: address.vault, tokenEndpoint: meta.token_endpoint, ...(onOrigin(revocation, address.issuer) ? { revocationEndpoint: revocation } : {}), clientId, codeVerifier, state, redirectUri: redirect, startedAt: Date.now(), ...(whose ? { whose } : {}) };
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

/** Drop the sign-in flow this app started (a key sign-in that the hub refused: the registration is still good). */
export function dropPending() { localStorage.removeItem(PENDING_KEY); }

/** The flow this app started, if `state` is its state; it is then used up. A wrong state leaves it waiting (a stray link can't cancel it). */
export function takePending(state: string, now = Date.now()): Pending | "mismatch" | null {
  const p = readJson<Pending>(PENDING_KEY);
  if (!p || typeof p.state !== "string" || typeof p.codeVerifier !== "string" || now - (p.startedAt ?? 0) > PENDING_TTL_MS) { localStorage.removeItem(PENDING_KEY); return null; }
  if (p.state !== state) return "mismatch";
  localStorage.removeItem(PENDING_KEY);
  return p;
}

export type SignedIn = { pending: Pending; token: TokenResponse; vault: string };

/** Finish signing in: check the state, trade the code for a token. Used once: the flow's secrets are gone after. */
export async function completeSignIn(code: string, state: string, fetchImpl?: typeof fetch): Promise<SignedIn> {
  const pending = takePending(state);
  if (!pending) throw new Error("This sign-in has expired or was already used. Start again from Add a vault.");
  if (pending === "mismatch") throw new Error("This sign-in doesn't match the one this app started. Start again.");
  // someone else's hub is read up to a limit (limited.ts); the person's own (or one they didn't say) as before
  const f = fetchImpl ?? (pending.whose === "theirs" ? limitedFetch() : fetch.bind(globalThis));
  const res = await f(pending.tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: pending.codeVerifier, client_id: pending.clientId, redirect_uri: pending.redirectUri }).toString(),
  });
  const text = await res.text();
  if (!res.ok) {
    let body: Record<string, unknown> = {};
    try { body = JSON.parse(text) as Record<string, unknown>; } catch { /* not JSON */ }
    if (body.error === "invalid_client" && onOrigin(body.approve_url, pending.issuer)) throw new PendingApprovalError(body.approve_url);
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

/** Tell the hub to end this app's sign-in (best effort: the record goes from this device either way). */
export async function revoke(rec: { issuer: string; clientId: string; refreshToken?: string; revocationEndpoint?: string }, fetchImpl: typeof fetch = fetch.bind(globalThis)): Promise<void> {
  if (!rec.refreshToken || !onOrigin(rec.revocationEndpoint, rec.issuer)) return;
  try {
    await fetchImpl(rec.revocationEndpoint, { method: "POST", signal: AbortSignal.timeout(5000), headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: rec.refreshToken, token_type_hint: "refresh_token", client_id: rec.clientId }).toString() });
  } catch { /* offline or refused: the local record still goes */ }
}
