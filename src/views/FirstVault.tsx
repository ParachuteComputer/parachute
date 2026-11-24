import { useState, type FormEvent } from "react";
import { isVaultName } from "../vault/address";
import type { FirstVault as First } from "../vault/signInFlow";

/** A person new to Parachute Cloud names their first vault here, in the app, right after the email that made their
 *  account (T-476): the sign-in makes it, then asks for it as their home. The same words Cloud's own page uses. */
export default function FirstVault({ first, onError, onCancel }: { first: First; onError: (e: unknown) => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clean = name.trim().toLowerCase();
  async function make(e: FormEvent) {
    e.preventDefault();
    if (!isVaultName(clean) || clean.length < 2) { setError("Use letters, numbers and hyphens, starting with a letter or number."); return; }
    setBusy(true); setError(null);
    try { window.location.assign(await first.make(clean)); } catch (err) {
      setBusy(false);
      // a refusal the person can answer (a name taken) stays here; a sign-in that ended goes back to the screen
      if (err instanceof Error && !/ended/.test(err.message)) setError(err.message); else onError(err);
    }
  }
  return (
    <form className="stack" onSubmit={make} noValidate>
      <p className="lead">Your account is ready. Now your first vault.</p>
      <p>A vault is the private home for your notes. Any AI you invite can read it, and it's always yours to export.</p>
      <label className="field">
        <span>Its name</span>
        <input autoCapitalize="off" autoCorrect="off" spellCheck={false} autoFocus value={name} onChange={(e) => setName(e.target.value)}
          aria-invalid={!!error} aria-describedby="first-hint" />
      </label>
      <p className="small quiet" id="first-hint">The name is part of its address and can't change, so pick a word you like. Letters, numbers, hyphens.</p>
      {error && <p className="error" role="alert">{error}</p>}
      <button className="primary" type="submit" disabled={busy || !clean}>{busy ? "Making it…" : "Make my vault"}</button>
      <button className="quiet-button" type="button" disabled={busy} onClick={() => { void first.end(); onCancel(); }}>Not now</button>
    </form>
  );
}
