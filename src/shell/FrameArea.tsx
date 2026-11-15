// What shows on the frame's addresses: the frame this device runs now (frameSource.ts), or its card. The person's
// frame is read again each time the frame area is shown, so a change made by them or their agent is seen at the next
// return, not by polling. Over a frame from a vault the shell keeps two things of its own: a way to Settings (whatever
// that frame draws), and the question before it opens an address outside the app.
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { answerLinkOut, LINK_OUT_HOLD_MS, frameCode, frameFailed, frameHidden, frameShown, readFrameRecord, useFrameSource } from "./frameSource";
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
  // a frame from a vault is marked while it is shown in the foreground, and unmarked when it is left, hidden or closed
  // (a page it hangs can't do that): if it hangs the app, the next start knows
  useEffect(() => {
    if (ready?.from !== "vault") return;
    const hash = ready.hash;
    const seen = () => (document.visibilityState === "hidden" ? frameHidden(hash) : frameShown(hash));
    const left = () => frameHidden(hash);
    seen();
    document.addEventListener("visibilitychange", seen);
    addEventListener("pagehide", left);
    return () => { document.removeEventListener("visibilitychange", seen); removeEventListener("pagehide", left); frameHidden(hash); answerLinkOut(false); };
  }, [ready?.hash, ready?.from]);
  if ("card" in choice) return <FrameCard {...choice.card} />;
  if (!ready) return null;
  const vault = ready.from === "vault";
  return (
    <>
      <FrameHost key={ready.hash} js={ready.js} from={ready.from}
        onFailed={(why, persist) => { if (vault) frameFailed(ready.hash, why, persist); }} />
      {vault && <Link className="shell-settings" to="/settings" aria-label="Settings (the app's own)">◠</Link>}
      {linkOut !== null && <LinkOutQuestion key={linkOut} url={linkOut} />}
    </>
  );
}

/**
 * The shell's question before a frame of the person's opens an address outside the app: the whole address, Cancel
 * focused (so the frame no longer holds the focus a tap needs), Escape cancels. Open counts only for a tap that began
 * LINK_OUT_HOLD_MS after the question was painted, judged by the tap's own time: a double tap's second tap can't
 * answer it, even when the frame held the page up between the two taps.
 */
function LinkOutQuestion({ url }: { url: string }) {
  const paintedAt = useRef(Infinity), downAt = useRef(-Infinity), keyAt = useRef(Infinity);
  const cancel = useRef<HTMLButtonElement>(null);
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    cancel.current?.focus();
    let id = requestAnimationFrame(() => { id = requestAnimationFrame(() => { paintedAt.current = performance.now(); }); });
    const t = window.setTimeout(() => setArmed(true), LINK_OUT_HOLD_MS + 50);
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") answerLinkOut(false); };
    addEventListener("keydown", esc);
    return () => { cancelAnimationFrame(id); window.clearTimeout(t); removeEventListener("keydown", esc); };
  }, []);
  const open = (e: React.MouseEvent) => {
    // a click from the keyboard has no pointer: it began when its key went down (Space clicks on release)
    const began = e.detail === 0 ? Math.min(e.timeStamp, keyAt.current) : downAt.current;
    if (e.isTrusted && began - paintedAt.current >= LINK_OUT_HOLD_MS) answerLinkOut(true);
  };
  return (
    <div className="sheet-scrim">
      <section className="sheet" role="dialog" aria-modal="true" aria-label="Open outside Parachute">
        <h2>Open this outside Parachute?</h2>
        <p>Your frame asks to open this address:</p>
        <p className="link-raw link-whole"><code>{url}</code></p>
        <div className="grant-actions">
          <button ref={cancel} type="button" className="quiet-button" onClick={() => answerLinkOut(false)}>Cancel</button>
          <button type="button" className="primary" aria-disabled={!armed} onPointerDown={(e) => { downAt.current = e.timeStamp; }} onKeyDown={(e) => {
            if (e.key !== "Enter" && e.key !== " ") return;
            // a fresh press on Open is when it began; a key already held when it reached Open (only repeats here) counts
            // as begun before anything: it can't open until a fresh press
            if (!e.repeat) keyAt.current = e.timeStamp; else if (keyAt.current === Infinity) keyAt.current = -Infinity;
          }} onClick={open}>Open</button>
        </div>
      </section>
    </div>
  );
}
