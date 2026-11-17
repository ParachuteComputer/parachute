// Notifications while Parachute is closed (docs/design/KEYRING.md): the list of what allowed applets asked for, handed
// to the native side (src-tauri/src/notify.rs → Android's NotifyService), which keeps its own relay connection. Made
// again when the app starts and whenever a grant is made or revoked. Only allowed applets of the person's own vaults
// count, and only `from` keys the device trusts.
import { npubDecode } from "./npub";
import { keyringNow } from "./keyring";
import { inShell } from "../vault/oauth";
import { listVaults } from "../vault/store";
import { clientFor } from "../vault/client";
import { isMine } from "../vault/whose";
import { readApplets } from "../applet/useApplets";
import { deviceGrants, subjectOf } from "../applet/grants";

export type NotifyEntry = { relay: string; me: string; rooms: string[] | null; mentions: boolean; from: string[]; subject: string; name: string };

export async function notifyEntries(): Promise<NotifyEntry[]> {
  const k = await keyringNow(true);
  if (!k) return [];
  const me = npubDecode(k.everyday);
  if (!me) return [];
  const out: NotifyEntry[] = [];
  for (const rec of listVaults()) {
    if (!isMine(rec)) continue;
    const read = await readApplets(clientFor(rec), rec.vault).catch(() => null);
    for (const e of read?.entries ?? []) {
      if (deviceGrants().status(subjectOf(rec.key, e.noteId), e.keys.scope, e.keys.html) !== "ok") continue;
      for (const s of e.services) {
        if (s.kind !== "nostr-relay" || !s.notify) continue;
        out.push({ relay: s.url, me, rooms: s.rooms?.map((r) => r.id) ?? null, mentions: s.notify.mentions, from: s.notify.from.filter((h) => k.approvers.some((a) => a.pubkey === h)),
          subject: `/v/${encodeURIComponent(rec.key)}/a/${encodeURIComponent(e.noteId)}`, name: e.manifest.name });
      }
    }
  }
  return out.slice(0, 8);
}

let running: Promise<void> | null = null;
/** Hand the list to the native side (the app on a device only). A second call while one runs waits for it, then runs. */
export function syncNotify(): Promise<void> {
  if (!inShell()) return Promise.resolve();
  const go = async () => {
    const entries = await notifyEntries();
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("notify_set", { entries });
  };
  running = (running ?? Promise.resolve()).then(go, go).catch(() => {});
  return running;
}
