// The applets Parachute Simplified offers on its bar (docs/SIMPLE.md): Capture, its own, and Journal, the same applet
// Aaron's Uni app runs. Their records ship with the app (applets/<name>.json, .tsx), and one tap of the person's puts
// one into their home vault, as any applet is: a note tagged applet in Applets/. From there it is an ordinary applet:
// its card asks before it runs, a change to its code asks again, an AI can read it.
import captureRecord from "../../applets/capture.json";
import captureBody from "../../applets/capture.tsx?raw";
import journalRecord from "../../applets/journal.json";
import journalBody from "../../applets/journal.tsx?raw";
import { VaultConflictError } from "@openparachute/surface-client";
import { clientFor } from "../vault/client";
import type { VaultRecord } from "../vault/store";
import { appletsNow, refreshApplets } from "./useApplets";
import { stripExt } from "./contract";

export type ShippedName = "capture" | "journal";
type Shipped = { id: string; name: string; path: string; record: { path: string; extension: string; tags: string[]; fields: unknown }; body: string };
export const SHIPPED: Record<ShippedName, Shipped> = {
  capture: { id: "capture", name: "Capture", path: captureRecord.path, record: captureRecord, body: captureBody },
  journal: { id: "journal", name: "Journal", path: journalRecord.path, record: journalRecord, body: journalBody },
};

/** The shipped applet in this vault, as this device last read its applets: its note's id, or null. */
export function shippedIn(rec: VaultRecord | null, which: ShippedName): string | null {
  if (!rec) return null;
  const a = appletsNow(rec.key);
  if (a?.state !== "ok") return null;
  const s = SHIPPED[which];
  // the one at its path first: another applet that calls itself the same doesn't take its place
  return (a.found.entries.find((e) => stripExt(e.path) === s.path) ?? a.found.entries.find((e) => e.manifest.id === s.id))?.noteId ?? null;
}

/** Put a shipped applet into the home vault (a tap's): its note's id. One already there (by id, or at its path) is used. */
export async function addShipped(home: VaultRecord, which: ShippedName): Promise<string> {
  const s = SHIPPED[which];
  await refreshApplets(home);
  const had = shippedIn(home, which);
  if (had) return had;
  let taken = false;
  try {
    await clientFor(home).createNote({ path: s.record.path, content: s.body, tags: s.record.tags, metadata: s.record.fields, extension: s.record.extension } as Parameters<ReturnType<typeof clientFor>["createNote"]>[0]);
  } catch (e) { if (!(e instanceof VaultConflictError)) throw e; taken = true; }
  await refreshApplets(home);
  const now = shippedIn(home, which);
  if (!now) throw new Error(taken ? `A note at ${s.path} that isn't ${s.name} is in ${home.vault} already: rename it, then add ${s.name} again.` : `${s.name} was written, but this vault doesn't list it as an applet.`);
  return now;
}
