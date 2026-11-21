// Who reaches a vault, and changing it: Vault > Sharing (applets/vault.tsx) through the `sharing` words
// (applet/modules/vaults.ts). The hub answers that with three calls a whole-vault admin may make for that vault
// (core vault-grants.ts and account-keys.ts, T-476): the list of every key, AI and app that reaches the vault, a key
// made for an AI (all the vault's types, or some), and ending one.
//
// The app holds no admin anywhere (docs/design/SCOPES.md): managing asks the hub for this vault's admin, once, when the
// person asks to (`askManage`, the hub's own page or the key door), and holds it only while they are managing. It is
// never the vault's own token: it lives in this tab's session storage, is ended at the hub when they leave Sharing
// (`endManage`) or when it runs out (the hub's access tokens last 15 minutes), and is never refreshed.
import type { TokenResponse } from "@openparachute/surface-client";
import { revoke, type Pending } from "./oauth";
import { originOf, type VaultRecord } from "./store";

const KEY = "parachute.manage";

type Held = { issuer: string; vault: string; clientId: string; access: string; refresh?: string; revocationEndpoint?: string; until: number };

const all = (): Held[] => {
  try { const v = JSON.parse(sessionStorage.getItem(KEY) ?? "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
};
const save = (list: Held[]) => { try { sessionStorage.setItem(KEY, JSON.stringify(list)); } catch { /* storage full or off: nothing held */ } };
const same = (h: Held, rec: Pick<VaultRecord, "issuer" | "vault">) => h.issuer === rec.issuer && h.vault === rec.vault;
const end = (h: Held) => void revoke({ issuer: h.issuer, clientId: h.clientId, refreshToken: h.refresh, revocationEndpoint: h.revocationEndpoint });

/** Keep the admin the hub just gave for managing one vault (signInFlow.ts finishStep), ending any held before. */
export function holdManage(pending: Pending, token: TokenResponse, vault: string): void {
  const rest = all().filter((h) => {
    if (h.issuer === pending.issuer && h.vault === vault) { end(h); return false; }
    return true;
  });
  // a minute short of the hub's own end, so a call is never made with a token about to run out
  const life = (token.expires_in ?? 900) * 1000 - 60_000;
  rest.push({ issuer: pending.issuer, vault, clientId: pending.clientId, access: token.access_token, ...(token.refresh_token ? { refresh: token.refresh_token } : {}),
    ...(pending.revocationEndpoint ? { revocationEndpoint: pending.revocationEndpoint } : {}), until: Date.now() + Math.max(life, 30_000) });
  save(rest);
}

/** The admin held for managing this vault, when it is still good; one that ran out is ended and dropped. */
export function manageHeld(rec: Pick<VaultRecord, "issuer" | "vault">): Held | null {
  const list = all();
  const h = list.find((x) => same(x, rec)) ?? null;
  if (h && h.until <= Date.now()) {
    end(h);
    save(list.filter((x) => x !== h));
    return null;
  }
  return h;
}

/** Stop managing this vault: the admin held for it is ended at the hub and dropped here. */
export function endManage(rec: Pick<VaultRecord, "issuer" | "vault">): void {
  const list = all();
  for (const h of list.filter((x) => same(x, rec))) end(h);
  save(list.filter((x) => !same(x, rec)));
}

export class ManageEndedError extends Error {
  constructor() { super("Managing this vault has ended. Ask again to see who reaches it."); }
}

/** One call to the hub with the held admin. A refusal of the token itself (it ran out, or was ended) drops it. */
async function call<T>(rec: Pick<VaultRecord, "issuer" | "vault">, method: string, path: string, body?: unknown): Promise<T> {
  const h = manageHeld(rec);
  if (!h) throw new ManageEndedError();
  const res = await fetch(`${originOf(rec.issuer)}${path}`, {
    method,
    cache: "no-store",
    headers: { authorization: `Bearer ${h.access}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (res.status === 401) { endManage(rec); throw new ManageEndedError(); }
  if (!res.ok) {
    const m = (json as { message?: unknown } | null)?.message;
    throw new Error(typeof m === "string" && m ? m : `Your hub answered ${res.status}.`);
  }
  return json as T;
}

/** A row of the hub's list (core vault-grants.ts): one credential that reaches the vault. */
export type HubGrantRow = { id: string; state: string; types: Record<string, string[]>; expires_at: string | null; name: string; kind: string;
  app: string | null; client: string | null; admin?: boolean; export?: boolean; created_at: string; last_used_at: string | null };

export const listReach = (rec: Pick<VaultRecord, "issuer" | "vault">) =>
  call<{ grants: HubGrantRow[] }>(rec, "GET", `/account/vaults/${encodeURIComponent(rec.vault)}/statements`).then((r) => r.grants ?? []);

export const makeKey = (rec: Pick<VaultRecord, "issuer" | "vault">, k: { name: string; can: "read" | "write"; types: string[] | null }) =>
  call<{ name: string; token: string; expires_at: string; types?: string[] }>(rec, "POST", "/account/keys", { name: k.name, vault: rec.vault, can: k.can, ...(k.types ? { types: k.types } : {}) });

export const endReach = (rec: Pick<VaultRecord, "issuer" | "vault">, id: string) =>
  call<{ id: string; revoked_at: string }>(rec, "DELETE", `/account/vaults/${encodeURIComponent(rec.vault)}/statements/${encodeURIComponent(id)}`);
