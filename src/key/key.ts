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

// What the screens show: `undefined` until read, then the key or null; `problem` when a key is stored but can't be read.
let known: KeyInfo | null | undefined;
/** `unavailable`: storage didn't answer (try again, the key may be fine); `unreadable`: what is kept isn't a key. */
export type KeyProblem = { code: "unavailable" | "unreadable"; message: string };
let problem: KeyProblem | null = null;
const listeners = new Set<() => void>();
const set = (k: KeyInfo | null, why: KeyProblem | null = null) => { known = k; problem = why; listeners.forEach((f) => f()); };
let reading: Promise<void> | null = null;

function read() {
  reading ??= invoke<KeyInfo | null>("key_status").then((k) => set(k), (e: unknown) => set(null, asProblem(e))).finally(() => { reading = null; });
  return reading;
}
const subscribe = (cb: () => void) => { listeners.add(cb); if (known === undefined && keysHere()) void read(); return () => { listeners.delete(cb); }; };

/** This device's key (its public half): `undefined` while it is read, `null` when there is none. */
export function useKey(): KeyInfo | null | undefined {
  return useSyncExternalStore(subscribe, () => (keysHere() ? known : null), () => undefined);
}
const asProblem = (e: unknown): KeyProblem => e && typeof e === "object" && ((e as KeyProblem).code === "unreadable" || (e as KeyProblem).code === "unavailable")
  ? e as KeyProblem : { code: "unavailable", message: typeof e === "string" ? e : "The key store didn't answer." };
/** Read the key again (after the key store didn't answer). */
export const readKeyAgain = () => read();

/** Why this device's key can't be shown, if it can't. */
export function useKeyProblem(): KeyProblem | null {
  return useSyncExternalStore(subscribe, () => problem, () => null);
}

/** A command that changes the key; when it fails, the screens read the key again (it may be there after all). */
async function changing<T extends KeyInfo | void>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    const k = await invoke<T>(cmd, args);
    set(k ? (k as KeyInfo) : null);
    return k;
  } catch (e) {
    await read();
    throw e;
  }
}
export const createKey = () => changing<KeyInfo>("key_create");
export const importKey = (secret: string) => changing<KeyInfo>("key_import", { secret });
export const forgetKey = () => changing<void>("key_forget");

export const pairStart = (link: string) => invoke<{ id: number; sas: string }>("pair_start", { link });
export const pairConfirm = (id: number) => changing<KeyInfo>("pair_confirm", { id });
export const pairCancel = (id: number, codesDiffer: boolean) => invoke<void>("pair_cancel", { id, codesDiffer }).catch(() => undefined);

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
