// Which bundle opens (docs/NAVIGATION.md "Bundles"): Parachute Simplified, Everything, or one of the person's bundle records, and the
// home vault that holds them. The choice is this device's, and the settings note's `bundle` follows it, so a new device
// of theirs opens the same one; their agent can change that note too (`bundle` and `app` alike until 2026-12-20).
// Under it, what the open bundle opens on (its `start`): the list, or one of the applets on its bar. A tap here is the
// person's choice on this device, as the bar's long-press "Open on start" is (shell/start.ts).
import { useState, type ChangeEvent } from "react";
import { chooseBundle, effective, readSettings, setStart, useSettings, type Pin } from "../shell/homeSettings";
import { chooseStart, forgetStart } from "../shell/start";
import { DEFAULT_BUNDLES } from "../shell/bundles";
import { homeVault, setHome } from "../shell/frameSource";
import { useVaults } from "../vault/hooks";
import { useWhose } from "../vault/whose";
import { siteOf } from "../vault/site";

export default function BundleChoice() {
  const { bundle, bundles, bar, settings } = useSettings();
  const vaults = useVaults();
  const isMine = useWhose();
  // only a vault that is the person's own can be the home (vault/whose.ts)
  const mine = vaults.filter((v) => isMine(v) === "mine");
  const oneHub = new Set(mine.map((v) => v.issuer)).size <= 1;
  const home = homeVault(vaults);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // the choice shows at once, while it is written
  const [choosing, setChoosing] = useState<string | null>(null);
  if (!home) return null;
  const pick = (id: string) => {
    if (id === bundle.id || busy) return;
    setBusy(true); setError("");
    chooseBundle(id).then(() => setBusy(false), (e: unknown) => { setError(e instanceof Error ? e.message : "That couldn't be saved."); setBusy(false); });
  };
  // what it opens on: the list (Notes, for a bundle that looks like Parachute Simplified), or an applet of the person's
  // own on its bar; a home that isn't on the bar is a choice too, so it shows checked
  const starts = effective(settings, bundles).start;
  const own = (vault: string) => { const v = vaults.find((x) => x.key === vault); return !!v && isMine(v) === "mine"; };
  const firsts = [...(bar.start && !bar.pins.some((p) => p.vault === bar.start!.vault && p.noteId === bar.start!.noteId) ? [bar.start] : []), ...bar.pins].filter((p) => own(p.vault));
  const keyOf = (p: { vault: string; noteId: string } | null) => (p ? `${p.vault}/${p.noteId}` : "");
  const now = choosing ?? (starts ? (bar.start ? keyOf(bar.start) : null) : "");
  // as the bar's long-press does: the pin's own place into the record, then this device's choice (a person's tap only)
  const opensOn = (e: ChangeEvent, to: Pin | null) => {
    if (busy || !e.nativeEvent.isTrusted) return;
    setBusy(true); setError(""); setChoosing(keyOf(to));
    setStart(to?.place ?? null).then(() => {
      if (to) chooseStart(to.vault, to.noteId); else forgetStart();
    }, (e: unknown) => { setError(e instanceof Error ? e.message : "That couldn't be saved."); }).finally(() => { setBusy(false); setChoosing(null); });
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
      {/* someone else's bundle: its first screen is theirs, as its bar is */}
      {!bundle.live && <fieldset className="plain" disabled={busy}>
        <legend className="settings-sub">Opens on</legend>
        <label className="line"><span><input type="radio" name="opens-on" checked={now === ""} onChange={(e) => opensOn(e, null)} /> {bundle.look === "notes" ? <><span aria-hidden="true">¶</span> <b>Notes</b></> : <><span aria-hidden="true">⁂</span> <b>Applets</b>: the list</>}</span></label>
        {firsts.map((p) => (
          <label key={`${p.vault}/${p.noteId}`} className="line"><span><input type="radio" name="opens-on" checked={now === keyOf(p)} onChange={(e) => opensOn(e, p)} /> <span aria-hidden="true">{p.glyph}</span> <b>{p.name}</b></span></label>
        ))}
      </fieldset>}
      {/* where each is, only when they are on more than one Parachute */}
      {mine.length > 1 && (
        <fieldset className="plain">
          <legend className="settings-sub">Home vault</legend>
          {mine.map((v) => (
            <label key={v.key} className="line"><span><input type="radio" name="home" checked={home.key === v.key} onChange={() => { setHome(v.key); void readSettings(); }} /> <strong>{v.vault}</strong>{oneHub ? null : <span className="quiet"> on {siteOf(v.issuer)}</span>}</span></label>
          ))}
        </fieldset>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
const rank = (id: string) => { const i = DEFAULT_BUNDLES.findIndex((r) => r.id === id); return i < 0 ? DEFAULT_BUNDLES.length : i; };
