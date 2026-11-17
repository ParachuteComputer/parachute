// One sign-in per Parachute (docs/design/ONE-SIGN-IN.md): the hub's one grant to this app for all the person's vaults
// there, and its one refresh chain. Each vault record of that Parachute names its sign-in; a vault's token comes from
// refreshing the chain re-aimed at that vault (`resource=<vault>/mcp`).
//
// The hub rotates the refresh token on every use, and a spent one used again after about a minute revokes the whole
// chain. So refreshes of one sign-in run one at a time (in this page, and across tabs where the browser has locks), and
// each new refresh token is stored before the next refresh starts.
import type { TokenResponse } from "@openparachute/surface-client";

export type SignIn = {
  id: string;
  /** the Parachute's address (an origin) and its OAuth issuer */
  hub: string;
  issuer: string;
  tokenEndpoint: string;
  revocationEndpoint?: string;
  clientId: string;
  refreshToken: string;
  /** where its vaults live: `https://hub/vault/{name}` */
  vaultTemplate: string;
  addedAt: string;
};

export const SIGNINS_KEY = "parachute.signins.v1";
const storage = () => (typeof localStorage === "undefined" ? null : localStorage);

function valid(s: unknown): s is SignIn {
  const v = s as Record<string, unknown> | null;
  return !!v && ["id", "hub", "issuer", "tokenEndpoint", "clientId", "refreshToken", "vaultTemplate"].every((k) => typeof v[k] === "string" && v[k]);
}
export function listSignIns(): SignIn[] {
  try { const v: unknown = JSON.parse(storage()?.getItem(SIGNINS_KEY) ?? "[]"); return Array.isArray(v) ? v.filter(valid) : []; } catch { return []; }
}
function write(list: SignIn[]) { try { storage()?.setItem(SIGNINS_KEY, JSON.stringify(list)); } catch { /* this session only */ } }
export const findSignIn = (id: string | undefined) => (id ? listSignIns().find((s) => s.id === id) ?? null : null);
export function saveSignIn(s: SignIn) { write([...listSignIns().filter((x) => x.id !== s.id), s]); }
export function removeSignIn(id: string) { write(listSignIns().filter((x) => x.id !== id)); }
const setRefresh = (id: string, refreshToken: string) => write(listSignIns().map((s) => (s.id === id ? { ...s, refreshToken } : s)));

export const newSignInId = () => {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
};

/** What a vault's token is aimed with: its MCP address, the shape the hub's refresh takes (resource-binding.ts). */
export const resourceFor = (vaultUrl: string) => `${vaultUrl}/mcp`;

// one refresh at a time per sign-in, in this page
const queues = new Map<string, Promise<unknown>>();
function serial<T>(id: string, run: () => Promise<T>): Promise<T> {
  const before = queues.get(id) ?? Promise.resolve();
  const p = before.then(() => withLock(id, run), () => withLock(id, run));
  queues.set(id, p.catch(() => undefined));
  return p;
}
/** Across tabs: the browser's lock where it has one; otherwise this page's queue alone. */
function withLock<T>(id: string, run: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== "undefined" ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
  return locks ? locks.request(`parachute-signin-${id}`, run) as Promise<T> : run();
}

/** A fresh token for one vault of a sign-in: refresh its chain aimed at that vault. Throws `refresh failed (<status>)`
 *  as the one-vault refresh does, so a refusal reads the same. */
export function refreshFor(id: string, vaultUrl: string, fetchImpl: typeof fetch = fetch.bind(globalThis)): Promise<TokenResponse> {
  return serial(id, async () => {
    // read inside the queue: the token stored by the refresh before this one
    const s = findSignIn(id);
    if (!s) throw new Error("refresh failed (401)");
    const res = await fetchImpl(s.tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: s.refreshToken, client_id: s.clientId, resource: resourceFor(vaultUrl) }).toString(),
    });
    if (!res.ok) throw new Error(`refresh failed (${res.status})`);
    const token = (await res.json()) as TokenResponse;
    if (!token.access_token) throw new Error("refresh gave no token");
    if (token.refresh_token) setRefresh(id, token.refresh_token);
    return token;
  });
}
