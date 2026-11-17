// One VaultClient per vault record, with the token refreshed when the vault says it expired.
import { VaultClient } from "@openparachute/surface-client";
import { refresh } from "./oauth";
import { recordsFetch } from "./records";
import { findVault, updateVault, vaultUrlOf, type VaultRecord } from "./store";
import { limitedFetch } from "./limited";
import { whoseOf } from "./whose";

/** The fetch for a vault's hub: someone else's is read up to a limit (limited.ts), the person's own as before. Judged per
 *  call, so a change of whose it is applies at once. */
const fetchFor = (rec: Pick<VaultRecord, "issuer" | "vault">): typeof fetch => {
  const limited = limitedFetch();
  return (input, init) => (whoseOf(rec) === "mine" ? fetch(input, init) : limited(input, init));
};

const clients = new Map<string, { at: string; client: VaultClient }>();
/** One refresh at a time per vault: the hub rotates refresh tokens, so two at once could store a spent one. */
const refreshing = new Map<string, Promise<string | null>>();

/** A refresh the hub answered no to: a 4xx, but not 429 (too many asks is not a no). */
export const refusedRefresh = (e: unknown) => e instanceof Error && /^refresh failed \(4(?!29)\d\d\)$/.test(e.message);

/** How the last refresh of each vault's sign-in ended, when it failed: the hub said no, or it didn't answer. */
const refreshFailed = new Map<string, "refused" | "unreachable">();

export function refreshOnce(key: string, fetchImpl?: typeof fetch): Promise<string | null> {
  const running = refreshing.get(key);
  if (running) return running;
  const p = (async () => {
    const cur = findVault(key);
    // no refresh token: the app can't ask, so it can't say the hub refused
    if (!cur?.refreshToken) { refreshFailed.set(key, "unreachable"); return null; }
    try {
      const t = await refresh(cur.tokenEndpoint, cur.clientId, cur.refreshToken, fetchImpl ?? fetchFor(cur));
      updateVault(cur.key, { accessToken: t.access_token, refreshToken: t.refresh_token ?? cur.refreshToken, expiresAt: t.expires_in ? Date.now() + t.expires_in * 1000 : undefined });
      refreshFailed.delete(key);
      return t.access_token;
    } catch (e) {
      // the hub answering no (a 4xx to the refresh) is a refusal; anything else (no answer, its own trouble) is not
      refreshFailed.set(key, refusedRefresh(e) ? "refused" : "unreachable");
      return null;
    }
  })().finally(() => refreshing.delete(key));
  refreshing.set(key, p);
  return p;
}

export function clientFor(rec: VaultRecord): VaultClient {
  const hit = clients.get(rec.key);
  const at = `${rec.issuer} ${rec.vault} ${rec.url ?? ""}`;
  if (hit && hit.at === at) return hit.client;
  const client = new VaultClient({
    vaultUrl: vaultUrlOf(rec),
    tokenProvider: () => findVault(rec.key)?.accessToken ?? rec.accessToken,
    onAuthError: () => refreshOnce(rec.key),
    // notes calls go through the hub's record door when it has one (records.ts)
    fetchImpl: recordsFetch(fetchFor(rec)),
  });
  clients.set(rec.key, { at, client });
  return client;
}

export const dropClient = (key: string) => { clients.delete(key); };

/**
 * Is this vault's sign-in still good, when a call to its hub failed with no answer the app could read? A hub may refuse a
 * token without the headers a browser needs to see the refusal (core 0.9 does, for a revoked token), so a failure that
 * looks like the network is checked by refreshing the sign-in: the hub answering no is a refused sign-in; no answer at
 * all is a hub out of reach; a fresh token means it was neither (try again).
 */
export async function signInState(key: string): Promise<"alive" | "refused" | "unreachable"> {
  const t = await refreshOnce(key);
  return t ? "alive" : refreshFailed.get(key) ?? "unreachable";
}
