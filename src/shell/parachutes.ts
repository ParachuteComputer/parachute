// The person's Parachutes (docs/design/ONE-SIGN-IN.md): the hubs this device is signed in to, and the ones their home
// vault's settings note lists (homeSettings.ts `hubs`), which this device may not be signed in to yet. And what follows
// a sign-in to a Parachute: the home vault chosen when this device had none, and the Parachute put on the list.
import { useSyncExternalStore } from "react";
import { clientFor } from "../vault/client";
import { CLOUD, CLOUD_NAME } from "../vault/parachute";
import { originOf, listVaults, subscribeVaults, hostOf, type VaultRecord } from "../vault/store";
import { isMine } from "../vault/whose";
import { homeVault, setHome, HOME_KEY } from "./frameSource";
import { listHub, readSettings, settingsNow, subscribeSettings, SETTINGS_TAG } from "./homeSettings";

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

/** After a sign-in to a Parachute: when this device has no home of the person's own yet, the vault of theirs that
 *  already holds their settings (another device wrote it there) becomes the home; then the Parachute goes on the
 *  person's list in the home vault (written once, on this tap). Best effort: the sign-in stands either way. */
export async function afterSignIn(hub: string, kept: readonly VaultRecord[]): Promise<void> {
  let chosen: string | null = null;
  try { chosen = localStorage.getItem(HOME_KEY); } catch { chosen = null; }
  const mineNow = listVaults().filter(isMine);
  // only a device with no home of its own before this sign-in looks for the one another device chose
  const hadHome = mineNow.some((v) => v.key === chosen || !kept.some((k) => k.key === v.key));
  if (!hadHome) {
    // the vault of theirs another device made the home (it holds the settings), else the first by name; kept as
    // this device's home, so a later sign-in doesn't move it
    const holding = await withSettings(kept.filter(isMine));
    const first = [...kept].filter(isMine).sort((a, b) => a.vault.localeCompare(b.vault))[0];
    if (holding ?? first) setHome((holding ?? first).key);
  }
  await readSettings();
  if (!homeVault()) return;
  if (settingsNow().hubs.some((h) => h.hub === hub)) return;
  try { await listHub(hub, true, hub === CLOUD ? CLOUD_NAME : undefined); } catch { /* the list waits for the next sign-in */ }
}

/** Of these vaults, the one holding a settings note (updated last, if several), or none. */
async function withSettings(vaults: readonly VaultRecord[]): Promise<VaultRecord | null> {
  const found = await Promise.all(vaults.map(async (v) => {
    try {
      const rows = await clientFor(v).queryNotes({ tag: SETTINGS_TAG, limit: 1 });
      return rows.length ? { v, at: (rows[0] as { updatedAt?: string }).updatedAt ?? "" } : null;
    } catch { return null; }
  }));
  const hits = found.filter((x): x is { v: VaultRecord; at: string } => !!x).sort((a, b) => b.at.localeCompare(a.at));
  return hits[0]?.v ?? null;
}
