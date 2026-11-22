import { useState } from "react";
import { siteOf } from "../vault/site";
import type { VaultPick } from "../vault/signInFlow";

/** Before the hub's consent (docs/design/SCOPES.md): on a hub the person runs, which of its vaults are theirs; and which
 *  one Parachute reads now: the home, on a Parachute of theirs. The others are asked for one at a time, later. */
export default function PickVaults({ pick, onError, onCancel }: { pick: VaultPick; onError: (e: unknown) => void; onCancel: () => void }) {
  const [mine, setMine] = useState<string[]>(pick.mine);
  const [first, setFirst] = useState<string>(pick.first);
  const [busy, setBusy] = useState(false);
  const flip = (v: string) => setMine((m) => (m.includes(v) ? m.filter((x) => x !== v) : [...m, v]));
  // the home is one of the person's own; on someone else's Parachute, any vault they reach
  const choices = pick.home ? (pick.askMine ? pick.vaults.filter((v) => mine.includes(v)) : pick.mine) : pick.vaults;
  const chosen = choices.includes(first) ? first : choices[0] ?? "";
  async function go() {
    if (!chosen) return;
    setBusy(true);
    try { window.location.assign(await pick.go(mine, chosen)); } catch (e) { setBusy(false); onError(e); }
  }
  return (
    <div className="stack">
      {pick.askMine && <fieldset className="plain">
        <legend>Which vaults on {siteOf(pick.hub)} are yours?</legend>
        {pick.vaults.map((v) => (
          <label key={v} className="line"><span><input type="checkbox" checked={mine.includes(v)} onChange={() => flip(v)} /> {v}</span></label>
        ))}
        <p className="small quiet">The others are someone else's: their applets can't ask the app for anything, show things from elsewhere, or be your home.</p>
      </fieldset>}
      {choices.length > 1 && <fieldset className="plain">
        <legend>{pick.home ? "Which one is your home?" : "Which vault do you want to open?"}</legend>
        {choices.map((v) => (
          <label key={v} className="line"><span><input type="radio" name="first" checked={chosen === v} onChange={() => setFirst(v)} /> {v}</span></label>
        ))}
      </fieldset>}
      <p className="small quiet">{pick.home ? "Parachute reads and writes your home now. Your other vaults are asked for one at a time, when you open one or allow an applet in it." : "Parachute reads this one now. The others are asked for one at a time, when you open them."}</p>
      <button className="primary" type="button" disabled={busy || !chosen} onClick={() => void go()}>{busy ? "Signing in…" : "Continue"}</button>
      <button className="quiet-button" type="button" disabled={busy} onClick={onCancel}>Back</button>
    </div>
  );
}
