// Sign-in to a Parachute (a hub): OAuth 2.1 with PKCE and dynamic client registration, on surface-client's discovery,
// registration and PKCE helpers (docs/design/ONE-SIGN-IN.md). One sign-in covers every vault the person may reach there:
//   list    (only without a key) a sign-in for `account:vaults`, whose token asks the hub which vaults are theirs
//   vaults  one consent naming all those vaults: its token is for the first of them
//   vault   for each of the others, the same sign-in once more for that vault alone: the hub's grant already covers it,
//           so it sends the person straight back with a code (no page), and the vault gets a token of its own
// The app registers itself on each hub as "Parachute" (on Parachute Cloud, which keeps that name, CLOUD_CLIENT_NAME); the hub keeps a new registration pending until its owner
// approves it once (the hub's own approve step). In a browser the redirect comes back to the page's own origin,
// /oauth/callback; in the shell, to a loopback address the shell catches (SHELL_RETURN below).

import {
  PendingApprovalError, deriveCodeChallenge, discoverAuthServer, generateCodeVerifier, generateState, registerClient,
  type TokenResponse,
} from "@openparachute/surface-client";
import { isLoopback } from "./address";
import { canList, grantedVaults, LIST_SCOPE, scopeForVaults, type Parachute } from "./parachute";

export const CLIENT_NAME = "Parachute";
/** Parachute Cloud refuses a name like "Parachute" from an app whose return address isn't one of Cloud's own (its guard
 *  against look-alikes, 2026-11-18): there the app registers under this, which its consent page shows. */
export const CLOUD_CLIENT_NAME = "Vault app";
const PENDING_KEY = "parachute.oauth.pending.v1";
const CLIENTS_KEY = "parachute.oauth.clients.v1";
/** A flow older than this is stale: its code verifier is dropped. */
const PENDING_TTL_MS = 30 * 60_000;

export { PendingApprovalError };
import { limitedFetch } from "./limited";

