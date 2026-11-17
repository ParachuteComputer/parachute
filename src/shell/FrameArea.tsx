// What shows on the frame's addresses: the frame this device runs now (frameSource.ts), or its card. The person's
// frame is read again each time the frame area is shown, so a change made by them or their agent is seen at the next
// return, not by polling. Over a frame from a vault the shell keeps two things of its own: a way to Settings (whatever
// that frame draws: a place at the end of the bar, BottomBar.tsx), and the question before it opens an address outside
// the app.
import { useSettledPress } from "../ui/press";
import { useEffect, useRef, useState } from "react";
import { answerLinkOut, type WriteAsk, LINK_OUT_HOLD_MS, frameCode, frameFailed, frameHidden, frameShown, readFrameRecord, useFrameSource } from "./frameSource";
import FrameHost from "./FrameHost";
import FrameCard from "./FrameCard";
import { readSettings } from "./homeSettings";
import { readTheme } from "../theme/store";

type Code = { js: string; hash: string; from: "built-in" | "vault" };

export default function FrameArea() {
  const { choice, linkOut, writeAsk } = useFrameSource();
  const [code, setCode] = useState<Code | null>(null);
  // the person's frame, settings and theme notes, read again each time the frame area is shown (the theme is also
  // followed live; this is for when the live query is down)
  useEffect(() => { void readFrameRecord(); void readSettings(); void readTheme(); }, []);
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
      {linkOut !== null && <LinkOutQuestion key={linkOut} url={linkOut} />}
      {writeAsk !== null && <WriteQuestion key={writeAsk.title} q={writeAsk} />}
    </>
  );
}

/**
 * The shell's question before a frame of the person's opens an address outside the app: the whole address, Cancel
 * focused (so the frame no longer holds the focus a tap needs), Escape cancels. Open counts only for a tap that began
 * LINK_OUT_HOLD_MS after the question was painted, judged by the tap's own time: a double tap's second tap can't
 * answer it, even when the frame held the page up between the two taps.
 */
/** The shell's question before a frame of the person's writes into their vault: the same sheet and timing as a link out. */
function WriteQuestion({ q }: { q: WriteAsk }) {
  const cancel = useRef<HTMLButtonElement>(null);
  const press = useSettledPress(LINK_OUT_HOLD_MS);
  useEffect(() => { cancel.current?.focus(); const esc = (e: KeyboardEvent) => { if (e.key === "Escape") answerLinkOut(false); }; addEventListener("keydown", esc); return () => removeEventListener("keydown", esc); }, []);
  return (
    <div className="sheet-scrim">
      <section className="sheet" role="dialog" aria-modal="true" aria-label={q.title}>
        <h2>{q.title}</h2>
        <p>{q.body}</p>
        <div className="grant-actions">
          <button ref={cancel} type="button" className="quiet-button" onClick={() => answerLinkOut(false)}>Cancel</button>
          <button type="button" className="primary" {...press.bind} onClick={(e) => { if (press.counts(e)) answerLinkOut(true); }}>{q.act}</button>
        </div>
      </section>
    </div>
  );
}

function LinkOutQuestion({ url }: { url: string }) {
  const cancel = useRef<HTMLButtonElement>(null);
  const press = useSettledPress(LINK_OUT_HOLD_MS);
  useEffect(() => {
    cancel.current?.focus();
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") answerLinkOut(false); };
    addEventListener("keydown", esc);
    return () => removeEventListener("keydown", esc);
  }, []);
  return (
    <div className="sheet-scrim">
      <section className="sheet" role="dialog" aria-modal="true" aria-label="Open outside Parachute">
        <h2>Open this outside Parachute?</h2>
        <p>Your frame asks to open this address:</p>
        <p className="link-raw link-whole"><code>{url}</code></p>
        <div className="grant-actions">
          <button ref={cancel} type="button" className="quiet-button" onClick={() => answerLinkOut(false)}>Cancel</button>
          <button type="button" className="primary" {...press.bind} onClick={(e) => { if (press.counts(e)) answerLinkOut(true); }}>Open</button>
        </div>
      </section>
    </div>
  );
}
