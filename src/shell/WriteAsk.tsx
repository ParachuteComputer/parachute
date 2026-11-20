// The one ask for write, for a change the person makes (docs/design/SCOPES.md): the app holds only read of a vault
// until something the person allows needs more. A change it can't make yet (a note, their settings, adding Capture)
// is refused before it is sent (vault/reach.ts), and this sheet says why and offers the hub's consent for that one vault.
// The change itself is made again after: nothing is done behind the person's back.
import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";
import { askOwnWrite } from "../vault/reach";
import { clearWriteAsk, markDraftReturn, onWriteAsk } from "../vault/writeAsk";
import { findVault, hostOf } from "../vault/store";

export default function WriteAsk() {
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const location = useLocation();
  // after Not now, the same vault doesn't ask again for a few seconds (a change retried by itself can't nag)
  const quiet = useRef(new Map<string, number>());
  // (while quiet no sheet shows, so no ask is pending either: the screen that asked says it itself)
  useEffect(() => onWriteAsk((k) => { if ((quiet.current.get(k) ?? 0) > Date.now()) { clearWriteAsk(); return; } setKey(k); setError(""); setBusy(false); }), []);
  const rec = key ? findVault(key) : null;
  if (!key || !rec) return null;
  const close = () => { quiet.current.set(key, Date.now() + 5_000); clearWriteAsk(); setKey(null); };
  const go = async (e: React.MouseEvent) => {
    // only a real tap leaves for the hub
    if (!e.isTrusted) return;
    setBusy(true); setError("");
    try {
      const to = await askOwnWrite(key, `${location.pathname}${location.search}`);
      // from a note's editor, the words typed come back with the person (views/NoteEdit.tsx)
      markDraftReturn(/^\/v\/[^/]+\/(?:new|n\/[^/]+\/edit)$/.test(location.pathname));
      window.location.assign(to);
    }
    catch (e) { setBusy(false); setError(e instanceof Error ? e.message : "Your hub didn't answer."); }
  };
  return (
    <div className="sheet-scrim sheet-over-frames" role="presentation">
      <section className="sheet" role="dialog" aria-modal="true" aria-label={`Change notes in ${rec.vault}`}>
        <h2>Let Parachute change notes in {rec.vault}?</h2>
        <p>Parachute only reads {rec.vault} so far. To save this, your hub ({hostOf(rec.issuer)}) asks you to let it add, change and delete notes there.</p>
        <p className="quiet">Nothing was saved yet. After you say yes, do it again.</p>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="grant-actions">
          <button type="button" className="quiet-button" disabled={busy} onClick={close}>Not now</button>
          <button type="button" className="primary" disabled={busy} onClick={(e) => void go(e)}>{busy ? "Opening your hub…" : `Continue to ${hostOf(rec.issuer)}`}</button>
        </div>
      </section>
    </div>
  );
}
