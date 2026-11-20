// Notifications while Parachute is closed (docs/design/KEYRING.md, docs/design/SERVICES.md "Notifications through an
// open push service"): the list of what allowed applets asked for, handed to the native side (src-tauri/src/notify.rs),
// then each applet's push gateway registered through Rust (`push_register` signs it with that gateway's own endpoint and
// push keys, one UnifiedPush instance per gateway; this side never sees a signature),
// and the gateways of grants that went unregistered. Made again when the app starts, when it comes back to the front,
// and whenever a grant is made or revoked. Only allowed applets of the person's own vaults count, and only `from` keys
// the device trusts.
import { npubDecode } from "./npub";
import { keyringNow } from "./keyring";
import { knownHubs } from "./hubs";
import { inShell } from "../vault/oauth";
import { listVaults } from "../vault/store";
import { clientFor } from "../vault/client";
import { isMine } from "../vault/whose";
import { readApplets, type Read } from "../applet/useApplets";
import { deviceGrants, subjectOf, type GrantStatus } from "../applet/grants";
import type { KeyringStatus } from "./native";
import { originOf, type VaultRecord } from "../vault/store";
import { gidOf } from "./signals";

export type NotifyEntry = {
  relay: string; me: string; rooms: string[] | null; mentions: boolean; from: string[]; subject: string; name: string;
  gateway?: string; names?: Record<string, string>;
};

/** The list from what was read, or null when anything couldn't be read (the key, or any of the person's vaults): a sync
 *  then sends nothing, since an empty list would stop every notification. Pure. */
export function entriesFrom(k: KeyringStatus | null, reads: readonly { key: string; read: Read | null }[], status: (subject: string, scope: string, html: string) => GrantStatus): NotifyEntry[] | null {
  if (!k) return null;
  const me = npubDecode(k.everyday);
  if (!me || reads.some((r) => !r.read)) return null;
  const out: NotifyEntry[] = [];
  for (const { key, read } of reads) {
    for (const e of read!.entries) {
      if (status(subjectOf(key, e.noteId), e.keys.scope, e.keys.html) !== "ok") continue;
      for (const s of e.services) {
        if (s.kind !== "nostr-relay" || !s.notify) continue;
        out.push({ relay: s.url, me, rooms: s.rooms?.map((r) => r.id) ?? null, mentions: s.notify.mentions, from: s.notify.from.filter((h) => k.approvers.some((a) => a.pubkey === h)),
          subject: `/v/${encodeURIComponent(key)}/a/${encodeURIComponent(e.noteId)}`, name: e.manifest.name,
          ...(s.notify.gateway ? { gateway: s.notify.gateway } : {}),
          ...(s.rooms?.length ? { names: Object.fromEntries(s.rooms.map((r) => [r.id, r.name])) } : {}) });
      }
    }
  }
  return out.slice(0, 8);
}

/** An allowed applet's signal that sends its count to a gateway (applet/signals.ts), as notify.rs `SignalEntry` keeps
 *  it: the opaque id and signal the gateway knows, and what the phone shows for a push of it. */
export type SignalEntry = { gid: string; signal: string; gateway: string; me: string; subject: string; name: string; label: string; relay?: string; rooms?: string[] | null };

/** The signals with a gateway, from what was read (the person's own vaults only). */
export async function signalEntriesFrom(me: string, reads: readonly { rec: VaultRecord; read: Read | null }[], status: (subject: string, scope: string, html: string) => GrantStatus): Promise<SignalEntry[]> {
  const out: SignalEntry[] = [];
  for (const { rec, read } of reads) {
    for (const e of read?.entries ?? []) {
      if (!e.signals?.length || status(subjectOf(rec.key, e.noteId), e.keys.scope, e.keys.html) !== "ok") continue;
      const gid = await gidOf(originOf(rec.issuer), rec.vault, e.noteId);
      for (const s of e.signals) {
        if (!s.via) continue;
        const relay = s.from.kind === "relay" ? e.services.find((v) => v.id === (s.from as { service: string }).service) : undefined;
        out.push({ gid, signal: s.id, gateway: s.via, me, subject: `/v/${encodeURIComponent(rec.key)}/a/${encodeURIComponent(e.noteId)}`, name: e.manifest.name, label: s.name,
          ...(relay?.kind === "nostr-relay" ? { relay: relay.url, rooms: relay.rooms?.map((r) => r.id) ?? null } : {}) });
      }
    }
  }
  return out.slice(0, 32);
}

/** What allowed applets of the person's own vaults ask for (null when something couldn't be read), and the vaults that
 *  couldn't be read. */
export async function notifyEntries(): Promise<{ entries: NotifyEntry[] | null; signals: SignalEntry[]; unread: string[]; noKey: boolean }> {
  const k = await keyringNow(true);
  // read as the applet screen keys them (refreshApplets): with the vault record, so an applet that imports a component
  // (Rooms and an area import Room) hashes with its imports and its grant reads as allowed
  const reads = await Promise.all(listVaults().filter((rec) => isMine(rec)).map(async (rec) => ({ key: rec.key, name: rec.vault, rec, read: await readApplets(clientFor(rec), rec.key, false, rec).catch(() => null) })));
  const g = deviceGrants();
  const status = (subject: string, scope: string, html: string) => g.status(subject, scope, html);
  const me = k ? npubDecode(k.everyday) : null;
  return { entries: entriesFrom(k, reads, status), signals: me ? await signalEntriesFrom(me, reads, status) : [], unread: reads.filter((r) => !r.read).map((r) => r.name), noKey: !k || !me };
}

