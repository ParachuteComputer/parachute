// Sign-in to a Parachute (a hub): OAuth 2.1 with PKCE and dynamic client registration, on surface-client's discovery,
// registration and PKCE helpers (docs/design/ONE-SIGN-IN.md). The app asks a hub only for what something the person
// allowed needs (docs/design/SCOPES.md), in two kinds of step:
//   list    (only without a key) a sign-in for `account:vaults`, whose token asks the hub which vaults are theirs, and
//           is ended at once
//   open    one vault at one level (read, or read and write): the home at sign-in (read), a vault the person opens
//           (read), what an applet they allow needs (its vault, read or write), or a change they make (write). Each
//           vault keeps one token, at the most any of those needs; asking again for more replaces it.
// The app registers itself on each hub as "Parachute" (on Parachute Cloud, which keeps that name, CLOUD_CLIENT_NAME); the hub keeps a new registration pending until its owner
// approves it once (the hub's own approve step). In a browser the redirect comes back to the page's own origin,
// /oauth/callback; in the shell, to a loopback address the shell catches (SHELL_RETURN below).

import {
  PendingApprovalError, deriveCodeChallenge, discoverAuthServer, generateCodeVerifier, generateState, registerClient,
  type TokenResponse,
} from "@openparachute/surface-client";
import { isLoopback } from "./address";
import { canList, levelIn, LIST_SCOPE, scopeFor, type Level, type Parachute } from "./parachute";

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

/** What follows when the hub says yes to an `open` step, beyond keeping the token: the applet the person allowed on its
 *  card, recorded only now (src/applet/grants.ts), so an Allow the hub refused allows nothing. */
export type AllowAfter = { subject: string; scope: string; html: string; mode: "sealed" | "approved-code"; asked?: { face: string[]; others: string[] };
  /** the Allow was tapped on the screen a start led to: the person's choice of it as home here, kept with the grant */
  home?: { vault: string; noteId: string } };

/** Why a vault is asked for: shown on the screen between steps, and kept with the vault (vault/reach.ts). */
export type Why = "signin" | "open" | "allow" | "write" | "narrow";

