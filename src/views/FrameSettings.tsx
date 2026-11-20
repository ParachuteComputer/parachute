// Settings → Frame: which frame runs (the home vault is chosen under Your bundle), and the person's ways to change that: "Make this mine"
// (copy the built-in frame into the home vault), looking at their frame again, going back to the built-in one, and a
// newer built-in frame when one is on offer (never written over theirs without their tap).
import { useEffect, useState } from "react";
import { useVaults } from "../vault/hooks";
import { askAgain, useBuiltIn, homeVault, keepMine, makeThisMine, readFrameRecord, takeNewDefault, useFrameSource } from "../shell/frameSource";

const WHY: Record<string, string> = {
  "no-home": "The built-in frame runs.",
  gate: "The built-in frame runs: a frame from your vault runs only once the self-test has passed on this device.",
  "no-record": "The built-in frame runs. Make it yours to change it, or ask your agent to.",
  many: "The built-in frame runs: your home vault holds more than one note tagged parachute-frame. Keep one.",
  bad: "The built-in frame runs: your frame's note couldn't be read.",
  declined: "The built-in frame runs: you chose it over your frame.",
  unreachable: "The built-in frame runs: your home vault can't be reached, and this device has no copy of your frame yet.",
  waiting: "Looking for your frame…",
  ask: "Your frame is waiting for you to allow it.",
};

export default function FrameSettings() {
  const vaults = useVaults();
  const fs = useFrameSource();
  const home = homeVault(vaults);
  const [busy, setBusy] = useState(false);
  // read when shown, as the frame area does: what an agent changed is seen here too
  useEffect(() => { void readFrameRecord(); }, [home?.key]);
  const [error, setError] = useState<string | null>(null);
  const act = (f: () => Promise<void> | void) => async () => { setBusy(true); setError(null); try { await f(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } };
  const found = fs.read?.state === "found" ? fs.read : null;
  const status = fs.choice.run === "vault" ? `Your frame runs: ${found?.path ?? "the copy this device keeps"}.`
    : fs.choice.why === "failed" ? "The built-in frame runs: your frame stopped." : WHY[fs.choice.why];
  return (
    <section className="card" aria-labelledby="s-frame">
      <h2 id="s-frame">Frame</h2>
      {!home && vaults.length > 0 && <p className="quiet">No home vault: none of your vaults is marked as yours.</p>}
      <p role="status" className="frame-status">{status}</p>
      {fs.choice.run === "built-in" && fs.choice.why === "failed" && fs.failedWhy && <p className="quiet">It said: <q data-untrusted="true">{fs.failedWhy}</q></p>}
      {home && fs.read?.state === "none" && (
        <button type="button" className="quiet-button" disabled={busy} onClick={act(makeThisMine)}>Make this mine</button>
      )}
      {found && fs.choice.run === "vault" && <button type="button" className="quiet-button" disabled={busy} onClick={() => useBuiltIn()}>Use the built-in frame</button>}
      {found && fs.choice.run === "built-in" && (fs.choice.why === "declined" || fs.choice.why === "failed") && (
        <button type="button" className="quiet-button" disabled={busy} onClick={act(async () => { askAgain(); await readFrameRecord(); })}>Look at my frame again</button>
      )}
      {fs.proposal && fs.defaultHash && (
        <div className="notice" role="status">
          <p>A newer built-in frame is available. Taking it replaces your frame's code; yours is kept beside it, as a note of its own.</p>
          <button type="button" className="quiet-button" disabled={busy} onClick={act(takeNewDefault)}>Use the new built-in frame</button>{" "}
          <button type="button" className="quiet-button" disabled={busy} onClick={() => keepMine(fs.defaultHash!)}>Keep mine</button>
        </div>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
