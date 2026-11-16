// The person's Nostr key, as the web side sees it: its public half and what can be asked of it. The key itself lives in
// the shell's native side (src-tauri/src/key.rs, pairing.rs, door.rs) and never comes here. Only the shell's own
// screens use this module; the frame and applets can't reach it (src/frame/boundary.test.ts, and they have no bridge).
import { useSyncExternalStore } from "react";
import { inShell } from "../vault/oauth";

export type KeyInfo = { npub: string };
/** Why a key sign-in didn't happen (src-tauri/src/door.rs `Refusal`). */
export type Refusal = { code: "no_key" | "no_door" | "unknown_key" | "refused" | "unreachable" | "bad_hub"; message: string };

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

/** Keys live in the app on a device (the shell), not in a browser tab. */
export const keysHere = () => inShell();

// What the screens show: `undefined` until read, then the key or null.
let known: KeyInfo | null | undefined;
const listeners = new Set<() => void>();
const set = (k: KeyInfo | null) => { known = k; listeners.forEach((f) => f()); };
let reading: Promise<void> | null = null;

function read() {
  reading ??= invoke<KeyInfo | null>("key_status").then((k) => set(k), () => set(null)).finally(() => { reading = null; });
}

/** This device's key (its public half): `undefined` while it is read, `null` when there is none. */
export function useKey(): KeyInfo | null | undefined {
  return useSyncExternalStore((cb) => { listeners.add(cb); if (known === undefined && keysHere()) read(); return () => { listeners.delete(cb); }; }, () => (keysHere() ? known : null), () => undefined);
}

export async function createKey(): Promise<KeyInfo> { const k = await invoke<KeyInfo>("key_create"); set(k); return k; }
export async function importKey(secret: string): Promise<KeyInfo> { const k = await invoke<KeyInfo>("key_import", { secret }); set(k); return k; }
export async function forgetKey(): Promise<void> { await invoke("key_forget"); set(null); }

export const pairStart = (link: string) => invoke<{ sas: string }>("pair_start", { link });
export async function pairConfirm(): Promise<KeyInfo> { const k = await invoke<KeyInfo>("pair_confirm"); set(k); return k; }
export const pairCancel = (codesDiffer: boolean) => invoke<void>("pair_cancel", { codesDiffer }).catch(() => undefined);

/** Sign in to `hub` with the key; resolves to the hub address to open next (`next`, or the hub's second step). */
export async function keySignIn(hub: string, next: string): Promise<string> {
  try {
    return (await invoke<{ go: string }>("key_sign_in", { hub, next })).go;
  } catch (e) {
    throw asRefusal(e);
  }
}

export function asRefusal(e: unknown): Refusal {
  if (e && typeof e === "object" && typeof (e as Refusal).code === "string" && typeof (e as Refusal).message === "string") return e as Refusal;
  return { code: "refused", message: typeof e === "string" ? e : e instanceof Error ? e.message : "The sign-in didn't finish." };
}

/** An npub shortened for a line of text; the whole one is a tap away. */
export const shortNpub = (npub: string) => (npub.length > 24 ? `${npub.slice(0, 12)}…${npub.slice(-6)}` : npub);