export type Pending = {
  /** the Parachute (its address, issuer, account MCP and where its vaults live) */
  parachute: Parachute;
  step: "list" | "open";
  /** step "open": the vault, and how much of it */
  vault?: string;
  level?: Level;
  why: Why;
  /** where the app goes after (the applet that asked, the screen that needed a change); the launcher when none */
  back?: string;
  allow?: AllowAfter;
  /** at sign-in: the vault asked for is to be this device's home */
  home?: boolean;
  /** at sign-in: whose each listed vault is, as the person said; kept only when the hub's consent comes back */
  marks?: { listed: string[]; whose: "mine" | "theirs"; mine: string[] | null; solo: boolean };
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

/** In the shell, the loopback address the shell catches (src-tauri/src/lib.rs SIGNIN_RETURN): a core hub keeps the
 *  name "Parachute" for redirects only this device can receive (Parachute Cloud doesn't: CLOUD_CLIENT_NAME). In a
 *  browser, this page's own origin. */
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

export type Begin = { parachute: Parachute; step: "list" | "open"; vault?: string; level?: Level; why?: Why; back?: string; allow?: AllowAfter; home?: boolean; marks?: Pending["marks"]; whose?: "mine" | "theirs"; how: "key" | "page";
  /** a new sign-in (not the next step of one): a registration a sign-in that never came back used is dropped */
  fresh?: boolean };

/** Start a step of signing in to a Parachute (or of asking it for one vault): returns the hub's authorize address to go to. The flow's secrets wait in
 *  this app's storage. */
export async function beginSignIn(b: Begin, fetchImpl: typeof fetch = fetch.bind(globalThis)): Promise<string> {
  const { parachute } = b;
  if (b.step === "open" && !b.vault) throw new Error("No vault to sign in to.");
  const scope = b.step === "list" ? LIST_SCOPE : scopeFor(b.vault!, b.level ?? "read");
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
  if (b.fresh && stale && stale.issuer === parachute.issuer && (stale.step === "list" || (stale.step === "open" && stale.why === "signin" && stale.how === "key"))) forgetClient(parachute.issuer);
  // the hub's reserved id for this app (Parachute Cloud's `parachute-app`, cloud #421), for the return only the shell
  // catches: its pages name it Parachute, not an app that registered itself
  let clientId = parachute.appClientId && redirect === SHELL_RETURN ? parachute.appClientId : cachedClient(parachute.issuer, redirect);
  if (!clientId) {
    clientId = (await registerClient(meta.registration_endpoint, { clientName: parachute.door === "cloud" ? CLOUD_CLIENT_NAME : CLIENT_NAME, redirectUri: redirect }, fetchImpl)).client_id;
    cacheClient(parachute.issuer, redirect, clientId);
  }
  const codeVerifier = generateCodeVerifier();
  const state = generateState();
  const revocation = (meta as { revocation_endpoint?: unknown }).revocation_endpoint;
  const pending: Pending = { parachute, step: b.step, ...(b.step === "open" ? { vault: b.vault, level: b.level ?? "read" } : {}), why: b.why ?? "signin",
    ...(b.back ? { back: b.back } : {}), ...(b.allow ? { allow: b.allow } : {}), ...(b.home ? { home: true } : {}), ...(b.marks ? { marks: b.marks } : {}),
    issuer: parachute.issuer, tokenEndpoint: meta.token_endpoint, ...(onOrigin(revocation, parachute.issuer) ? { revocationEndpoint: revocation } : {}),
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
  if (b.step === "open") url.searchParams.set("vault", b.vault!);
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

/** A finished step: its token, and for an `open` step the vault it reads and what the hub gave of it. */
export type SignedIn = { pending: Pending; token: TokenResponse; vault: string | null; level: Level | null };

/** The vault a token is for: its audience (`vault.<name>`), when it says. */
export function audienceVault(accessToken: string): string | null {
  try {
    const claims = JSON.parse(atob(accessToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))) as { aud?: unknown };
    const aud = Array.isArray(claims.aud) ? claims.aud[0] : claims.aud;
    return typeof aud === "string" && aud.startsWith("vault.") ? aud.slice(6) : null;
  } catch { return null; }
}

/** Finish a step of signing in: check the state, trade the code for a token. Used once: the flow's secrets are gone
 *  after. For an `open` step, the token must be for the vault asked for, and hold at least read of it. */
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
  // a token refused below is ended at the hub first: nothing on this device holds it
  const endIt = () => revoke({ issuer: pending.issuer, clientId: pending.clientId, refreshToken: token.refresh_token, revocationEndpoint: pending.revocationEndpoint });
  if (pending.step === "list") {
    if (!canList(token.scope)) { await endIt(); throw new Error("The hub didn't let Parachute see which vaults are yours. Nothing was added."); }
    return { pending, token, vault: null, level: null };
  }
  // what the token holds of the vault asked for: the hub's word (its scope); a token for something else (account-wide,
  // or another vault) is refused, not stored
  const vault = pending.vault!;
  const level = levelIn(token.scope, vault);
  if (!level) { await endIt(); throw new Error(`The hub didn't give Parachute the ${vault} vault. Nothing was added.`); }
  // more than was asked (the hub's page lets the person tick extra access): not kept; the app holds only what it asked
  const extra = (token.scope ?? "").split(/\s+/).filter((w) => w && !scopeFor(vault, pending.level ?? "read").split(" ").includes(w));
  // (the token it gave is ended at once: nothing holds it)
  if (extra.length) { await endIt(); throw new Error(`The hub gave more than Parachute asked for (${extra.join(", ").slice(0, 120)}). Nothing was added: ask again without the extra access.`); }
  const aud = audienceVault(token.access_token) ?? token.vault ?? vault;
  if (aud !== vault) { await endIt(); throw new Error("The hub's token is for a vault it wasn't asked for. Nothing was added."); }
  return { pending, token, vault, level };
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
