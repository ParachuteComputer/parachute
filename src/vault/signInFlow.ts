// Signing in to a Parachute from start to end (docs/design/ONE-SIGN-IN.md): read the hub, learn the person's vaults
// (with the key, from the shell; without, by a first sign-in that only lists them), one consent for all of them, then
// each other vault's own token by the same sign-in for that vault alone, which the hub answers at once (its grant
// covers it). The screens (Add a Parachute, the sign-in's return) call these.
import { beginSignIn, completeSignIn, dropPending, revoke, type Pending } from "./oauth";
import { describe, listWithToken, reachesEvery, vaultUrlFrom, type Listed, type Parachute } from "./parachute";
import { limitedFetch } from "./limited";
import { listVaults, saveVault, vaultUrlOf, type VaultRecord } from "./store";
import { setWhose, whoseOf, whoseSaid } from "./whose";
import { hubVaults, keySignIn, type Refusal } from "../key/key";
import { holdHome } from "../shell/frameSource";
import type { TokenResponse } from "@openparachute/surface-client";

/** On a hub the person runs (it lists every vault on it), before the consent: which of them are theirs. `vaults` are all
 *  of them; `mine`, the ones ticked to begin with (each one this device already said is theirs, and every new one). The
 *  screen calls `go` with the person's choice, and opens the address it gives. */
export type VaultPick = { hub: string; vaults: string[]; mine: string[]; go: (mine: string[]) => Promise<string> };
/** Where to go next: the hub (its sign-in or consent page, or the next vault's sign-in), a pick of the person's own
 *  vaults first, or done, with the vaults now held. `progress`: how far through the vaults, for the screen between steps. */
export type Next = { go: string; progress?: { done: number; of: number } } | { pick: VaultPick } | { done: VaultRecord[]; parachute: Parachute };

/** The pick of their own vaults, when the person said Mine of a hub that gave them every vault on it (they run it: some
 *  vaults may be other people's). Null when there is nothing to pick. */
function pickFor(parachute: Parachute, listed: Listed, whose: "mine" | "theirs", go: (mine: string[]) => Promise<string>): VaultPick | null {
  if (whose !== "mine" || !listed.all || listed.vaults.length < 2) return null;
  const mine = listed.vaults.filter((v) => [null, "mine"].includes(whoseSaid({ issuer: parachute.issuer, vault: v })));
  return { hub: parachute.hub, vaults: listed.vaults, mine, go };
}

const fetchFor = (whose: "mine" | "theirs") => (whose === "mine" ? fetch.bind(globalThis) : limitedFetch());

/** Start: read the hub, and with the key learn the person's vaults at once and open the hub's key door. Throws a
 *  Refusal (key) or an Error (words for the person). */
export async function startSignIn(hub: string, whose: "mine" | "theirs", withKey: boolean): Promise<{ go: string } | { pick: VaultPick }> {
  const f = fetchFor(whose);
  const parachute = await describe(hub, f);
  if (!withKey) return { go: await beginSignIn({ parachute, step: "list", whose, how: "page", fresh: true }, f) };
  // the shell signs one `list-vaults` request with the key, to the hub's own account MCP; a hub that can't answer it
  // (an older one, or one whose account MCP is elsewhere) gets the listing sign-in instead, through the same key door
  let listed: Listed | null = null;
  if (parachute.accountMcp === `${hub}/account/mcp`) {
    try {
      listed = await hubVaults(hub);
    } catch (e) {
      const r = e as Refusal;
      if (r.code !== "no_list") throw r;
    }
  }
  if (listed && !listed.vaults.length) throw { code: "no_vaults", message: "Your key is known there, but no vault is yours yet. Ask the hub's owner to give you one." } satisfies Refusal;
  const door = async (b: Parameters<typeof beginSignIn>[0]) => {
    const authorize = await beginSignIn(b, f);
    try {
      return await keySignIn(hub, authorize);
    } catch (r) {
      dropPending();
      throw r;
    }
  };
  if (!listed) return { go: await door({ parachute, step: "list", whose, how: "key", fresh: true }) };
  const vaults = listed.vaults;
  const consent = (mine: string[] | undefined) => door({ parachute, step: "vaults", vaults, whose, how: "key", fresh: true, ...(mine ? { mine } : {}) });
  const pick = pickFor(parachute, listed, whose, consent);
  return pick ? { pick } : { go: await consent(undefined) };
}

