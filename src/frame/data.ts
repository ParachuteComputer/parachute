// What the frame knows, all of it asked of the shell: the vaults this device holds (no tokens), reads of a vault, the
// applets with their status, and the person's "Always" choices. Each is kept for the session and read again when the
// shell says it changed.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Note } from "@openparachute/surface-client";
import type { FrameApplets, FrameComponents, FrameHome, FramePointer, FrameVault, Query } from "../bridge/protocol";
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

// Kept running hidden behind the shell's screens (shell/FrameArea.tsx), the frame is told when it is shown again: what
// it drew stays, and everything it read is read again behind it (as a new frame would have read it), quietly.
let round = 0;
const roundSubs = new Set<() => void>();
/** A number that grows each time the frame is shown again after a shell screen: a read that depends on it (an effect's
 *  dependency) is made again then, as a new frame would have made it. Keep what it drew until the answer comes. */
export const useShownAgain = (): number => useSyncExternalStore((f) => { roundSubs.add(f); return () => { roundSubs.delete(f); }; }, () => round);
const useRound = useShownAgain;
on("shown", (shown) => {
  if (!shown) return;
  round++;
  void vaults.load();
  for (const k of applets.keys()) void readApplets(k, true);
  for (const k of defaults.keys()) void readDefaults(k);
  for (const k of components.keys()) void readComponents(k);
  void home.load(); void pointers.load();
  roundSubs.forEach((f) => f());
});

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

/** Run `fn` against a vault whenever `deps` change, and again, quietly (what it showed stays until the answer), when the
 *  frame is shown again; the last answer wins. */
export function useVaultQuery<T>(v: FrameVault | null, fn: (r: Reader) => Promise<T>, deps: unknown[]): Load<T> {
  const [load, setLoad] = useState<Load<T>>({ state: "loading" });
  const again = useRound();
  const asked = useRef("");
  useEffect(() => {
    if (!v) return;
    let live = true;
    // the same question asked again (shown again): what it shows stays until the answer
    const q = JSON.stringify([v.key, ...deps]);
    const quiet = asked.current === q;
    asked.current = q;
    if (!quiet) setLoad({ state: "loading" });
    fn(readerFor(v)).then((data) => live && setLoad({ state: "ok", data }), (e: unknown) => live && setLoad((was) => quiet && was.state === "ok" ? was : { state: "error", error: e instanceof Error && e.message ? e.message : "Something went wrong reaching the vault." }));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v?.key, again, ...deps]);
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
  // a failed read keeps the choices read before (it is asked again each time the frame shows)
  defaults.set(vault, await call("defaults.get", { vault }).catch(() => defaults.get(vault) ?? {}));
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

// ── the bar and the home ──

const home = store<FrameHome>(() => call("home.get", {}), { start: null, bar: [] });
// Vault's place (FrameHome.viewer) follows the home vault's applets
on("changed", ({ what }) => { if (what === "home" || what === "applets") void home.load(); });
/** What is on the bar (the home applet, the pins) as the shell finds them on this device. */
export const useHome = (): FrameHome => useSyncExternalStore(home.subscribe, home.get);
/** Whether the bar and the home have been read yet (before, Vault's place isn't known). */
export const useHomeLoaded = (): boolean => useSyncExternalStore(home.subscribe, home.loaded);
/** Pin or unpin an applet (during a tap only: the shell refuses otherwise). */
export const pinApplet = (vault: string, noteId: string, on: boolean) => call("home.pin", { vault, noteId, on }).then(() => home.load());
/** Make an applet the home, or none (during a tap only). */
export const startApplet = (vault: string, noteId: string | null) => call("home.start", { vault, noteId }).then(() => home.load());

// ── what the home vault brings in from other Parachutes (docs/design/EMBED.md) ──

const pointers = store<FramePointer[]>(() => call("pointers.list", {}), []);
on("changed", ({ what }) => { if (what === "pointers" || what === "vaults" || what === "applets") void pointers.load(); });
/** The home vault's pointers, as the shell finds them on this device. */
export const usePointers = (): FramePointer[] => useSyncExternalStore(pointers.subscribe, pointers.get);
/** Bring an applet of someone else's vault into the home vault (during a tap only). */
export const bringIn = (vault: string, noteId: string) => call("home.bringIn", { vault, noteId }).then(() => pointers.load());

// ── components, per vault ──

const components = new Map<string, FrameComponents>();
const componentSubs = new Set<() => void>();
async function readComponents(vault: string) {
  const got = await call("components.list", { vault }).catch((e: unknown): FrameComponents => ({ ok: false, error: String(e) }));
  // a failed read keeps a good list read before
  if (got.ok || !components.get(vault)?.ok) components.set(vault, got);
  componentSubs.forEach((f) => f());
}
on("changed", ({ what }) => { if (what === "applets") for (const k of components.keys()) void readComponents(k); });
/** A vault's components, as the shell reads them. */
export function useComponents(vault: string | undefined): FrameComponents | null {
  const got = useSyncExternalStore((f) => { componentSubs.add(f); return () => { componentSubs.delete(f); }; }, () => (vault ? components.get(vault) ?? null : null));
  useEffect(() => { if (vault) void readComponents(vault); }, [vault]);
  return got;
}
/** Put a component on the home applet's page (during a tap only). */
/** Add a vault its Parachute offers (the shell opens the hub's consent), or stop offering it. */
export const addVault = (hub: string, vault: string) => call("home.addVault", { hub, vault });
export const dismissVault = (hub: string, vault: string) => call("home.dismissVault", { hub, vault }).then(() => home.load());
export const addEmbed = (vault: string, noteId: string) => call("home.addEmbed", { vault, noteId }).then((r) => { void pointers.load(); return r; });
