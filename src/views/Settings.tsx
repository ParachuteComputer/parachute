import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { Bar, backOrLauncher } from "../ui/Bar";
import { Link } from "react-router";
import { useVaults } from "../vault/hooks";
import { removeVault, type VaultRecord } from "../vault/store";
import { dropClient } from "../vault/client";
import { revoke } from "../vault/oauth";
import AppletSettings from "./AppletSettings";
import FrameSettings from "./FrameSettings";
import { forgetVaultFrame, homeVault, readFrameRecord, useFrameSource } from "../shell/frameSource";
import { clearDefaults } from "../open/defaults";
import { forgetVaultStart } from "../shell/start";
import { forgetVaultSettings } from "../shell/homeSettings";
import { forgetVaultTheme } from "../theme/store";
import ThemeSettings from "./ThemeSettings";
import ServicesSettings from "./ServicesSettings";
import { appletsNow, forgetApplets, subscribeApplets } from "../applet/useApplets";
import { deviceGrants, subjectOf } from "../applet/grants";
import { grantInVault, isEmbedSubject } from "../applet/embeds";
import { forgetSaved } from "../shell/saved";
import KeySettings from "../key/KeySettings";
import KeyringSettings from "../key/KeyringSettings";
import ApprovalSettings from "../key/ApprovalSettings";
import SecuritySettings from "../key/SecuritySettings";
import NotifySettings from "./NotifySettings";
import { AskWhose, WhoseLine } from "./Whose";
import { useParachutes } from "../shell/parachutes";
import { listHub } from "../shell/homeSettings";
import { askVault, signOutOf } from "../vault/signInFlow";
import { dismissVault, newVaultsOn, newVaultsRev, startAddVault, subscribeNewVaults } from "../vault/newVaults";
import BundleChoice from "./BundleChoice";
import { appletsNeedingWrite, forgetOwnWrite, giveBack, heldLevel } from "../vault/reach";
import { anchorNow, forgetOwnKey, ownKey } from "../applet/approvalStore";
import { useKey } from "../key/key";
import { nativeNow } from "../services/native";
import { DEFAULTS } from "../shell/levelRules";
import { onLevels } from "../shell/levels";
import { useWhose } from "../vault/whose";
import { ownFrame, settingsShown, usesCards } from "./settingsShown";

/** Signing out of a vault ends what its applets were allowed on this device too, and the embeds on its pages or from it;
 *  what those applets saved here (drafts) goes with them. */
const revokeVaultGrants = (key: string) => { const g = deviceGrants(); for (const s of g.subjects()) if (grantInVault(s, subjectOf(key, ""), key)) { g.revoke(s); if (!isEmbedSubject(s)) forgetSaved(s); } };

/** What a vault leaves on this device, gone with it: its client, its applets' grants and the embeds from it, its
 *  "Always" choices, its frame, its home applet, its settings and theme. */
const forgetVault = (key: string) => { dropClient(key); forgetApplets(key); revokeVaultGrants(key); clearDefaults(key); forgetVaultFrame(key); forgetVaultStart(key); forgetVaultSettings(key); forgetVaultTheme(key); };
/** Sign out of one vault: off this device, and its sign-in ended at the hub. */
function signOutVault(v: VaultRecord) {
  forgetOwnWrite(v);
  removeVault(v.key);
  forgetVault(v.key);
  void revoke(v);
}

/** What Parachute holds of a vault at its hub (docs/design/SCOPES.md), and the person's own write given back. */
function Holds({ v }: { v: VaultRecord }) {
  const level = heldLevel(v);
  // write that no applet allowed here needs (the person's own, or held from before this app asked per vault): theirs to give back
  const applets = appletsNeedingWrite(v);
  const own = level === "write" && applets !== null && !applets.length;
  return <span className="quiet holds">· {level === "write" ? "reads and changes notes" : "reads"}{own && <> <button type="button" className="quiet-button" onClick={() => { forgetOwnWrite(v); void giveBack(v.key, "/settings"); }}>Read only</button></>}</span>;
}

/** The person's vaults on a Parachute that this device doesn't read yet (docs/design/SCOPES.md): one quiet line each. A
 *  tap asks the hub to read that one vault (vault/newVaults.ts); Not now stops offering it here. */
function VaultsToAdd({ hub, name }: { hub: string; name: string }) {
  useSyncExternalStore(subscribeNewVaults, newVaultsRev);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fresh = newVaultsOn(hub);
  if (!fresh.length) return null;
  const add = (v: string) => {
    if (busy) return;
    setBusy(true); setError("");
    // the app leaves for the hub; it stays busy until then
    startAddVault(hub, v).then((u) => window.location.assign(u), (e: unknown) => { setError(e instanceof Error ? e.message : "Your hub didn't answer."); setBusy(false); });
  };
  return (
    <ul className="parachute-new plain" aria-label={`Vaults to open on ${name}`}>
      {fresh.map((v) => (
        <li key={v}>
          <button type="button" className="parachute-new-add" disabled={busy} onClick={() => add(v)}>Open <b>{v}</b></button>
          <button type="button" className="quiet-button" disabled={busy} aria-label={`Not now: ${v}`} onClick={() => dismissVault(hub, v)}>Not now</button>
        </li>
      ))}
      {error && <li className="error" role="alert">{error}</li>}
    </ul>
  );
}

