// Which bundle opens (docs/NAVIGATION.md "Bundles"): Parachute Simplified, Everything, or one of the person's bundle records. The
// choice is this device's, and the settings note's `bundle` follows it, so a new device of theirs opens the same one;
// their agent can change that note too.
import { useState } from "react";
import { chooseBundle, useSettings } from "../shell/homeSettings";
import { homeVault } from "../shell/frameSource";
import { useVaults } from "../vault/hooks";

export default function BundleChoice() {
  const { bundle, bundles } = useSettings();
  const home = homeVault(useVaults());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!home) return null;
  const pick = (id: string) => {
    if (id === bundle.id || busy) return;
    setBusy(true); setError("");
    chooseBundle(id).then(() => setBusy(false), (e: unknown) => { setError(e instanceof Error ? e.message : "That couldn't be saved."); setBusy(false); });
  };
  // the built-ins first (Parachute Simplified, Everything), then the person's own, by name
  const order = [...bundles].sort((a, b) => rank(a.id) - rank(b.id) || a.name.localeCompare(b.name));
  return (
    <section className="card" aria-labelledby="s-bundle">
      <h2 id="s-bundle">Your bundle</h2>
      <fieldset className="plain" disabled={busy}>
        <legend className="sr-only">Which bundle opens</legend>
        {order.map((a) => (
          <label key={a.id} className="line"><span><input type="radio" name="bundle" checked={a.id === bundle.id} onChange={() => pick(a.id)} /> <span aria-hidden="true">{a.glyph}</span> <b>{a.name}</b>{a.note ? <>: {a.note}</> : null}{a.live ? <span className="quiet"> · from {hostOfHub(a.live.hub)}</span> : null}</span></label>
        ))}
      </fieldset>
      <p className="quiet small">Which applets this device shows, its bar and its home. Kept in {home.vault} too, so a new device opens the same one.</p>
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
const rank = (id: string) => (id === "simple" ? 0 : id === "everything" ? 1 : 2);
const hostOfHub = (hub: string) => { try { return new URL(hub).host; } catch { return hub; } };
