import type { ReactNode } from "react";
import { Bar, backOrLauncher } from "../ui/Bar";
import { Link } from "react-router";
import { useVaults } from "../vault/hooks";
import { removeVault, type VaultRecord } from "../vault/store";
import { dropClient } from "../vault/client";
import { revoke } from "../vault/oauth";
import AppletSettings from "./AppletSettings";
import FrameSettings from "./FrameSettings";
import { forgetVaultFrame } from "../shell/frameSource";
import { clearDefaults } from "../open/defaults";
import { forgetVaultStart } from "../shell/start";
import { forgetVaultSettings } from "../shell/homeSettings";
import { forgetVaultTheme } from "../theme/store";
import ThemeSettings from "./ThemeSettings";
import { forgetApplets } from "../applet/useApplets";
import { deviceGrants, subjectOf } from "../applet/grants";
import { grantInVault } from "../applet/embeds";
import KeySettings from "../key/KeySettings";
import { AskWhose, WhoseLine } from "./Whose";
import { useParachutes } from "../shell/parachutes";
import { listHub } from "../shell/homeSettings";
import { endSignInIfUnused, signOutOf } from "../vault/signInFlow";

/** Signing out of a vault ends what its applets were allowed on this device too, and the embeds on its pages or from it. */
const revokeVaultGrants = (key: string) => { const g = deviceGrants(); for (const s of g.subjects()) if (grantInVault(s, subjectOf(key, ""), key)) g.revoke(s); };

/** What a vault leaves on this device, gone with it: its client, its applets' grants and the embeds from it, its
 *  "Always" choices, its frame, its home applet, its settings and theme. */
const forgetVault = (key: string) => { dropClient(key); forgetApplets(key); revokeVaultGrants(key); clearDefaults(key); forgetVaultFrame(key); forgetVaultStart(key); forgetVaultSettings(key); forgetVaultTheme(key); };
/** Sign out of one vault: a vault of a Parachute sign-in only leaves this device (the sign-in ends with its last vault). */
function signOutVault(v: VaultRecord) {
  removeVault(v.key);
  forgetVault(v.key);
  if (v.signIn) void endSignInIfUnused(v.signIn); else void revoke(v);
}

/** The one place for what this device holds. Later sections (applets, the self-test) join here. */
export default function Settings({ children }: { children?: ReactNode }) {
  const vaults = useVaults();
  const parachutes = useParachutes();
  return (
    <main className="screen">
      <Bar title="Settings" back={true} onBack={backOrLauncher} />
      <section className="card" aria-labelledby="s-vaults">
        <h2 id="s-vaults">Your Parachutes</h2>
        <AskWhose vaults={vaults} />
        {parachutes.length ? parachutes.map((p) => (
          <section key={p.hub} className="settings-parachute" aria-label={`Parachute: ${p.name}`}>
            <h3>{p.name}{p.name !== p.host && <span className="quiet"> · {p.host}</span>}</h3>
            {p.vaults.length ? <>
              <ul className="plain">
                {p.vaults.map((v) => (
                  <li key={v.key} className="line">
                    <span><strong>{v.vault}</strong> <WhoseLine v={v} /></span>
                    <button type="button" className="quiet-button" aria-label={`Sign out of ${v.vault}`} onClick={() => signOutVault(v)}>Sign out</button>
                  </li>
                ))}
              </ul>
              <p className="small"><Link to={`/add?hub=${encodeURIComponent(p.hub)}`}>Sign in again</Link> <span className="quiet">(brings any vault you've been given since)</span>{" · "}
                <button type="button" className="quiet-button" onClick={() => void signOutOf(p.hub, forgetVault)}>Sign out of {p.name}</button></p>
            </> : <p className="small">On your list, not signed in on this device. <Link to={`/add?hub=${encodeURIComponent(p.hub)}`}>Sign in</Link>{" · "}
              <button type="button" className="quiet-button" onClick={() => void listHub(p.hub, false).catch(() => undefined)}>Take off the list</button></p>}
          </section>
        )) : <p className="quiet">None yet.</p>}
        <p className="small"><Link to="/add">Add a Parachute</Link></p>
      </section>
      <KeySettings />
      <FrameSettings />
      <ThemeSettings />
      <AppletSettings vaults={vaults} />
      {children}
      <p className="screen-foot quiet">Parachute {__APP_VERSION__}</p>
    </main>
  );
}
