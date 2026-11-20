// The shell's half of the security levels (shell/levels.ts; the gate is src-tauri/src/levels.rs): the open app's record
// raises this device's levels as soon as it is read, and the idle lock covers everything until the device unlock.
//
// The idle clock is native. The web side tells it of real touches only: the shell's own input (trusted events), and an
// applet's or the frame's message while the browser says the person is acting (user activation reaches the shell's
// window from any frame, and a page can't make it up). On Android the activity reports every touch itself, scrolling
// inside a frame included. Nothing polls: one timer runs to the moment the lock would engage, and the app coming back
// to the front asks again.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { nativeNow, type Native } from "../services/native";
import { homeVault } from "./frameSource";
import { useSettings } from "./homeSettings";
import { liveSyncDeps, onLevels, syncLevels, type LevelsStatus } from "./levels";

const TOUCH_EVERY_MS = 30_000;
const said = (e: unknown) => (e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : String(e));

/** Raise this device to what the open app's record asks (and take a lowering only with the person's signed approval). */
function LevelsSync({ native }: { native: Native }) {
  const { app, read } = useSettings();
  const key = `${app.id}|${JSON.stringify(app.security)}|${read}`;
  useEffect(() => {
    if (read !== "read") return;
    void syncLevels(app, homeVault(), liveSyncDeps(native)).catch(() => undefined);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

function IdleLock({ native }: { native: Native }) {
  const [status, setStatus] = useState<LevelsStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const sent = useRef(-Infinity);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const later = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let on = true;
    const take = (s: LevelsStatus) => {
      if (!on) return;
      setStatus(s);
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      // one timer, to the moment it would lock with no touch (and a little after, so the check finds it past)
      if (!s.locked && s.left_ms !== null) timer.current = setTimeout(() => void native.levelsStatus().then(take, () => undefined), s.left_ms + 250);
    };
    const ask = () => void native.levelsStatus().then(take, () => undefined);
    // at most one report each TOUCH_EVERY_MS: the first touch at once (a quiet time past the lock is caught then),
    // and the last one within the window when it ends, so the lock counts from the latest touch, not the first
    const send = () => { later.current = null; sent.current = performance.now(); void native.idleTouch().then(take, () => undefined); };
    const touch = () => {
      const wait = sent.current + TOUCH_EVERY_MS - performance.now();
      if (wait <= 0) send();
      else later.current ??= setTimeout(send, wait);
    };
    const onInput = (e: Event) => { if (e.isTrusted) touch(); };
    // a frame's message while the person is acting (an applet saving what they type, opening, answering)
    const onMessage = (e: MessageEvent) => {
      if (e.source === null || e.source === window) return;
      if ((navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation?.isActive) touch();
    };
    const onVisible = () => { if (document.visibilityState === "visible") { sent.current = -Infinity; ask(); } };
    ask();
    const opts = { capture: true, passive: true } as const;
    for (const t of ["pointerdown", "keydown", "wheel", "touchstart"]) window.addEventListener(t, onInput, opts);
    window.addEventListener("message", onMessage);
    document.addEventListener("visibilitychange", onVisible);
    const offLevels = onLevels(ask);
    return () => {
      offLevels();
      on = false;
      if (timer.current) clearTimeout(timer.current);
      if (later.current) clearTimeout(later.current);
      for (const t of ["pointerdown", "keydown", "wheel", "touchstart"]) window.removeEventListener(t, onInput, opts);
      window.removeEventListener("message", onMessage);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [native]);

  const locked = status?.locked === true;
  // locked: the app under the cover takes no input and no focus
  useEffect(() => {
    const root = document.getElementById("root");
    if (!root) return;
    if (locked) { root.setAttribute("inert", ""); (document.activeElement as HTMLElement | null)?.blur?.(); } else root.removeAttribute("inert");
    return () => root.removeAttribute("inert");
  }, [locked]);

  if (!locked || !status) return null;
  const unlock = () => {
    setError(null);
    setAsking(true);
    native.idleUnlock().then((s) => { setAsking(false); setStatus(s); }, (e: unknown) => { setAsking(false); setError(said(e)); });
  };
  const min = status.levels.idle;
  return createPortal(
    <div className="idle-lock" role="dialog" aria-modal="true" aria-label="Parachute is locked">
      <div className="idle-lock-inner">
        <p className="idle-lock-glyph" aria-hidden="true">⁂</p>
        <h1>Parachute is locked</h1>
        <p className="quiet">Untouched for {min === 1 ? "a minute" : min < 60 ? `${min} minutes` : min === 60 ? "an hour" : `${Math.round(min / 60)} hours`}.</p>
        <button type="button" className="primary" onClick={unlock} disabled={asking} autoFocus>Unlock</button>
        {error && <p className="error" role="alert">{error}</p>}
      </div>
    </div>,
    document.body,
  );
}

/** Mounted once, in the shell. Nothing on a device without the native side (a browser tab has no unlock to ask). */
export default function Security() {
  const [native, setNative] = useState<Native | null>(null);
  useEffect(() => { void nativeNow().then(setNative); }, []);
  if (!native) return null;
  return <><LevelsSync native={native} /><IdleLock native={native} /></>;
}
