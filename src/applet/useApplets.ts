// The applets in one vault, as the app lists them (discovery.ts), read from the vault's notes tagged `applet` and kept
// for this session. Read again when a screen asks (`refresh`), so a newly published applet shows up.
import { useEffect, useSyncExternalStore } from "react";
import type { VaultClient } from "@openparachute/surface-client";
import { discoverApplets, type AppletEntry, type Discovery } from "./discovery";
import { grantKey, grantOf } from "./grant";
import { sha256Hex } from "./needs";
import { codeKindOf } from "./code";
import { withoutRoles } from "./opens";
import { readRoleTags } from "../open/roles";
import { clientFor } from "../vault/client";
import type { VaultRecord } from "../vault/store";

type Entry = { state: "loading" } | { state: "ok"; found: Read; at: number } | { state: "error"; error: string };
const cache = new Map<string, Entry>();
const LOADING: Entry = { state: "loading" };
const inflight = new Map<string, Promise<boolean>>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((f) => f());

/** An applet as read now, with the two keys its status is judged on: the grant's and its code's. */
export type Keyed = AppletEntry & { keys: { scope: string; html: string } };
export type Read = { entries: Keyed[]; skipped: number };

export async function readApplets(client: Pick<VaultClient, "queryNotes" | "getNote">, vault: string): Promise<Read> {
  const [rows, roles] = await Promise.all([client.queryNotes({ tag: "applet", limit: 200, includeMetadata: true, includeContent: true }), readRoleTags(client)]);
  const found: Discovery = discoverApplets(rows.filter((r) => codeKindOf(r as { extension?: string }) !== null), vault);
  const html = new Map(rows.map((r) => [r.id, r.content ?? ""]));
  // as the applet screen reads them: the vault's role tags dropped first, so the keys match its keys
  const entries = await Promise.all(found.entries.map((e) => ({ ...e, opens: withoutRoles(e.opens, roles) })).map(async (e) => ({ ...e, keys: { scope: await grantKey(grantOf(e.manifest, vault, e.opens), e.path), html: await sha256Hex(html.get(e.noteId) ?? "") } })));
  return { entries, skipped: rows.length - found.entries.length };
}

/** Read a vault's applets again. Resolves to whether this read succeeded (a failure keeps the last list for the strip). */
export function refreshApplets(rec: VaultRecord): Promise<boolean> {
  const running = inflight.get(rec.key);
  if (running) return running;
  if (!cache.has(rec.key)) cache.set(rec.key, { state: "loading" });
  const p = readApplets(clientFor(rec), rec.key)
    .then((found) => { cache.set(rec.key, { state: "ok", found, at: Date.now() }); return true; }, (e: unknown) => { if (cache.get(rec.key)?.state !== "ok") cache.set(rec.key, { state: "error", error: String(e) }); return false; })
    .finally(() => { inflight.delete(rec.key); notify(); });
  inflight.set(rec.key, p);
  return p;
}

export function useApplets(rec: VaultRecord | null, refreshOnMount = true): Entry {
  const entry = useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => (rec ? cache.get(rec.key) : undefined) ?? LOADING);
  useEffect(() => { if (rec && (refreshOnMount || !cache.has(rec.key))) void refreshApplets(rec); }, [rec?.key]); // eslint-disable-line react-hooks/exhaustive-deps
  return entry;
}

/** Forget what was read (sign-out). */
export const forgetApplets = (key: string) => { cache.delete(key); notify(); };
