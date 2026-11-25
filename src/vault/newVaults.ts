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
import { isMine, whoseSaid } from "./whose";
import { keySignIn, keysHere, listWithKey } from "../key/key";

export const NEW_VAULTS_KEY = "parachute.newvaults.v1";
/** At most this often per hub. */
export const RELIST_MS = 60_000;
/** `every`: hubs where the person reaches every vault (the public list is theirs to read); `admin`: hubs where the key's
 *  own listing found them the hub's admin (core's `covered: "all"` for a key is an admin's only), what "yours" is
 *  inferred from (`opensAs`). */
type Kept = { every: string[]; admin: string[]; dismissed: string[]; listed: Record<string, string[]> };

const read = (): Kept => {
  try {
    const v = JSON.parse(localStorage.getItem(NEW_VAULTS_KEY) ?? "null") as Partial<Kept> | null;
    const strs = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string").slice(-500) : []);
    const listed: Record<string, string[]> = {};
    if (v?.listed && typeof v.listed === "object" && !Array.isArray(v.listed)) for (const [h, names] of Object.entries(v.listed).slice(0, 50)) listed[h] = strs(names);
    return { every: strs(v?.every), admin: strs(v?.admin), dismissed: strs(v?.dismissed), listed };
  } catch { return { every: [], admin: [], dismissed: [], listed: {} }; }
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
export function noteEvery(hub: string, every: boolean) { noteIn("every", hub, every); }

/** The key's own listing of `hub` (signed by the shell): whether it found the person the hub's admin. */
export function noteAdmin(hub: string, admin: boolean) { noteIn("admin", hub, admin); }

function noteIn(list: "every" | "admin", hub: string, on: boolean) {
  const k = read();
  const h = originOf(hub);
  if (k[list].includes(h) === on) return;
  write({ ...k, [list]: on ? [...k[list], h] : k[list].filter((x) => x !== h) });
  // what the Open lines say follows (opensAs)
  told();
}

/** A vault the person doesn't want offered again: they said Not now, or signed out of it. */
export function dismissVault(hub: string, vault: string) {
  const k = read();
  if (!k.dismissed.includes(keyOf(hub, vault))) write({ ...k, dismissed: [...k.dismissed, keyOf(hub, vault)] });
  told();
}

/** A new sign-in to `hub`: the vaults waved away there are offered again. */
export function undismissOn(hub: string) {
  const k = read(), h = originOf(hub);
  const left = k.dismissed.filter((x) => !x.startsWith(`${h} `));
  if (left.length !== k.dismissed.length) { write({ ...k, dismissed: left }); told(); }
}

/** The vaults on offer on `hub`: found there, not held on this device, not waved away. */
export function newVaultsOn(hub: string): string[] {
  const h = originOf(hub);
  const held = new Set(listVaults().filter((v) => originOf(v.issuer) === h).map((v) => v.vault));
  if (!held.size) return [];
  const away = new Set(read().dismissed);
  return listedOn(h).filter((v) => !held.has(v) && !away.has(keyOf(h, v)));
}

/** Every vault the last listing found the person reaches on `hub`, held here or not (an applet's pick offers them all:
 *  docs/ACCESS.md proposal 5). */
export const listedVaults = (hub: string): string[] => listedOn(originOf(hub));

export function subscribeNewVaults(f: () => void): () => void { listeners.add(f); return () => { listeners.delete(f); }; }
export const newVaultsRev = () => rev;

/** The vaults the person reaches on `hub` now, asked as the sign-in asks; null when this device can't ask. With the key,
 *  whether they reach every vault there is noted again (a device signed in before that was kept learns it here). */
async function reachable(hub: string): Promise<string[] | null> {
  if (keysHere()) {
    try {
      const listed = await listWithKey(await describe(hub));
      if (listed) { noteEvery(hub, listed.all); noteAdmin(hub, listed.all); return listed.vaults; }
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

/** Does the person run this Parachute: the key's own listing found them its admin, and they said it is theirs (a vault
 *  of theirs is held here)? Reaching every vault isn't enough: without a key that is read from what a sign-in could
 *  list, which a member given every vault also can. */
export function runsHub(hub: string): boolean {
  const h = originOf(hub);
  return read().admin.includes(h) && listVaults().some((v) => originOf(v.issuer) === h && isMine(v));
}

/** Whose a vault on offer opens as, and what its Open line says of it (`said`: nothing, the person said so already):
 *  what the person said of it; else, on a Parachute they run, theirs, as the sign-in's own pick ticks every vault there
 *  to begin with, and its line says "yours", so the tap that opens it says so too (a vault another admin of the hub
 *  made is one to wave away, or to change in Settings); elsewhere someone else's, and its line says that (a vault
 *  offered later there may be one someone shared with them), until the person says otherwise in Settings. */
export function opensAs(hub: string, vault: string): { whose: "mine" | "theirs"; line: "yours" | "someone else's" | null } {
  const said = whoseSaid({ issuer: originOf(hub), vault });
  if (said === "mine") return { whose: "mine", line: null };
  if (said === null && runsHub(hub)) return { whose: "mine", line: "yours" };
  return { whose: "theirs", line: "someone else's" };
}

/** Open a vault on offer: the hub's consent to read it alone (its sign-in, then its Approve, unless the person's grant
 *  there already covers it), and back to the sign-in's return. Resolves to the address to open. Whose it is: `opensAs`
 *  (the hub doesn't say whose). */
export async function startAddVault(hub: string, vault: string): Promise<string> {
  const h = originOf(hub);
  if (!newVaultsOn(h).includes(vault)) throw new Error("That vault isn't on offer here.");
  const { whose } = opensAs(h, vault);
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
