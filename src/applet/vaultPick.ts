// Which vaults an applet reaches (docs/ACCESS.md proposal 5). An applet whose `app` names a word that reaches across
// vaults (`vaults`, `sharing`, `recent`, `changes`) reaches only the vaults the person picked for it: the pick, kept in
// its signed approval (approvals.ts `vaults`), or on a device without the person's key, beside its Allow on that
// device (pickStore.ts). No pick means the home, and for an applet with a card its own vault too. There is no "all": a
// vault added later is in no pick until it is ticked. A vault is named by its hub's origin and its name there, never by
// this device's key for it, so every device reads a pick the same. Pure.
import type { AppWord } from "./app";

/** The words that reach across vaults: an applet naming one of them asks which vaults. */
export const CROSS_WORDS: readonly AppWord[] = ["vaults", "sharing", "recent", "changes"];
export const asksVaults = (app: readonly AppWord[]): boolean => app.some((w) => CROSS_WORDS.includes(w));

export type VaultRef = { hub: string; vault: string };
/** At most this many vaults in one pick. */
export const MAX_PICK = 50;

const origin = (hub: string): string | null => { try { const u = new URL(hub); return (u.protocol === "https:" || u.protocol === "http:") && u.origin === hub ? u.origin : null; } catch { return null; } };
// a vault's name as its hub gives it: any short text without control characters
const VAULT_NAME = /^[^\u0000-\u001f\u007f]{1,200}$/;
export const refKey = (r: VaultRef) => `${r.hub} ${r.vault}`;
export const sameRef = (a: VaultRef, b: VaultRef) => a.hub === b.hub && a.vault === b.vault;

/** A pick as written: a list of `{hub, vault}`, each a hub's origin and a vault's name, each once. Anything else is
 *  null (an approval holding one that can't be read is refused, never read as "no pick": approvals.ts). Sorted, so two
 *  picks of the same vaults are one value whatever order they were ticked in. */
export function parsePick(raw: unknown): VaultRef[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_PICK) return null;
  const out: VaultRef[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object" || Array.isArray(r)) return null;
    const keys = Object.keys(r);
    const { hub, vault } = r as Record<string, unknown>;
    if (keys.length !== 2 || typeof hub !== "string" || typeof vault !== "string" || origin(hub) !== hub || !VAULT_NAME.test(vault)) return null;
    if (out.some((x) => x.hub === hub && x.vault === vault)) return null;
    out.push({ hub, vault });
  }
  return sortPick(out);
}
// by code unit, never the device's language: the sorted pick is hashed, and two devices must hash it alike (review finding 2)
const byUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
export const sortPick = (p: readonly VaultRef[]): VaultRef[] => [...p].map((r) => ({ hub: r.hub, vault: r.vault })).sort((a, b) => byUnit(refKey(a), refKey(b)));
export const samePick = (a: readonly VaultRef[] | null, b: readonly VaultRef[] | null) =>
  a === b || (!!a && !!b && a.length === b.length && sortPick(a).every((r, i) => sameRef(r, sortPick(b)[i])));

/** What it reaches when nothing was picked: the home, and for an applet with a card the vault its note lives in. */
export function defaultReach(home: VaultRef | null, own: VaultRef | null): VaultRef[] {
  const out: VaultRef[] = [];
  for (const r of [home, own]) if (r && !out.some((x) => sameRef(x, r))) out.push(r);
  return sortPick(out);
}

/** The vaults it reaches: the pick, else the default. */
export const reachOf = (pick: readonly VaultRef[] | null, home: VaultRef | null, own: VaultRef | null): VaultRef[] => (pick ? sortPick(pick) : defaultReach(home, own));

/** Of the vaults this device holds, the ones a reach names (by hub and name). */
export function heldIn<V extends { issuer: string; vault: string }>(held: readonly V[], reach: readonly VaultRef[], originOf: (issuer: string) => string): V[] {
  return held.filter((v) => reach.some((r) => r.hub === originOf(v.issuer) && r.vault === v.vault));
}

/** The pick to sign: none when it is the default (nothing to sign, and its approval hashes as before), else the pick. */
export const pickToSign = (ticked: readonly VaultRef[], home: VaultRef | null, own: VaultRef | null): VaultRef[] | null =>
  (samePick(sortPick(ticked), defaultReach(home, own)) ? null : sortPick(ticked));

/** "kitchen", "kitchen and letters", "kitchen, letters and 3 more": the vaults by name, for a line. */
export function namesLine(names: readonly string[]): string {
  if (!names.length) return "no vault";
  if (names.length <= 3) return names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
}
