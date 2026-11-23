// "Link your Parachute": a website that is an applet asks a visitor for their Parachute (a hub's address and a vault),
// signs in there (OAuth with PKCE; the hub registers the website the first time, and its admin approves it), and then
// shows the applet on that vault. The scope is the named vault's, as the Parachute app asks it (src/vault/parachute.ts
// scopeFor): a hub answers the unnamed `vault:read vault:write` with a token no vault takes.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createVaultSurface, PendingApprovalError, type VaultSurface } from "@openparachute/surface-client";
import { Card, Field } from "../../../src/kit/parts.tsx";
import { Button, Page, Problem } from "../../../src/kit/screen.tsx";
import { forgetSaved, installWebKit, linkClient, type AppletInfo } from "./web.ts";
import "./link.css";

export type Link = { hub: string; vault: string };
/** The website's ask of the hub: its name, the vault, and that vault's read and write. */
export function surfaceOptions(app: AppletInfo, link: Link, origin = location.origin) {
  return {
    clientName: app.name,
    appName: `${app.id}-web`,
    hubUrl: link.hub,
    vaultName: link.vault,
    scope: `vault:${link.vault}:read vault:${link.vault}:write`,
    redirectUri: `${origin}/oauth/callback`,
    bootstrap: "dcr" as const,
  };
}
const kept = (app: AppletInfo) => `parachute.link.${app.id}`;
const readLink = (app: AppletInfo): Link | null => { try { const l = JSON.parse(localStorage.getItem(kept(app)) ?? "null"); return l?.hub && l?.vault ? l : null; } catch { return null; } };
/** A hub's address as typed: https:// when no scheme was given, no trailing slash. */
export const hubOf = (typed: string) => { const t = typed.trim().replace(/\/+$/, ""); return t && !/^https?:\/\//i.test(t) ? `https://${t}` : t; };
// the code the hub sent back is exchanged once a page load, however often the effect runs (React's StrictMode runs it twice)
const exchanges = new Map<string, Promise<void>>();

export function LinkParachute({ applet, hub: hubDefault = "", vault: vaultDefault = "", children }: { applet: AppletInfo; hub?: string; vault?: string; children: ReactNode }) {
  useMemo(() => installWebKit(applet), [applet.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [link, setLink] = useState<Link | null>(() => readLink(applet));
  const [hub, setHub] = useState(link?.hub ?? hubDefault);
  const [vaultName, setVaultName] = useState(link?.vault ?? vaultDefault);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [n, setN] = useState(0);
  const surface: VaultSurface | null = useMemo(() => (link ? createVaultSurface(surfaceOptions(applet, link)) : null), [link?.hub, link?.vault]); // eslint-disable-line react-hooks/exhaustive-deps

  // back from the hub: the code for a token, then the applet
  useEffect(() => {
    if (!surface || location.pathname !== "/oauth/callback") return;
    let on = true;
    let done = exchanges.get(location.href);
    if (!done) { done = surface.handleCallback(); exchanges.set(location.href, done); }
    done.then(() => { if (on) { history.replaceState(null, "", "/"); setN((x) => x + 1); } }, (e) => { if (on) setError(e); });
    return () => { on = false; };
  }, [surface]);
  const client = useMemo(() => (surface && location.pathname !== "/oauth/callback" ? surface.getClient() : null), [surface, n]);
  // set before the applet below renders (its first read is in its first effect)
  linkClient(client, link ? `${link.hub}|${link.vault}` : "");

  const start = async () => {
    const next = { hub: hubOf(hub), vault: vaultName.trim() };
    if (!next.hub || !next.vault) return;
    setBusy(true); setError(null);
    try { localStorage.setItem(kept(applet), JSON.stringify(next)); } catch { /* this visit only */ }
    setLink(next);
    try { await createVaultSurface(surfaceOptions(applet, next)).login(); } catch (e) { setError(e); setBusy(false); }
  };
  // Unlink: this browser forgets the token, the link and what the applet saved (its drafts hold the vault's words). The
  // hub keeps the website's approval until its person takes it back there.
  const unlink = () => {
    surface?.logout();
    try { localStorage.removeItem(kept(applet)); } catch { /* nothing kept */ }
    forgetSaved();
    linkClient(null);
    setLink(null); setBusy(false);
  };
  const waiting = error instanceof PendingApprovalError ? error.approveUrl : null;

  if (!client) {
    return (
      <Page title={applet.name}>
        <Card title="Link your Parachute">
          <p>{applet.name} reads and writes the vault you link, and nothing else. Your Parachute asks you first.</p>
          <Field label="Your Parachute's address" placeholder="parachute.example.org" value={hub} onChange={setHub} />
          <Field label="Vault" placeholder="home" value={vaultName} onChange={setVaultName} />
          {waiting ? <p role="status">Your Parachute's admin approves new websites first. <a href={waiting}>Ask for approval</a>, then link again.</p>
            : error ? <Problem error={error}>Couldn't link it.</Problem> : null}
          <Button kind="primary" busy={busy} onClick={() => void start()}>{busy ? "Linking…" : "Link your Parachute"}</Button>
        </Card>
      </Page>
    );
  }
  // the line, then the applet in what is left of the screen (a paged Page is a screen tall: link.css)
  return (
    <div className="pa-linked">
      <p className="pa-linked-line">
        <span>Linked to <strong>{link!.vault}</strong> on {link!.hub.replace(/^https?:\/\//, "")}</span>
        <Button small kind="quiet" onClick={unlink}>Unlink</Button>
      </p>
      <div className="pa-linked-applet">{children}</div>
    </div>
  );
}
