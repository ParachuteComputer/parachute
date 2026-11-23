// The vaults an applet reaches on this screen (docs/ACCESS.md proposal 5): for an applet whose `app` reaches across
// vaults, its pick, read from the approval this device checks (a device with the person's key, or their anchor), else
// the one kept on this device (a browser tab); no pick, the default: the home, and for an applet with a card its own
// vault. Until the pick is read it reaches the default: the narrow side. `given` answers for this device's vault keys,
// read at each call, so the applet's calls follow a change of pick at once.
import { useEffect, useMemo, useRef, useState } from "react";
import type { AppletEntry } from "../applet/discovery";
import { dOf, type Decision, type Subject } from "../applet/approvals";
import { signedPick } from "../applet/approvalStore";
import { devicePick, onDevicePick } from "../applet/pickStore";
import { asksVaults, heldIn, reachOf, refKey, type VaultRef } from "../applet/vaultPick";
import { homeVault } from "../shell/frameSource";
import { listVaults, originOf, subscribeVaults, type VaultRecord } from "../vault/store";

export const refOf = (v: Pick<VaultRecord, "issuer" | "vault">): VaultRef => ({ hub: originOf(v.issuer), vault: v.vault });

export type VaultPickNow = {
  /** It reaches across vaults, so it has a pick. */
  asks: boolean;
  /** The pick is read (or there is none to read). */
  read: boolean;
  /** The pick, or null (the default). */
  pick: VaultRef[] | null;
  /** Where the pick comes from: a signed approval, or this device. */
  signed: boolean;
  /** What it reaches: the pick, or the default. */
  reach: VaultRef[];
  /** One string for what it reaches, to make its session again when that changes. */
  key: string;
  /** Vaults in its reach this device doesn't hold. */
  missing: VaultRef[];
  /** By this device's key: may it reach this vault. Every vault for an applet that doesn't ask. */
  given: (key: string) => boolean;
  /** Read again (a pick just saved on this device). */
  again: () => void;
};

export function useVaultPick(o: { rec: VaultRecord | null; entry: AppletEntry | null; official: boolean; subject: Subject | null;
  /** an applet with a card: the approvals this device read (undefined: not yet; null: it doesn't check them) */ signed: Decision | null | undefined;
  /** read again when the approvals in the home vault change */ recheck: number }): VaultPickNow {
  const asks = !!o.entry && asksVaults(o.entry.app);
  const [n, setN] = useState(0);
  const again = () => setN((x) => x + 1);
  useEffect(() => onDevicePick(again), []);
  // the vaults held change (one opened, one signed out of): what it reaches is read again
  const [held, setHeld] = useState(0);
  useEffect(() => subscribeVaults(() => setHeld((x) => x + 1)), []);
  const d = o.subject ? dOf(o.subject) : null;
  // Parachute's own: the pick alone, in an approval of its own (approvalStore.ts signedPick)
  const [official, setOfficial] = useState<{ for: string; pick: VaultRef[] | null; signed: boolean } | null>(null);
  useEffect(() => {
    if (!asks || !o.official || !o.subject || !d) return;
    let on = true;
    const s = o.subject;
    void signedPick(s).then((p) => { if (on) setOfficial({ for: d, pick: p === undefined ? devicePick(d) : p, signed: p !== undefined }); },
      () => { if (on) setOfficial({ for: d, pick: null, signed: true }); });
    return () => { on = false; };
  }, [asks, o.official, d, o.recheck, n]); // eslint-disable-line react-hooks/exhaustive-deps
  let read = true, pick: VaultRef[] | null = null, signed = false;
  if (asks && d) {
    if (o.official) {
      const now = official && official.for === d ? official : null;
      read = !!now; pick = now?.pick ?? null; signed = now?.signed ?? false;
    } else if (o.signed === undefined) read = false;
    else if (o.signed === null) pick = devicePick(d);
    else { signed = true; pick = o.signed.run ? o.signed.content.vaults ?? null : null; }
  }
  const home = homeVault();
  const reach = asks ? reachOf(pick, home ? refOf(home) : null, o.rec && !o.official ? refOf(o.rec) : null) : [];
  const key = asks ? reach.map(refKey).join("\n") : "";
  const reachRef = useRef(reach);
  reachRef.current = reach;
  const given = useMemo(() => (asks ? (k: string) => heldIn(listVaults(), reachRef.current, originOf).some((v) => v.key === k) : () => true), [asks]);
  const missing = useMemo(() => reach.filter((r) => !listVaults().some((v) => originOf(v.issuer) === r.hub && v.vault === r.vault)), [key, held]); // eslint-disable-line react-hooks/exhaustive-deps
  return { asks, read, pick, signed, reach, key, missing, given, again };
}
