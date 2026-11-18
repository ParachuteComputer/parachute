// The simple app's Capture applet (docs/SIMPLE.md): its record ships with the app (applets/capture.json, .tsx), and
// one tap of the person's puts it into their home vault, as any applet is: a note tagged applet in Applets/. From
// there it is an ordinary applet: its card asks before it runs, a change to its code asks again, an AI can read it.
import record from "../../applets/capture.json";
import body from "../../applets/capture.tsx?raw";
import { VaultConflictError } from "@openparachute/surface-client";
import { clientFor } from "../vault/client";
import type { VaultRecord } from "../vault/store";
import { appletsNow, refreshApplets } from "./useApplets";
import { stripExt } from "./contract";

export const CAPTURE_ID = "capture";
export const CAPTURE_PATH = record.path;

/** The Capture applet in this vault, as this device last read its applets: its note's id, or null. */
export function captureIn(rec: VaultRecord | null): string | null {
  if (!rec) return null;
  const a = appletsNow(rec.key);
  if (a?.state !== "ok") return null;
  // the one at its path first: another applet that calls itself "capture" doesn't take its place
  return (a.found.entries.find((e) => stripExt(e.path) === CAPTURE_PATH) ?? a.found.entries.find((e) => e.manifest.id === CAPTURE_ID))?.noteId ?? null;
}

/** Put Capture into the home vault (a tap's): its note's id. One already there (by id, or at its path) is used. */
export async function addCapture(home: VaultRecord): Promise<string> {
  await refreshApplets(home);
  const had = captureIn(home);
  if (had) return had;
  try {
    await clientFor(home).createNote({ path: record.path, content: body, tags: record.tags, metadata: record.fields, extension: record.extension } as Parameters<ReturnType<typeof clientFor>["createNote"]>[0]);
  } catch (e) { if (!(e instanceof VaultConflictError)) throw e; }
  await refreshApplets(home);
  const now = captureIn(home);
  if (!now) throw new Error("Capture was written, but this vault doesn't list it as an applet.");
  return now;
}