export type Pending = {
  /** the Parachute (its address, issuer, account MCP and where its vaults live) */
  parachute: Parachute;
  step: "list" | "vaults" | "vault";
  /** the vaults asked for (step "vaults"), or the one vault (step "vault") */
  vaults: string[];
  /** the vaults still to sign in to after this step, one by one */
  queue: string[];
  /** the scope the consent granted (steps "vault"): each vault asks for exactly what it holds, so the hub needn't ask */
  granted: string;
  /** the vaults this sign-in has kept so far */
  kept: string[];
  /** on a hub the person runs (every vault listed): the ones they said are theirs; the rest are someone else's */
  mine?: string[];
  issuer: string;
  tokenEndpoint: string;
  /** where Sign out ends the sign-in, when the hub names one on its own origin */
  revocationEndpoint?: string;
  clientId: string;
  codeVerifier: string;
  state: string;
  redirectUri: string;
  startedAt: number;
  /** whose the person said it is, on Add a Parachute (vault/whose.ts): kept when the sign-in comes back */
  whose?: "mine" | "theirs";
  /** how the person signs in at the hub: with this device's key (its key door) or on the hub's own page */
  how: "key" | "page";
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

export type Begin = { parachute: Parachute; step: "list" | "vaults" | "vault"; vaults?: string[]; queue?: string[]; granted?: string; kept?: string[]; mine?: string[]; whose?: "mine" | "theirs"; how: "key" | "page";
  /** a new sign-in (not the next step of one): a registration a sign-in that never came back used is dropped */
  fresh?: boolean };

/** The scope a vault holds in what a consent granted: its read, and its write if granted. */
export const scopeIn = (granted: string, vault: string) => granted.split(/\s+/).filter((w) => w === `vault:${vault}:read` || w === `vault:${vault}:write`).join(" ");

/** Start a step of signing in to a Parachute: returns the hub's authorize address to go to. The flow's secrets wait in
 *  this app's storage. */
export async function beginSignIn(b: Begin, fetchImpl: typeof fetch = fetch.bind(globalThis)): Promise<string> {
  const { parachute } = b;
  const vaults = b.step === "list" ? [] : [...(b.vaults ?? [])];
  if (b.step !== "list" && !vaults.length) throw new Error("No vaults to sign in to.");
  const scope = b.step === "list" ? LIST_SCOPE : b.step === "vaults" ? scopeForVaults(vaults) : scopeIn(b.granted ?? "", vaults[0]);
  if (!scope) throw new Error(`The hub didn't grant the ${vaults[0]} vault.`);
  const redirect = redirectUri();
  const meta = await discoverAuthServer(parachute.issuer, fetchImpl);
  // the hub must name itself as its own issuer (RFC 8414 3.3), and keep its sign-in on that origin
  let named = "";
  try { named = new URL(String(meta.issuer)).origin; } catch { /* not an address: refused below */ }
  if (named !== parachute.issuer) throw new Error(`That hub calls itself ${String(meta.issuer).slice(0, 80)}, not ${parachute.issuer}. Nothing was added.`);
  if (![meta.authorization_endpoint, meta.token_endpoint, meta.registration_endpoint].every((e) => onOrigin(e, parachute.issuer))) throw new Error("The hub's sign-in addresses aren't on the hub itself. Nothing was added.");
  // a sign-in that never came back may have died on a registration the hub no longer knows: register again (only at
  // a new sign-in: its next steps follow at once, with the registration the hub just took)
  const stale = readJson<Pending>(PENDING_KEY);
  // (only one that stopped at its first step: the listing, or the consent when the key listed the vaults; past that,
  // the hub took the registration, kept so a hub whose owner approves new registrations doesn't have to again)
  if (b.fresh && stale && stale.issuer === parachute.issuer && (stale.step === "list" || (stale.step === "vaults" && stale.how === "key"))) forgetClient(parachute.issuer);
  let clientId = cachedClient(parachute.issuer, redirect);
  if (!clientId) {
    clientId = (await registerClient(meta.registration_endpoint, { clientName: parachute.door === "cloud" ? CLOUD_CLIENT_NAME : CLIENT_NAME, redirectUri: redirect }, fetchImpl)).client_id;
    cacheClient(parachute.issuer, redirect, clientId);
  }
  const codeVerifier = generateCodeVerifier();
  const state = generateState();
  const revocation = (meta as { revocation_endpoint?: unknown }).revocation_endpoint;
  const pending: Pending = { parachute, step: b.step, vaults, queue: [...(b.queue ?? [])], granted: b.granted ?? "", kept: [...(b.kept ?? [])], ...(b.mine ? { mine: [...b.mine] } : {}), issuer: parachute.issuer, tokenEndpoint: meta.token_endpoint, ...(onOrigin(revocation, parachute.issuer) ? { revocationEndpoint: revocation } : {}),
    clientId, codeVerifier, state, redirectUri: redirect, startedAt: Date.now(), how: b.how, ...(b.whose ? { whose: b.whose } : {}) };
  localStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  const url = new URL(meta.authorization_endpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirect);
  url.searchParams.set("code_challenge", await deriveCodeChallenge(codeVerifier));
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  url.searchParams.set("scope", scope);
  if (b.step !== "list") url.searchParams.set("vault", vaults[0]);
  return url.toString();
}

/** The flow this app started, if `state` is its state, without using it up (what a sign-in kept so far, before a step
 *  that may fail). */
export function peekPending(state: string | null): Pending | null {
  const p = readJson<Pending>(PENDING_KEY);
  return p && state && p.state === state ? p : null;
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

export type SignedIn = { pending: Pending; token: TokenResponse; vaults: string[]; vault: string | null };

/** The vault a token is for: its audience (`vault.<name>`), when it says. */
export function audienceVault(accessToken: string): string | null {
  try {
    const claims = JSON.parse(atob(accessToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))) as { aud?: unknown };
    const aud = Array.isArray(claims.aud) ? claims.aud[0] : claims.aud;
    return typeof aud === "string" && aud.startsWith("vault.") ? aud.slice(6) : null;
  } catch { return null; }
}

/** Finish a step of signing in: check the state, trade the code for a token. Used once: the flow's secrets are gone
 *  after. `vaults`: the vaults the hub granted (steps "vaults" and "vault"), in the order asked; `vault`: the one this
 *  token reads. */
export async function completeSignIn(code: string, state: string, fetchImpl?: typeof fetch): Promise<SignedIn> {
  const pending = takePending(state);
  if (!pending) throw new Error("This sign-in has expired or was already used. Start again.");
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
  let token: TokenResponse;
  try { token = JSON.parse(text) as TokenResponse; } catch { throw new Error("The hub's answer couldn't be read."); }
  if (!token.access_token) throw new Error("The hub's answer had no token.");
  if (pending.step === "list") {
    if (!canList(token.scope)) throw new Error("The hub didn't let Parachute see which vaults are yours. Nothing was added.");
    return { pending, token, vaults: [], vault: null };
  }
  // the vaults this sign-in holds: the hub's word (the token's scope), among those asked for; a token for something
  // else (account-wide, or other vaults) is refused, not stored
  const vaults = grantedVaults(token.scope, pending.vaults);
  if (!vaults.length) throw new Error("The hub signed in to none of the vaults asked for. Nothing was added.");
  // the token reads the first vault it names (the hub's audience); one for a vault not granted here is refused
  const aud = audienceVault(token.access_token) ?? token.vault ?? vaults[0];
  if (!vaults.includes(aud)) throw new Error("The hub's token is for a vault it didn't grant here. Nothing was added.");
  return { pending, token, vaults, vault: aud };
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
    // keepalive: a revoke made as the page moves on (the sign-in's next step) still reaches the hub
    await fetchImpl(rec.revocationEndpoint, { method: "POST", keepalive: true, signal: AbortSignal.timeout(5000), headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: rec.refreshToken, token_type_hint: "refresh_token", client_id: rec.clientId }).toString() });
  } catch { /* offline or refused: the local record still goes */ }
}
