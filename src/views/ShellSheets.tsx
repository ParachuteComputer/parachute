// What the shell draws over a running applet, outside its frame (docs/design/KEYRING.md): the sheet a secret is typed
// on (the value never enters the frame), and the shell's own line when an approval went through on an earlier unlock.
// Every word is the app's; what comes from Uni's request is shown as Uni's.
import { useCallback, useEffect, useRef, useState } from "react";
import type { SecretView } from "../services/native";
import type { Shell } from "../services/broker";
import { onScreen } from "../shell/appDeps";

type Asking = { view: SecretView; done: (value: string | null) => void };
type Trusting = { applet: string; key: string; done: (name: string | null) => void };

/** Whether to trust a key for approvals on this device, asked by the shell (never the applet's words): which applet
 *  shows a card signed by it, the whole key, and the name the person gives it. The device unlock follows (Rust). */
function TrustSheet({ t }: { t: Trusting }) {
  const [name, setName] = useState("");
  return (
    <div className="sheet-scrim sheet-over-frames" role="presentation">
      <section className="sheet" role="dialog" aria-modal="true" aria-label="Trust a key for approvals">
        <h2>Trust a key for approvals?</h2>
        <p>{t.applet} shows a card signed by this key, which it names for approvals. Trusted, it can ask this device for approvals and secrets.</p>
        <p className="trust-key"><code>{t.key}</code></p>
        <p className="quiet">Trust it only if you know whose key this is. Uni's key is in your Parachute notes.</p>
        <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) t.done(name.trim()); }}>
          <label className="secret-field">
            <span className="quiet">Whose key is it?</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoComplete="off" placeholder="A name, as Uni" />
          </label>
          <div className="grant-actions">
            <button type="button" className="quiet-button" onClick={() => t.done(null)}>Cancel</button>
            <button type="submit" className="primary" disabled={!name.trim()}>Trust it</button>
          </div>
        </form>
      </section>
    </div>
  );
}

/** A tap in this applet now, each tap good for one call: live user activation with the focus in its own frame, and none
 *  spent in the last few seconds (an activation lasts that long, and one tap must not pay for several approvals). */
export function useTapOnce(frame: () => HTMLIFrameElement | null) {
  const spent = useRef(-Infinity);
  return useCallback(() => {
    const active = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation?.isActive === true;
    const f = frame();
    if (!active || !f || !onScreen(f) || document.activeElement !== f) return false;
    const t = performance.now();
    if (t - spent.current < 5000) return false;
    spent.current = t;
    return true;
  }, [frame]);
}

const until = (s: number) => new Date(s * 1000).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

function SecretSheet({ asking, onDone }: { asking: Asking; onDone: (v: string | null) => void }) {
  const [value, setValue] = useState("");
  const [shown, setShown] = useState(false);
  const v = asking.view;
  const send = () => { const x = value; setValue(""); onDone(x); };
  return (
    <div className="sheet-scrim sheet-over-frames" role="presentation">
      <section className="sheet secret-sheet" role="dialog" aria-modal="true" aria-label={`${v.requester} asks for a secret`}>
        <h2>{v.requester} asks for a secret</h2>
        <p><strong>{v.label}</strong></p>
        {v.purpose && <p className="quiet">{v.purpose}</p>}
        <p className="quiet">{v.requester} says it keeps it in {v.store} for {v.keep_days} {v.keep_days === 1 ? "day" : "days"}. Sealed with your approval key, only {v.requester} can open it. The applet never sees it. Asked until {until(v.expires)}.</p>
        <form onSubmit={(e) => { e.preventDefault(); if (value) send(); }}>
          <label className="secret-field">
            <span className="quiet">The secret</span>
            <input type={shown ? "text" : "password"} value={value} onChange={(e) => setValue(e.target.value)} onBlur={() => setShown(false)} autoComplete="off" autoCapitalize="off" spellCheck={false} maxLength={16384} placeholder="Paste or type it here" />
          </label>
          <div className="grant-actions">
            <button type="button" className="quiet-button" onClick={() => setShown((s) => !s)}>{shown ? "Hide" : "Show"}</button>
            <button type="button" className="quiet-button" onClick={() => { setValue(""); onDone(null); }}>Cancel</button>
            <button type="submit" className="primary" disabled={!value}>Send sealed</button>
          </div>
        </form>
      </section>
    </div>
  );
}

/** The shell's half of an applet's approvals: its tap, its secret sheet, its line. `ui` goes over the frame. */
export function useShellSheets(frame: () => HTMLIFrameElement | null) {
  const tap = useTapOnce(frame);
  const [asking, setAsking] = useState<Asking | null>(null);
  const [trusting, setTrusting] = useState<Trusting | null>(null);
  const [line, setLine] = useState<string | null>(null);
  useEffect(() => { if (!line) return; const t = setTimeout(() => setLine(null), 6000); return () => clearTimeout(t); }, [line]);
  // an open sheet answers "cancelled" when the screen goes
  const open = useRef<Asking | Trusting | null>(null);
  useEffect(() => () => { open.current?.done(null); }, []);
  const shell: Shell = {
    tap,
    secret: (view) => new Promise((done) => {
      // one at a time, and never for a screen that is hidden (kept running, shell/kept.tsx): it would wait there unseen
      const f = frame();
      if (open.current || !f || !onScreen(f)) { done(null); return; }
      const a = { view, done: (x: string | null) => { open.current = null; setAsking(null); done(x); } };
      open.current = a;
      setAsking(a);
    }),
    say: (text) => setLine(text),
    trust: ({ applet, key }) => new Promise((done) => {
      const f = frame();
      if (open.current || !f || !onScreen(f)) { done(null); return; }
      const t = { applet, key, done: (x: string | null) => { open.current = null; setTrusting(null); done(x); } };
      open.current = t;
      setTrusting(t);
    }),
  };
  const ui = <>
    {asking && <SecretSheet asking={asking} onDone={asking.done} />}
    {trusting && <TrustSheet t={trusting} />}
    {line && <p className="shell-line" role="status">{line}</p>}
  </>;
  // the screen hid (kept running, shell/kept.tsx): an open sheet answers "cancelled", as when the screen goes
  const cancel = () => { open.current?.done(null); };
  return { shell, ui, cancel };
}
