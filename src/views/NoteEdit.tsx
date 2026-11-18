// The app's own editor (docs/SIMPLE.md): a new note in a vault, or a note's words changed. A shell screen, so the frame
// (which a person's vault can replace) never writes: it only sends the person here. Only the person's own words: never
// an app's own note (settings, frame, theme, pointers) or code, which the note view offers no Edit for either.
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { VaultConflictError, type Note } from "@openparachute/surface-client";
import { Bar } from "../ui/Bar";
import { useVault, useVaults } from "../vault/hooks";
import { clientFor } from "../vault/client";
import { isAppOwn, isCodeNote, noteHref } from "../vault/notes";

const pad = (n: number) => String(n).padStart(2, "0");
/** A new note's path, from its first line: plain words, no folder (where Parachute Cloud keeps a person's notes). */
export function pathFromText(text: string, at = new Date()): string {
  const first = (text.split("\n").find((l) => l.trim()) ?? "").replace(/^#+\s*/, "");
  const words = first.replace(/[\u0000-\u001f\\/:*?"<>|#[\]^]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80).trim().replace(/^\.+/, "");
  return words || `Note ${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}-${pad(at.getMinutes())}`;
}
const updatedOf = (n: Note | null) => (n as { updatedAt?: string } | null)?.updatedAt ?? null;

export default function NoteEdit() {
  const { vault: key, id } = useParams();
  const rec = useVault(key);
  const vaults = useVaults();
  const nav = useNavigate();
  const isNew = id === undefined;
  const [note, setNote] = useState<Note | null>(null);
  const [text, setText] = useState("");
  const [into, setInto] = useState(key ?? "");
  const [state, setState] = useState<"loading" | "ready" | "saving" | "error">(isNew ? "ready" : "loading");
  const [error, setError] = useState("");
  // the note changed elsewhere (an AI, another device) since it was opened: the person's text stays, and they choose
  const [theirs, setTheirs] = useState<Note | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isNew || !rec || !id) return;
    let live = true;
    clientFor(rec).getNote(id).then((n) => {
      if (!live) return;
      if (!n) { setState("error"); setError("There's no such note."); return; }
      if (isCodeNote(n) || isAppOwn(n)) { setState("error"); setError("This note is the app's own, or code: it isn't changed here."); return; }
      setNote(n); setText(n.content ?? ""); setState("ready");
    }, (e: unknown) => { if (live) { setState("error"); setError(e instanceof Error ? e.message : "The note couldn't be read."); } });
    return () => { live = false; };
  }, [rec?.key, id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (state === "ready") box.current?.focus(); }, [state]);

  const target = vaults.find((v) => v.key === into) ?? rec;
  async function save(force = false) {
    if (!target || state === "saving") return;
    setState("saving"); setError("");
    const c = clientFor(target);
    try {
      if (isNew) {
        const base = pathFromText(text);
        // a note already at that path: the next free name
        for (let n = 1; ; n++) {
          try {
            const made = await c.createNote({ path: n === 1 ? base : `${base} ${n}`, content: text });
            nav(noteHref(target.key, made.id), { replace: true });
            return;
          } catch (e) { if (!(e instanceof VaultConflictError) || n >= 20) throw e; }
        }
      }
      const at = force ? updatedOf(theirs) : updatedOf(note);
      await c.updateNote(note!.id, { content: text, ...(at ? { if_updated_at: at } : {}) });
      nav(noteHref(target.key, note!.id), { replace: true });
    } catch (e) {
      if (e instanceof VaultConflictError && !isNew) {
        try { setTheirs(await c.getNote(note!.id)); } catch { /* shown without their words */ }
        setState("ready"); setError("This note changed since you opened it (an AI or another device wrote to it).");
        return;
      }
      setState("ready"); setError(e instanceof Error ? e.message : "That couldn't be saved.");
    }
  }

  if (!rec) return <main className="screen"><Bar title="Note" back={true} /><p className="error" role="alert">This device doesn't hold that vault.</p></main>;
  return (
    <main className="screen note-edit">
      <Bar title={isNew ? "New note" : "Edit"} back={true} />
      {state === "loading" && <p className="quiet" role="status">Reading the note…</p>}
      {state !== "loading" && state !== "error" && <>
        {isNew && vaults.length > 1 && (
          <label className="field note-into"><span>In</span>
            <select value={into} onChange={(e) => setInto(e.target.value)}>
              {vaults.map((v) => <option key={v.key} value={v.key}>{v.vault}</option>)}
            </select>
          </label>
        )}
        <textarea ref={box} className="note-text" aria-label={isNew ? "The new note" : "The note's words"} placeholder={isNew ? "Write. The first line is its name." : ""}
          value={text} onChange={(e) => setText(e.target.value)} />
        {error && <div className="error" role="alert"><p>{error}</p>
          {theirs && <div className="row-buttons">
            <button type="button" className="secondary" onClick={() => { setNote(theirs); setText(theirs.content ?? ""); setTheirs(null); setError(""); }}>Show their version</button>
            <button type="button" className="secondary" onClick={() => void save(true)}>Keep mine</button>
          </div>}
        </div>}
        <div className="row-buttons note-edit-actions">
          <button type="button" className="primary" disabled={state === "saving" || (isNew && !text.trim())} onClick={() => void save()}>{state === "saving" ? "Saving…" : "Save"}</button>
          <span className="quiet small">{isNew ? `Into ${target?.vault ?? ""}` : `In ${rec.vault}`}</span>
        </div>
      </>}
      {state === "error" && <p className="error" role="alert">{error}</p>}
    </main>
  );
}
