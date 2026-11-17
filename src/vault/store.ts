// The vaults this device holds, one record per sign-in, kept in this app's own storage under `parachute.vaults.v1`.
// A record carries its hub (the OAuth issuer), the vault's name on it, and the token the hub gave this app.
// `key` is what routes use (`/v/<key>/…`): the vault's name, or name@host when two hubs hold vaults of the same name.

export type VaultRecord = {
  key: string;
  issuer: string;
  vault: string;
  tokenEndpoint: string;
  revocationEndpoint?: string;
  clientId: string;
  accessToken: string;
  refreshToken?: string;
  /** ms since the epoch */
  expiresAt?: number;
  scope: string;
  addedAt: string;
  /** the vault's API root, when it isn't `<issuer>/vault/<name>` (Parachute Cloud's vaults live on another host) */
  url?: string;
};

export const VAULTS_KEY = "parachute.vaults.v1";
type StorageLike = Pick<Storage, "getItem" | "setItem">;

const listeners = new Set<() => void>();
let cache: { raw: string | null; list: VaultRecord[] } | null = null;

const storage = (): StorageLike | null => (typeof localStorage === "undefined" ? null : localStorage);

function valid(r: unknown): r is VaultRecord {
  if (!r || typeof r !== "object") return false;
  const v = r as Record<string, unknown>;
  return ["key", "issuer", "vault", "tokenEndpoint", "clientId", "accessToken"].every((k) => typeof v[k] === "string" && v[k]) && typeof v.scope === "string";
}

export function listVaults(s: StorageLike | null = storage()): VaultRecord[] {
  let raw: string | null = null;
  try { raw = s?.getItem(VAULTS_KEY) ?? null; } catch { raw = null; }
  if (cache && cache.raw === raw) return cache.list;
  let list: VaultRecord[] = [];
  try { const v: unknown = JSON.parse(raw ?? "[]"); if (Array.isArray(v)) list = v.filter(valid); } catch { list = []; }
  cache = { raw, list };
  return list;
}

function write(list: VaultRecord[], s: StorageLike | null = storage()) {
  try { s?.setItem(VAULTS_KEY, JSON.stringify(list)); } catch { /* storage full or gone: the change lasts this session only */ }
  cache = null;
  listeners.forEach((f) => f());
}

/** The key for a new vault: its name, unless another hub's vault already has that name. */
export function keyFor(list: readonly VaultRecord[], issuer: string, vault: string): string {
  const same = list.find((r) => r.issuer === issuer && r.vault === vault);
  if (same) return same.key;
  if (!list.some((r) => r.key === vault)) return vault;
  return `${vault}@${hostOf(issuer)}`;
}

/** Keep a vault, or replace the record for the same hub and vault (signing in again). */
export function saveVault(rec: Omit<VaultRecord, "key">): VaultRecord {
  const list = listVaults();
  const key = keyFor(list, rec.issuer, rec.vault);
  const next = { ...rec, key };
  write([...list.filter((r) => r.key !== key), next]);
  return next;
}

export function updateVault(key: string, patch: Partial<VaultRecord>) {
  write(listVaults().map((r) => (r.key === key ? { ...r, ...patch, key } : r)));
}

export function removeVault(key: string) { write(listVaults().filter((r) => r.key !== key)); }

/** A vault's API root. */
export const vaultUrlOf = (r: Pick<VaultRecord, "issuer" | "vault" | "url">) => r.url ?? `${r.issuer}/vault/${encodeURIComponent(r.vault)}`;

export const findVault = (key: string | undefined) => listVaults().find((r) => r.key === key) ?? null;
/** The vault a web address names: its hub and its name, among the vaults this device holds. */
export const vaultAt = (issuer: string, vault: string) => listVaults().find((r) => r.issuer === issuer && r.vault === vault) ?? null;

/** Tell everyone who follows the vaults that something about them changed (whose one is, vault/whose.ts). */
export function touchVaults() { cache = null; listeners.forEach((f) => f()); }

export function subscribeVaults(cb: () => void): () => void {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => { if (!e.key || e.key === VAULTS_KEY) { cache = null; cb(); } };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => { listeners.delete(cb); if (typeof window !== "undefined") window.removeEventListener("storage", onStorage); };
}

/** The host of a hub's address, for showing; the address itself when it can't be read. */
export function hostOf(issuer: string): string { try { return new URL(issuer).host; } catch { return issuer; } }
