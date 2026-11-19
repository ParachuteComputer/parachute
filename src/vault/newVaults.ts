// The person's vaults on a Parachute that this device doesn't read (docs/design/SCOPES.md): the sign-in reads only the
// home, so every other vault the hub listed, and any made there later (docs/design/ONE-SIGN-IN.md, "A vault made
// later"), is one quiet line on the launcher, "Open <vault>", and a tap asks the hub to read that one vault.
//
// Which vaults the person reaches is asked the way the sign-in asks it: with the key, the hub's own `list-vaults` (signed
// by the shell); without one, the hub's public list of its vaults, and only on a hub where the sign-in found the person
// reaches every vault (they run it: `every` below). A hub where neither holds (a member's, without a key) is not asked.
// Asked when the app opens and each time the launcher shows, at most once a minute per hub: no timer.
// Kept on this device, never in a record: what the hub last listed, which hubs the person reaches every vault of, and the
// vaults they waved away (Not now, or signed out of on purpose), so those don't come back.
import { beginSignIn, dropPending } from "./oauth";
import { describe, everyVault } from "./parachute";
import { listVaults, originOf } from "./store";
import { whoseSaid } from "./whose";
import { keySignIn, keysHere, listWithKey } from "../key/key";

export const NEW_VAULTS_KEY = "parachute.newvaults.v1";
/** At most this often per hub. */
export const RELIST_MS = 60_000;
type Kept = { every: string[]; dismissed: string[]; listed: Record<string, string[]> };

const read = (): Kept => {
  try {
    const v = JSON.parse(localStorage.getItem(NEW_VAULTS_KEY) ?? "null") as Partial<Kept> | null;
    const strs = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string").slice(-500) : []);
    const listed: Record<string, string[]> = {};
    if (v?.listed && typeof v.listed === "object" && !Array.isArray(v.listed)) for (const [h, names] of Object.entries(v.listed).slice(0, 50)) listed[h] = strs(names);
    return { every: strs(v?.every), dismissed: strs(v?.dismissed), listed };
  } catch { return { every: [], dismissed: [], listed: {} }; }
};
const write = (k: Kept) => { try { localStorage.setItem(NEW_VAULTS_KEY, JSON.stringify(k)); } catch { /* lasts this session */ } };
const keyOf = (hub: string, vault: string) => `${originOf(hub)} ${vault}`;

const listeners = new Set<() => void>();
const told = () => { rev++; listeners.forEach((f) => f()); };
let rev = 0;
/** What the last listing of each hub found there (every vault the person reaches), by hub origin; this session's, over
 *  what the device kept from before. */
const found = new Map<string, string[]>();
const listedOn = (hub: string) => found.get(hub) ?? read().listed[hub] ?? [];

/** What a sign-in (or a later listing) found the person reaches on `hub`: kept, so the launcher offers the ones this
 *  device doesn't read. */
export function noteListed(hub: string, vaults: readonly string[]) {
  const h = originOf(hub);
  found.set(h, [...vaults]);
  const k = read();
  if (JSON.stringify(k.listed[h] ?? []) !== JSON.stringify(vaults)) write({ ...k, listed: { ...k.listed, [h]: [...vaults] } });
  told();
}
const askedAt = new Map<string, number>();

/** The sign-in learned whether the person reaches every vault on `hub` (they run it). */
export function noteEvery(hub: string, every: boolean) {
  const k = read();
  const h = originOf(hub);
  const was = k.every.includes(h);
  if (was === every) return;
  write({ ...k, every: every ? [...k.every, h] : k.every.filter((x) => x !== h) });
}

/** A vault the person doesn't want offered again: they said Not now, or signed out of it. */
export function dismissVault(hub: string, vault: string) {
  const k = read();
  if (!k.dismissed.includes(keyOf(hub, vault))) write({ ...k, dismissed: [...k.dismissed, keyOf(hub, vault)] });
  told();
}

/** The vaults on offer on `hub`: found there, not held on this device, not waved away. */
export function newVaultsOn(hub: string): string[] {
  const h = originOf(hub);
  const held = new Set(listVaults().filter((v) => originOf(v.issuer) === h).map((v) => v.vault));
  if (!held.size) return [];
  const away = new Set(read().dismissed);
  return listedOn(h).filter((v) => !held.has(v) && !away.has(keyOf(h, v)));
}

export function subscribeNewVaults(f: () => void): () => void { listeners.add(f); return () => { listeners.delete(f); }; }
export const newVaultsRev = () => rev;

/** The vaults the person reaches on `hub` now, asked as the sign-in asks; null when this device can't ask. */
async function reachable(hub: string): Promise<string[] | null> {
  if (keysHere()) {
    try {
      const listed = await listWithKey(await describe(hub));
      if (listed) return listed.vaults;
    } catch { /* no key here, or the hub refused it: the public list, where it is the person's */ }
  }
  return read().every.includes(hub) ? everyVault(hub) : null;
}

/** Ask each hub this device is signed in to which vaults the person reaches there (at most once a minute per hub). */
export async function relistVaults(now = Date.now()): Promise<void> {
  const hubs = [...new Set(listVaults().map((v) => originOf(v.issuer)))];
  await Promise.all(hubs.map(async (hub) => {
    if (now - (askedAt.get(hub) ?? -Infinity) < RELIST_MS) return;
    askedAt.set(hub, now);
    const names = await reachable(hub).catch(() => null);
    if (!names) return;
    if (JSON.stringify(names) !== JSON.stringify(listedOn(hub))) noteListed(hub, names);
  }));
}

/** Open a vault on offer: the hub's consent to read it alone (its sign-in, then its Approve, unless the person's grant
 *  there already covers it), and back to the sign-in's return. Resolves to the address to open. Whose it is: what the
 *  person said at sign-in (of the Parachute, or of that vault on a hub they run); a vault made later is someone
 *  else's until they say otherwise in Settings (the hub doesn't say whose; another account may have made it). */
export async function startAddVault(hub: string, vault: string): Promise<string> {
  const h = originOf(hub);
  if (!newVaultsOn(h).includes(vault)) throw new Error("That vault isn't on offer here.");
  const said = whoseSaid({ issuer: h, vault });
  const whose: "mine" | "theirs" = said === "mine" ? "mine" : "theirs";
  const parachute = await describe(h);
  const b = { parachute, step: "open" as const, vault, level: "read" as const, why: "open" as const, whose };
  if (keysHere()) {
    // through the hub's key door, as a sign-in with the key does; a key the hub refuses: the hub's own page
    try {
      return await keySignIn(h, await beginSignIn({ ...b, how: "key" }));
    } catch { dropPending(); }
  }
  return beginSignIn({ ...b, how: "page" });
}

/** For tests: forget what was found and when. */
export function resetNewVaults() { found.clear(); askedAt.clear(); told(); }
