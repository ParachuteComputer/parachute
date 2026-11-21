// Who reaches a vault, and changing it: Vault > Sharing (applets/vault.tsx) through the `sharing` words
// (applet/modules/vaults.ts). The hub answers that with three calls a whole-vault admin may make for that vault
// (core vault-grants.ts and account-keys.ts, T-476): the list of every key, AI and app that reaches the vault, a key
// made for an AI (all the vault's types, or some), and ending one.
//
// The app holds no admin anywhere (docs/design/SCOPES.md): managing asks the hub for this vault's admin, once, when the
// person asks to (`askManage`, the hub's own page or the key door), and holds it only while they are managing, for the
// applet that asked and no other. It is never the vault's own token: it lives in this tab's session storage, is never
// refreshed, and is ended at the hub (its access token and its refresh token) when the applet leaves Sharing, when the
// shell leaves or hides that applet (AppletScreen), when the page goes (`pagehide`: a reload, the tab closed), or when it
// runs out (the hub's access tokens last 15 minutes; an Android app sent to the background usually fires no `pagehide`,
// so there that limit is what ends it).
import type { TokenResponse } from "@openparachute/surface-client";
import type { Pending } from "./oauth";
import { onOrigin } from "./oauth";
import { originOf, type VaultRecord } from "./store";

const KEY = "parachute.manage";

export type Held = { issuer: string; vault: string; applet: string; clientId: string; access: string; refresh?: string; revocationEndpoint?: string; until: number };
type Where = Pick<VaultRecord, "issuer" | "vault">;

const all = (): Held[] => {
  try { const v = JSON.parse(sessionStorage.getItem(KEY) ?? "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
};
const save = (list: Held[]) => {
  try { if (list.length) sessionStorage.setItem(KEY, JSON.stringify(list)); else sessionStorage.removeItem(KEY); } catch { /* storage off: nothing held */ }
};
const same = (h: Held, rec: Where) => h.issuer === rec.issuer && h.vault === rec.vault;

/** End one at the hub: its refresh token and its access token (a hub may keep the access token alive past a refresh
 *  token's revoke). keepalive, so it reaches the hub as the page goes. */
function end(h: Held): void {
  if (!h.revocationEndpoint || !onOrigin(h.revocationEndpoint, h.issuer)) return;
  for (const [token, hint] of [[h.refresh, "refresh_token"], [h.access, "access_token"]] as const) {
    if (!token) continue;
    try {
      void fetch(h.revocationEndpoint, { method: "POST", keepalive: true, headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token, token_type_hint: hint, client_id: h.clientId }).toString() }).catch(() => {});
    } catch { /* offline: it runs out by itself within the hub's 15 minutes */ }
  }
}

let listening = false;
/** The page going ends everything held (a reload, the tab closed). */
function listen(): void {
  if (listening || typeof addEventListener !== "function") return;
  listening = true;
  addEventListener("pagehide", () => endAllManage());
}

/** Keep the admin the hub just gave for managing one vault (signInFlow.ts finishStep), ending any held before. */
export function holdManage(pending: Pick<Pending, "issuer" | "clientId" | "revocationEndpoint" | "applet">, token: TokenResponse, vault: string, now = Date.now()): void {
  const rest = all().filter((h) => {
    if (h.issuer === pending.issuer && h.vault === vault) { end(h); return false; }
    return true;
  });
  // a minute short of the hub's own end, so a call is never made with a token about to run out
  const life = (token.expires_in ?? 900) * 1000 - 60_000;
  rest.push({ issuer: pending.issuer, vault, applet: pending.applet ?? "", clientId: pending.clientId, access: token.access_token, ...(token.refresh_token ? { refresh: token.refresh_token } : {}),
    ...(pending.revocationEndpoint ? { revocationEndpoint: pending.revocationEndpoint } : {}), until: now + Math.max(life, 30_000) });
  save(rest);
  listen();
}

/** The admin held for managing this vault, for this applet, when it is still good; one that ran out is ended and
 *  dropped. Another applet gets nothing. */
export function manageHeld(rec: Where, applet: string, now = Date.now()): Held | null {
  listen();
  const list = all();
  const h = list.find((x) => same(x, rec)) ?? null;
  if (h && h.until <= now) {
    end(h);
    save(list.filter((x) => x !== h));
    return null;
  }
  return h && h.applet === applet ? h : null;
}

/** Stop managing this vault: the admin held for it is ended at the hub and dropped here. */
export function endManage(rec: Where): void {
  const list = all();
  for (const h of list.filter((x) => same(x, rec))) end(h);
  save(list.filter((x) => !same(x, rec)));
}

/** The shell left or hid an applet: whatever it was managing ends. */
export function endManageFor(applet: string): void {
  const list = all();
  for (const h of list.filter((x) => x.applet === applet)) end(h);
  save(list.filter((x) => x.applet !== applet));
}

/** End everything held in this tab. */
export function endAllManage(): void {
  for (const h of all()) end(h);
  save([]);
}

export class ManageEndedError extends Error {
  constructor() { super("Managing this vault has ended. Ask again to see who reaches it."); }
}

/** One call to the hub with the held admin. A refusal of the token itself (it ran out, or was ended) drops it. */
async function call<T>(rec: Where, applet: string, method: string, path: string, body?: unknown): Promise<T> {
  const h = manageHeld(rec, applet);
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

export const listReach = (rec: Where, applet: string) =>
  call<{ grants: HubGrantRow[] }>(rec, applet, "GET", `/account/vaults/${encodeURIComponent(rec.vault)}/statements`).then((r) => r.grants ?? []);

export const makeKey = (rec: Where, applet: string, k: { name: string; can: "read" | "write"; types: string[] | null }) =>
  call<{ name: string; token: string; expires_at: string; types?: string[] }>(rec, applet, "POST", "/account/keys", { name: k.name, vault: rec.vault, can: k.can, ...(k.types ? { types: k.types } : {}) });

export const endReach = (rec: Where, applet: string, id: string) =>
  call<{ id: string; revoked_at: string }>(rec, applet, "DELETE", `/account/vaults/${encodeURIComponent(rec.vault)}/statements/${encodeURIComponent(id)}`);
