// What open-with knows about one note: the note, its vault's applets as read now (each with its status on this device,
// judged by the shell, which waits until the self-test's facts are known), the vault's role tags, the person's
// choices, and so its candidates and the decision.
import { useEffect, useMemo, useState } from "react";
import type { Note } from "@openparachute/surface-client";
import type { FrameApplets, FrameVault } from "../../bridge/protocol";
import { call } from "../bridge";
import { readApplets, useDefaults } from "../data";
import { candidates, resolve, type Candidate, type Decision } from "../../open/resolve";

export type OpenWith = { state: "loading" } | { state: "error"; error: string } | { state: "ok"; note: Note | null; cands: Candidate[]; decision: Decision };

export function useOpenWith(v: FrameVault | null, noteId: string | undefined, fresh = true): OpenWith {
  const [read, setRead] = useState<{ id: string; note: Note | null; roles: string[] | null; applets: FrameApplets } | { id: string; error: string } | null>(null);
  const defaults = useDefaults(v?.key);

  useEffect(() => {
    if (!v || !noteId) return;
    let on = true;
    setRead(null);
    // the applets as they are now: the status is judged on each applet's note as read now. If that read fails, no
    // applet opens the note this time; roles unread (the vault answered badly) the same; the note itself still opens
    Promise.all([call("vault.note", { vault: v.key, id: noteId }), call("vault.roles", { vault: v.key }).catch(() => null), readApplets(v.key, fresh)])
      .then(([note, roles, applets]) => on && setRead({ id: noteId, note, roles, applets }), (e: unknown) => on && setRead({ id: noteId, error: e instanceof Error ? e.message : "the vault couldn't be read" }));
    return () => { on = false; };
  }, [v?.key, noteId]); // eslint-disable-line react-hooks/exhaustive-deps

  return useMemo((): OpenWith => {
    if (!v || !read || read.id !== noteId || !defaults) return { state: "loading" };
    if ("error" in read) return { state: "error", error: read.error };
    if (!read.note) return { state: "ok", note: null, cands: [], decision: { kind: "vault", line: null } };
    const entries = read.applets.ok ? read.applets.entries : [];
    const cands = read.roles ? candidates(read.note, entries, (e) => e.status, read.roles) : [];
    return { state: "ok", note: read.note, cands, decision: resolve(cands, defaults) };
  }, [v, read, noteId, defaults]);
}
