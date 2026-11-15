// One VaultClient per vault record, with the token refreshed when the vault says it expired.
import { VaultClient } from "@openparachute/surface-client";
import { refresh } from "./oauth";
import { findVault, updateVault, type VaultRecord } from "./store";
import { vaultUrl } from "./address";

const clients = new Map<string, { at: string; client: VaultClient }>();

export function clientFor(rec: VaultRecord): VaultClient {
  const hit = clients.get(rec.key);
  const at = `${rec.issuer} ${rec.vault}`;
  if (hit && hit.at === at) return hit.client;
  const client = new VaultClient({
    vaultUrl: vaultUrl(rec.issuer, rec.vault),
    tokenProvider: () => findVault(rec.key)?.accessToken ?? rec.accessToken,
    onAuthError: async () => {
      const cur = findVault(rec.key);
      if (!cur?.refreshToken) return null;
      try {
        const t = await refresh(cur.tokenEndpoint, cur.clientId, cur.refreshToken);
        updateVault(cur.key, { accessToken: t.access_token, refreshToken: t.refresh_token ?? cur.refreshToken, expiresAt: t.expires_in ? Date.now() + t.expires_in * 1000 : undefined });
        return t.access_token;
      } catch { return null; }
    },
  });
  clients.set(rec.key, { at, client });
  return client;
}

export const dropClient = (key: string) => { clients.delete(key); };
