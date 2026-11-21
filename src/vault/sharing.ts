// Sharing a vault with a friend (docs/design/SHARING.md): the shell's side. The owner's calls (who is in, invite, take
// back, end) are tools of the vault's hub's account MCP that the person's key signs (native `sharingTool`); the friend
// reads an invite with nothing but its code, and accepts it with their key (native `acceptInvite`). The names of a
// vault's people, for naming who wrote what, are read with the vault's own sign-in (the hub's `names`).
import type { PeopleNames } from "../applet/changes";
import type { PeopleRow, PersonRow } from "../applet/modules/vaults";
import { nativeNow, type InviteView } from "../services/native";
import { withCurrentToken } from "./client";
import { findVault, originOf, type VaultRecord } from "./store";

/** The hub a vault is on, when its account door is there (a box); null for a vault that lives on another host (Cloud). */
export const sharingHub = (rec: VaultRecord): string | null => (rec.url ? null : originOf(rec.issuer));

const refusal = (e: unknown) => (e && typeof e === "object" && typeof (e as { code?: unknown }).code === "string" ? (e as { code: string; message?: string }) : null);

/** Who else is in the vault, and its open invites: for its owner, signed by the key. */
export async function vaultPeople(rec: VaultRecord): Promise<PeopleRow> {
  const hub = sharingHub(rec);
  if (!hub) return { people: null, invites: null, why: "no_hub" };
  const native = await nativeNow();
  if (!native?.sharingTool) return { people: null, invites: null, why: "no_key" };
  try {
    const r = (await native.sharingTool(hub, "list-access", { vault: rec.vault })) as { access?: unknown[]; invites?: unknown[] };
    // a hub before sharing (core T-476) lists access without invites: it can't invite anyone yet
    if (!Array.isArray(r.invites)) return { people: null, invites: null, why: "no_hub" };
    const people: PersonRow[] = (Array.isArray(r.access) ? r.access : []).flatMap((a) => {
      const x = a as Record<string, unknown>;
      return typeof x.pubkey === "string" && x.vault === rec.vault ? [{ key: x.pubkey, name: typeof x.name === "string" ? x.name : null, role: typeof x.role === "string" ? x.role : "read" }] : [];
    });
    const invites = (Array.isArray(r.invites) ? r.invites : []).flatMap((i) => {
      const x = i as Record<string, unknown>;
      return typeof x.id === "string" && typeof x.name === "string" && typeof x.expires_at === "string" ? [{ id: x.id, name: x.name, expires_at: x.expires_at }] : [];
    });
    return { people, invites, from: savedFrom() };
  } catch (e) {
    const r = refusal(e);
    if (r?.code === "not_owner") return { people: null, invites: null, why: "not_owner" };
    if (r?.code === "unknown_key") return { people: null, invites: null, why: "unknown_key" };
    if (r?.code === "no_key") return { people: null, invites: null, why: "no_key" };
    // any other refusal (a vault the hub doesn't have, its trouble) is a problem to show, in the hub's words
    if (r) throw new Error(r.message ?? r.code);
    throw e;
  }
}

/** The person's own name, as the people they invite see it, kept on this device for the next invite. */
const FROM = "parachute.sharing.from";
export const savedFrom = (): string | null => { try { return localStorage.getItem(FROM); } catch { return null; } };

async function tool(rec: VaultRecord, name: "invite-to-vault" | "take-back-invite" | "revoke-access", args: Record<string, string>): Promise<Record<string, unknown>> {
  const hub = sharingHub(rec);
  const native = await nativeNow();
  if (!hub || !native?.sharingTool) throw new Error("Sharing needs your key: use Parachute on your phone or Mac.");
  return (await native.sharingTool(hub, name, { vault: rec.vault, ...args })) as Record<string, unknown>;
}

