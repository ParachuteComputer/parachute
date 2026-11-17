// Signing in to a Parachute from start to end (docs/design/ONE-SIGN-IN.md): read the hub, learn the person's vaults
// (with the key, from the shell; without, by a first sign-in that only lists them), one consent for all of them, then a
// sign-in kept with one record per vault. The screens (Add a Parachute, the sign-in's return) call these.
import { beginSignIn, completeSignIn, dropPending, revoke, type Pending } from "./oauth";
import { describe, listWithToken, vaultAt, type Parachute } from "./parachute";
import { limitedFetch } from "./limited";
import { findSignIn, newSignInId, refreshFor, removeSignIn, saveSignIn, type SignIn } from "./signins";
import { listVaults, removeVault, saveVaults, type VaultRecord } from "./store";
import { setWhose, whoseOf } from "./whose";
import { hubVaults, keySignIn, type Refusal } from "../key/key";

/** Where to go next: the hub (its sign-in or consent page), or done, with the vaults now held. */
export type Next = { go: string } | { done: VaultRecord[]; parachute: Parachute };

const fetchFor = (whose: "mine" | "theirs") => (whose === "mine" ? fetch.bind(globalThis) : limitedFetch());

/** Start: read the hub, and with the key learn the person's vaults at once and open the hub's key door. Throws a
 *  Refusal (key) or an Error (words for the person). */
export async function startSignIn(hub: string, whose: "mine" | "theirs", withKey: boolean): Promise<string> {
  const f = fetchFor(whose);
  const parachute = await describe(hub, f);
  if (!withKey) return beginSignIn({ parachute, step: "list", whose, how: "page" }, f);
  // the shell signs one `list-vaults` request with the key; a hub that can't answer it (an older one) gets the
  // listing sign-in instead, through the same key door
  let vaults: string[] | null = null;
  try {
    vaults = await hubVaults(hub);
  } catch (e) {
    const r = e as Refusal;
    if (r.code !== "no_list") throw r;
  }
  if (vaults && !vaults.length) throw { code: "no_vaults", message: "Your key is known there, but no vault is yours yet. Ask the hub's owner to give you one." } satisfies Refusal;
  const authorize = await beginSignIn(vaults ? { parachute, step: "vaults", vaults, whose, how: "key" } : { parachute, step: "list", whose, how: "key" }, f);
  try {
    return await keySignIn(hub, authorize);
  } catch (r) {
    dropPending();
    throw r;
  }
}

/** The hub sent the person back with a code: finish that step, and either go on to the next or keep what was granted. */
export async function finishStep(code: string, state: string): Promise<Next> {
  const { pending, token, vaults } = await completeSignIn(code, state);
  const whose = pending.whose ?? "theirs";
  if (pending.step === "list") {
    const f = fetchFor(whose);
    let names: string[];
    try {
      names = await listWithToken(pending.parachute.accountMcp, token.access_token, f);
    } finally {
      // the listing token has done its one job
      void revoke({ issuer: pending.issuer, clientId: pending.clientId, refreshToken: token.refresh_token, revocationEndpoint: pending.revocationEndpoint });
    }
    if (!names.length) throw new Error("You're signed in there, but no vault is yours yet. Ask the hub's owner to give you one.");
    // the hub's session is still in place: its consent page comes next, asking for all of them at once
    return { go: await beginSignIn({ parachute: pending.parachute, step: "vaults", vaults: names, whose: pending.whose, how: pending.how }, f) };
  }
  return { done: await keep(pending, token.refresh_token, vaults), parachute: pending.parachute };
}

/** Keep a Parachute sign-in: the sign-in (its refresh chain) and a record per vault, each with its first token. */
async function keep(pending: Pending, refreshToken: string | undefined, vaults: string[]): Promise<VaultRecord[]> {
  if (!refreshToken) throw new Error("The hub gave no way to stay signed in. Nothing was added.");
  const p = pending.parachute;
  const signIn: SignIn = { id: newSignInId(), hub: p.hub, issuer: p.issuer, tokenEndpoint: pending.tokenEndpoint, ...(pending.revocationEndpoint ? { revocationEndpoint: pending.revocationEndpoint } : {}),
    clientId: pending.clientId, refreshToken, vaultTemplate: p.vaultTemplate, addedAt: new Date().toISOString() };
  saveSignIn(signIn);
  const f = fetchFor(pending.whose ?? "theirs");
  const addedAt = new Date().toISOString();
  const recs: Omit<VaultRecord, "key">[] = [];
  try {
    // each vault's first token: the chain, aimed at it (one at a time: each refresh rotates the chain)
    for (const name of vaults) {
      const url = vaultAt(p.vaultTemplate, name);
      const t = await refreshFor(signIn.id, url, f);
      recs.push({ issuer: p.issuer, vault: name, tokenEndpoint: pending.tokenEndpoint, ...(pending.revocationEndpoint ? { revocationEndpoint: pending.revocationEndpoint } : {}), clientId: pending.clientId,
        accessToken: t.access_token, expiresAt: t.expires_in ? Date.now() + t.expires_in * 1000 : undefined, scope: t.scope ?? "", addedAt, signIn: signIn.id,
        ...(url !== `${p.issuer}/vault/${encodeURIComponent(name)}` ? { url } : {}) });
    }
  } catch (e) {
    removeSignIn(signIn.id);
    throw e instanceof Error && /^refresh failed/.test(e.message) ? new Error("The hub wouldn't give a token for each vault. Nothing was added.") : e;
  }
  // older sign-ins of the same vaults on this device: replaced (and ended at the hub)
  const before = listVaults().filter((v) => v.issuer === p.issuer && vaults.includes(v.vault));
  const kept = saveVaults(recs);
  for (const old of before) void endOld(old);
  for (const v of kept) {
    // what the person said on Add a Parachute; signing in again to a trusted vault doesn't drop its trust
    if (pending.whose && !(pending.whose === "theirs" && whoseOf(v) === "trusted")) setWhose(v, pending.whose);
  }
  return kept;
}

/** End a sign-in this device no longer uses: a one-vault one (its own refresh token), or a Parachute's once none of its
 *  vaults is left here. */
async function endOld(old: VaultRecord) {
  if (old.refreshToken && !old.signIn) await revoke(old);
  else if (old.signIn) await endSignInIfUnused(old.signIn);
}

/** Revoke a Parachute sign-in's chain and forget it, when no vault on this device uses it any more. */
export async function endSignInIfUnused(id: string): Promise<void> {
  if (listVaults().some((v) => v.signIn === id)) return;
  const s = findSignIn(id);
  if (!s) return;
  removeSignIn(id);
  await revoke({ issuer: s.issuer, clientId: s.clientId, refreshToken: s.refreshToken, revocationEndpoint: s.revocationEndpoint });
}

/** Sign out of a whole Parachute on this device: its vaults and its sign-in. `forget` drops what each vault left
 *  (its applets' grants, its frame, its theme…), as Settings does for one vault. */
export async function signOutOf(issuer: string, forget: (key: string) => void): Promise<void> {
  const ids = new Set<string>();
  for (const v of listVaults().filter((x) => x.issuer === issuer)) {
    removeVault(v.key);
    forget(v.key);
    if (v.signIn) ids.add(v.signIn);
    else void revoke(v);
  }
  for (const id of ids) await endSignInIfUnused(id);
}
