// Settings → Applets: the self-test's result (and Run again), and each applet this device has allowed, with Revoke.
import { giveBack } from "../vault/reach";
import { useState } from "react";
import { runSelfTest, useGate, useSelfTestRun } from "../applet/selftest/run";
import { deviceGrants, subjectOf } from "../applet/grants";
import { takeBack } from "../applet/approvalStore";
import { forgetSaved } from "../shell/saved";
import { useApplets } from "../applet/useApplets";
import { listVaults, type VaultRecord } from "../vault/store";
import { embedSubjectParts } from "../applet/embeds";
import { useSyncExternalStore } from "react";
import { allDefaults, clearDefault, subscribeDefaults, VAULT } from "../open/defaults";
import AppletServices from "./AppletServices";

const grants = deviceGrants();
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });

function DefaultsIn({ rec }: { rec: VaultRecord }) {
  const raw = useSyncExternalStore(subscribeDefaults, () => JSON.stringify(allDefaults()[rec.key] ?? {}), () => "{}");
  const applets = useApplets(rec, false);
  const defaults = Object.entries(JSON.parse(raw) as Record<string, string>);
  const nameOf = (id: string) => id === VAULT ? "the vault view" : applets.state === "ok" ? applets.found.entries.find((a) => a.noteId === id)?.manifest.name ?? "an applet that is gone" : "an applet";
  return <>{defaults.map(([type, id]) => (
    <li key={type} className="line">
      <span><strong>{type}</strong> notes in {rec.vault} open in {nameOf(id)}</span>
      <button type="button" className="quiet-button" onClick={() => clearDefault(rec.key, type)}>Clear</button>
    </li>
  ))}</>;
}

function AllowedIn({ rec, onChange }: { rec: VaultRecord; onChange: () => void }) {
  const applets = useApplets(rec, false);
  // when a Revoke's taking back went no further than this device (applet/approvalStore.ts `takeBack`)
  const [said, setSaid] = useState<string | null>(null);
  // Revoke here is Revoke in the applet's menu: on a device with the person's key the approval is taken back on every
  // device, and the one left in the home vault never allows it here again
  const revoke = (subject: string, id: string, a: { manifest: { id: string; name: string } } | undefined) => void (async () => {
    const told = await takeBack(rec, id, a?.manifest.name ?? "this applet", a?.manifest.id ?? null);
    grants.revoke(subject); forgetSaved(subject); setSaid(told); onChange(); void giveBack(rec.key, "/settings");
  })();
  // from the grants themselves, so a grant whose applet is gone from the vault can still be revoked
  const subjects = grants.subjects().filter((s) => s.startsWith(subjectOf(rec.key, "")));
  return <>{said && <li className="line"><p className="error" role="alert">{said}</p></li>}{subjects.map((subject) => {
    const id = subject.slice(subjectOf(rec.key, "").length);
    const a = applets.state === "ok" ? applets.found.entries.find((e) => e.noteId === id) : undefined;
    const r = grants.record(subject);
    return (
      <li key={subject} className="line">
        <span>{a ? <><span aria-hidden="true">{a.manifest.glyph}{"\uFE0E"}</span> <strong>{a.manifest.name}</strong></> : <strong>An applet no longer in the vault</strong>} <span className="quiet">in {rec.vault}{r?.grantedAt ? `, since ${day(r.grantedAt)}` : ""}</span></span>
        <button type="button" className="quiet-button" onClick={() => revoke(subject, id, a)}>Revoke</button>
        {a && (a.services.length > 0 || a.servicesError) && <AppletServices subject={subject} entry={a} />}
      </li>
    );
  })}</>;
}

/** The embeds allowed on this device, on the pages of one vault (docs/design/EMBED.md), each with Revoke. */
function EmbedsIn({ rec, onChange }: { rec: VaultRecord; onChange: () => void }) {
  const subjects = grants.subjects().map((s) => ({ s, p: embedSubjectParts(s) })).filter((x) => x.p?.hostVault === rec.key);
  return <>{subjects.map(({ s, p }) => {
    const r = grants.record(s);
    const from = listVaults().find((v) => v.key === p!.from);
    return (
      <li key={s} className="line">
        <span><strong>«{p!.name}»</strong> <span className="quiet">on a page in {rec.vault}{from && from.key !== rec.key ? `, from ${from.vault}` : ""}{r?.grantedAt ? `, since ${day(r.grantedAt)}` : ""}</span></span>
        <button type="button" className="quiet-button" onClick={() => { grants.revoke(s); onChange(); }}>Revoke</button>
      </li>
    );
  })}</>;
}

export default function AppletSettings({ vaults }: { vaults: VaultRecord[] }) {
  const mode = useGate();
  const run = useSelfTestRun();
  const [, setN] = useState(0);
  const failed = run.last?.checks.filter((c) => !c.ok) ?? [];
  return (
    <section className="card" aria-labelledby="s-applets">
      <h2 id="s-applets">Applets</h2>
      <p className="selftest-status" role="status">
        {run.running ? "Checking that applets are sealed on this device…"
          : mode === "sealed" ? "Applets run sealed here."
          : mode === "approved-code" ? "Applets run approved code only here: one runs only while its code is the code you allowed."
          : run.last ? `Applets are off on this device: the self-test failed${run.timedOut ? " (it didn't finish)" : ""}. Every note opens in the vault view.`
          : "Applets are off until the self-test has run on this device."}
      </p>
      {run.last && failed.length > 0 && mode !== "approved-code" && <ul className="check-list" aria-label="Checks that failed">{failed.map((c) => <li key={c.id} className="fail">✗ {c.label}</li>)}</ul>}
      <button type="button" className="quiet-button" disabled={run.running} onClick={runSelfTest}>Run again</button>
      <h3 className="settings-sub">Always open with</h3>
      <ul className="plain" aria-label="Defaults">{vaults.map((v) => <DefaultsIn key={v.key} rec={v} />)}</ul>
      <h3 className="settings-sub">Allowed</h3>
      <ul className="plain" aria-label="Allowed applets">{vaults.map((v) => <AllowedIn key={v.key} rec={v} onChange={() => setN((n) => n + 1)} />)}</ul>
      <h3 className="settings-sub">On your pages</h3>
      <ul className="plain" aria-label="Allowed on your pages">{vaults.map((v) => <EmbedsIn key={v.key} rec={v} onChange={() => setN((n) => n + 1)} />)}</ul>
    </section>
  );
}
