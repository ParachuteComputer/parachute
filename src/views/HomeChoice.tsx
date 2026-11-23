// When the home vault can't be reached (T-476: Aaron's Mac kept a home from an older install that it can't reach, so
// every one of Parachute's own applets and his bundle were out of reach): the person's other vaults on this device that
// it can reach, one tap each to make that one home. Settings shows it at the top; one of Parachute's own shows it on its
// card; the list links to Settings. (Settings → Your bundle → Home vault does the same at any time; this is the
// shortcut while the home is out of reach.)
import { useState, useSyncExternalStore } from "react";
import { Link } from "react-router";
import { appletsNow, subscribeApplets } from "../applet/useApplets";
import { homeVault, setHome } from "../shell/frameSource";
import { readSettings, useSettings } from "../shell/homeSettings";
import { useVaults } from "../vault/hooks";
import { useWhose } from "../vault/whose";
import { siteOf } from "../vault/site";
import type { VaultRecord } from "../vault/store";

/** The home, when it is out of reach now: its settings got no answer, or its applets didn't. (A refused sign-in is
 *  another matter: Settings → Your Parachutes, Sign in again.) */
export function useHomeUnreached(): VaultRecord | null {
  const vaults = useVaults();
  const { read, why } = useSettings();
  const home = homeVault(vaults);
  const failed = useSyncExternalStore(subscribeApplets, () => { const e = home ? appletsNow(home.key) : null; return e?.state === "error" && e.failure === "offline"; });
  return home && ((read === "unreachable" && why === "offline") || failed) ? home : null;
}

/** The person's own vaults here other than the home, leaving out any known to be out of reach. */
export function useOtherHomes(): VaultRecord[] {
  const vaults = useVaults();
  const isMine = useWhose();
  const home = homeVault(vaults);
  useSyncExternalStore(subscribeApplets, () => vaults.map((v) => appletsNow(v.key)?.state ?? "").join());
  return vaults.filter((v) => { const e = appletsNow(v.key); return v.key !== home?.key && isMine(v) === "mine" && !(e?.state === "error" && e.failure === "offline"); });
}

/** One button per other vault: "Make letters your home"; with none, the way to add one. `onChosen` after the home moved. */
export function OtherHomes({ onChosen }: { onChosen?: (v: VaultRecord) => void }) {
  const others = useOtherHomes();
  if (!others.length) return <p className="small">No other vault of yours is on this device. <Link to="/add">Add a Parachute</Link>, or sign in again to yours in Settings.</p>;
  const oneHub = new Set(others.map((v) => v.issuer)).size <= 1;
  return <p className="home-choices">{others.map((v) => (
    <button key={v.key} type="button" className="quiet-button" onClick={() => { setHome(v.key); void readSettings(); onChosen?.(v); }}>
      Make {v.vault} your home{oneHub ? "" : ` on ${siteOf(v.issuer)}`}
    </button>))}</p>;
}

/** Settings, at the top while the home can't be reached; after a tap, a line that says where home is now. */
export function HomeUnreached() {
  const home = useHomeUnreached();
  const [chosen, setChosen] = useState<string | null>(null);
  if (!home) return chosen ? <p className="quiet" role="status">{chosen} is your home now.</p> : null;
  return (
    <section className="card" role="region" aria-labelledby="s-home-unreached">
      <h2 id="s-home-unreached" className="sr-only">Your home vault</h2>
      <p>Parachute can't reach {home.vault}, your home vault. Its Parachute is {siteOf(home.issuer)}.</p>
      <p className="small quiet">Parachute's own applets and your bundle live in your home vault. Make another vault your home:</p>
      <OtherHomes onChosen={(v) => setChosen(v.vault)} />
    </section>
  );
}
