// When the home vault can't be reached (T-476: Aaron's Mac kept a home from an older install that it can't reach, so
// every one of Parachute's own applets and his bundle were out of reach): the person's other vaults on this device that
// it can reach, one tap each to make that one home. Settings shows it at the top; an applet that runs in the home shows
// it on its card; the list links to Settings.
import { useSyncExternalStore } from "react";
import { appletsNow, subscribeApplets } from "../applet/useApplets";
import { homeVault, setHome } from "../shell/frameSource";
import { readSettings, useSettings } from "../shell/homeSettings";
import { useVaults } from "../vault/hooks";
import { useWhose } from "../vault/whose";
import { siteOf } from "../vault/site";
import type { VaultRecord } from "../vault/store";

/** Whether the home can't be reached now: its settings couldn't be read, or its applets failed with no answer. */
export function useHomeUnreached(): VaultRecord | null {
  const vaults = useVaults();
  const { read } = useSettings();
  const home = homeVault(vaults);
  const failed = useSyncExternalStore(subscribeApplets, () => { const e = home ? appletsNow(home.key) : null; return e?.state === "error" && e.failure === "offline"; });
  return home && (read === "unreachable" || failed) ? home : null;
}

/** The person's own vaults here other than the home, those not known to be out of reach first (a vault whose applets
 *  failed with no answer is left out). */
function useOtherHomes(): VaultRecord[] {
  const vaults = useVaults();
  const isMine = useWhose();
  const home = homeVault(vaults);
  useSyncExternalStore(subscribeApplets, () => vaults.map((v) => appletsNow(v.key)?.state ?? "").join());
  return vaults.filter((v) => v.key !== home?.key && isMine(v) === "mine" && !(appletsNow(v.key)?.state === "error" && (appletsNow(v.key) as { failure?: string }).failure === "offline"));
}

/** One button per other vault: "Make letters your home". `onChosen` after the home moved (an applet goes there). */
export function OtherHomes({ onChosen }: { onChosen?: (v: VaultRecord) => void }) {
  const others = useOtherHomes();
  if (!others.length) return null;
  const oneHub = new Set(others.map((v) => v.issuer)).size <= 1;
  return <p className="home-choices">{others.map((v) => (
    <button key={v.key} type="button" className="quiet-button" onClick={() => { setHome(v.key); void readSettings(); onChosen?.(v); }}>
      Make {v.vault} your home{oneHub ? "" : <span className="quiet"> ({siteOf(v.issuer)})</span>}
    </button>))}</p>;
}

/** Settings, at the top while the home can't be reached. */
export function HomeUnreached() {
  const home = useHomeUnreached();
  if (!home) return null;
  return (
    <section className="card" role="region" aria-labelledby="s-home-unreached">
      <h3 id="s-home-unreached" className="sr-only">Your home vault</h3>
      <p>Parachute can't reach {home.vault}, your home vault. Its Parachute is {siteOf(home.issuer)}.</p>
      <p className="small quiet">Parachute's own applets and your bundle live in your home vault. Make another vault your home:</p>
      <OtherHomes />
    </section>
  );
}
