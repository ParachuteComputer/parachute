// Which frame runs, decided from what is known (frameSource.ts gathers it). Pure.

/** The record as last read from the home vault. */
export type Read =
  | { state: "none" }
  | { state: "found"; noteId: string; path: string; kind: "tsx" | "jsx"; source: string; hash: string; basedOn: string | null; updatedAt: string | null }
  | { state: "many"; paths: string[] }
  | { state: "bad"; error: string }
  | { state: "unreachable" };
/** What this device keeps: the copy last allowed (to run offline), and code the person said no to. */
export type Kept = { approved?: { vault: string; noteId: string; hash: string; js: string }; declined?: { vault: string; noteId: string; hash: string }; keptMine?: string; failed?: { hash: string; why: string } };
export type Choice =
  | { run: "built-in"; why: "no-home" | "gate" | "no-record" | "many" | "bad" | "declined" | "unreachable" | "failed" | "waiting" }
  | { run: "vault"; vault: string; noteId: string; hash: string; js: string | null }
  | { run: "built-in"; why: "ask"; card: { vault: string; noteId: string; path: string; hash: string; changed: boolean } };

/** Decide, from what is known. */
export function choose(o: { gateOpen: boolean; home: string | null; read: Read | null; kept: Kept; failed: string | null }): Choice {
  if (!o.home) return { run: "built-in", why: "no-home" };
  if (!o.gateOpen) return { run: "built-in", why: "gate" };
  const a = o.kept.approved?.vault === o.home ? o.kept.approved : undefined;
  // a frame that stopped gives way to the built-in one, until its code changes
  const runs = (hash: string, js: string | null, noteId: string): Choice => (o.failed === hash ? { run: "built-in", why: "failed" } : { run: "vault", vault: o.home!, noteId, hash, js });
  // not read yet, or the vault can't be reached: the last allowed copy, if there is one
  if (!o.read || o.read.state === "unreachable") return a ? runs(a.hash, a.js, a.noteId) : { run: "built-in", why: o.read ? "unreachable" : "waiting" };
  if (o.read.state === "none") return { run: "built-in", why: "no-record" };
  if (o.read.state === "many") return { run: "built-in", why: "many" };
  if (o.read.state === "bad") return { run: "built-in", why: "bad" };
  const r = o.read;
  if (a && a.noteId === r.noteId && a.hash === r.hash) return runs(r.hash, a.js, r.noteId);
  const d = o.kept.declined;
  if (d && d.vault === o.home && d.noteId === r.noteId && d.hash === r.hash) return { run: "built-in", why: "declined" };
  return { run: "built-in", why: "ask", card: { vault: o.home, noteId: r.noteId, path: r.path, hash: r.hash, changed: !!a && a.noteId === r.noteId } };
}

