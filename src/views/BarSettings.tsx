// The bar in Settings → Your bundle (T-476, Aaron 11-23: "I'd also like to be able to select what gets pinned to the menu
// bar. Which should be updating the Bundle as we go right?"): what is pinned, in order, to move or unpin; any applet here
// to pin. Each change goes into the open bundle's record in the home vault, as the bar's own long-press does, so every
// device of the person's that opens the bundle shows the same bar. A bundle someone else offers has their bar: the
// person makes a copy of their own to change it.
import { useState, useSyncExternalStore } from "react";
import { appletsNow, subscribeApplets } from "../applet/useApplets";
import { copyBundle, move, pinApplet, useSettings } from "../shell/homeSettings";
import { homeVault } from "../shell/frameSource";
import { useVaults } from "../vault/hooks";

export default function BarSettings() {
  const { bar, bundle } = useSettings();
  const vaults = useVaults();
  const home = homeVault(vaults);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useSyncExternalStore(subscribeApplets, () => vaults.map((v) => { const e = appletsNow(v.key); return e?.state === "ok" ? e.at : e?.state ?? ""; }).join());
  if (!home) return null;
  const act = (f: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError("");
    f().then(() => setBusy(false), (e: unknown) => { setError(e instanceof Error ? e.message : "That couldn't be saved."); setBusy(false); });
  };
  const pinned = new Set(bar.pins.map((p) => `${p.vault} ${p.noteId}`));
  const more = vaults.flatMap((v) => { const e = appletsNow(v.key); return e?.state === "ok" ? e.found.entries.map((a) => ({ v, a })) : []; })
    .filter(({ v, a }) => !pinned.has(`${v.key} ${a.noteId}`));
  const many = new Set(more.map(({ v }) => v.key)).size > 1;
  return (
    <fieldset className="plain bar-settings" disabled={busy}>
      <legend className="settings-sub">On the bar</legend>
      {bundle.live && <p className="small">This bar is the one the bundle's owner offers. <button type="button" className="quiet-button" onClick={() => act(copyBundle)}>Make a copy of your own</button> to change it; their later changes then no longer reach it.</p>}
      {bar.pins.length ? <ol className="plain bar-pins" aria-label="Pinned on the bar">
        {bar.pins.map((p, i) => (
          <li key={p.href} className="line">
            <span><span aria-hidden="true">{p.glyph}{"︎"}</span> {p.name}</span>
            {!bundle.live && <span className="bar-pin-acts">
              <button type="button" className="quiet-button" aria-label={`Move ${p.name} up`} disabled={i === 0} onClick={() => act(() => move(p.place, -1))}>↑</button>
              <button type="button" className="quiet-button" aria-label={`Move ${p.name} down`} disabled={i === bar.pins.length - 1} onClick={() => act(() => move(p.place, 1))}>↓</button>
              <button type="button" className="quiet-button" aria-label={`Unpin ${p.name}`} onClick={() => act(() => pinApplet(p.vault, p.noteId, false))}>Unpin</button>
            </span>}
          </li>))}
      </ol> : <p className="quiet small">Nothing pinned yet.</p>}
      {!bundle.live && more.length > 0 && <details className="bar-more">
        <summary>Pin another applet</summary>
        <ul className="plain">{more.map(({ v, a }) => (
          <li key={`${v.key} ${a.noteId}`}><button type="button" className="quiet-button" aria-label={`Pin ${a.manifest.name}`} onClick={() => act(() => pinApplet(v.key, a.noteId, true))}>
            <span aria-hidden="true">{a.manifest.glyph}{"︎"}</span> {a.manifest.name}</button>{many ? <span className="quiet small"> in {v.vault}</span> : null}</li>))}
        </ul>
      </details>}
      <p className="quiet small">Kept in the {bundle.name} bundle in {home.vault}, so your other devices show the same bar. A long-press on a place on the bar does the same.</p>
      {error && <p className="error" role="alert">{error}</p>}
    </fieldset>
  );
}
