// The person's Parachutes (docs/design/ONE-SIGN-IN.md): the hubs this device is signed in to, and the ones their home
// vault's settings note lists (homeSettings.ts `hubs`), which this device may not be signed in to yet. And what follows
// a sign-in to a Parachute: the home vault chosen when this device had none, and the Parachute put on the list.
import { useSyncExternalStore } from "react";
import { clientFor } from "../vault/client";
import { CLOUD, CLOUD_NAME } from "../vault/parachute";
import { originOf, listVaults, subscribeVaults, hostOf, type VaultRecord } from "../vault/store";
import { homeVault } from "./frameSource";
import { levelIn } from "../vault/parachute";
import { listHub, readSettings, settingsNow, forgetSimpleHere, startSimpleHere, subscribeSettings, SETTINGS_TAG } from "./homeSettings";

export type ParachuteLine = {
  /** the Parachute's address (its issuer origin) */
  hub: string;
  host: string;
  /** what to call it: the list's name, Cloud's, else its host */
  name: string;
  /** the vaults this device holds there */
  vaults: VaultRecord[];
  /** it holds the home vault */
  home: boolean;
};


/** The Parachutes in order: the home's first, then the others this device is signed in to (as first signed in), then
 *  the ones the list names that this device isn't signed in to (as listed). */
export function parachutesNow(list: readonly VaultRecord[] = listVaults(), home: VaultRecord | null = homeVault(list)): ParachuteLine[] {
  const listed = settingsNow().hubs;
  // a name from the list (an agent can write it) only for a Parachute this device isn't signed in to; one it is
  // signed in to is called by its address, so a record can't relabel it
  const nameOf = (hub: string, signedIn: boolean) => (hub === CLOUD ? CLOUD_NAME : !signedIn && listed.find((h) => h.hub === hub)?.name) || hostOf(hub);
  const byHub = new Map<string, VaultRecord[]>();
  for (const v of [...list].sort((a, b) => a.addedAt.localeCompare(b.addedAt) || a.vault.localeCompare(b.vault))) {
    const h = originOf(v.issuer);
    byHub.set(h, [...(byHub.get(h) ?? []), v]);
  }
  const lines: ParachuteLine[] = [...byHub].map(([hub, vaults]) => ({ hub, host: hostOf(hub), name: nameOf(hub, true), vaults, home: !!home && vaults.some((v) => v.key === home.key) }));
  lines.sort((a, b) => Number(b.home) - Number(a.home));
  for (const h of listed) if (!byHub.has(h.hub)) lines.push({ hub: h.hub, host: hostOf(h.hub), name: nameOf(h.hub, false), vaults: [], home: false });
  return lines;
}

let rev = 0;
subscribeVaults(() => { rev++; });
subscribeSettings(() => { rev++; });
export function useParachutes(): ParachuteLine[] {
  useSyncExternalStore((f) => { const a = subscribeVaults(f), b = subscribeSettings(f); return () => { a(); b(); }; }, () => rev);
  return parachutesNow();
}

/** After a sign-in to a Parachute (docs/design/SCOPES.md): the sign-in read one vault, the home when it chose one
 *  (`firstHome`: this device had no home before, and the hub listed that one vault only: with more, another may hold
 *  the person's settings, so nobody is taken for new). Then the Parachute goes on the person's list in the home vault, when
 *  Parachute may write there (the sign-in asks to read only: the list waits for the first time the person lets it change
 *  notes in their home, vault/reach.ts), and a person new to the app on Parachute Cloud (`cloud`: the hub said so)
 *  starts on the simple app. Best effort: the sign-in stands either way. */
export async function afterSignIn(hub: string, kept: readonly VaultRecord[], cloud = false, firstHome = false): Promise<void> {
  let newPerson = false;
  const home = homeVault();
  if (firstHome && home && kept.some((k) => k.key === home.key)) {
    // a home that holds no settings yet: a person new to this app (another device would have written them)
    const { holding, unread } = await withSettings([home]);
    newPerson = startsSimple(cloud, !!holding, unread);
    if (newPerson) startSimpleHere(); else forgetSimpleHere();
  }
  await readSettings();
  if (!homeVault()) return;
  await listThisHub(hub, newPerson);
}

/** Put a Parachute on the person's list (and the simple app, for a new person) when the home may be written; else it
 *  waits (listWaiting, after the person lets Parachute change notes in their home). */
async function listThisHub(hub: string, newPerson: boolean) {
  if (settingsNow().hubs.some((h) => h.hub === hub) && !newPerson) return;
  const home = homeVault();
  if (!home || levelIn(home.scope, home.vault) !== "write") { wait(hub, newPerson); return; }
  try { await listHub(hub, true, hub === CLOUD ? CLOUD_NAME : undefined, newPerson ? "simple" : undefined); unwait(hub); } catch { wait(hub, newPerson); }
}

const WAITING_KEY = "parachute.hubs.waiting.v1";
type Waiting = { hub: string; simple: boolean }[];
const waiting = (): Waiting => { try { const v = JSON.parse(localStorage.getItem(WAITING_KEY) ?? "[]") as unknown; return Array.isArray(v) ? v.filter((w): w is Waiting[number] => !!w && typeof (w as Waiting[number]).hub === "string").slice(0, 20) : []; } catch { return []; } };
const setWaiting = (w: Waiting) => { try { localStorage.setItem(WAITING_KEY, JSON.stringify(w)); } catch { /* this session */ } };
function wait(hub: string, simple: boolean) { setWaiting([...waiting().filter((w) => w.hub !== hub), { hub, simple: simple || waiting().some((w) => w.hub === hub && w.simple) }]); }
function unwait(hub: string) { setWaiting(waiting().filter((w) => w.hub !== hub)); }

/** The home may be written now: the Parachutes that waited go on the list. */
export async function listWaiting(): Promise<void> {
  for (const w of waiting()) await listThisHub(w.hub, w.simple).catch(() => undefined);
}

/** Who starts on the simple app (docs/SIMPLE.md): a person signing in to Parachute Cloud on a device with no home of
 *  theirs, with a vault of their own there, when every vault the sign-in brought was read and none holds a settings
 *  note. */
export const startsSimple = (cloud: boolean, holding: boolean, unread: number) => cloud && !holding && unread === 0;

/** Of these vaults, the one holding a settings note (updated last, if several), or none; and how many couldn't be read. */
async function withSettings(vaults: readonly VaultRecord[]): Promise<{ holding: VaultRecord | null; unread: number }> {
  let unread = 0;
  const found = await Promise.all(vaults.map(async (v) => {
    try {
      const rows = await clientFor(v).queryNotes({ tag: SETTINGS_TAG, limit: 1 });
      return rows.length ? { v, at: (rows[0] as { updatedAt?: string }).updatedAt ?? "" } : null;
    } catch { unread++; return null; }
  }));
  const hits = found.filter((x): x is { v: VaultRecord; at: string } => !!x).sort((a, b) => b.at.localeCompare(a.at));
  return { holding: hits[0]?.v ?? null, unread };
}
