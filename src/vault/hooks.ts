import { useEffect, useState, useSyncExternalStore } from "react";
import type { Note } from "@openparachute/surface-client";
import { listVaults, subscribeVaults, type VaultRecord } from "./store";
import { clientFor } from "./client";

export const useVaults = (): VaultRecord[] => useSyncExternalStore(subscribeVaults, () => listVaults(), () => []);
export function useVault(key: string | undefined): VaultRecord | null {
  const list = useVaults();
  return list.find((r) => r.key === key) ?? null;
}

export type Load<T> = { state: "loading" } | { state: "error"; error: string } | { state: "ok"; data: T };

/** Run `fn` against a vault whenever `deps` change; the last answer wins. */
export function useVaultQuery<T>(rec: VaultRecord | null, fn: (c: ReturnType<typeof clientFor>) => Promise<T>, deps: unknown[]): Load<T> {
  const [load, setLoad] = useState<Load<T>>({ state: "loading" });
  useEffect(() => {
    if (!rec) return;
    let live = true;
    setLoad({ state: "loading" });
    fn(clientFor(rec)).then((data) => live && setLoad({ state: "ok", data }), (e: unknown) => live && setLoad({ state: "error", error: messageOf(e) }));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec?.key, rec?.issuer, ...deps]);
  return load;
}

export function messageOf(e: unknown): string {
  const status = (e as { status?: number } | null)?.status;
  if (status === 401) return "The vault no longer accepts this app's sign-in. Sign in again from Settings.";
  if (status === 403) return "This sign-in may not read that.";
  if (status === 404) return "There's no such note.";
  return e instanceof Error && e.message ? e.message : "Something went wrong reaching the vault.";
}

export type { Note };
