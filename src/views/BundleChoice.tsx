// Which bundle opens (docs/NAVIGATION.md "Bundles"): Parachute Simplified, Everything, or one of the person's bundle records, and the
// home vault that holds them. The choice is this device's, and the settings note's `bundle` follows it, so a new device
// of theirs opens the same one; their agent can change that note too (`bundle` and `app` alike until 2026-12-20).
import { useState } from "react";
import { chooseBundle, readSettings, useSettings } from "../shell/homeSettings";
import { DEFAULT_BUNDLES } from "../shell/bundles";
import { homeVault, setHome } from "../shell/frameSource";
import { useVaults } from "../vault/hooks";
import { useWhose } from "../vault/whose";
import { siteOf } from "../vault/site";

export default function BundleChoice() {
  const { bundle, bundles } = useSettings();
  const vaults = useVaults();
  const isMine = useWhose();
  // only a vault that is the person's own can be the home (vault/whose.ts)
  const mine = vaults.filter((v) => isMine(v) === "mine");
  const home = homeVault(vaults);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!home) return null;
  const pick = (id: string) => {
    if (id === bundle.id || busy) return;
    setBusy(true); setError("");
    chooseBundle(id).then(() => setBusy(false), (e: unknown) => { setError(e instanceof Error ? e.message : "That couldn't be saved."); setBusy(false); });
  };
  // the ones the app ships first, in their order, then the person's own, by name
  const order = [...bundles].sort((a, b) => rank(a.id) - rank(b.id) || a.name.localeCompare(b.name));
  return (
    <section className="card" aria-labelledby="s-bundle">
      <h2 id="s-bundle">Your bundle</h2>
      <fieldset className="plain" disabled={busy}>
        <legend className="sr-only">Which bundle opens</legend>
        {order.map((a) => (
          <label key={a.id} className="line"><span><input type="radio" name="bundle" checked={a.id === bundle.id} onChange={() => pick(a.id)} /> <span aria-hidden="true">{a.glyph}</span> <b>{a.name}</b>{a.note ? <>: {a.note}</> : null}{a.live ? <span className="quiet"> · from {siteOf(a.live.hub)}</span> : null}</span></label>
        ))}
      </fieldset>
      <p className="quiet small">Which applets this device shows, its bar and its home. Kept in {home.vault} too, so a new device opens the same one.</p>
      {mine.length > 1 && (
        <fieldset className="plain">
          <legend className="settings-sub">Home vault</legend>
          {mine.map((v) => (
            <label key={v.key} className="line"><span><input type="radio" name="home" checked={home.key === v.key} onChange={() => { setHome(v.key); void readSettings(); }} /> <strong>{v.vault}</strong> <span className="quiet">on {siteOf(v.issuer)}</span></span></label>
          ))}
        </fieldset>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
const rank = (id: string) => { const i = DEFAULT_BUNDLES.findIndex((r) => r.id === id); return i < 0 ? DEFAULT_BUNDLES.length : i; };
