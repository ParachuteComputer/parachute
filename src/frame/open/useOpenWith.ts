// What open-with knows about one note: the note, its vault's applets (each with its status on this device, judged by
// the shell, which waits until the self-test's facts are known), the vault's role tags, the person's choices, and so its
// candidates and the decision.
//
// `copyFirst` (the note's route): decided first from what this device read before (the copies, vault/readCache.ts), at
// once. That is enough when the decision only shows the note (in Vault, or plain), with no line: nothing runs, and an
// old copy can only show it. Anything else (an applet opens it, a choice to ask, a line to show) waits for the note and
// the applets as the hub has them now, as every decision did before. A note shown from its copy is drawn again when the
// hub's answer differs. Without it (the Open with… sheet), always as the hub has them now.
import { useEffect, useMemo, useState } from "react";
import type { Note } from "@openparachute/surface-client";
import type { FrameApplets, FrameVault } from "../../bridge/protocol";
import { call, on } from "../bridge";
import { readApplets, useDefaults } from "../data";
import { candidates, resolve, type Candidate, type Decision } from "../../open/resolve";

export type OpenWith = { state: "loading" } | { state: "error"; error: string } | { state: "ok"; note: Note | null; cands: Candidate[]; decision: Decision };

type Read = { id: string; note: Note | null; roles: string[] | null; applets: FrameApplets };
const decide = (r: Read, defaults: Record<string, string>): { cands: Candidate[]; decision: Decision } => {
  if (!r.note) return { cands: [], decision: { kind: "vault", line: null } };
  const entries = r.applets.ok ? r.applets.entries : [];
  const cands = r.roles ? candidates(r.note, entries, (e) => e.status, r.roles) : [];
  return { cands, decision: resolve(cands, defaults) };
};

export function useOpenWith(v: FrameVault | null, noteId: string | undefined, copyFirst = false): OpenWith {
  const [read, setRead] = useState<Read | { id: string; error: string } | null>(null);
  const defaults = useDefaults(v?.key);

  useEffect(() => {
    if (!v || !noteId) return;
    let live = true;
    setRead(null);
    // the applets as they are now: the status is judged on each applet's note as read now. If that read fails, no
    // applet opens the note this time; roles unread (the vault answered badly) the same; the note itself still opens
    const now = () => Promise.all([call("vault.note", { vault: v.key, id: noteId }), call("vault.roles", { vault: v.key }).catch(() => null), readApplets(v.key, true)])
      .then(([note, roles, applets]) => live && setRead({ id: noteId, note, roles, applets }), (e: unknown) => live && setRead({ id: noteId, error: e instanceof Error ? e.message : "the vault couldn't be read" }));
    if (!copyFirst) { void now(); return () => { live = false; }; }
    void Promise.all([call("vault.note", { vault: v.key, id: noteId, kept: true }), call("vault.roles", { vault: v.key }).catch(() => null), readApplets(v.key, false), call("defaults.get", { vault: v.key })])
      .then(([note, roles, applets, chosen]) => {
        if (!live) return;
        const r: Read = { id: noteId, note, roles, applets };
        const { decision } = decide(r, chosen);
        if (note && roles && applets.ok && decision.kind === "vault" && !decision.line) setRead(r); else void now();
      }, () => { if (live) void now(); });
    // the hub's answer for the note shown from its copy differs: drawn again from it
    const off = on("changed", (d) => {
      if (d.what !== "note" || d.vault !== v.key || d.id !== noteId) return;
      void call("vault.note", { vault: v.key, id: noteId, kept: true }).then((note) => { if (live) setRead((r) => (r && "note" in r && r.id === noteId ? { ...r, note } : r)); }, () => {});
    });
    return () => { live = false; off(); };
  }, [v?.key, noteId]); // eslint-disable-line react-hooks/exhaustive-deps

  return useMemo((): OpenWith => {
    if (!v || !read || read.id !== noteId || !defaults) return { state: "loading" };
    if ("error" in read) return { state: "error", error: read.error };
    return { state: "ok", note: read.note, ...decide(read, defaults) };
  }, [v, read, noteId, defaults]);
}
