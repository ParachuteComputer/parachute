// Security levels (docs/design/APP-RECORD.md "Security levels"): how careful Parachute is per action, and the idle
// lock. The gate is native (src-tauri/src/levels.rs): it keeps this device's levels and asks the passcode and the
// unlock. This file is the web side's half: the bundle record's `security` (which may only raise them), the signed
// approval that lowering takes, and what Settings shows.
//
//   approvals  Uni's routine approval cards and held sends: none (the tap), unlock, passcode. Powerful ones always unlock.
//   code       approving an applet's code: unlock or passcode (never less).
//   join       asking to join a private network (an http service's `join` op): none, unlock, passcode.
//   idle       minutes untouched before Parachute asks the unlock to open; 0: off.
//
// A record's levels raise every device that opens its app. Lowering one, or turning the idle lock off, is signed: on
// an unlocked device, with the person's key, as an approval of exactly the new levels (kind 30479, subject
// `security-<app id>`), kept in the home vault beside the applets' approvals. Another device takes it only when it is
// signed with its own key and newer than its own last change (Rust checks; `decide` here first). A vault edit without
// it changes nothing but upward.
import { approvalContent, decide, dOf, type SignedEvent, type Subject } from "../applet/approvals";
import { floorOf, raiseFloor, readApprovals, trustedNow, writeApprovalEvent, deviceName } from "../applet/approvalStore";
import type { Native } from "../services/native";
import { originOf, type VaultRecord } from "../vault/store";
import { codeOf, fullOf, loosens, same, SECURITY_SUBJECT, type Asked, type Levels } from "./levelRules";

export * from "./levelRules";

const listeners = new Set<() => void>();
/** Told when this device's levels may have changed (a record read, Settings): the idle lock asks again. */
export const onLevels = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
export const levelsChanged = () => { for (const f of [...listeners]) f(); };

/** What a lowering's approval is of: the app, in the home vault (never an applet: its record is `security-<id>`). */
export const subjectFor = (home: Pick<VaultRecord, "issuer" | "vault">, appId: string): Subject => ({ hub: originOf(home.issuer), vault: home.vault, record: `security-${appId}`, applet: SECURITY_SUBJECT });

type SyncDeps = {
  native: Pick<Native, "levelsRaise" | "levelsAdopt">;
  /** The approvals kept for this subject (the events), and the keys whose approvals count here. */
  approvals: (s: Subject) => Promise<unknown[]>;
  trusted: () => Promise<Set<string>>;
  floor: (s: Subject) => number | null;
  raiseFloor: (s: Subject, n: number) => void;
  now?: number;
};

/** Follow the open bundle's record: raise this device to what it asks; where it asks for less than this device holds,
 *  take that only with the person's signed approval of exactly those levels (Rust checks it again). Returns the
 *  device's levels after. */
export async function syncLevels(app: { id: string; security: Asked }, home: Pick<VaultRecord, "issuer" | "vault"> | null, deps: SyncDeps): Promise<Levels> {
  try { return await follow(app, home, deps); } finally { levelsChanged(); }
}
async function follow(app: { id: string; security: Asked }, home: Pick<VaultRecord, "issuer" | "vault"> | null, deps: SyncDeps): Promise<Levels> {
  let now = await deps.native.levelsRaise(app.security);
  if (!home || !Object.keys(app.security).length) return now;
  const wanted = fullOf(app.security);
  if (!loosens(now, wanted) || same(now, wanted)) return now;
  const s = subjectFor(home, app.id);
  const events = await deps.approvals(s).catch(() => [] as unknown[]);
  const d = decide(events, s, codeOf(wanted), "", await deps.trusted(), deps.now ?? Date.now(), deps.floor(s));
  if (!d.run) return now;
  const ev = events.find((e) => { try { const c = JSON.parse((e as SignedEvent).content) as { n?: unknown; code?: unknown }; return c.n === d.content.n && c.code === codeOf(wanted); } catch { return false; } });
  if (!ev) return now;
  try { now = await deps.native.levelsAdopt(ev as SignedEvent); deps.raiseFloor(s, d.content.n); } catch { /* not for this device: it keeps its own */ }
  return now;
}

/** The live dependencies: the home vault's approvals, the keys that count, the floors this device keeps. */
export const liveSyncDeps = (native: SyncDeps["native"]): SyncDeps => ({ native, approvals: readApprovals, trusted: trustedNow, floor: floorOf, raiseFloor });

/** Sign a change of levels on this device (the passcode when it keeps one, then the unlock), keep it here, and write
 *  the signed approval to the home vault. `written`: whether it reached the vault. */
export async function signLowering(native: Pick<Native, "levelsLower">, home: VaultRecord, appId: string, next: Levels, passcode: string | null, now = Date.now()): Promise<{ ev: SignedEvent; written: boolean }> {
  const s = subjectFor(home, appId);
  const content = approvalContent({ subject: s, approved: true, code: codeOf(next), scope: "", now, seen: floorOf(s), device: deviceName() });
  const ev = await native.levelsLower(JSON.stringify(content), dOf(s), passcode);
  raiseFloor(s, content.n);
  levelsChanged();
  const written = await writeApprovalEvent(home, s, "Security levels", ev).then(() => true, () => false);
  return { ev, written };
}

/** A level in plain words, for each action. */
export const levelWords: Record<import("./levelRules").Level, string> = { none: "Tap only", unlock: "Unlock", passcode: "Passcode" };
export const idleWords = (m: number) => (m === 0 ? "Off" : m < 60 ? `${m} min` : m === 60 ? "1 hour" : `${Math.round(m / 60)} hours`);