/** The hub sent the person back with a code: finish that step, keep what it brought, and say where to go next. */
export async function finishStep(code: string, state: string): Promise<Next> {
  const { pending, token, vaults, vault } = await completeSignIn(code, state);
  const f = fetchFor(pending.whose ?? "theirs");
  const p = pending.parachute;

  if (pending.step === "list") {
    let listed: Listed;
    try {
      // an account token's `covered` says what the token covers, not whether the person runs the hub (0.9 grants it
      // per vault): that is read from the hub's public list instead
      const theirs = await listWithToken(p.accountMcp, token.access_token, f);
      // asked only when there could be a pick (Mine, and more than one vault)
      const ask = pending.whose === "mine" && theirs.vaults.length > 1;
      listed = { vaults: theirs.vaults, all: ask && await reachesEvery(p.hub, theirs.vaults, f) };
    } finally {
      // the listing token has done its one job: ended before the page moves on
      await revoke({ issuer: pending.issuer, clientId: pending.clientId, refreshToken: token.refresh_token, revocationEndpoint: pending.revocationEndpoint });
    }
    if (!listed.vaults.length) throw new Error("You're signed in there, but no vault is yours yet. Ask the hub's owner to give you one.");
    // the hub's session is still in place: its consent page comes next, asking for all of them at once
    const consent = (mine: string[] | undefined) => beginSignIn({ parachute: p, step: "vaults", vaults: listed.vaults, whose: pending.whose, how: pending.how, ...(mine ? { mine } : {}) }, f);
    const pick = pickFor(p, listed, pending.whose ?? "theirs", consent);
    return pick ? { pick } : { go: await consent(undefined) };
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
    try {
      const go = await beginSignIn({ parachute: p, step: "vault", vaults: [queue[0]], queue: queue.slice(1), granted, kept, whose: pending.whose, how: pending.how, ...(pending.mine ? { mine: pending.mine } : {}) }, f);
      return { go, progress: { done: kept.length, of: kept.length + queue.length } };
    } catch (e) {
      // what was kept stays, and the screen says so (keptSoFar)
      throw Object.assign(e instanceof Error ? e : new Error("The sign-in didn't finish."), { kept: { done: listVaults().filter((v) => v.issuer === p.issuer && kept.includes(v.vault)), parachute: p } });
    }
  }
  return { done: listVaults().filter((v) => v.issuer === p.issuer && kept.includes(v.vault)), parachute: p };
}

/** Keep one vault of a Parachute sign-in, with its own token; an older sign-in of the same vault here is ended. */
function keep(pending: Pending, token: TokenResponse, vault: string): VaultRecord {
  const p = pending.parachute;
  const url = vaultUrlFrom(p.vaultTemplate, vault);
  const before = listVaults().find((v) => v.issuer === p.issuer && v.vault === vault);
  // what the person already said of this vault: read before the record is kept (on a device that has never been told
  // whose anything is, the first read sorts out the vaults held then, and this one mustn't be among them)
  const said = whoseSaid({ issuer: p.issuer, vault });
  const rec = saveVault({ issuer: p.issuer, vault, tokenEndpoint: pending.tokenEndpoint, ...(pending.revocationEndpoint ? { revocationEndpoint: pending.revocationEndpoint } : {}), clientId: pending.clientId,
    accessToken: token.access_token, refreshToken: token.refresh_token, expiresAt: token.expires_in ? Date.now() + token.expires_in * 1000 : undefined, scope: token.scope ?? "",
    addedAt: new Date().toISOString(), ...(url !== vaultUrlOf({ issuer: p.issuer, vault }) ? { url } : {}) });
  if (before?.refreshToken && before.refreshToken !== token.refresh_token) void revoke(before);
  // whose it is: what the person picked for each vault of a hub they run; otherwise their answer on Add a Parachute,
  // for a vault this device hasn't been told about. Signing in again never changes what they already said of a vault
  // (Settings does), and a trusted vault stays trusted.
  const picked = pending.mine ? (pending.mine.includes(vault) ? "mine" : "theirs") : null;
  const to = picked ?? (said === null ? pending.whose : null);
  if (to && !(to === "theirs" && whoseOf(rec) === "trusted")) setWhose(rec, to);
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
