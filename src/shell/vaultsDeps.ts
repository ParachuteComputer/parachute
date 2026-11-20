// What the `vaults` and `sharing` words reach (applet/modules/vaults.ts), answered by the shell: each vault's own API
// with this device's sign-in (a change to a vault held only for reading is refused before it is sent, and the person
// is asked: vault/writeAsk.ts), the vault's live changes, and what the app knows of who reaches a vault.
import type { VaultClient } from "@openparachute/surface-client";
import type { AccessRow, HeldVault, VaultsDeps, WatchEvent } from "../applet/modules/vaults";
import { clientFor } from "../vault/client";
import { findVault, hostOf, listVaults, originOf, type VaultRecord } from "../vault/store";
import { isMine } from "../vault/whose";
import { heldLevel, giveBack, appletLevel } from "../vault/reach";
import { forgetOwnWrite } from "../vault/writeAsk";
import { homeVault } from "./frameSource";
import { deviceGrants, subjectOf } from "../applet/grants";
import { appletsNow, refreshApplets } from "../applet/useApplets";
import { takeBack } from "../applet/approvalStore";
import { forgetSaved } from "./saved";
import { connectorAddress } from "../views/Connect";

type Requesting = { request<T>(path: string, init?: RequestInit): Promise<T> };
const doors = new Map<string, Promise<"records" | "notes">>();

const rec = (key: string): VaultRecord => {
  const r = findVault(key);
  if (!r) throw new Error("This device doesn't hold that vault.");
  return r;
};

export function heldVaults(): HeldVault[] {
  const home = homeVault();
  return listVaults().map((v) => ({ key: v.key, name: v.vault, host: hostOf(v.issuer), mine: isMine(v), home: home?.key === v.key, level: heldLevel(v) }));
}

export function vaultsDeps(opts: { confirm(q: { title: string; body: string; act: string }): Promise<"yes" | "no" | "untapped">; emit(event: string, data: unknown): void; back(): string }): VaultsDeps {
  const req = (key: string) => clientFor(rec(key)) as unknown as VaultClient & Requesting;
  return {
    list: heldVaults,
    // never from the browser's cache: the hub sends ETag and Last-Modified with no Cache-Control, so a browser may reuse a
    // read of a moment ago (heuristic freshness), and a record just changed would read as it was
    request: (key, method, path, body) => req(key).request(`/api${path}`, { method, cache: "no-store", ...(body === undefined ? {} : { body: JSON.stringify(body) }) }),
    door(key) {
      let d = doors.get(key);
      if (!d) {
        d = req(key).request("/api/records?limit=1").then(() => "records" as const, (e: unknown) => {
          // only "no such route" says there is no door; anything else is asked again next time
          if ((e as { status?: number })?.status === 404 || (e as { name?: string })?.name === "VaultNotFoundError") return "notes" as const;
          doors.delete(key);
          throw e;
        });
        doors.set(key, d);
      }
      return d;
    },
    watch(key, type, on: (e: WatchEvent) => void) {
      try {
        // the live query sends what matches now first (the hub ignores `limit` there: the whole type, or the whole
        // vault, without bodies), then every change; only the changes go on to the applet
        return clientFor(rec(key)).subscribe({ ...(type ? { tag: type } : {}), includeContent: false } as never, {
          onSnapshot: () => {},
          onUpsert: (n: unknown) => on({ upsert: n as never }),
          onRemove: (id: string) => on({ remove: id }),
        });
      } catch { return () => {}; }
    },
    async access(key): Promise<AccessRow> {
      const v = rec(key);
      const grants = deviceGrants();
      if (appletsNow(v.key)?.state !== "ok") await refreshApplets(v).catch(() => false);
      const read = appletsNow(v.key);
      const applets = grants.subjects().filter((s) => s.startsWith(subjectOf(v.key, ""))).map((s) => {
        const id = s.slice(subjectOf(v.key, "").length);
        const e = read?.state === "ok" ? read.found.entries.find((x) => x.noteId === id) : undefined;
        return { noteId: id, name: e?.manifest.name ?? "An applet no longer in the vault", glyph: e?.manifest.glyph ?? "◇", since: grants.record(s)?.grantedAt || null, changes: e ? appletLevel(e.manifest) === "write" : false };
      });
      return { level: heldLevel(v), mine: isMine(v), home: homeVault()?.key === v.key, hub: originOf(v.issuer), connector: connectorAddress(v), applets };
    },
    async revoke(key, noteId) {
      const v = rec(key);
      const subject = subjectOf(v.key, noteId);
      const read = appletsNow(v.key);
      const e = read?.state === "ok" ? read.found.entries.find((x) => x.noteId === noteId) : undefined;
      // as Settings' Revoke: the signed approval taken back where the key is, the grant, what it saved here
      await takeBack(v, noteId, e?.manifest.name ?? "this applet", e?.manifest.id ?? null).catch(() => null);
      deviceGrants().revoke(subject);
      forgetSaved(subject);
      await giveBack(v.key, opts.back());
    },
    async readOnly(key) {
      const v = rec(key);
      forgetOwnWrite(v);
      await giveBack(v.key, opts.back());
    },
    confirm: opts.confirm,
    emit: opts.emit,
  };
}
