// What open-with knows about one note: the note, its vault's applets as read now, the vault's role tags, and so its
// candidates and the decision. Waits until the self-test's facts are known, so a note never opens plain only because
// the app had not finished starting. While the self-test itself runs (first launch, after an update) applets are off.
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { Note } from "@openparachute/surface-client";
import { clientFor } from "../vault/client";
import type { VaultRecord } from "../vault/store";
import { refreshApplets, useApplets } from "../applet/useApplets";
import { useGate, useSelfTestRun } from "../applet/selftest/run";
import { readRoleTags } from "./roles";
import { candidates, resolve, type Candidate, type Decision } from "./resolve";
import { statusOf } from "./status";
import { defaultsFor, subscribeDefaults } from "./defaults";

export type OpenWith = { state: "loading" } | { state: "error"; error: string } | { state: "ok"; note: Note | null; cands: Candidate[]; decision: Decision };

export function useOpenWith(rec: VaultRecord | null, noteId: string | undefined, fresh = true): OpenWith {
  const mode = useGate();
  const run = useSelfTestRun();
  const applets = useApplets(rec, false);
  const [note, setNote] = useState<{ id: string; note: Note | null; roles: string[] | null } | { id: string; error: string } | null>(null);
  // the note this visit's applet read was for, and whether that read succeeded
  const [read, setRead] = useState<{ id: string; ok: boolean } | null>(null);
  const defaultsRaw = useSyncExternalStore(subscribeDefaults, () => JSON.stringify(rec ? defaultsFor(rec.key) : {}), () => "{}");

  useEffect(() => {
    if (!rec || !noteId) return;
    let on = true;
    setNote(null); setRead(null);
    const c = clientFor(rec);
    // the applets as they are now: the status is judged on each applet's note as read now
    void (fresh ? refreshApplets(rec) : Promise.resolve(true)).then((ok) => on && setRead({ id: noteId, ok }));
    // roles unread (the vault answered badly): no applet opens this note this time; the note itself still opens
    Promise.all([c.getNote(noteId), readRoleTags(c).catch(() => null)])
      .then(([n, roles]) => on && setNote({ id: noteId, note: n, roles }), (e: unknown) => on && setNote({ id: noteId, error: e instanceof Error ? e.message : "the vault couldn't be read" }));
    return () => { on = false; };
  }, [rec?.key, noteId]); // eslint-disable-line react-hooks/exhaustive-deps

  return useMemo((): OpenWith => {
    if (!rec || !note || note.id !== noteId || read?.id !== noteId || !run.known) return { state: "loading" };
    if ("error" in note) return { state: "error", error: note.error };
    if (!note.note) return { state: "ok", note: null, cands: [], decision: { kind: "vault", line: null } };
    // statuses are judged on the applets as read now: if this visit's read failed, no applet opens the note this time
    const entries = applets.state === "ok" && read.ok ? applets.found.entries : [];
    const cands = note.roles ? candidates(note.note, entries, statusOf(rec.key, mode), note.roles) : [];
    return { state: "ok", note: note.note, cands, decision: resolve(cands, JSON.parse(defaultsRaw)) };
  }, [rec, note, noteId, read, run.known, run.running, applets, mode, defaultsRaw]);
}
