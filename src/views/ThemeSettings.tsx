// Settings → Look: the theme the app shows, where it comes from, and the choices most people want to change by hand
// (the built-in look it starts from, density, light or dark, whether things move). Anything else (colours, fonts) is the theme note's, changed there by the person or their
// agent (docs/THEME.md). The first change copies the built-in theme into the home vault (copy-on-write).
import { useEffect, useState } from "react";
import { makeThemeMine, readTheme, screenNow, setDensity, setLook, setMotion, setScheme, setScreen, THEME_PATH, useTheme } from "../theme/store";
import { COLOR_KEYS, DENSITIES, LOOK_NAMES, MOTIONS, SCHEMES, type Density, type LookName, type Motion, type Scheme } from "../theme/theme";
import { homeVault } from "../shell/frameSource";

const DENSITY_NAME: Record<Density, string> = { compact: "Compact", regular: "Regular", roomy: "Roomy" };
const SCHEME_NAME: Record<Scheme, string> = { system: "As the device", light: "Light", dark: "Dark" };
const MOTION_NAME: Record<Motion, string> = { flowing: "Flowing", still: "Still" };
const LOOK_NAME: Record<LookName, string> = { paper: "Paper", almanac: "Almanac", book: "Book", daylight: "Daylight" };
/** The looks to choose for every device; Daylight is this screen's own choice, below. */
const STYLES = LOOK_NAMES.filter((l) => l !== "daylight");

export default function ThemeSettings() {
  const t = useTheme();
  const home = homeVault();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // read when shown, as the frame area does: what an agent changed is seen here even with the live query down
  useEffect(() => { void readTheme(); }, [home?.key]);
  const act = (f: () => Promise<void>) => async () => { setBusy(true); setError(null); try { await f(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } };
  const palette = t.tokens.scheme === "dark" ? t.theme.dark : t.theme.colors;
  return (
    <section className="card" aria-labelledby="s-look">
      <h2 id="s-look">Look</h2>
      <p role="status" className="look-status">{t.from === "vault" ? <>Your theme: <strong>{THEME_PATH}</strong> in {home?.vault}. Change it there, or ask your agent to.</> : "The built-in theme."}</p>
      <p className="swatches" aria-label="Colours">{COLOR_KEYS.map((k) => <span key={k} className="swatch" title={k} style={{ background: palette[k] }} />)}</p>
      {home && (
        <>
          <fieldset className="plain choice" disabled={busy}>
            <legend className="settings-sub">Style</legend>
            {STYLES.map((l) => <label key={l}><input type="radio" name="look" checked={t.theme.look === l} onChange={act(() => setLook(l))} /> {LOOK_NAME[l]}</label>)}
          </fieldset>
          <fieldset className="plain choice" disabled={busy}>
            <legend className="settings-sub">Density</legend>
            {DENSITIES.map((d) => <label key={d}><input type="radio" name="density" checked={t.theme.density === d} onChange={act(() => setDensity(d))} /> {DENSITY_NAME[d]}</label>)}
          </fieldset>
          <fieldset className="plain choice" disabled={busy}>
            <legend className="settings-sub">Light or dark</legend>
            {SCHEMES.map((s) => <label key={s}><input type="radio" name="scheme" checked={t.theme.scheme === s} onChange={act(() => setScheme(s))} /> {SCHEME_NAME[s]}</label>)}
          </fieldset>
          <fieldset className="plain choice" disabled={busy}>
            <legend className="settings-sub">Motion</legend>
            {MOTIONS.map((m) => <label key={m}><input type="radio" name="motion" checked={t.theme.motion === m} onChange={act(() => setMotion(m))} /> {MOTION_NAME[m]}</label>)}
          </fieldset>
          {t.from === "built-in" && <button type="button" className="quiet-button" disabled={busy} onClick={act(makeThemeMine)}>Make this look mine</button>}
        </>
      )}
      <fieldset className="plain choice">
        <legend className="settings-sub">This screen</legend>
        <label><input type="radio" name="screen" checked={screenNow() === "theme"} onChange={() => setScreen("theme")} /> As the theme</label>
        <label><input type="radio" name="screen" checked={screenNow() === "daylight"} onChange={() => setScreen("daylight")} /> Daylight: black on white, for e-paper</label>
      </fieldset>
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
