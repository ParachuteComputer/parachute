// Which app this person's devices open (docs/SIMPLE.md): the simple one, or everything. Kept in their settings note
// (`parachute.app`), so every device of theirs follows it, and their agent can change it there too.
import { useState } from "react";
import { setApp, useSettings, type AppChoice as Choice } from "../shell/homeSettings";
import { homeVault } from "../shell/frameSource";
import { useVaults } from "../vault/hooks";

export default function AppChoice() {
  const { settings } = useSettings();
  const home = homeVault(useVaults());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!home) return null;
  const now: Choice = settings.app ?? "everything";
  const pick = (c: Choice) => {
    if (c === now || busy) return;
    setBusy(true); setError("");
    setApp(c).then(() => setBusy(false), (e: unknown) => { setError(e instanceof Error ? e.message : "That couldn't be saved."); setBusy(false); });
  };
  return (
    <section className="card" aria-labelledby="s-app">
      <h2 id="s-app">Your app</h2>
      <fieldset className="plain" disabled={busy}>
        <legend className="sr-only">Which app opens</legend>
        <label className="line"><span><input type="radio" name="app" checked={now === "simple"} onChange={() => pick("simple")} /> <b>Simple</b>: your notes, Capture, and Connect an AI</span></label>
        <label className="line"><span><input type="radio" name="app" checked={now === "everything"} onChange={() => pick("everything")} /> <b>Everything</b>: the launcher, with every applet in every vault</span></label>
      </fieldset>
      <p className="quiet small">Kept in {home.vault}, so your other devices open the same one.</p>
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
