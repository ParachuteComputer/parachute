import { useEffect, useState, useSyncExternalStore } from "react";
import { VaultServerError, VaultUnreachableError, type Note } from "@openparachute/surface-client";
import { listVaults, subscribeVaults, type VaultRecord } from "./store";
import { clientFor } from "./client";
import { failureNow, failureOf } from "./failure";

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

const REFUSED = "The vault no longer accepts this app's sign-in. Sign out in Settings and add it again.";
/** The vault client's "reached no hub", or a fetch's own words for it in each engine; not a bug's TypeError. */
const reachedNoOne = (e: unknown) => (e instanceof VaultUnreachableError && !(e instanceof VaultServerError))
  || (e instanceof TypeError && /^(Failed to fetch|Load failed|NetworkError when attempting to fetch resource\.?|Network request failed)$/.test(e.message));
/** An error from the vault, in the person's words. `vault`: the vault it came from (this device's key), when known. */
export function messageOf(e: unknown, vault?: string): string {
  const status = (e as { status?: number } | null)?.status;
  if (status === 401) return REFUSED;
  if (status === 403) return "This sign-in may not read that.";
  if (status === 404) return "There's no such note.";
  // a request that reached no hub (off the network, off the tailnet): plain words, never "GET … failed: Failed to fetch";
  // one this vault's sign-in was refused for looks the same (vault/failure.ts), and says so. Any other error as it is
  const f = vault ? failureNow({ key: vault }, e) : failureOf(e);
  // (refused only for what looks like the network: a bug's own error keeps its words)
  if (f === "refused" && reachedNoOne(e)) return REFUSED;
  if (f === "offline" && reachedNoOne(e)) return "Can't reach the vault just now.";
  return e instanceof Error && e.message ? e.message : "Something went wrong reaching the vault.";
}

export type { Note };