export async function inviteTo(rec: VaultRecord, name: string, from: string | null): Promise<{ id: string; url: string; expires_at: string }> {
  const r = await tool(rec, "invite-to-vault", { name, ...(from ? { from } : {}) });
  if (from) { try { localStorage.setItem(FROM, from); } catch { /* kept on the hub too */ } }
  if (typeof r.id !== "string" || typeof r.url !== "string" || typeof r.expires_at !== "string") throw new Error("The hub's answer couldn't be read.");
  return { id: r.id, url: r.url, expires_at: r.expires_at };
}
export const takeBackInvite = async (rec: VaultRecord, id: string) => (await tool(rec, "take-back-invite", { id })).taken_back === true;
export const endAccess = async (rec: VaultRecord, key: string) => (await tool(rec, "revoke-access", { pubkey: key })).revoked === true;

/** Names already read, per vault and stamp, for this session (a name changes rarely; a new stamp is asked). */
const known = new Map<string, { name: string | null; you: boolean } | null>();

/** The names of a vault's people by the `by` stamps asked about, with this device's sign-in to the vault. The hub names
 *  only stamps asked about, never a list of everyone in the vault. */
export async function vaultNames(key: string, bys: string[]): Promise<PeopleNames> {
  const rec = findVault(key);
  const hub = rec && sharingHub(rec);
  if (!rec || !hub) return {};
  const ask = bys.filter((b) => !known.has(`${key}\u0000${b}`)).slice(0, 100);
  if (ask.length) {
    const q = new URLSearchParams(ask.map((b) => ["by", b]));
    const url = `${hub}/account/vaults/${encodeURIComponent(rec.vault)}/names?${q}`;
    const f = withCurrentToken(rec.key, fetch);
    const asked = (token: string | undefined) => f(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    // it never refreshes the sign-in itself (the screen's own reads, just before, refresh a token past its time). An
    // answer, or any refusal but "wait" (a hub without the read answers 404 or 405; an ended sign-in, 401), settles
    // these stamps for the session; no answer at all doesn't
    const got = await asked(findVault(key)?.accessToken ?? rec.accessToken)
      .then(async (res) => (res.ok ? ((await res.json()) as { names?: PeopleNames }).names ?? {} : res.status >= 400 && res.status < 500 && res.status !== 429 ? {} : null), () => null);
    if (got === null) return {};
    for (const b of ask) known.set(`${key}\u0000${b}`, got[b] ?? null);
  }
  const out: PeopleNames = {};
  for (const b of bys) { const n = known.get(`${key}\u0000${b}`); if (n) out[b] = n; }
  return out;
}

/** The names already read for these stamps this session; nothing is asked. */
export function knownNames(key: string, bys: string[]): PeopleNames {
  const out: PeopleNames = {};
  for (const b of bys) { const n = known.get(`${key}\u0000${b}`); if (n) out[b] = n; }
  return out;
}

/** An invite link: `<hub>/invite#<code>`. Null for anything else. */
export function parseInviteLink(link: string): { hub: string; code: string } | null {
  let u: URL;
  try { u = new URL(link.trim()); } catch { return null; }
  const code = u.hash.replace(/^#/, "");
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  if (u.pathname.replace(/\/+$/, "") !== "/invite" || !/^[A-Za-z0-9_-]{16,128}$/.test(code)) return null;
  if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) return null;
  return { hub: u.origin, code };
}

/** What an invite lets you into, read with its code alone; null when it isn't open. */
export async function lookInvite(hub: string, code: string): Promise<InviteView | null> {
  const res = await fetch(`${hub}/account/invites/look`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }), credentials: "omit" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(res.status === 429 ? "The hub asks to wait a moment before trying again." : `The hub didn't answer (${res.status}).`);
  return (await res.json()) as InviteView;
}

/** Accept it with the key: null when this device has none (the web), else what it let you into. */
export async function acceptWithKey(hub: string, code: string): Promise<InviteView | null> {
  const native = await nativeNow();
  if (!native?.acceptInvite) return null;
  return native.acceptInvite(hub, code);
}
