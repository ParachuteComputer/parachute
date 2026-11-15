// What shows on the frame's addresses: the frame this device runs now (frameSource.ts), or its card. The person's
// frame is read again each time the frame area is shown, so a change made by them or their agent is seen at the next
// return, not by polling. Over a frame from a vault the shell keeps two things of its own: a way to Settings (whatever
// that frame draws), and the question before it opens an address outside the app.
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { answerLinkOut, frameCode, frameFailed, frameStarted, frameStarting, readFrameRecord, STARTED_MS, useFrameSource } from "./frameSource";
import FrameHost from "./FrameHost";
import FrameCard from "./FrameCard";

type Code = { js: string; hash: string; from: "built-in" | "vault" };

export default function FrameArea() {
  const { choice, linkOut } = useFrameSource();
  const [code, setCode] = useState<Code | null>(null);
  useEffect(() => { void readFrameRecord(); }, []);
  const want = choice.run === "vault" ? `vault:${choice.hash}` : "built-in";
  useEffect(() => {
    let on = true;
    void frameCode(choice).then((r) => {
      if (!on) return;
      if ("error" in r) { if (choice.run === "vault") frameFailed(choice.hash, r.error); return; }
      setCode(r);
    });
    return () => { on = false; };
  }, [want]); // eslint-disable-line react-hooks/exhaustive-deps
  const ready = code && (code.from === "vault" ? `vault:${code.hash}` : "built-in") === want ? code : null;
  // a frame from a vault is marked as starting until it has run a while, or the page is left normally (a hung page
  // can't run its pagehide): if it hangs the app, the next start knows
  useEffect(() => {
    if (ready?.from !== "vault") return;
    const hash = ready.hash;
    frameStarting(hash);
    const left = () => frameStarted(hash);
    addEventListener("pagehide", left);
    return () => removeEventListener("pagehide", left);
  }, [ready?.hash, ready?.from]);
  if ("card" in choice) return <FrameCard {...choice.card} />;
  if (!ready) return null;
  const vault = ready.from === "vault";
  return (
    <>
      <FrameHost key={ready.hash} js={ready.js} from={ready.from}
        onStarted={() => { if (vault) window.setTimeout(() => frameStarted(ready.hash), STARTED_MS); }}
        onFailed={(why) => { if (vault) frameFailed(ready.hash, why); }} />
      {vault && <Link className="shell-settings" to="/settings" aria-label="Settings (the app's own)">◠</Link>}
      {linkOut !== null && (
        <div className="sheet-scrim">
          <section className="sheet" role="dialog" aria-modal="true" aria-label="Open outside Parachute">
            <h2>Open this outside Parachute?</h2>
            <p>Your frame asks to open:</p>
            <p className="link-raw"><code>{linkOut.slice(0, 600)}{linkOut.length > 600 ? "…" : ""}</code></p>
            <div className="grant-actions">
              <button type="button" className="quiet-button" onClick={() => answerLinkOut(false)}>Cancel</button>
              <button type="button" className="primary" onClick={(e) => { if (e.isTrusted) answerLinkOut(true); }}>Open</button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
