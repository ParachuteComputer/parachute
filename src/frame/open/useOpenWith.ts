// What open-with knows about one note: the note, its vault's applets (each with its status on this device, judged by
// the shell, which waits until the self-test's facts are known), the vault's role tags, the person's choices, and so its
// candidates and the decision.
//
// `fresh`: true (the default, the Open with… sheet) reads the note and the applets as the hub has them now; false, the
// applets as read before. "copy-first" (the note's route): decided first from what this device read before (the
// copies, vault/readCache.ts), at once. That is enough when the decision only shows the note (in Vault, or plain), with no line: nothing runs, and an
// old copy can only show it. Anything else (an applet opens it, a choice to ask, a line to show) waits for the note and
// the applets as the hub has them now, as every decision did before. A note shown from its copy is drawn again when the
// hub's answer differs.
import { useEffect, useMemo, useRef, useState } from "react";
import type { Note } from "@openparachute/surface-client";
import type { FrameApplets, FrameVault } from "../../bridge/protocol";
import { call, on } from "../bridge";
import { readApplets, useDefaults, useShownAgain } from "../data";
import { candidates, resolve, type Candidate, type Decision } from "../../open/resolve";

export type OpenWith = { state: "loading" } | { state: "error"; error: string } | { state: "ok"; note: Note | null; cands: Candidate[]; decision: Decision };

/** `at`: what it was read for (the vault, the note and how: forOf), so a read is never used for anything else, a
 *  long-press on the same note among them; `copy`: read from the copies (copy-first), not yet as the hub has them now. */
type Read = { at: string; note: Note | null; roles: string[] | null; applets: FrameApplets; copy?: boolean };
const forOf = (vault: string, noteId: string, fresh: boolean | "copy-first") => `${vault}\u0000${noteId}\u0000${String(fresh)}`;
/** A decision that only shows the note: in Vault or plain, with no line. */
const showsOnly = (d: Decision) => d.kind === "vault" && !d.line;
const decide = (r: Read, defaults: Record<string, string>): { cands: Candidate[]; decision: Decision } => {
  if (!r.note) return { cands: [], decision: { kind: "vault", line: null } };
  const entries = r.applets.ok ? r.applets.entries : [];
  const cands = r.roles ? candidates(r.note, entries, (e) => e.status, r.roles) : [];
  return { cands, decision: resolve(cands, defaults) };
};

export function useOpenWith(v: FrameVault | null, noteId: string | undefined, fresh: boolean | "copy-first" = true): OpenWith {
  const [read, setRead] = useState<Read | { at: string; error: string } | null>(null);
  const at = v && noteId ? forOf(v.key, noteId, fresh) : "";
  const defaults = useDefaults(v?.key);
  // asks for the hub's answer, once per note: when a decision drawn from the copies no longer only shows the note
  const askHub = useRef<() => void>(() => {});
  // shown again after a shell screen (the editor, Settings): the note and the applets are read again, as the hub has
  // them now, and what was drawn stays until the answer
  const again = useShownAgain();
  const readFor = useRef("");

  useEffect(() => {
    if (!v || !noteId) return;
    let live = true, asked = false;
    const at = forOf(v.key, noteId, fresh);
    const quiet = readFor.current === at;
    readFor.current = at;
    if (!quiet) setRead(null);
    // the applets as they are now: the status is judged on each applet's note as read now. If that read fails, no
    // applet opens the note this time; roles unread (the vault answered badly) the same; the note itself still opens
    const now = () => {
      if (asked) return;
      asked = true;
      void Promise.all([call("vault.note", { vault: v.key, id: noteId }), call("vault.roles", { vault: v.key }).catch(() => null), readApplets(v.key, fresh !== false)])
        .then(([note, roles, applets]) => live && setRead({ at, note, roles, applets }),
          // read again on show and failed (offline a moment): what was drawn stays
          (e: unknown) => live && setRead((r) => (quiet && r && "note" in r && r.at === at ? r : { at, error: e instanceof Error ? e.message : "the vault couldn't be read" })));
    };
    askHub.current = now;
    if (fresh !== "copy-first" || quiet) { now(); return () => { live = false; }; }
    // the hub's answer for the note drawn from its copy differs: drawn again from it (told before the copy was drawn:
    // once it is)
    let drawn = false, told = false;
    const again = () => call("vault.note", { vault: v.key, id: noteId, kept: true })
      .then((note) => { if (live) setRead((r) => (r && "note" in r && r.at === at && r.copy ? { ...r, note } : r)); }, () => {});
    void Promise.all([call("vault.note", { vault: v.key, id: noteId, kept: true }), call("vault.roles", { vault: v.key }).catch(() => null), readApplets(v.key, false), call("defaults.get", { vault: v.key })])
      .then(([note, roles, applets, chosen]) => {
        // (the hub's answer, asked meanwhile, wins)
        if (!live || asked) return;
        const r: Read = { at, note, roles, applets, copy: true };
        if (!note || !roles || !applets.ok || !showsOnly(decide(r, chosen).decision)) { now(); return; }
        setRead(r);
        drawn = true;
        if (told) void again();
      }, () => { if (live) now(); });
    const off = on("changed", (d) => {
      if (d.what !== "note" || d.vault !== v.key || d.id !== noteId) return;
      if (drawn) void again(); else told = true;
    });
    return () => { live = false; off(); };
  }, [v?.key, noteId, fresh, again]); // eslint-disable-line react-hooks/exhaustive-deps

  const out = useMemo((): OpenWith => {
    if (!v || !read || read.at !== at || !defaults) return { state: "loading" };
    if ("error" in read) return { state: "error", error: read.error };
    const d = decide(read, defaults);
    // drawn from the copies, it may only show the note: a note read again, or a choice changed, that now leads anywhere
    // else waits for the note and the applets as the hub has them now
    if (read.copy && !showsOnly(d.decision)) return { state: "loading" };
    return { state: "ok", note: read.note, ...d };
  }, [v, read, at, defaults]);
  const waits = out.state === "loading" && !!read && read.at === at && "note" in read && read.copy === true;
  useEffect(() => { if (waits) askHub.current(); }, [waits]);
  return out;
}
