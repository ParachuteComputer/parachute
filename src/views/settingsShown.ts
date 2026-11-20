// Which of Settings' sections for the person's key show (docs/design/APP-RECORD.md "Security levels", KEYRING.md): each
// only when it governs something this person uses on this device. A newcomer (no key here, no frame of their own) sees
// none of them. Pure: Settings.tsx gathers the facts.
import type { Service } from "../applet/services";

export type SettingsFacts = {
  /** The person's key is on this device (approvalStore `ownKey`). */
  key: boolean;
  /** A home vault of theirs is on this device: where Allow keeps the approval it signs. */
  home: boolean;
  /** The applets read in the vaults on this device, each with the services it declares. */
  applets: readonly { services: readonly Service[] }[];
  /** Something of Security's is set on this device: the levels or the idle lock off the defaults (a record raised them,
   *  or the person changed them), or a passcode kept here. It needs no key. */
  securitySet: boolean;
  /** A root key's public half is kept here for the home (approvalStore `anchorNow`). */
  anchor: boolean;
  /** The home vault holds a frame of the person's, or this device runs the copy it kept of one (`ownFrame`). */
  frame: boolean;
  /** How many vaults on this device are the person's own. */
  ownVaults: number;
};
export type Shown = { security: boolean; approving: boolean; frame: boolean };

/** An applet that answers approval cards (a relay's `approvals`) or sends held requests (an http service's `approve`). */
export const usesCards = (a: { services: readonly Service[] }) => a.services.some((s) => (s.kind === "nostr-relay" ? !!s.approvals : !!s.approve));

export function settingsShown(f: SettingsFacts): Shown {
  const applets = f.applets.length > 0;
  return {
    // what Parachute asks before it acts: with the key here every Allow is a signed approval of the applet's code, and
    // approval cards and joins are applets' too. Shown, key or not, while something of it is set here: an idle lock
    // locks, a passcode is asked, and this is where they are seen and changed.
    security: (f.key && applets) || f.securitySet,
    // Approving code and its Root key: the key signs each Allow and keeps it in the home vault. Kept while a root key is
    // held here, so it can be removed.
    approving: f.key && f.home && (applets || f.anchor),
    // the home picker is in Frame while it has more to choose from than one vault
    frame: f.frame || f.ownVaults > 1,
  };
}

/** Settings → Approvals (KeyringSettings.tsx), the keys trusted to ask this device: with the key here (its keyring read,
 *  `k`), once an applet answers approval cards, or while a key is trusted or a separate approval key (made before 11-18)
 *  is here to remove. */
export const approvalsShown = (cards: boolean, k: { same: boolean; approvers: readonly unknown[] } | null) =>
  !!k && (cards || k.approvers.length > 0 || !k.same);

/** The person has a frame: one in the home vault (or several, or a copy of theirs runs here while it can't be read). */
export const ownFrame = (read: { state: string } | null, run: "built-in" | "vault") => run === "vault" || read?.state === "found" || read?.state === "many";
