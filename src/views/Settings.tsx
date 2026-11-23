import UpdateSettings from "./UpdateSettings";
import { OWN } from "../shell/updates";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { Bar, backOrLauncher } from "../ui/Bar";
import { Link } from "react-router";
import { useVaults } from "../vault/hooks";
import { hostOf, removeVault, type VaultRecord } from "../vault/store";
import { siteOf } from "../vault/site";
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
import { embedSubjectParts, grantInVault, isEmbedSubject } from "../applet/embeds";
import { forgetSaved } from "../shell/saved";
import KeySettings from "../key/KeySettings";
import KeyringSettings from "../key/KeyringSettings";
import ApprovalSettings from "../key/ApprovalSettings";
import SecuritySettings from "../key/SecuritySettings";
import NotifySettings from "./NotifySettings";
import { AskWhose, WhoseLine } from "./Whose";
import { useParachutes, type ParachuteLine } from "../shell/parachutes";
import { listHub } from "../shell/homeSettings";
import { askVault, signOutOf } from "../vault/signInFlow";
import { dismissVault, newVaultsOn, newVaultsRev, startAddVault, subscribeNewVaults } from "../vault/newVaults";
import BundleChoice from "./BundleChoice";
import BundleSections from "./BundleSections";
import { appletsNeedingWrite, forgetOwnWrite, giveBack, heldLevel, ownWrite } from "../vault/reach";
import { reachCount, reachLine, why } from "./reachWords";
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

/** One vault this device holds, in one line: its name, and what Parachute holds of it and what for (reachWords.ts). A tap
 *  on it shows why in a sentence, whose it is, and Read only, Sign in again and Sign out; Open stays beside it. */
function VaultRow({ v }: { v: VaultRecord }) {
  const whose = useWhose()(v);
  const g = deviceGrants();
  // the applets allowed here, by name, as Applets lists them: read again when the vault's applets are, and when a grant
  // here comes or goes (a Revoke in Applets, on this screen)
  useSyncExternalStore(subscribeApplets, () => { const e = appletsNow(v.key); return e?.state === "ok" ? e.at : e?.state ?? ""; });
  useSyncExternalStore(g.onChange, () => g.subjects().join("|"));
  const read = appletsNow(v.key);
  const here = g.subjects().filter((s) => s.startsWith(subjectOf(v.key, "")));
  const entries = here.map((s) => (read?.state === "ok" ? read.found.entries.find((x) => subjectOf(v.key, x.noteId) === s) : undefined));
  const allowed = here.flatMap((s, i) => { const e = entries[i]; return e && !e.newer && g.status(s, e.keys.scope, e.keys.html) !== "none" ? [e.manifest.name] : []; });
  // a component from this vault allowed on a page (applet/embeds.ts) reaches it too
  const embeds = g.subjects().filter(isEmbedSubject).map(embedSubjectParts).filter((p) => p?.from === v.key).map((p) => `«${p!.name}» on a page`);
  // grants here whose applets this device hasn't read (still reading, the vault not answering, made for a newer app):
  // what they need isn't known, so the vault is never called unused
  const unknown = here.length > 0 && (read?.state !== "ok" || entries.some((e) => e?.newer));
  const level = heldLevel(v);
  const home = homeVault()?.key === v.key;
  const facts = { level, home, applets: [...allowed, ...embeds], unknown, own: ownWrite(v), theirs: whose !== "mine" };
  // write that no applet allowed here needs (the person's own, or held from before this app asked per vault): theirs to give back
  const needing = appletsNeedingWrite(v);
  const giveable = level === "write" && needing !== null && !needing.length && !home;
  return (
    <li className="vault-row">
      <details className="vault-more">
        <summary><strong className="vault-name">{v.vault}</strong><span className="vault-reach">{reachLine(facts)}</span></summary>
        <div className="vault-detail">
          <p className="small">{why(facts).long}</p>
          <WhoseLine v={v} />
          <div className="vault-acts">
            {giveable && <button type="button" className="quiet-button" onClick={() => { forgetOwnWrite(v); void giveBack(v.key, "/settings"); }}>Read only</button>}
            <button type="button" className="quiet-button" aria-label={`Sign in again to ${v.vault}`} onClick={() => void askVault(v, heldLevel(v) ?? "read", "open", "/settings").then((u) => window.location.assign(u), () => undefined)}>Sign in again</button>
            <button type="button" className="quiet-button" aria-label={`Sign out of ${v.vault}`} onClick={() => signOutVault(v)}>Sign out</button>
          </div>
        </div>
      </details>
      <Link className="quiet-button" to={`/v/${encodeURIComponent(v.key)}`} aria-label={`Open ${v.vault}`}>Open</Link>
    </li>
  );
}

