// Which app opens (docs/NAVIGATION.md "Apps"): Parachute Simplified, Everything, or one of the person's app records. The choice is this
// device's, and the settings note's `app` follows it, so a new device of theirs opens the same one; their agent can
// change that note too.
import { useState } from "react";
import { chooseApp, useSettings } from "../shell/homeSettings";
import { homeVault } from "../shell/frameSource";
import { useVaults } from "../vault/hooks";

export default function AppChoice() {
  const { app, apps } = useSettings();
  const home = homeVault(useVaults());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!home) return null;
  const pick = (id: string) => {
    if (id === app.id || busy) return;
    setBusy(true); setError("");
    chooseApp(id).then(() => setBusy(false), (e: unknown) => { setError(e instanceof Error ? e.message : "That couldn't be saved."); setBusy(false); });
  };
  // the built-ins first (Parachute Simplified, Everything), then the person's own, by name
  const order = [...apps].sort((a, b) => rank(a.id) - rank(b.id) || a.name.localeCompare(b.name));
  return (
    <section className="card" aria-labelledby="s-app">
      <h2 id="s-app">Your app</h2>
      <fieldset className="plain" disabled={busy}>
        <legend className="sr-only">Which app opens</legend>
        {order.map((a) => (
          <label key={a.id} className="line"><span><input type="radio" name="app" checked={a.id === app.id} onChange={() => pick(a.id)} /> <span aria-hidden="true">{a.glyph}</span> <b>{a.name}</b>{a.note ? <>: {a.note}</> : null}{a.live ? <span className="quiet"> · from {hostOfHub(a.live.hub)}</span> : null}</span></label>
        ))}
      </fieldset>
      <p className="quiet small">Opens on this device now. Kept in {home.vault} too, so a new device opens the same one.</p>
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
const rank = (id: string) => (id === "simple" ? 0 : id === "everything" ? 1 : 2);
const hostOfHub = (hub: string) => { try { return new URL(hub).host; } catch { return hub; } };
