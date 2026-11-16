// One VaultClient per vault record, with the token refreshed when the vault says it expired.
import { VaultClient } from "@openparachute/surface-client";
import { refresh } from "./oauth";
import { recordsFetch } from "./records";
import { findVault, updateVault, type VaultRecord } from "./store";
import { vaultUrl } from "./address";

const clients = new Map<string, { at: string; client: VaultClient }>();
/** One refresh at a time per vault: the hub rotates refresh tokens, so two at once could store a spent one. */
const refreshing = new Map<string, Promise<string | null>>();

export function refreshOnce(key: string, fetchImpl?: typeof fetch): Promise<string | null> {
  const running = refreshing.get(key);
  if (running) return running;
  const p = (async () => {
    const cur = findVault(key);
    if (!cur?.refreshToken) return null;
    try {
      const t = await refresh(cur.tokenEndpoint, cur.clientId, cur.refreshToken, fetchImpl ?? fetch.bind(globalThis));
      updateVault(cur.key, { accessToken: t.access_token, refreshToken: t.refresh_token ?? cur.refreshToken, expiresAt: t.expires_in ? Date.now() + t.expires_in * 1000 : undefined });
      return t.access_token;
    } catch { return null; }
  })().finally(() => refreshing.delete(key));
  refreshing.set(key, p);
  return p;
}

export function clientFor(rec: VaultRecord): VaultClient {
  const hit = clients.get(rec.key);
  const at = `${rec.issuer} ${rec.vault}`;
  if (hit && hit.at === at) return hit.client;
  const client = new VaultClient({
    vaultUrl: vaultUrl(rec.issuer, rec.vault),
    tokenProvider: () => findVault(rec.key)?.accessToken ?? rec.accessToken,
    onAuthError: () => refreshOnce(rec.key),
    // notes calls go through the hub's record door when it has one (records.ts)
    fetchImpl: recordsFetch(),
  });
  clients.set(rec.key, { at, client });
  return client;
}

export const dropClient = (key: string) => { clients.delete(key); };
