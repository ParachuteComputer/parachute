// The vaults an applet reaches on this screen (docs/ACCESS.md proposal 5): for an applet whose `app` reaches across
// vaults, its pick, read from the approval this device checks (a device with the person's key, or their anchor), else
// the one kept on this device (a browser tab); no pick, the default: the home, and for an applet with a card its own
// vault. Until the pick is read it reaches the default: the narrow side. `given` answers for this device's vault keys,
// read at each call, so the applet's calls follow a change of pick at once.
import { useEffect, useMemo, useRef, useState } from "react";
import type { AppletEntry } from "../applet/discovery";
import { dOf, pickOfDecision, type Content, type Decision, type PickRead, type Subject } from "../applet/approvals";
import { approvalsHere, floorOf, signedPick, signPick, signsHere, subjectOf as approvalSubject } from "../applet/approvalStore";
import { devicePick, onDevicePick, setDevicePick } from "../applet/pickStore";
import { asksVaults, heldIn, KEEPS_NOTES, reachOf, refKey, type VaultRef } from "../applet/vaultPick";
import { BUNDLED, OFFICIAL_NAMES, officialId, officialOf, type OfficialName } from "../applet/parachuteSource";
import { parseApp } from "../applet/app";
import { deviceGrants, subjectOf as grantSubject } from "../applet/grants";
import { appletsNow } from "../applet/useApplets";
import { isMine } from "../vault/whose";
import { homeVault } from "../shell/frameSource";
import { listVaults, originOf, subscribeVaults, type VaultRecord } from "../vault/store";

export const refOf = (v: Pick<VaultRecord, "issuer" | "vault">): VaultRef => ({ hub: originOf(v.issuer), vault: v.vault });

export type VaultPickNow = {
  /** It reaches across vaults, so it has a pick. */
  asks: boolean;
  /** A pick of one: Journal and Capture (where they keep their notes), or a record's `pick: "one"`. */
  one: boolean;
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
  // asked once per screen (asked again on each recheck, the extra async work tipped a race in kept screens, so a tapped
  // applet showed stopped: e2e/signed.spec.ts). A home or an anchor that comes later counts from the next screen
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
  const name = o.official && o.entry ? officialOf(o.entry.noteId) : null;
  const keeps = !!name && (KEEPS_NOTES as readonly string[]).includes(name);
  const asks = !!o.entry && (asksVaults(o.entry.app) || keeps);
  const one = keeps || !!o.entry?.pickOne;
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
  const reach = asks && read && !unconfirmed ? reachOf(pick, home ? refOf(home) : null, o.rec && !o.official ? refOf(o.rec) : null, one) : [];
  const key = asks ? `${read ? "" : "?"}${unconfirmed ? "!" : ""}${reach.map(refKey).join("\n")}` : "";
  const reachRef = useRef(reach);
  reachRef.current = reach;
  const given = useMemo(() => (asks ? (k: string) => heldIn(listVaults(), reachRef.current, originOf).some((v) => v.key === k) : () => true), [asks]);
  const missing = useMemo(() => reach.filter((r) => !listVaults().some((v) => originOf(v.issuer) === r.hub && v.vault === r.vault)), [key, held]); // eslint-disable-line react-hooks/exhaustive-deps
  const took = (p: VaultRef[] | null) => { if (d) setOfficial({ for: d, read: { pick: p }, signed: true }); };
  const canPick = !!here && (here.signs || !here.checks);
  return { asks, one, read, pick, unconfirmed, signed, canPick, reach, key, missing, given, again, took };
}

/** The subject of the approval that keeps a pick for one of Parachute's own: always in the home, named for it. */
export function ownSubject(name: OfficialName, home: VaultRecord): Subject {
  return approvalSubject(home, officialId(name), (BUNDLED[name].record.fields.applet as { id: string }).id);
}

/** Keep a pick for one of Parachute's own (no card): signed where the key is, else kept on this device; never on a
 *  device that reads signed picks but can't sign one (an anchor alone). `signed`: told before it is written. */
