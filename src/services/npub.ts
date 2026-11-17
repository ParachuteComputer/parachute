import { decode } from "nostr-tools/nip19";
/** An npub's hex, or null. */
export function npubDecode(npub: string): string | null {
  try { const d = decode(npub); return d.type === "npub" ? (d.data as string) : null; } catch { return null; }
}
