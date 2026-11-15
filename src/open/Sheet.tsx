// "Open with…": the candidates for a note, the vault view last, and Always ticked. An applet that isn't allowed yet
// says "Allow first" and leads to its card. Shown when the note's route can't decide (two applets claim it), and on a
// long-press of any link to a note. A choice is a tap inside the app: it starts the applet for this note.
import { useState } from "react";
import { useNavigate } from "react-router";
import { useVault } from "../vault/hooks";
import { noteHref, titleOf } from "../vault/notes";
import { closeSheet, useSheet, type SheetTarget } from "./sheet";
import { useOpenWith, type OpenWith } from "./useOpenWith";
import { setDefault, VAULT } from "./defaults";
import { appletHref, appletPath } from "./paths";
import { isRealTap, markTap } from "./mark";
import type { Candidate } from "./resolve";

export default function Sheet() {
  const target = useSheet();
  if (!target) return null;
  return <SheetFor key={`${target.vault}/${target.note}`} vault={target.vault} note={target.note} preset={target.preset} />;
}

function SheetFor({ vault, note, preset }: { vault: string; note: string; preset?: SheetTarget["preset"] }) {
  const rec = useVault(vault);
  const nav = useNavigate();
  const read = useOpenWith(preset ? null : rec, note, false);
  const ow: OpenWith = preset ? { state: "ok", note: preset.note, cands: preset.cands, decision: { kind: "ask", candidates: preset.cands } } : read;
  const [always, setAlways] = useState(true);
  if (!rec) return null;
  const cands = ow.state === "ok" ? ow.cands : [];
  const types = [...new Set(cands.map((c) => c.claim.type))];
  const title = ow.state === "ok" && ow.note ? titleOf(ow.note) : "this note";
  const pick = (e: React.MouseEvent, c: Candidate | null) => {
    if (!isRealTap(e) || ow.state !== "ok" || !ow.note) return;
    const id = ow.note.id;
    closeSheet();
    if (!c) {
      if (always) for (const t of types) setDefault(rec.key, t, VAULT);
      nav(`${noteHref(rec.key, id)}?with=vault`);
      return;
    }
    if (always) setDefault(rec.key, c.claim.type, c.entry.noteId);
    // the choice is the person's tap: it starts this applet for this note (an applet not yet allowed shows its card)
    markTap(appletPath(rec.key, c.entry.noteId));
    nav(appletHref(rec.key, c, id));
  };
  return (
    <div className="sheet-scrim" onClick={(e) => { if (e.target === e.currentTarget) closeSheet(); }}>
      <section className="sheet" role="dialog" aria-modal="true" aria-label="Open with">
        <h2>Open {title} with…</h2>
        {ow.state === "loading" && <p className="quiet" role="status">Looking…</p>}
        {ow.state === "error" && <p className="error" role="alert">{ow.error}</p>}
        {ow.state === "ok" && (
          <ul className="rows" aria-label="Choices">
            {cands.map((c) => (
              <li key={c.entry.noteId}>
                <button type="button" className="row sheet-choice" disabled={c.status === "off"} onClick={(e) => pick(e, c)}>
                  <span className="row-title"><span aria-hidden="true">{c.entry.manifest.glyph}</span> {c.entry.manifest.name}</span>
                  <span className="row-sub">{c.status === "ok" ? `opens ${c.claim.type} notes` : c.status === "updated" ? "changed since you allowed it" : c.status === "off" ? "applets are off on this device" : "Allow first"}</span>
                </button>
              </li>
            ))}
            <li><button type="button" className="row sheet-choice" onClick={(e) => pick(e, null)}>
              <span className="row-title"><span aria-hidden="true">▤</span> Vault</span>
              <span className="row-sub">the plain vault view</span>
            </button></li>
          </ul>
        )}
        {types.length > 0 && (
          <label className="sheet-always"><input type="checkbox" checked={always} onChange={(e) => setAlways(e.target.checked)} /> Always open {types.join(" and ")} notes this way</label>
        )}
        <button type="button" className="quiet-button" onClick={closeSheet}>Cancel</button>
      </section>
    </div>
  );
}