export async function keepOwnPick(name: OfficialName, label: string, pick: VaultRef[] | null, passcode: string | null, signed?: (c: Content) => void): Promise<Content | null> {
  const home = homeVault();
  if (!home) throw new Error("there's no home vault yet");
  const s = ownSubject(name, home);
  if (await signsHere()) return JSON.parse((await signPick(s, label, pick, passcode, signed)).ev.content) as Content;
  if (await approvalsHere()) throw new Error("Change it on a device that holds your key: this one reads the vaults you picked there");
  setDevicePick(dOf(s), pick);
  return null;
}

/** Where Journal or Capture keeps its notes on this device: its pick (signed, or kept here), else the home. `held:
 *  false`: picked, but this device doesn't hold that vault (it doesn't run elsewhere in the meantime). Only one of the
 *  person's own vaults counts. `unconfirmed`: on a device that checks approvals, one was seen and none counts now (or
 *  the read failed): it runs nowhere until a pick is signed again, never in the home by default. */
export async function keptIn(name: OfficialName): Promise<{ held: true; rec: VaultRecord } | { held: false; ref: VaultRef } | { unconfirmed: true } | null> {
  const home = homeVault();
  if (!home) return null;
  const s = ownSubject(name, home);
  const p = await signedPick(s).catch((): PickRead => ({ unconfirmed: true }));
  const read: PickRead = p === undefined ? { pick: devicePick(dOf(s)) } : p;
  if ("unconfirmed" in read) return { unconfirmed: true };
  const r = read.pick?.[0];
  if (!r) return { held: true, rec: home };
  const v = listVaults().find((x) => originOf(x.issuer) === r.hub && x.vault === r.vault);
  return v && isMine(v) ? { held: true, rec: v } : { held: false, ref: r };
}

/** For Settings (docs/ACCESS.md proposal 5, "1 gets exact"): by this device's key, the applets that reach each vault
 *  through their pick: Parachute's own that ask (Journal and Capture where they keep notes), and each applet allowed
 *  on this device that asks. One that can't be confirmed reaches none. */
export async function reachersNow(): Promise<Map<string, string[]>> {
  const home = homeVault();
  const out = new Map<string, string[]>();
  if (!home) return out;
  const items: { name: string; subject: Subject; own: VaultRef | null; one: boolean }[] = [];
  for (const n of OFFICIAL_NAMES) {
    const r = BUNDLED[n].record.fields, p = parseApp(r.app), keeps = (KEEPS_NOTES as readonly string[]).includes(n);
    if ((p.ok && asksVaults(p.app)) || keeps) items.push({ name: (r.applet as { name: string }).name, subject: ownSubject(n, home), own: null, one: keeps });
  }
  const g = deviceGrants();
  for (const v of listVaults()) {
    const read = appletsNow(v.key);
    if (read?.state !== "ok") continue;
    for (const e of read.found.entries) if (!e.newer && asksVaults(e.app) && g.status(grantSubject(v.key, e.noteId), e.keys.scope, e.keys.html) !== "none")
      items.push({ name: e.manifest.name, subject: approvalSubject(v, e.noteId, e.manifest.id), own: refOf(v), one: !!e.pickOne });
  }
  await Promise.all(items.map(async (it) => {
    const p = await signedPick(it.subject).catch((): PickRead => ({ unconfirmed: true }));
    const r: PickRead = p === undefined ? { pick: devicePick(dOf(it.subject)) } : p;
    if ("unconfirmed" in r) return;
    for (const v of heldIn(listVaults(), reachOf(r.pick, refOf(home), it.own, it.one), originOf)) out.set(v.key, [...(out.get(v.key) ?? []), it.name]);
  }));
  return out;
}
let reachers: { tick: string; p: Promise<Map<string, string[]>> } | null = null;
/** The same, asked once for each state of the vaults, grants and picks (`tick`), however many rows ask. */
export function useReachers(tick: string): Map<string, string[]> | null {
  const [m, setM] = useState<{ tick: string; m: Map<string, string[]> } | null>(null);
  const [picks, setPicks] = useState(0);
  useEffect(() => onDevicePick(() => setPicks((x) => x + 1)), []);
  const t = `${tick}|${picks}`;
  useEffect(() => {
    let on = true;
    if (reachers?.tick !== t) reachers = { tick: t, p: reachersNow() };
    void reachers.p.then((x) => { if (on) setM({ tick: t, m: x }); }, () => {});
    return () => { on = false; };
  }, [t]);
  return m?.m ?? null;
}
