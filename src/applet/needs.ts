// What a frame may ask for, resolved to folders: the shape the router checks every call against. Pure.
import type { Capability } from "./contract.ts";

export type Need = { cap: Capability; scope: string };
/** Needs resolved to concrete scopes: folder prefixes per capability. */
export type Resolved = Partial<Record<Capability, string[]>>;

export function resolveNeeds(needs: readonly Need[]): Resolved {
  const out: Resolved = {};
  for (const n of needs) out[n.cap] = [...new Set([...(out[n.cap] ?? []), n.scope])];
  return out;
}

export async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** SHA-256 of an applet's HTML: what "allowed" and "changed since" are judged on. */
export const htmlHash = (html: string) => sha256Hex(html);
