// What the `vaults` and `sharing` words reach (applet/modules/vaults.ts), answered by the shell: each vault's own API
// with this device's sign-in (a change to a vault held only for reading is refused before it is sent, and the person
// is asked: vault/writeAsk.ts), the vault's live changes, and what the app knows of who reaches a vault.
import type { VaultClient } from "@openparachute/surface-client";
import type { AccessRow, HeldVault, HubRow, VaultsDeps, WatchEvent } from "../applet/modules/vaults";
import { describe, oneAddress } from "../vault/parachute";
import { clientFor, keptClientFor } from "../vault/client";
import { connectorAddress, findVault, hostOf, listVaults, originOf, vaultUrlOf, type VaultRecord } from "../vault/store";
import { isMine } from "../vault/whose";
import { heldLevel, giveBack, appletLevel } from "../vault/reach";
import { forgetOwnWrite } from "../vault/writeAsk";
import { homeVault } from "./frameSource";
import { deviceGrants, subjectOf } from "../applet/grants";
import { appletsNow, refreshApplets } from "../applet/useApplets";
import { takeBack } from "../applet/approvalStore";
import { forgetSaved } from "./saved";
import { officialCopyOf } from "../applet/parachuteSource";

type Requesting = { request<T>(path: string, init?: RequestInit): Promise<T> };
const doors = new Map<string, Promise<"records" | "notes">>();

const rec = (key: string): VaultRecord => {
  const r = findVault(key);
  if (!r) throw new Error("This device doesn't hold that vault.");
  return r;
};

export function heldVaults(): HeldVault[] {
  const home = homeVault();
  return listVaults().map((v) => ({ key: v.key, name: v.vault, host: hostOf(v.issuer), mine: isMine(v), home: home?.key === v.key, level: heldLevel(v), connector: connectorAddress(v) }));
}

/** Each hub's one address, asked of its description once a session. A hub that doesn't answer within 4 s, or can't
 *  be read, counts as none and is asked again after a minute; one slow hub never holds back the others. */
const addresses = new Map<string, Promise<string | null>>();
const ASK_MS = 4000, RETRY_MS = 60_000;
const addressOf = (hub: string) => {
  let a = addresses.get(hub);
  if (!a) {
    const timed: typeof fetch = (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(ASK_MS) });
    a = describe(hub, timed).then(oneAddress, () => { setTimeout(() => addresses.delete(hub), RETRY_MS); return null; });
    addresses.set(hub, a);
  }
  return a;
};

/** The hubs the device holds vaults on, in the order of `heldVaults`, each with its one address (T-476). */
export async function heldHubs(): Promise<HubRow[]> {
  const by = new Map<string, HubRow & { hub: string }>();
  for (const v of listVaults()) {
    const hub = originOf(v.issuer);
    const row = by.get(hub) ?? { hub, host: hostOf(v.issuer), address: null, vaults: [] };
    row.vaults.push(v.key);
    by.set(hub, row);
  }
  return Promise.all([...by.values()].map(async ({ hub, ...row }) => ({ ...row, address: await addressOf(hub) })));
}

export function vaultsDeps(opts: { confirm(q: { title: string; body: string; act: string }): Promise<"yes" | "no" | "untapped">; emit(event: string, data: unknown): void; back(): string;
  /** Each read made from the kept copies (the vault, the read's path and query as readCache names it). */ read?(vault: string, read: string): void }): VaultsDeps {
  const req = (key: string) => clientFor(rec(key)) as unknown as VaultClient & Requesting;
  return {
    list: heldVaults,
    hubs: heldHubs,
    // never from the browser's cache: the hub sends ETag and Last-Modified with no Cache-Control, so a browser may reuse a
    // read of a moment ago (heuristic freshness), and a record just changed would read as it was
    // a read as the hub has it now, kept for the screens that may show it from the copy (vault/readCache.ts); a change
    // goes as it is
    request: (key, method, path, body) => (method === "GET" ? (keptClientFor(rec(key)) as unknown as VaultClient & Requesting).request(`/api${path}`, { method, cache: "reload" })
      : req(key).request(`/api${path}`, { method, cache: "no-store", ...(body === undefined ? {} : { body: JSON.stringify(body) }) })),
    // what a screen shows: from the copy kept of the read at once, the hub asked behind it (vault/readCache.ts)
    // a record for what shows, from the copy kept of it (vault/readCache.ts): only for an applet that redraws when told
    ...(opts.read ? { read: (key: string, path: string) => {
      const r = rec(key);
      // the read as the client asks it (its address without a trailing slash, then /api…), so it is named as onFresh names it
      try { const u = new URL(`${vaultUrlOf(r).replace(/\/+$/, "")}/api${path}`); opts.read?.(key, `${u.pathname}${u.search}`); } catch { /* not a URL */ }
      return (keptClientFor(r) as unknown as VaultClient & Requesting).request(`/api${path}`, { cache: "no-store" });
    } } : {}),
    door(key) {
      let d = doors.get(key);
      if (!d) {
        // the answer kept from before, when there is one (a hub doesn't lose its door): no ask before the first read
        d = (keptClientFor(rec(key)) as unknown as VaultClient & Requesting).request("/api/records?limit=1").then(() => "records" as const, (e: unknown) => {
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
    async applets(key) {
      const v = rec(key);
      // read again each time: an applet an AI just wrote is what the person is looking for
      await refreshApplets(v).catch(() => false);
      const read = appletsNow(v.key);
      const grants = deviceGrants();
      return read?.state === "ok" ? read.found.entries.map((e) => {
        const copy = officialCopyOf(e.manifest.id);
        return { id: e.noteId, name: e.manifest.name, glyph: e.manifest.glyph, href: `/v/${encodeURIComponent(v.key)}/a/${encodeURIComponent(e.noteId)}`,
          allowed: grants.status(subjectOf(v.key, e.noteId), e.keys.scope, e.keys.html) === "ok", ...(copy ? { copyOf: copy } : {}) };
      }) : [];
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
