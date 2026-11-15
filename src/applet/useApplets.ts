// The applets in one vault, as the app lists them (discovery.ts), read from the vault's notes tagged `applet` and kept
// for this session. Read again when a screen asks (`refresh`), so a newly published applet shows up.
import { useEffect, useSyncExternalStore } from "react";
import type { VaultClient } from "@openparachute/surface-client";
import { discoverApplets, type Discovery } from "./discovery";
import { clientFor } from "../vault/client";
import type { VaultRecord } from "../vault/store";

type Entry = { state: "loading" } | { state: "ok"; found: Discovery } | { state: "error"; error: string };
const cache = new Map<string, Entry>();
const LOADING: Entry = { state: "loading" };
const inflight = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((f) => f());

export async function readApplets(client: Pick<VaultClient, "queryNotes">, vault: string): Promise<Discovery> {
  const rows = await client.queryNotes({ tag: "applet", limit: 200, includeMetadata: true });
  return discoverApplets(rows, vault);
}

export function refreshApplets(rec: VaultRecord): Promise<void> {
  const running = inflight.get(rec.key);
  if (running) return running;
  if (!cache.has(rec.key)) cache.set(rec.key, { state: "loading" });
  const p = readApplets(clientFor(rec), rec.key)
    .then((found) => { cache.set(rec.key, { state: "ok", found }); }, (e: unknown) => { if (cache.get(rec.key)?.state !== "ok") cache.set(rec.key, { state: "error", error: String(e) }); })
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