/** What decides which sections for the person's key show (settingsShown.ts), read for this screen. */
function useShown(vaults: VaultRecord[]) {
  const isMine = useWhose();
  const fs = useFrameSource();
  const home = homeVault(vaults);
  const [key, setKey] = useState(false);
  const [securitySet, setSecuritySet] = useState(false);
  // the applets as their section reads them (AppletSettings), across every vault here, read again when it reads them
  useSyncExternalStore(subscribeApplets, () => vaults.map((v) => { const e = appletsNow(v.key); return e?.state === "ok" ? e.at : e?.state ?? ""; }).join());
  const applets = vaults.flatMap((v) => { const e = appletsNow(v.key); return e?.state === "ok" ? e.found.entries : []; });
  // the key, again when Settings → Your key adds or removes it (on a device; a test build's key is there from the start)
  const npub = useKey()?.npub;
  useEffect(() => {
    let on = true;
    forgetOwnKey();
    void ownKey().then((k) => { if (on) setKey(!!k); });
    return () => { on = false; };
  }, [npub]);
  useEffect(() => {
    let on = true;
    const levels = () => void nativeNow().then((n) => n?.levelsStatus()).then((s) => {
      if (on && s) setSecuritySet(s.passcode || (Object.keys(DEFAULTS) as (keyof typeof DEFAULTS)[]).some((k) => s.levels[k] !== DEFAULTS[k]));
    }, () => undefined);
    levels();
    const off = onLevels(levels);
    return () => { on = false; off(); };
  }, []);
  // the home's frame record, read when Settings shows (the frame area reads it too, but isn't shown here)
  useEffect(() => { void readFrameRecord(); }, [home?.key]);
  const shown = settingsShown({ key, home: !!home && isMine(home) === "mine", applets, securitySet, anchor: !!anchorNow(),
    frame: ownFrame(fs.read, fs.choice.run), ownVaults: vaults.filter((v) => isMine(v) === "mine").length });
  return { ...shown, cards: key && applets.some(usesCards) };
}

/** The one place for what this device holds. Later sections (applets, the self-test) join here. */
export default function Settings({ children }: { children?: ReactNode }) {
  const vaults = useVaults();
  const parachutes = useParachutes();
  const shown = useShown(vaults);
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
                    <span><strong>{v.vault}</strong> <WhoseLine v={v} /> <Holds v={v} /></span>
                    <Link className="quiet-button" to={`/v/${encodeURIComponent(v.key)}`} aria-label={`Open ${v.vault}`}>Open</Link>
                    <button type="button" className="quiet-button" aria-label={`Sign out of ${v.vault}`} onClick={() => signOutVault(v)}>Sign out</button>
                    <button type="button" className="quiet-button" aria-label={`Sign in again to ${v.vault}`} onClick={() => void askVault(v, heldLevel(v) ?? "read", "open", "/settings").then((u) => window.location.assign(u), () => undefined)}>Sign in again</button>
                  </li>
                ))}
              </ul>
              <VaultsToAdd hub={p.hub} name={p.name} />
              <p className="small"><Link to={`/add?hub=${encodeURIComponent(p.hub)}`}>Sign in again</Link> <span className="quiet">(sees which vaults you have there now)</span>{" · "}
                <button type="button" className="quiet-button" onClick={() => signOutOf(p.hub, signOutVault)}>Sign out of {p.name}</button></p>
            </> : <p className="small">On your list, not signed in on this device. <Link to={`/add?hub=${encodeURIComponent(p.hub)}`} aria-label={`Sign in to ${p.name}`}>Sign in</Link>{" · "}
              <button type="button" className="quiet-button" onClick={() => void listHub(p.hub, false).catch(() => undefined)}>Take off the list</button></p>}
          </section>
        )) : <p className="quiet">None yet.</p>}
        <p className="small"><Link to="/add">Add a Parachute</Link></p>
      </section>
      <BundleChoice />
      <ServicesSettings />
      <KeySettings />
      {shown.security && <SecuritySettings />}
      {shown.approving && <ApprovalSettings />}
      <KeyringSettings cards={shown.cards} />
      <NotifySettings />
      {shown.frame && <FrameSettings />}
      <ThemeSettings />
      <AppletSettings vaults={vaults} />
      {children}
      <p className="screen-foot quiet">Parachute {__APP_VERSION__}</p>
    </main>
  );
}
