// What the frame knows, all of it asked of the shell: the vaults this device holds (no tokens), reads of a vault, the
// applets with their status, and the person's "Always" choices. Each is kept for the session and read again when the
// shell says it changed.
import { useEffect, useState, useSyncExternalStore } from "react";
import type { Note } from "@openparachute/surface-client";
import type { FrameApplets, FrameVault, Query } from "../bridge/protocol";
import { call, on } from "./bridge";

function store<T>(read: () => Promise<T>, initial: T) {
  let value = initial, loaded = false, inflight: Promise<void> | null = null;
  const subs = new Set<() => void>();
  const load = () => (inflight ??= read().then((v) => { value = v; loaded = true; }, () => { loaded = true; }).finally(() => { inflight = null; subs.forEach((f) => f()); }));
  return {
    load,
    get: () => value,
    loaded: () => loaded,
    subscribe(f: () => void) { subs.add(f); if (!loaded) void load(); return () => { subs.delete(f); }; },
  };
}

const vaults = store<FrameVault[]>(() => call("vaults.list", {}), []);
on("changed", ({ what }) => { if (what === "vaults") void vaults.load(); });

export const useVaults = (): FrameVault[] => useSyncExternalStore(vaults.subscribe, vaults.get);
/** Whether the list of vaults has been read yet (before, every vault looks missing). */
export const useVaultsLoaded = (): boolean => useSyncExternalStore(vaults.subscribe, vaults.loaded);
export function useVault(key: string | undefined): FrameVault | null {
  return useVaults().find((r) => r.key === key) ?? null;
}

/** A read-only reader of one vault, through the shell. */
export type Reader = { queryNotes(q: Query): Promise<Note[]>; getNote(id: string): Promise<Note | null> };
export const readerFor = (v: FrameVault): Reader => ({
  queryNotes: (query) => call("vault.query", { vault: v.key, query }),
  getNote: (id) => call("vault.note", { vault: v.key, id }),
});

export type Load<T> = { state: "loading" } | { state: "error"; error: string } | { state: "ok"; data: T };

/** Run `fn` against a vault whenever `deps` change; the last answer wins. */
export function useVaultQuery<T>(v: FrameVault | null, fn: (r: Reader) => Promise<T>, deps: unknown[]): Load<T> {
  const [load, setLoad] = useState<Load<T>>({ state: "loading" });
  useEffect(() => {
    if (!v) return;
    let live = true;
    setLoad({ state: "loading" });
    fn(readerFor(v)).then((data) => live && setLoad({ state: "ok", data }), (e: unknown) => live && setLoad({ state: "error", error: e instanceof Error && e.message ? e.message : "Something went wrong reaching the vault." }));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v?.key, ...deps]);
  return load;
}

// ── applets, per vault ──

const applets = new Map<string, FrameApplets>();
const appletSubs = new Set<() => void>();
const appletsNotify = () => appletSubs.forEach((f) => f());
/** Read a vault's applets (again, with `fresh`), through the shell. */
export async function readApplets(vault: string, fresh: boolean): Promise<FrameApplets> {
  const r = await call("applets.list", { vault, fresh }).catch((e: unknown): FrameApplets => ({ ok: false, error: String(e) }));
  if (r.ok || !applets.get(vault)?.ok) applets.set(vault, r);
  appletsNotify();
  return r;
}
on("changed", ({ what }) => { if (what === "applets") for (const k of applets.keys()) void readApplets(k, false); });
export function useApplets(vault: string | undefined, fresh = true): FrameApplets | null {
  const got = useSyncExternalStore((f) => { appletSubs.add(f); return () => { appletSubs.delete(f); }; }, () => (vault ? applets.get(vault) ?? null : null));
  useEffect(() => { if (vault && (fresh || !applets.has(vault))) void readApplets(vault, fresh); }, [vault]); // eslint-disable-line react-hooks/exhaustive-deps
  return got;
}

// ── "Always" choices, per vault ──

const defaults = new Map<string, Record<string, string>>();
const defaultSubs = new Set<() => void>();
async function readDefaults(vault: string) {
  defaults.set(vault, await call("defaults.get", { vault }).catch(() => ({})));
  defaultSubs.forEach((f) => f());
}
on("changed", ({ what }) => { if (what === "defaults") for (const k of defaults.keys()) void readDefaults(k); });
/** The vault's choices, or null until they are read. */
export function useDefaults(vault: string | undefined): Record<string, string> | null {
  const got = useSyncExternalStore((f) => { defaultSubs.add(f); return () => { defaultSubs.delete(f); }; }, () => (vault ? defaults.get(vault) ?? null : null));
  useEffect(() => { if (vault && !defaults.has(vault)) void readDefaults(vault); }, [vault]);
  return got;
}
export async function setDefault(vault: string, type: string, choice: string | null) {
  await call("defaults.set", { vault, type, choice });
  await readDefaults(vault);
}
