import type { ReactNode } from "react";
import { Bar } from "../ui/Bar";
import { useVaults } from "../vault/hooks";
import { hostOf, removeVault } from "../vault/store";
import { dropClient } from "../vault/client";
import { revoke } from "../vault/oauth";

/** The one place for what this device holds. Later sections (applets, the self-test) join here. */
export default function Settings({ children }: { children?: ReactNode }) {
  const vaults = useVaults();
  return (
    <main className="screen">
      <Bar title="Settings" back="/" />
      <section className="card" aria-labelledby="s-vaults">
        <h2 id="s-vaults">Vaults</h2>
        {vaults.length ? <ul className="plain">
          {vaults.map((v) => (
            <li key={v.key} className="line">
              <span><strong>{v.vault}</strong> <span className="quiet">on {hostOf(v.issuer)}</span></span>
              <button type="button" className="quiet-button" onClick={() => { void revoke(v.issuer, v.refreshToken); removeVault(v.key); dropClient(v.key); }}>Sign out</button>
            </li>
          ))}
        </ul> : <p className="quiet">None yet.</p>}
      </section>
      {children}
      <p className="screen-foot quiet">Parachute {__APP_VERSION__}</p>
    </main>
  );
}
