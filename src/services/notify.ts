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

/** What allowed applets of the person's own vaults ask for, or null when something couldn't be read. */
export async function notifyEntries(): Promise<NotifyEntry[] | null> {
  const k = await keyringNow(true);
  // read as the applet screen keys them (refreshApplets): with the vault record, so an applet that imports a component
  // (Rooms and an area import Room) hashes with its imports and its grant reads as allowed
  const reads = await Promise.all(listVaults().filter((rec) => isMine(rec)).map(async (rec) => ({ key: rec.key, read: await readApplets(clientFor(rec), rec.key, false, rec).catch(() => null) })));
  const g = deviceGrants();
  return entriesFrom(k, reads, (subject, scope, html) => g.status(subject, scope, html));
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

let running: Promise<void> | null = null;
/** Hand the list to the native side, then bring the gateways in line (the app on a device only). A second call while
 *  one runs waits for it, then runs. */
export function syncNotify(): Promise<void> {
  if (!inShell()) return Promise.resolve();
  const go = async () => {
    const entries = await notifyEntries();
    if (!entries) return; // something couldn't be read: the native side keeps the last list
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("notify_set", { entries });
    const status = await invoke<PushStatus>("push_status");
    if (!status.available) return;
    const plan = pushPlan(entries, status.registered ?? []);
    // a distributor first: with none chosen and only one installed, that one (with several, the person picks in
    // Settings: no chooser pops up on its own). Each gateway's endpoint is asked of it when that gateway registers.
    const chosen = status.distributors?.some((d) => d.id === status.distributor);
    if (plan.register.length && !chosen && status.distributors?.length === 1) await invoke("push_setup", {}).catch(() => {});
    const hubs = knownHubs();
    for (const r of plan.unregister) await invoke("push_register", { ...r, op: "unregister", hubs }).catch(() => {});
    for (const r of plan.register) await invoke("push_register", { ...r, op: "register", hubs }).catch(() => {});
  };
  running = (running ?? Promise.resolve()).then(go, go).catch(() => {});
  return running;
}
