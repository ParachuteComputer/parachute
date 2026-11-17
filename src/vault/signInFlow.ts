// Signing in to a Parachute from start to end (docs/design/ONE-SIGN-IN.md): read the hub, learn the person's vaults
// (with the key, from the shell; without, by a first sign-in that only lists them), one consent for all of them, then
// each other vault's own token by the same sign-in for that vault alone, which the hub answers at once (its grant
// covers it). The screens (Add a Parachute, the sign-in's return) call these.
import { beginSignIn, completeSignIn, dropPending, revoke, type Pending } from "./oauth";
import { describe, listWithToken, vaultUrlFrom, type Parachute } from "./parachute";
import { limitedFetch } from "./limited";
import { listVaults, saveVault, vaultUrlOf, type VaultRecord } from "./store";
import { setWhose, whoseOf } from "./whose";
import { hubVaults, keySignIn, type Refusal } from "../key/key";
import { holdHome } from "../shell/frameSource";
import type { TokenResponse } from "@openparachute/surface-client";

/** Where to go next: the hub (its sign-in or consent page, or the next vault's sign-in), or done, with the vaults now
 *  held. `progress`: how far through the vaults, for the screen between steps. */
export type Next = { go: string; progress?: { done: number; of: number } } | { done: VaultRecord[]; parachute: Parachute };

const fetchFor = (whose: "mine" | "theirs") => (whose === "mine" ? fetch.bind(globalThis) : limitedFetch());

/** Start: read the hub, and with the key learn the person's vaults at once and open the hub's key door. Throws a
 *  Refusal (key) or an Error (words for the person). */
export async function startSignIn(hub: string, whose: "mine" | "theirs", withKey: boolean): Promise<string> {
  const f = fetchFor(whose);
  const parachute = await describe(hub, f);
  if (!withKey) return beginSignIn({ parachute, step: "list", whose, how: "page", fresh: true }, f);
  // the shell signs one `list-vaults` request with the key, to the hub's own account MCP; a hub that can't answer it
  // (an older one, or one whose account MCP is elsewhere) gets the listing sign-in instead, through the same key door
  let vaults: string[] | null = null;
  if (parachute.accountMcp === `${hub}/account/mcp`) {
    try {
      vaults = await hubVaults(hub);
    } catch (e) {
      const r = e as Refusal;
      if (r.code !== "no_list") throw r;
    }
  }
  if (vaults && !vaults.length) throw { code: "no_vaults", message: "Your key is known there, but no vault is yours yet. Ask the hub's owner to give you one." } satisfies Refusal;
  const authorize = await beginSignIn(vaults ? { parachute, step: "vaults", vaults, whose, how: "key", fresh: true } : { parachute, step: "list", whose, how: "key", fresh: true }, f);
  try {
    return await keySignIn(hub, authorize);
  } catch (r) {
    dropPending();
    throw r;
  }
}

/** The hub sent the person back with a code: finish that step, keep what it brought, and say where to go next. */
export async function finishStep(code: string, state: string): Promise<Next> {
  const { pending, token, vaults, vault } = await completeSignIn(code, state);
  const f = fetchFor(pending.whose ?? "theirs");
  const p = pending.parachute;

  if (pending.step === "list") {
    let names: string[];
    try {
      names = await listWithToken(p.accountMcp, token.access_token, f);
    } finally {
      // the listing token has done its one job: ended before the page moves on
      await revoke({ issuer: pending.issuer, clientId: pending.clientId, refreshToken: token.refresh_token, revocationEndpoint: pending.revocationEndpoint });
    }
    if (!names.length) throw new Error("You're signed in there, but no vault is yours yet. Ask the hub's owner to give you one.");
    // the hub's session is still in place: its consent page comes next, asking for all of them at once
    return { go: await beginSignIn({ parachute: p, step: "vaults", vaults: names, whose: pending.whose, how: pending.how }, f) };
  }

  // before this sign-in keeps its first vault: the device's home stays where it is (a new record of a vault it held
  // would otherwise count as newer). A first sign-in has no home yet: the launcher's return chooses it (afterSignIn).
  if (!pending.kept.length) holdHome();
  keep(pending, token, vault!);
  const kept = [...pending.kept, vault!];
  // after the consent, every other vault it granted, one at a time, each asking for exactly what it holds
  const granted = pending.step === "vaults" ? token.scope ?? "" : pending.granted;
  const queue = pending.step === "vaults" ? vaults.filter((v) => v !== vault) : pending.queue;
  if (queue.length) {
    const go = await beginSignIn({ parachute: p, step: "vault", vaults: [queue[0]], queue: queue.slice(1), granted, kept, whose: pending.whose, how: pending.how }, f);
    return { go, progress: { done: kept.length, of: kept.length + queue.length } };
  }
  return { done: listVaults().filter((v) => v.issuer === p.issuer && kept.includes(v.vault)), parachute: p };
}

/** Keep one vault of a Parachute sign-in, with its own token; an older sign-in of the same vault here is ended. */
function keep(pending: Pending, token: TokenResponse, vault: string): VaultRecord {
  const p = pending.parachute;
  const url = vaultUrlFrom(p.vaultTemplate, vault);
  const before = listVaults().find((v) => v.issuer === p.issuer && v.vault === vault);
  const rec = saveVault({ issuer: p.issuer, vault, tokenEndpoint: pending.tokenEndpoint, ...(pending.revocationEndpoint ? { revocationEndpoint: pending.revocationEndpoint } : {}), clientId: pending.clientId,
    accessToken: token.access_token, refreshToken: token.refresh_token, expiresAt: token.expires_in ? Date.now() + token.expires_in * 1000 : undefined, scope: token.scope ?? "",
    addedAt: new Date().toISOString(), ...(url !== vaultUrlOf({ issuer: p.issuer, vault }) ? { url } : {}) });
  if (before?.refreshToken && before.refreshToken !== token.refresh_token) void revoke(before);
  // what the person said on Add a Parachute; signing in again to a trusted vault doesn't drop its trust
  if (pending.whose && !(pending.whose === "theirs" && whoseOf(rec) === "trusted")) setWhose(rec, pending.whose);
  return rec;
}

/** A sign-in that stopped partway (the person said no to a later vault, or the hub refused one): what it kept stays,
 *  and is said. Null when it had kept nothing. */
export function keptSoFar(p: Pending | null): { done: VaultRecord[]; parachute: Parachute } | null {
  if (!p?.kept?.length) return null;
  return { done: listVaults().filter((v) => v.issuer === p.issuer && p.kept.includes(v.vault)), parachute: p.parachute };
}

/** Sign out of a whole Parachute on this device: each of its vaults, as Settings signs out of one. */
export function signOutOf(issuer: string, signOut: (v: VaultRecord) => void) {
  for (const v of listVaults().filter((x) => x.issuer === issuer)) signOut(v);
}
