// What the `vaults` and `sharing` words reach (applet/modules/vaults.ts), answered by the shell: each vault's own API
// with this device's sign-in (a change to a vault held only for reading is refused before it is sent, and the person
// is asked: vault/writeAsk.ts), the vault's live changes, and what the app knows of who reaches a vault.
import type { VaultClient } from "@openparachute/surface-client";
import type { AccessRow, HeldVault, HubRow, ReachRow, VaultsDeps, WatchEvent } from "../applet/modules/vaults";
import { askManage } from "../vault/signInFlow";
import { endManage, endReach, hubLists, listReach, makeKey, ManageEndedError, manageHeld, type HubGrantRow } from "../vault/manage";
import { describe, oneAddress } from "../vault/parachute";
import { clientFor, keptClientFor, lastRefreshFailure, signInState } from "../vault/client";
import { connectorAddress, findVault, hostOf, listVaults, originOf, vaultUrlOf, type VaultRecord } from "../vault/store";
import { isMine } from "../vault/whose";
import { heldLevel, giveBack, appletLevel } from "../vault/reach";
import { forgetOwnWrite } from "../vault/writeAsk";
import { homeVault } from "./frameSource";
import { userOf } from "../services/signals";
import { reachOf, viewBase } from "../vault/published";
import { deviceGrants, subjectOf } from "../applet/grants";
import { appletsNow, refreshApplets } from "../applet/useApplets";
import { takeBack } from "../applet/approvalStore";
import { forgetSaved } from "./saved";
import { officialCopyOf } from "../applet/parachuteSource";
import { endAccess, inviteTo, knownNames, takeBackInvite, vaultNames, vaultPeople } from "../vault/sharing";
import { bareName } from "../applet/files";

type Requesting = { request<T>(path: string, init?: RequestInit): Promise<T> };
const doors = new Map<string, Promise<"records" | "notes">>();

const rec = (key: string): VaultRecord => {
  const r = findVault(key);
  if (!r) throw new Error("This device doesn't hold that vault.");
  return r;
};