/** The person's vaults on a Parachute that this device doesn't read (docs/design/SCOPES.md): behind one line that counts
 *  them, one quiet line each. A tap asks the hub to read that one vault (vault/newVaults.ts); Not now stops offering it here. */
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
    <details className="parachute-more">
      <summary>{fresh.length === 1 ? "1 more vault there, which Parachute doesn't read" : `${fresh.length} more vaults there, which Parachute doesn't read`}</summary>
      <p className="small quiet">Open one and Parachute reads that one vault; an applet there asks for more on its card.</p>
      <ul className="parachute-new plain" aria-label={`Vaults to open on ${name}`}>
        {fresh.map((v) => (
          <li key={v}>
            <button type="button" className="parachute-new-add" disabled={busy} onClick={() => add(v)}>Open <b>{v}</b></button>
            <button type="button" className="quiet-button" disabled={busy} aria-label={`Not now: ${v}`} onClick={() => dismissVault(hub, v)}>Not now</button>
          </li>
        ))}
        {error && <li className="error" role="alert">{error}</li>}
      </ul>
    </details>
  );
}

/** A group of Settings: a title, and the sections under it (each with its own small heading). Hidden while none of its
 *  sections shows (styles.css). */
function Group({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return <div className="settings-group" role="group" aria-labelledby={id}><h2 id={id}>{title}</h2>{children}</div>;
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

/** A Parachute in a sentence: "your Parachute" for the one with the home vault, else its name, else its site (its whole
 *  address when another on the list has the same site). */
const said = (p: ParachuteLine, all: readonly ParachuteLine[] = []) => (p.home ? "your Parachute" : p.name !== p.host ? p.name
  : all.some((o) => o.hub !== p.hub && siteOf(o.hub) === siteOf(p.hub)) ? p.host : siteOf(p.hub));

/** The one place for what this device holds. Later sections (applets, the self-test) join here. */
export default function Settings({ children }: { children?: ReactNode }) {
  const vaults = useVaults();
  const parachutes = useParachutes();
  const shown = useShown(vaults);
  // how many vaults each Parachute has that this device doesn't read, counted over its vaults
  useSyncExternalStore(subscribeNewVaults, newVaultsRev);
  return (
    <main className="screen settings">
      <Bar title="Settings" back={true} onBack={backOrLauncher} />
      <Group id="g-you" title="You">
        <KeySettings />
        {shown.approving && <ApprovalSettings />}
        <KeyringSettings cards={shown.cards} />
        <BundleChoice />
        <ThemeSettings />
        {shown.frame && <FrameSettings />}
      </Group>
      <Group id="g-parachutes" title="Your Parachutes">
        <section className="card" aria-labelledby="s-vaults">
          <h3 id="s-vaults" className="sr-only">Your vaults</h3>
          <p className="settings-lead">Parachute reaches your home vault, and another vault only when you open it or allow an applet there.</p>
          <AskWhose vaults={vaults} />
          {parachutes.length ? parachutes.map((p) => (
            <section key={p.hub} className="settings-parachute" aria-label={`Parachute: ${said(p, parachutes)}`}>
              <h4>{p.home ? "Your Parachute" : said(p, parachutes)}{(p.home || hostOf(p.hub) !== said(p, parachutes)) && <span className="quiet small">{hostOf(p.hub)}</span>}</h4>
              {p.vaults.length ? <>
                <p className="small quiet">{reachCount(p.vaults.length, newVaultsOn(p.hub).length)}</p>
                <ul className="plain vault-rows">{p.vaults.map((v) => <VaultRow key={v.key} v={v} />)}</ul>
                <VaultsToAdd hub={p.hub} name={said(p, parachutes)} />
                <p className="small"><Link to={`/add?hub=${encodeURIComponent(p.hub)}`}>Sign in again</Link> <span className="quiet">(sees which vaults you have there now)</span>{" · "}
                  <button type="button" className="quiet-button" onClick={() => signOutOf(p.hub, signOutVault)}>Sign out of {said(p, parachutes)}</button></p>
              </> : <p className="small">On your list, not signed in on this device. <Link to={`/add?hub=${encodeURIComponent(p.hub)}`} aria-label={`Sign in to ${said(p, parachutes)}`}>Sign in</Link>{" · "}
                <button type="button" className="quiet-button" onClick={() => void listHub(p.hub, false).catch(() => undefined)}>Take off the list</button></p>}
            </section>
          )) : <p className="quiet">None yet.</p>}
          <p className="small"><Link to="/add">Add a Parachute</Link>{" · "}<Link to="/accept">Accept an invite</Link></p>
        </section>
        <AppletSettings vaults={vaults} />
        <ServicesSettings />
      </Group>
      <Group id="g-device" title="This device">
        {shown.security && <SecuritySettings />}
        <NotifySettings />
      </Group>
      <Group id="g-updates" title="Updates">
        <UpdateSettings />
        <p className="screen-foot quiet">Parachute {__APP_VERSION__}{OWN.commit && <> · {OWN.commit}</>}</p>
      </Group>
      {/* the sections the person's applets draw (BundleSections.tsx): last, so a frame that changes height moves nothing
          of Settings' own under a tap */}
      <Group id="g-applets" title="From your applets">
        <BundleSections vaults={vaults} />
      </Group>
      {children}
    </main>
  );
}
