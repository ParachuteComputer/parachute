// Settings → Applets: the self-test's result (and Run again), and each applet this device has allowed, with Revoke.
import { useState } from "react";
import { PLATFORM, runSelfTest, useGate, useSelfTestRun } from "../applet/selftest/run";
import { deviceGrants, subjectOf } from "../applet/grants";
import { useApplets } from "../applet/useApplets";
import type { VaultRecord } from "../vault/store";

const grants = deviceGrants();

function AllowedIn({ rec, onChange }: { rec: VaultRecord; onChange: () => void }) {
  const applets = useApplets(rec, false);
  if (applets.state !== "ok") return null;
  const allowed = applets.found.entries.filter((a) => grants.record(subjectOf(rec.key, a.noteId)));
  return <>{allowed.map((a) => {
    const r = grants.record(subjectOf(rec.key, a.noteId));
    return (
      <li key={a.noteId} className="line">
        <span><span aria-hidden="true">{a.manifest.glyph}</span> <strong>{a.manifest.name}</strong> <span className="quiet">in {rec.vault}{r?.grantedAt ? `, allowed ${r.grantedAt.slice(0, 10)}` : ""}</span></span>
        <button type="button" className="quiet-button" onClick={() => { grants.revoke(subjectOf(rec.key, a.noteId)); onChange(); }}>Revoke</button>
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
          : mode === "sealed" ? `Applets run sealed on this device (${PLATFORM}).`
          : mode === "approved-code" ? `Applets run approved code only on this device (${PLATFORM}): an allowed applet runs only while its code is the code you allowed, because this webview can't switch WebRTC off.`
          : run.last ? `Applets are off on this device: the self-test failed${run.timedOut ? " (it didn't finish)" : ""}. Every note opens in the vault view.`
          : "Applets are off until the self-test has run on this device."}
      </p>
      {run.last && failed.length > 0 && mode !== "approved-code" && <ul className="check-list" aria-label="Checks that failed">{failed.map((c) => <li key={c.id} className="fail">✗ {c.label}</li>)}</ul>}
      <button type="button" className="quiet-button" disabled={run.running} onClick={runSelfTest}>Run again</button>
      <ul className="plain" aria-label="Allowed applets">{vaults.map((v) => <AllowedIn key={v.key} rec={v} onChange={() => setN((n) => n + 1)} />)}</ul>
    </section>
  );
}
