import { useState } from "react";
import { hostOf } from "../vault/store";
import type { VaultPick } from "../vault/signInFlow";

/** On a hub the person runs, before its consent: which of its vaults are theirs (docs/design/ONE-SIGN-IN.md). Every
 *  vault comes in; the ones left unticked are someone else's (Settings changes either, per vault). */
export default function PickVaults({ pick, onError, onCancel }: { pick: VaultPick; onError: (e: unknown) => void; onCancel: () => void }) {
  const [mine, setMine] = useState<string[]>(pick.mine);
  const [busy, setBusy] = useState(false);
  const flip = (v: string) => setMine((m) => (m.includes(v) ? m.filter((x) => x !== v) : [...m, v]));
  async function go() {
    setBusy(true);
    try { window.location.assign(await pick.go(mine)); } catch (e) { setBusy(false); onError(e); }
  }
  return (
    <div className="stack">
      <fieldset className="plain">
        <legend>Every vault on {hostOf(pick.hub)} comes in. Which are yours?</legend>
        {pick.vaults.map((v) => (
          <label key={v} className="line"><span><input type="checkbox" checked={mine.includes(v)} onChange={() => flip(v)} /> {v}</span></label>
        ))}
      </fieldset>
      <p className="small quiet">The others come in marked as someone else's: their applets can't ask the app for anything, show things from elsewhere, or be your home.</p>
      <button className="primary" type="button" disabled={busy} onClick={() => void go()}>{busy ? "Signing in…" : "Continue"}</button>
      <button className="quiet-button" type="button" disabled={busy} onClick={onCancel}>Back</button>
    </div>
  );
}
