// A vault made on a Parachute after this device signed in there (docs/design/ONE-SIGN-IN.md, "A vault made later"):
// the launcher offers it as one quiet line, "New: <vault>, tap to add", and a tap adds it through the hub's consent.
//
// Which vaults the person reaches is asked the way the sign-in asks it: with the key, the hub's own `list-vaults` (signed
// by the shell); without one, the hub's public list of its vaults, and only on a hub where the sign-in found the person
// reaches every vault (they run it: `every` below). A hub where neither holds (a member's, without a key) is not asked.
// Asked when the app opens and each time the launcher shows, at most once a minute per hub: no timer.
// Kept on this device, never in a record: which hubs the person reaches every vault of, and the vaults they waved away
// (Not now, or signed out of on purpose), so those don't come back.
import { beginSignIn, dropPending } from "./oauth";
import { describe, everyVault } from "./parachute";
import { listVaults, originOf } from "./store";
import { keySignIn, keysHere, listWithKey } from "../key/key";

export const NEW_VAULTS_KEY = "parachute.newvaults.v1";
/** At most this often per hub. */
export const RELIST_MS = 60_000;
type Kept = { every: string[]; dismissed: string[] };

const read = (): Kept => {
  try {
    const v = JSON.parse(localStorage.getItem(NEW_VAULTS_KEY) ?? "null") as Partial<Kept> | null;
    const strs = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string").slice(-500) : []);
    return { every: strs(v?.every), dismissed: strs(v?.dismissed) };
  } catch { return { every: [], dismissed: [] }; }
};
const write = (k: Kept) => { try { localStorage.setItem(NEW_VAULTS_KEY, JSON.stringify(k)); } catch { /* lasts this session */ } };
const keyOf = (hub: string, vault: string) => `${originOf(hub)} ${vault}`;

const listeners = new Set<() => void>();
const told = () => { rev++; listeners.forEach((f) => f()); };
let rev = 0;
/** What the last listing of each hub found there (every vault the person reaches), by hub origin. */
const found = new Map<string, string[]>();
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
  return (found.get(h) ?? []).filter((v) => !held.has(v) && !away.has(keyOf(h, v)));
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
    const before = JSON.stringify(found.get(hub) ?? []);
    found.set(hub, names);
    if (JSON.stringify(names) !== before) told();
  }));
}

/** Add a vault on offer: the hub's consent for it alone (its sign-in, then its Approve, unless the person's grant there
 *  already covers it), and back to the sign-in's return. Resolves to the address to open. The vault comes in as
 *  someone else's: the hub doesn't say whose it is; Settings makes it the person's. */
export async function startAddVault(hub: string, vault: string): Promise<string> {
  const h = originOf(hub);
  if (!newVaultsOn(h).includes(vault)) throw new Error("That vault isn't on offer here.");
  // whose it is isn't known from the hub (another account there may have made it): someone else's until the person
  // says it is theirs in Settings, so a new vault gets none of "mine"'s rights (home, embeds, recent) unasked
  const whose = "theirs";
  const parachute = await describe(h);
  if (keysHere()) {
    // through the hub's key door, as a sign-in with the key does; a key the hub refuses: the hub's own page
    try {
      return await keySignIn(h, await beginSignIn({ parachute, step: "vaults", vaults: [vault], whose, how: "key" }));
    } catch { dropPending(); }
  }
  return beginSignIn({ parachute, step: "vaults", vaults: [vault], whose, how: "page" });
}

/** For tests: forget what was found and when. */
export function resetNewVaults() { found.clear(); askedAt.clear(); told(); }