export function heldVaults(): HeldVault[] {
  const home = homeVault();
  return listVaults().map((v) => ({ key: v.key, name: v.vault, host: hostOf(v.issuer), mine: isMine(v), home: home?.key === v.key, level: heldLevel(v), connector: connectorAddress(v), view: viewBase(v), reach: reachOf(vaultUrlOf(v)) }));
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

/** A vault that refuses this device's sign-in, when the hub also refused to refresh it, is no longer reached (its owner
 *  may have ended the share: docs/design/SHARING.md); a refusal while the hub is out of reach stays what it was. */
const noReach = (key: string) => async (e: unknown): Promise<never> => {
  const status = (e as { status?: number })?.status;
  // the refresh the client just tried says it; only when none has failed yet is the hub asked (one refresh)
  if ((e as { name?: string })?.name === "VaultAuthError" && status === 401 && (lastRefreshFailure(key) ?? await signInState(key).catch(() => "unreachable")) === "refused") {
    throw Object.assign(new Error(`no_reach: this device's sign-in to the vault was refused`), { name: "NoReachError" });
  }
  throw e;
};

/** A row of the hub's list as Vault shows it: in force only, what it may do in a word, its types (null: all). */
function reachRow(r: HubGrantRow, self: string | null): ReachRow {
  const types = Object.keys(r.types ?? {});
  const writes = types.some((t) => (r.types[t] ?? []).some((v) => v !== "read"));
  const who = (["person", "agent", "app", "service"] as const).find((k) => k === r.kind) ?? "app";
  // a person the vault is shared with: one row for them and every sign-in of theirs (core T-476 one list)
  const member = r.kind === "person" && r.by === "self" ? { key: typeof r.grantee === "string" ? r.grantee : null, role: r.member?.role ?? (r.admin ? "write" : writes ? "member" : "read") } : null;
  return { id: r.id, name: r.name, who, app: r.app, can: r.admin ? "manage" : r.export ? "backup" : writes ? "change" : "read",
    types: types.length === 0 || types.includes("*") ? null : types.sort(), until: r.expires_at, lastUsed: r.last_used_at, self: !!self && r.client === self,
    ...(member ? { member } : {}), ...(!member && r.person?.name ? { of: r.person.name } : {}) };
}

export function vaultsDeps(opts: { confirm(q: { title: string; body: string; act: string }): Promise<"yes" | "no" | "untapped">; emit(event: string, data: unknown): void; back(): string;
  /** The applet these words serve (its subject): what it manages is held for it alone (vault/manage.ts). */ applet?: string;
  /** The shell's own sheet that shows a key's secret once, never handing it to the applet. */ reveal?(k: { name: string; vault: string; token: string; address: string; until: string }): Promise<void>;
  /** Each read made from the kept copies (the vault, the read's path and query as readCache names it). */ read?(vault: string, read: string): void;
  /** The shell's own picker over the applet, during a tap (Import from Notion). */ pick?: VaultsDeps["pick"] }): VaultsDeps {
  const req = (key: string) => clientFor(rec(key)) as unknown as VaultClient & Requesting;
  const applet = opts.applet ?? "";
  return {
    ...(opts.pick ? { pick: opts.pick } : {}),
    list: heldVaults,
    hubs: heldHubs,
    // this device's Parachute signed in as an app: its writes are its key's, named for this client id (core keys.ts)
    self: (key) => findVault(key)?.clientId ?? null,
    // the person's own account on that hub: the sign-in's subject (a write for it, by no named key, is theirs)
    account: (key) => { const v = findVault(key); return v ? userOf(v.accessToken) : null; },
    // never from the browser's cache: the hub sends ETag and Last-Modified with no Cache-Control, so a browser may reuse a
    // read of a moment ago (heuristic freshness), and a record just changed would read as it was
    // a read as the hub has it now, kept for the screens that may show it from the copy (vault/readCache.ts); a change
    // goes as it is
    request: (key, method, path, body) => (method === "GET" ? (keptClientFor(rec(key)) as unknown as VaultClient & Requesting).request(`/api${path}`, { method, cache: "reload" })
      : req(key).request(`/api${path}`, { method, cache: "no-store", ...(body === undefined ? {} : { body: JSON.stringify(body) }) })).catch(noReach(key)),
    upload: async (key, name, bytes, mimeType) => {
      const up = await clientFor(rec(key)).uploadStorageFile(new File([new Uint8Array(bytes)], bareName(name), { type: mimeType })).catch(noReach(key));
      return { path: up.path, mimeType: up.mimeType ?? mimeType };
    },
    // a file attached to a record (vaults.ts `file` checks it is one), with this device's sign-in
    file: (key, path) => clientFor(rec(key)).fetchAttachmentBlob(`/api/storage/${path.split("/").map(encodeURIComponent).join("/")}`).catch(noReach(key)),
    // what a screen shows: from the copy kept of the read at once, the hub asked behind it (vault/readCache.ts)
    // a record for what shows, from the copy kept of it (vault/readCache.ts): only for an applet that redraws when told
    ...(opts.read ? { read: (key: string, path: string) => {
      const r = rec(key);
      // the read as the client asks it (its address without a trailing slash, then /api…), so it is named as onFresh names it
      try { const u = new URL(`${vaultUrlOf(r).replace(/\/+$/, "")}/api${path}`); opts.read?.(key, `${u.pathname}${u.search}`); } catch { /* not a URL */ }
      return (keptClientFor(r) as unknown as VaultClient & Requesting).request(`/api${path}`, { cache: "no-store" }).catch(noReach(key));
    } } : {}),
    door(key) {
      let d = doors.get(key);
      if (!d) {
        // the answer kept from before, when there is one (a hub doesn't lose its door): no ask before the first read
        d = (keptClientFor(rec(key)) as unknown as VaultClient & Requesting).request("/api/records?limit=1").then(() => "records" as const, (e: unknown) => {
          // only "no such route" says there is no door; anything else is asked again next time
          if ((e as { status?: number })?.status === 404 || (e as { name?: string })?.name === "VaultNotFoundError") return "notes" as const;
          doors.delete(key);
          return noReach(key)(e);
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
    async reach(key) {
      const v = rec(key);
      // a hub without the list: nothing to manage here (Sharing keeps the hub's own line)
      if (!(await hubLists(v))) return false;
      if (!manageHeld(v, applet)) return null;
      try {
        return (await listReach(v, applet)).filter((r) => r.state === "in_force").map((r) => reachRow(r, v.clientId ?? null));
      } catch (e) {
        if (e instanceof ManageEndedError) return null;
        throw e;
      }
    },
    async manage(key) {
      // never ask the hub for a vault's admin where nothing could be read with it
      if (!(await hubLists(rec(key)))) throw new Error("This vault's hub has no list of who reaches it.");
      // back to this vault's Sharing (Vault reads `show`), where the person asked
      const back = new URL(opts.back(), window.location.origin);
      back.searchParams.set("vault", key);
      // to Sharing, not to a record Vault was opened on
      back.searchParams.delete("record");
      back.searchParams.set("show", "sharing");
      window.location.assign(await askManage(rec(key), `${back.pathname}${back.search}`, applet));
    },
    async giveKey(key, k) {
      const v = rec(key);
      const made = await makeKey(v, applet, k);
      return { name: made.name, token: made.token, until: made.expires_at, types: made.types ?? null, address: connectorAddress(v) };
    },
    async endReach(key, id) {
      await endReach(rec(key), applet, id);
    },
    stopManaging(key) {
      const v = findVault(key);
      if (v && manageHeld(v, applet)) endManage(v);
    },
    ...(opts.reveal ? { reveal: opts.reveal } : {}),
    async readOnly(key) {
      const v = rec(key);
      forgetOwnWrite(v);
      await giveBack(v.key, opts.back());
    },
    // sharing with people (docs/design/SHARING.md; vault/sharing.ts)
    names: (key, bys) => vaultNames(key, bys),
    knownNames: (key, bys) => knownNames(key, bys),
    people: (key) => vaultPeople(rec(key)),
    invite: (key, name, from) => inviteTo(rec(key), name, from),
    takeBack: (key, id) => takeBackInvite(rec(key), id),
    end: (key, pubkey) => endAccess(rec(key), pubkey),
    confirm: opts.confirm,
    emit: opts.emit,
  };
}
