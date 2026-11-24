// The bar in Settings → Your bundle (T-476, Aaron 11-23: "I'd also like to be able to select what gets pinned to the menu
// bar. Which should be updating the Bundle as we go right?"): what is on it, in order (the bundle's own places, then the
// pins to move or unpin), and the applets the bundle offers, to pin. Each change goes into the open bundle's record in
// the home vault, as the bar's own long-press does, so every device of the person's that opens the bundle shows the same
// bar. A bundle someone else offers has their bar: the person makes a copy of their own to change it.
import { useState, useSyncExternalStore } from "react";
import { appletsNow, subscribeApplets } from "../applet/useApplets";
import { OFFICIAL_NAMES, officialFace, officialId } from "../applet/parachuteSource";
import { offered } from "../shell/bundles";
import { barOwnIds, copyBundle, move, pinApplet, useSettings } from "../shell/homeSettings";
import { homeVault } from "../shell/frameSource";
import { useVaults } from "../vault/hooks";
import { originOf } from "../vault/store";

export default function BarSettings() {
  const { bar, bundle } = useSettings();
  const vaults = useVaults();
  const home = homeVault(vaults);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useSyncExternalStore(subscribeApplets, () => vaults.map((v) => { const e = appletsNow(v.key); return e?.state === "ok" ? e.at : e?.state ?? ""; }).join());
  if (!home) return null;
  // (busy guards a second tap; the buttons stay as they are, so the one pressed keeps its focus)
  const act = (f: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError("");
    f().then(() => setBusy(false), (e: unknown) => { setError(e instanceof Error ? e.message : "That couldn't be saved."); setBusy(false); });
  };
  const pinned = new Set(bar.pins.map((p) => `${p.vault} ${p.noteId}`));
  // what the bundle offers and isn't on the bar: Parachute's own (when it offers them), then each vault's, as the list has them
  const own = bundle.parachute ? OFFICIAL_NAMES.map((n) => ({ vault: home.key, noteId: officialId(n), name: officialFace(n).name, glyph: officialFace(n).glyph, where: "" })) : [];
  const theirs = vaults.flatMap((v) => { const e = appletsNow(v.key); return e?.state === "ok" ? e.found.entries
    .filter((a) => offered(bundle, { hub: originOf(v.issuer), vault: v.vault }, a, originOf(home.issuer)))
    .map((a) => ({ vault: v.key, noteId: a.noteId, name: a.manifest.name, glyph: a.manifest.glyph, where: v.vault })) : []; });
  // one of Parachute's own the bar already has as a place of the bundle's: shipped there, Connect, or Notes as the home
  // screen (the list, in other bundles, is no applet)
  const onBarAlready = new Set(barOwnIds(bar.entries, bundle.look));
  const more = [...own, ...theirs].filter((a) => !pinned.has(`${a.vault} ${a.noteId}`) && !onBarAlready.has(a.noteId));
  const many = new Set(theirs.map((a) => a.vault)).size > 1;
  const appName = (e: (typeof bar.entries)[number]) => ("href" in e ? null : "shipped" in e ? officialFace(e.shipped).name : e.screen === "connect" ? officialFace("connect").name : bundle.look === "notes" ? "Notes" : "Applets");
  return (
    <fieldset className="plain bar-settings" aria-busy={busy}>
      <legend className="settings-sub">On the bar</legend>
      {bundle.live && (bundle.hubOf
        ? <p className="small">This bar is the one the bundle's owner offers. <button type="button" className="quiet-button" onClick={() => act(copyBundle)}>Make a copy of your own</button> to change it; their later changes then no longer reach it.</p>
        : <p className="small">This bar is the one the bundle's owner offers, and it can't be read here now, so it can't be copied yet.</p>)}
      {bar.entries.length ? <ol className="plain bar-pins" aria-label="On the bar now">
        {bar.entries.map((e, i) => "href" in e ? (
          <li key={e.href} className="line">
            <span><span aria-hidden="true">{e.glyph}{"︎"}</span> {e.name}</span>
            {!bundle.live && <span className="bar-pin-acts">
              <button type="button" className="quiet-button" aria-label={`Move ${e.name} up`} aria-disabled={bar.pins[0]?.href === e.href} onClick={() => bar.pins[0]?.href !== e.href && act(() => move(e.place, -1))}>↑</button>
              <button type="button" className="quiet-button" aria-label={`Move ${e.name} down`} aria-disabled={bar.pins.at(-1)?.href === e.href} onClick={() => bar.pins.at(-1)?.href !== e.href && act(() => move(e.place, 1))}>↓</button>
              <button type="button" className="quiet-button" aria-label={`Unpin ${e.name}`} onClick={() => act(() => pinApplet(e.vault, e.noteId, false))}>Unpin</button>
            </span>}
          </li>) : <li key={`app ${i}`} className="line"><span>{appName(e)}</span><span className="quiet small">the bundle's own</span></li>)}
      </ol> : <p className="quiet small">Nothing pinned yet.</p>}
      {!bundle.live && more.length > 0 && <details className="bar-more">
        <summary>Pin another applet</summary>
        <ul className="plain">{more.map((a) => (
          <li key={`${a.vault} ${a.noteId}`}><button type="button" className="quiet-button" aria-label={`Pin ${a.name}`} onClick={() => act(() => pinApplet(a.vault, a.noteId, true))}>
            <span aria-hidden="true">{a.glyph}{"︎"}</span> {a.name}</button>{many && a.where ? <span className="quiet small"> in {a.where}</span> : null}</li>))}
        </ul>
      </details>}
      <p className="quiet small">Kept in {home.vault}, so your other devices show the same bar. Pin, on any applet in the list or at its top, does the same.</p>
      {busy && <p className="quiet small" role="status">Saving…</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </fieldset>
  );
}