/** How the last bringing-up-to-date went, for Settings: vaults it couldn't read (then nothing was handed on), how many
 *  applets ask to tell the person something, and each gateway that didn't take this phone, with why. `off`: applets ask,
 *  and the phone's notifications for Parachute are off (the person said no to the one question, or turned them off
 *  since): Settings says so and opens the phone's switch, since Parachute never asks again by itself. */
export type NotifyOutcome = { unread: string[]; noKey: boolean; asking: number; failed: { gateway: string; why: string }[]; error?: string; off?: boolean };
let outcome: NotifyOutcome | null = null;
const outcomeListeners = new Set<() => void>();
export const notifyOutcome = () => outcome;
export function onNotifyOutcome(f: () => void): () => void { outcomeListeners.add(f); return () => { outcomeListeners.delete(f); }; }
const said = (e: unknown) => (e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : String(e));

/** What Settings says about it, a line each, none twice. Pure. */
export function outcomeLines(o: NotifyOutcome | null, host: (url: string) => string): string[] {
  if (!o) return [];
  if (o.noKey) return ["Couldn't read this device's key just now, so notifications weren't updated."];
  if (o.unread.length) return [`Couldn't reach ${o.unread.join(", ")} just now, so notifications weren't updated. Parachute tries again when you come back to it.`];
  const lines = [
    ...(o.error ? [`Notifications weren't updated: ${o.error}`] : []),
    ...(o.asking || o.error ? [] : ["No applet asks to tell you anything yet. Rooms does once you allow it."]),
    ...o.failed.map((f) => `Couldn't register with ${host(f.gateway)}: ${f.why}`),
  ];
  return [...new Set(lines)];
}

export type PushStatus = {
  available: boolean;
  /** Installed UnifiedPush distributors (package names) and the one in use. */
  distributors?: { id: string; name: string }[];
  distributor?: string | null;
  /** Some gateway's push instance has an endpoint (each gateway gets its own, asked for when it registers). */
  endpoint?: boolean;
  /** Parachute's own connection for what no push service delivers: on unless the person turned it off. */
  fallback?: boolean;
  /** How many applets' asks the own connection is serving now (0: it isn't running). */
  listening?: number;
  registered?: { gateway: string; relay: string }[];
};

/** What to register and unregister: each (gateway, relay) the list names, and each one registered that it no longer
 *  names. Pure. */
export function pushPlan(entries: readonly NotifyEntry[], registered: readonly { gateway: string; relay: string }[]) {
  const want = new Map<string, { gateway: string; relay: string }>();
  for (const e of entries) if (e.gateway && (e.mentions || e.from.length)) want.set(`${e.gateway} ${e.relay}`, { gateway: e.gateway, relay: e.relay });
  const drop = registered.filter((r) => !want.has(`${r.gateway} ${r.relay}`));
  return { register: [...want.values()], unregister: drop };
}

/** The registrations to make: with a push service in use, all of them; none without one (Parachute's own connection then
 *  serves the applets, and a registration would only fail). A distributor first: with none chosen and only one
 *  installed, that one (`setup`; with several, the person picks in Settings: no chooser pops up on its own). Each
 *  gateway's endpoint is asked of the distributor when that gateway registers. */
export async function toRegister<T>(want: readonly T[], status: Pick<PushStatus, "distributors" | "distributor">, setup: () => Promise<unknown>): Promise<T[]> {
  if (!want.length) return [];
  if (status.distributors?.some((d) => d.id === status.distributor)) return [...want];
  if (status.distributors?.length === 1 && await setup().then(() => true, () => false)) return [...want];
  return [];
}

let running: Promise<void> | null = null;
/** Hand the list to the native side, then bring the gateways in line (the app on a device only). A second call while
 *  one runs waits for it, then runs. */
export function syncNotify(): Promise<void> {
  if (!inShell()) return Promise.resolve();
  const go = async () => {
    const failed: NotifyOutcome["failed"] = [];
    let read: Awaited<ReturnType<typeof notifyEntries>> | null = null;
    let off = false;
    const told = (error?: string) => {
      outcome = { unread: read?.unread ?? [], noKey: read?.noKey ?? false, asking: read?.entries?.length ?? 0, failed, ...(error ? { error } : {}), ...(off ? { off } : {}) };
      outcomeListeners.forEach((f) => f());
    };
    try {
      read = await notifyEntries();
      const entries = read.entries;
      if (!entries) { told(); return; } // something couldn't be read: the native side keeps the last list
      const { invoke } = await import("@tauri-apps/api/core");
      // Android asks for the permission once, the first time an applet asks (notify.rs `take_ask`); after that its answer
      // only shows here
      const set = await invoke<{ permission?: boolean } | null>("notify_set", { entries, signals: read.signals });
      off = entries.length > 0 && set?.permission === false;
      // the shell sends counts only for signals on the list just set: now they can go
      void import("./signals").then((s) => s.exchange());
      const status = await invoke<PushStatus>("push_status");
      if (!status.available) { told(); return; }
      const plan = pushPlan(entries, status.registered ?? []);
      const register = await toRegister(plan.register, status, () => invoke("push_setup", {}));
      const hubs = knownHubs();
      for (const r of plan.unregister) await invoke("push_register", { ...r, op: "unregister", hubs }).catch(() => {});
      for (const r of register) await invoke("push_register", { ...r, op: "register", hubs }).catch((e: unknown) => { failed.push({ gateway: r.gateway, why: said(e) }); });
      told();
    } catch (e) { told(said(e)); }
  };
  running = (running ?? Promise.resolve()).then(go, go).catch(() => {});
  return running;
}
