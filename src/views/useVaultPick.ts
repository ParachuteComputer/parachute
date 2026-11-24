// The vaults an applet reaches on this screen (docs/ACCESS.md proposal 5): for an applet whose `app` reaches across
// vaults, its pick, read from the approval this device checks (a device with the person's key, or their anchor), else
// the one kept on this device (a browser tab); no pick, the default: the home, and for an applet with a card its own
// vault. Until the pick is read it reaches the default: the narrow side. `given` answers for this device's vault keys,
// read at each call, so the applet's calls follow a change of pick at once.
import { useEffect, useMemo, useRef, useState } from "react";
import type { AppletEntry } from "../applet/discovery";
import { dOf, pickOfDecision, type Decision, type PickRead, type Subject } from "../applet/approvals";
import { approvalsHere, floorOf, signedPick, signsHere } from "../applet/approvalStore";
import { devicePick, onDevicePick } from "../applet/pickStore";
import { asksVaults, heldIn, reachOf, refKey, type VaultRef } from "../applet/vaultPick";
import { homeVault } from "../shell/frameSource";
import { listVaults, originOf, subscribeVaults, type VaultRecord } from "../vault/store";

export const refOf = (v: Pick<VaultRecord, "issuer" | "vault">): VaultRef => ({ hub: originOf(v.issuer), vault: v.vault });

export type VaultPickNow = {
  /** It reaches across vaults, so it has a pick. */
  asks: boolean;
  /** The pick is read (or there is none to read). Until then it reaches nothing. */
  read: boolean;
  /** The pick, or null (the default). */
  pick: VaultRef[] | null;
  /** On a device that checks approvals, one was seen for it and none counts now (deleted, put back, unreadable): it
   *  reaches nothing until a new pick is signed (review finding 1). */
  unconfirmed: boolean;
  /** Where the pick comes from: a signed approval, or this device. */
  signed: boolean;
  /** This device can change the pick: it signs approvals, or doesn't check them (an anchor alone can't). */
  canPick: boolean;
  /** What it reaches: the pick, or the default; nothing while unread or unconfirmed. */
  reach: VaultRef[];
  /** One string for what it reaches, to make its session again when that changes. */
  key: string;
  /** Vaults in its reach this device doesn't hold. */
  missing: VaultRef[];
  /** By this device's key: may it reach this vault. Every vault for an applet that doesn't ask. */
  given: (key: string) => boolean;
  /** Read again (a pick just saved on this device). */
  again: () => void;
  /** One of Parachute's own: the pick just signed here holds at once, before the home vault has it. */
  took: (pick: VaultRef[] | null) => void;
};

/** What this device does with approvals: checks them (a key or an anchor), and signs them (a key). */
function useApprovalsHere(): { checks: boolean; signs: boolean } | null {
  const [here, setHere] = useState<{ checks: boolean; signs: boolean } | null>(null);
  useEffect(() => {
    let on = true;
    void Promise.all([approvalsHere(), signsHere()]).then(([checks, signs]) => { if (on) setHere({ checks, signs }); }, () => { if (on) setHere({ checks: true, signs: false }); });
    return () => { on = false; };
  }, []);
  return here;
}

export function useVaultPick(o: { rec: VaultRecord | null; entry: AppletEntry | null; official: boolean; subject: Subject | null;
  /** an applet with a card: the approvals this device read (undefined: not yet; null: none read, or the read failed) */ signed: Decision | null | undefined;
  /** read again when the approvals in the home vault change */ recheck: number }): VaultPickNow {
  const asks = !!o.entry && asksVaults(o.entry.app);
  const [n, setN] = useState(0);
  const again = () => setN((x) => x + 1);
  useEffect(() => onDevicePick(again), []);
  // the vaults held change (one opened, one signed out of): what it reaches is read again
  const [held, setHeld] = useState(0);
  useEffect(() => subscribeVaults(() => setHeld((x) => x + 1)), []);
  const here = useApprovalsHere();
  const d = o.subject ? dOf(o.subject) : null;
  // Parachute's own: the pick alone, in an approval of its own (approvalStore.ts signedPick)
  const [official, setOfficial] = useState<{ for: string; read: PickRead; signed: boolean } | null>(null);
  useEffect(() => {
    if (!asks || !o.official || !o.subject || !d) return;
    let on = true;
    const s = o.subject;
    void signedPick(s).then((p) => { if (on) setOfficial({ for: d, read: p === undefined ? { pick: devicePick(d) } : p, signed: p !== undefined }); },
      () => { if (on) setOfficial({ for: d, read: { unconfirmed: true }, signed: true }); });
    return () => { on = false; };
  }, [asks, o.official, d, o.recheck, n]); // eslint-disable-line react-hooks/exhaustive-deps
  let read = true, pick: VaultRef[] | null = null, signed = false, unconfirmed = false;
  if (asks && d) {
    let r: PickRead | null = null;
    if (o.official) {
      const now = official && official.for === d ? official : null;
      r = now?.read ?? null; signed = now?.signed ?? false;
    } else if (o.signed === undefined || here === null) r = null;
    // none read: on a device that checks approvals, the read failed (never the device's own copy); else this device's
    else if (o.signed === null) { signed = here.checks; r = here.checks ? { unconfirmed: true } : { pick: devicePick(d) }; }
    else { signed = true; r = pickOfDecision(o.signed, o.subject ? floorOf(o.subject) : null); }
    if (!r) read = false;
    else if ("unconfirmed" in r) unconfirmed = true;
    else pick = r.pick;
  }
  const home = homeVault();
  const reach = asks && read && !unconfirmed ? reachOf(pick, home ? refOf(home) : null, o.rec && !o.official ? refOf(o.rec) : null) : [];
  const key = asks ? `${read ? "" : "?"}${unconfirmed ? "!" : ""}${reach.map(refKey).join("\n")}` : "";
  const reachRef = useRef(reach);
  reachRef.current = reach;
  const given = useMemo(() => (asks ? (k: string) => heldIn(listVaults(), reachRef.current, originOf).some((v) => v.key === k) : () => true), [asks]);
  const missing = useMemo(() => reach.filter((r) => !listVaults().some((v) => originOf(v.issuer) === r.hub && v.vault === r.vault)), [key, held]); // eslint-disable-line react-hooks/exhaustive-deps
  const took = (p: VaultRef[] | null) => { if (d) setOfficial({ for: d, read: { pick: p }, signed: true }); };
  const canPick = !!here && (here.signs || !here.checks);
  return { asks, read, pick, unconfirmed, signed, canPick, reach, key, missing, given, again, took };
}
