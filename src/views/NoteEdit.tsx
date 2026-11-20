// The app's own editor (docs/SIMPLE.md): a new note in a vault, or a note's words and fields changed (a typed record's
// fields, any type, each input shaped by the type's own definition: vault/fields.ts). A shell screen, so the frame
// (which a person's vault can replace) never writes: it only sends the person here. Only the person's own words: never
// an app's own note (settings, frame, theme, pointers) or code, which the note view offers no Edit for either.
import { heldLevel } from "../vault/reach";
import { DRAFT_LATEST, DRAFT_RETURN } from "../vault/writeAsk";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { VaultConflictError, type Note } from "@openparachute/surface-client";
import { Bar } from "../ui/Bar";
import { useVault, useVaults } from "../vault/hooks";
import { clientFor } from "../vault/client";
import { isAppOwn, isCodeNote, noteHref } from "../vault/notes";
import { atFirstEntry } from "../ui/history";
import { fieldChanges, fieldInputs, type FieldInput, type FieldSpec } from "../vault/fields";

const pad = (n: number) => String(n).padStart(2, "0");
/** A new note's path, from its first line: plain words, no folder (where Parachute Cloud keeps a person's notes). */
export function pathFromText(text: string, at = new Date()): string {
  const first = (text.split("\n").find((l) => l.trim()) ?? "").replace(/^#+\s*/, "");
  const words = first.replace(/[\u0000-\u001f\\/:*?"<>|#[\]^]/g, " ").replace(/\s+/g, " ").replace(/^[.\s]+/, "").slice(0, 80).trim();
  return words || `Note ${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}-${pad(at.getMinutes())}`;
}
const updatedOf = (n: Note | null) => (n as { updatedAt?: string } | null)?.updatedAt ?? null;
/** May this device write in the vault? Its sign-in's scope says (a vault given to read only can't be changed here). */

/** The words typed before the app left for the hub's write ask, if this opening is the way back from it. */
function takeDraft(k: string): { text: string; base: string | null; into: string | null } | null {
  try {
    const back = sessionStorage.getItem(DRAFT_RETURN) === k;
    sessionStorage.removeItem(DRAFT_RETURN);
    const raw = sessionStorage.getItem(k);
    sessionStorage.removeItem(k);
    if (!back || !raw) return null;
    const d = JSON.parse(raw) as { text?: unknown; base?: unknown; into?: unknown };
    return typeof d.text === "string" ? { text: d.text, base: typeof d.base === "string" ? d.base : null, into: typeof d.into === "string" ? d.into : null } : null;
  } catch { return null; }
}
function keepDraft(k: string, text: string, base: string | null, into: string) { try { sessionStorage.setItem(k, JSON.stringify({ text, base, into })); sessionStorage.setItem(DRAFT_LATEST, k); } catch { /* this screen only */ } }
const leavingForHub = () => { try { return !!sessionStorage.getItem(DRAFT_RETURN); } catch { return false; } };

export default function NoteEdit() {
  const { vault: key, id } = useParams();
  const rec = useVault(key);
  const vaults = useVaults();
  const nav = useNavigate();
  const isNew = id === undefined;
  const [note, setNote] = useState<Note | null>(null);
  // what the person typed, kept for this tab while the hub is asked for write (shell/WriteAsk.tsx leaves the page):
  // back here, it is as they left it
  // Only on the way back from that ask (WriteAsk marks it): any other opening of the editor starts from the note.
  const draftKey = `parachute.draft.v1:${key ?? ""}:${id ?? "new"}`;
  const [draft] = useState(() => takeDraft(draftKey));
  const [text, setTextNow] = useState(draft?.text ?? "");
  // the version the person's words were written against: the conflict check is against it, not a later read
  const base = useRef<string | null>(draft?.base ?? null);
  const intoRef = useRef<string>(draft?.into ?? key ?? "");
  const setText = (t: string) => { setTextNow(t); keepDraft(draftKey, t, base.current, intoRef.current); };
  const dropDraft = () => { try { sessionStorage.removeItem(draftKey); } catch { /* nothing kept */ } };
  useEffect(() => () => { if (!leavingForHub()) dropDraft(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // the vault a new note goes into, kept with the draft: back from the hub, it is the one the person chose
  const [into, setIntoNow] = useState(draft?.into ?? key ?? "");
  const setInto = (v: string) => { intoRef.current = v; setIntoNow(v); keepDraft(draftKey, text, base.current, v); };
  const [state, setState] = useState<"loading" | "ready" | "saving" | "error">(isNew ? "ready" : "loading");
  const [error, setError] = useState("");
  // the note changed elsewhere (an AI, another device) since it was opened: the person's text stays, and they choose.
  // `conflictAt`: when it last changed, as the hub said (Keep mine works with it even if their version can't be read)
  const [theirs, setTheirs] = useState<Note | null>(null);
  const [conflictAt, setConflictAt] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  // the record's fields: the inputs (from its types' definitions and what it holds) and what the person typed
  const [fields, setFields] = useState<FieldInput[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    if (isNew || !rec || !id) return;
    let live = true;
    clientFor(rec).getNote(id).then((n) => {
      if (!live) return;
      if (!n) { setState("error"); setError("There's no such note."); return; }
      if (isCodeNote(n) || isAppOwn(n)) { setState("error"); setError("This note is the app's own, or code: it isn't changed here."); return; }
      if (!draft) base.current = updatedOf(n);
      setNote(n); setTextNow(draft?.text ?? n.content ?? ""); setState("ready");
      // its types' field definitions (the vault's own), so each field gets the right input; a type that can't be read
      // leaves its fields as plain text
      const types = ((n as { types?: string[] }).types ?? n.tags ?? []).slice(0, 6);
      const c = clientFor(rec);
      void Promise.all(types.map((t) => c.getTag(t).catch(() => null))).then((defs) => {
        if (!live) return;
        const declared: Record<string, FieldSpec> = {};
        for (const d of defs) for (const [k, v] of Object.entries((d as { fields?: Record<string, FieldSpec> } | null)?.fields ?? {})) declared[k] ??= v;
        setFields(fieldInputs(n.metadata, declared));
      });
    }, (e: unknown) => { if (live) { setState("error"); setError(e instanceof Error ? e.message : "The note couldn't be read."); } });
    return () => { live = false; };
  }, [rec?.key, id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (state === "ready") box.current?.focus(); }, [state]);

  // any vault this device reads takes a new note: one it may only read asks first (vault/reach.ts, the shell's WriteAsk)
  const writable = vaults;
  const target = writable.find((v) => v.key === into) ?? rec ?? null;
  const asksFirst = !!target && heldLevel(target) !== "write";
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
            dropDraft();
            nav(noteHref(target.key, made.id), { replace: true });
            return;
          } catch (e) { if (!(e instanceof VaultConflictError) || n >= 20) throw e; }
        }
      }
      const at = force ? (updatedOf(theirs) ?? conflictAt) : base.current ?? updatedOf(note);
      const changed = fieldChanges(fields, values);
      await c.updateNote(note!.id, { content: text, ...(Object.keys(changed).length ? { metadata: changed } : {}), ...(at ? { if_updated_at: at } : {}) });
      dropDraft();
      // back to the note the person came from (it reads itself again), so Back after it doesn't show it twice
      if (atFirstEntry()) nav(noteHref(target.key, note!.id), { replace: true }); else nav(-1);
    } catch (e) {
      if (e instanceof VaultConflictError && !isNew) {
        setConflictAt(e.currentUpdatedAt);
        try { setTheirs(await c.getNote(note!.id)); } catch { /* Keep mine still works, from when the hub said it changed */ }
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
        {isNew && writable.length > 1 && (
          <label className="field note-into"><span>In</span>
            <select value={into} onChange={(e) => setInto(e.target.value)}>
              {writable.map((v) => <option key={v.key} value={v.key}>{v.vault}</option>)}
            </select>
          </label>
        )}
        {fields.length > 0 && <div className="note-edit-fields" role="group" aria-label="Fields">
          {fields.map((f) => <FieldBox key={f.name} f={f} value={values[f.name] ?? f.value} onChange={(v) => setValues((was) => ({ ...was, [f.name]: v }))} />)}
        </div>}
        <textarea ref={box} className="note-text" aria-label={isNew ? "The new note" : "The note's words"} placeholder={isNew ? "Write. The first line is its name." : ""}
          value={text} onChange={(e) => setText(e.target.value)} />
        {error && <div className="error" role="alert"><p>{error}</p>
          {(theirs || conflictAt) && <>
            <p className="small">Keep mine saves your words over theirs. Use theirs drops your changes.</p>
            <div className="row-buttons">
              <button type="button" className="secondary" onClick={() => void save(true)}>Keep mine</button>
              {theirs && <button type="button" className="secondary" onClick={() => { base.current = updatedOf(theirs); setNote(theirs); setText(theirs.content ?? ""); setTheirs(null); setConflictAt(null); setError(""); }}>Use theirs</button>}
            </div>
          </>}
        </div>}
        <div className="row-buttons note-edit-actions">
          <button type="button" className="primary" disabled={state === "saving" || !target || (isNew && !text.trim())} onClick={() => void save()}>{state === "saving" ? "Saving…" : "Save"}</button>
          <span className="quiet small">{isNew ? (target ? `Into ${target.vault}` : "No vault here takes new notes from this device.") : `In ${rec.vault}`}{asksFirst ? ". Your hub asks you first." : ""}</span>
        </div>
      </>}
      {state === "error" && <p className="error" role="alert">{error}</p>}
    </main>
  );
}

/** One field's input, by its kind: a choice of the type's values, a yes/no box, a number, or text. */
function FieldBox({ f, value, onChange }: { f: FieldInput; value: string; onChange: (v: string) => void }) {
  const id = `field-${f.name}`;
  const input = f.kind === "choice"
    ? <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">–</option>
        {[...new Set([...(f.choices ?? []), ...(value && !f.choices?.includes(value) ? [value] : [])])].map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
    : f.kind === "yesno"
      ? <input id={id} type="checkbox" checked={value === "true"} onChange={(e) => onChange(e.target.checked ? "true" : "false")} />
      : <input id={id} type={f.kind === "number" ? "number" : "text"} value={value} onChange={(e) => onChange(e.target.value)} />;
  return <><label htmlFor={id}>{f.label}</label>{input}</>;
}
