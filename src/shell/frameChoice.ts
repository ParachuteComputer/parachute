// Which frame runs, decided from what is known (frameSource.ts gathers it). Pure.

/** The record as last read from a vault (`vault`: which one; a read of another vault than home is not used). */
export type Read = { vault: string } & (
  | { state: "none" }
  | { state: "found"; noteId: string; path: string; kind: "tsx" | "jsx"; source: string; hash: string; basedOn: string | null; updatedAt: string | null }
  | { state: "many"; paths: string[] }
  | { state: "bad"; error: string }
  | { state: "unreachable" });
export type Mode = "sealed" | "approved-code";
/** The copy last allowed, kept to run offline: its code too, so a newer transpiler can make it again. */
export type Approved = { vault: string; noteId: string; hash: string; js: string; t: string; source: string; kind: "tsx" | "jsx"; mode: Mode };
/** What this device keeps about the person's frame. `starting`: the hash of a frame from a vault shown in the foreground
 *  now; found at the next start, it becomes `suspect` (the app stopped while it showed), and its card asks again. */
export type Kept = { approved?: Approved; declined?: { vault: string; noteId: string; hash: string }; keptMine?: string; failed?: { hash: string; why: string }; starting?: string; suspect?: string };
export type Card = { vault: string; noteId: string; path: string; hash: string; changed: "code" | "mode" | "stopped" | null };
export type Choice =
  | { run: "built-in"; why: "no-home" | "gate" | "no-record" | "many" | "bad" | "declined" | "unreachable" | "failed" | "waiting" }
  | { run: "vault"; vault: string; noteId: string; hash: string; approved: Approved }
  | { run: "built-in"; why: "ask"; card: Card };

/** Decide, from what is known. `mode`: the gate now ("closed" also while the self-test runs). */
export function choose(o: { mode: Mode | "closed"; home: string | null; read: Read | null; kept: Kept }): Choice {
  if (!o.home) return { run: "built-in", why: "no-home" };
  if (o.mode === "closed") return { run: "built-in", why: "gate" };
  const a = o.kept.approved?.vault === o.home ? o.kept.approved : undefined;
  // allowed under a sealed pass, and this device now runs approved code only (it could reach the internet): ask again
  const modeOk = (x: Approved) => o.mode !== "approved-code" || x.mode === "approved-code";
  // a frame that stopped, or hung the app last time, gives way to the built-in one until its code changes
  const runs = (x: Approved): Choice => (o.kept.failed?.hash === x.hash ? { run: "built-in", why: "failed" } : { run: "vault", vault: o.home!, noteId: x.noteId, hash: x.hash, approved: x });
  const read = o.read && o.read.vault === o.home ? o.read : null;
  // the app stopped while this code showed: ask before it runs again (online and offline)
  if (a && o.kept.suspect === a.hash && o.kept.failed?.hash !== a.hash) {
    if (!read) return { run: "built-in", why: "waiting" };
    if (read.state === "unreachable") return { run: "built-in", why: "failed" };
    if (read.state === "found" && read.noteId === a.noteId && read.hash === a.hash) return { run: "built-in", why: "ask", card: { vault: o.home, noteId: read.noteId, path: read.path, hash: read.hash, changed: "stopped" } };
  }
  // not read yet, or the vault can't be reached: the last allowed copy, if there is one
  if (!read || read.state === "unreachable") return a && modeOk(a) ? runs(a) : { run: "built-in", why: read ? "unreachable" : "waiting" };
  if (read.state === "none") return { run: "built-in", why: "no-record" };
  if (read.state === "many") return { run: "built-in", why: "many" };
  if (read.state === "bad") return { run: "built-in", why: "bad" };
  if (a && a.noteId === read.noteId && a.hash === read.hash && modeOk(a)) return runs(a);
  const d = o.kept.declined;
  if (d && d.vault === o.home && d.noteId === read.noteId && d.hash === read.hash) return { run: "built-in", why: "declined" };
  const same = !!a && a.noteId === read.noteId;
  return { run: "built-in", why: "ask", card: { vault: o.home, noteId: read.noteId, path: read.path, hash: read.hash, changed: !same ? null : a!.hash !== read.hash ? "code" : "mode" } };
}
