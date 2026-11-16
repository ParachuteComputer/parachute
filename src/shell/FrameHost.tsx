// The frame, as the shell holds it: one sealed iframe (frameDoc.ts), there only while one of the frame's addresses is
// shown; a shell screen (an applet, Settings, signing in) removes it, and coming back starts it afresh, its reads new.
// Only messages from its own window are read. The shell sends it each address it should show, and tells it when vaults,
// applets or the person's choices change.
import { useEffect, useMemo, useRef } from "react";
import { useLocation, useNavigate } from "react-router";
import frameKit from "virtual:frame-kit";
import { createFrameHost } from "./frameHost";
import { decidedFor, shellDeps } from "./frameDeps";
import { frameDocument } from "./frameDoc";
import { subscribeVaults } from "../vault/store";
import { subscribeDefaults } from "../open/defaults";
import { subscribeApplets } from "../applet/useApplets";
import { subscribeGate } from "../applet/selftest/run";
import { subscribeSettings } from "./homeSettings";
import { homeNow } from "./frameDeps";
import { subscribeTheme, tokensNow } from "../theme/store";
import { cssOf } from "../theme/theme";

/** How long a frame from a vault has to say it is listening before the built-in one takes its place. */
const WATCHDOG_MS = 10_000;

export default function FrameHost({ js, from, onFailed }: { js: string; from: "built-in" | "vault"; onFailed: (why: string, persist: boolean) => void }) {
  // the look as it is when the frame starts; each later change is a `theme` event
  const doc = useMemo(() => frameDocument(frameKit.js, frameKit.css, js, cssOf(tokensNow())), [js]);
  const failedRef = useRef(onFailed);
  failedRef.current = onFailed;
  const heard = useRef(false);
  const ref = useRef<HTMLIFrameElement>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const navRef = useRef(navigate);
  navRef.current = navigate;
  const shown = useRef(location);
  shown.current = location;
  const host = useMemo(() => createFrameHost((m) => ref.current?.contentWindow?.postMessage(m, "*"), shellDeps((to, replace) => navRef.current(to, { replace }), () => ref.current, from)), []); // eslint-disable-line react-hooks/exhaustive-deps
  const sendLocation = () => {
    const l = shown.current;
    const decided = decidedFor(l.key);
    host.event("location", { pathname: l.pathname, search: l.search, hash: l.hash, key: l.key, ...(decided ? { decided } : {}) });
  };

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      // targetOrigin "*" and this check: a sandboxed srcdoc frame's origin is opaque, so its window is what identifies it
      if (e.source === null || e.source !== ref.current?.contentWindow) return;
      const d = e.data as { pf?: unknown; hello?: unknown; failed?: unknown } | null;
      if (d && typeof d === "object" && d.pf === 1 && d.hello === 1) { heard.current = true; sendLocation(); return; }
      if (d && typeof d === "object" && d.pf === 1 && typeof d.failed === "string") { failedRef.current(d.failed.slice(0, 300), true); return; }
      host.handle(e.data);
    };
    addEventListener("message", onMessage);
    const changed = (what: "vaults" | "applets" | "defaults" | "home") => () => host.event("changed", { what });
    // the bar and the home: told only when what the frame would read of them changed (the settings store moves often)
    let homeWas = JSON.stringify(homeNow());
    const homeChanged = () => { const now = JSON.stringify(homeNow()); if (now !== homeWas) { homeWas = now; host.event("changed", { what: "home" }); } };
    let themeWas = JSON.stringify(tokensNow());
    const themeChanged = () => { const t = tokensNow(), now = JSON.stringify(t); if (now !== themeWas) { themeWas = now; host.event("theme", t); } };
    const offs = [subscribeTheme(themeChanged), subscribeVaults(changed("vaults")), subscribeDefaults(changed("defaults")), subscribeApplets(changed("applets")), subscribeGate(changed("applets")), subscribeSettings(homeChanged)];
    // a frame from a vault that never starts (or never listens) gives way to the built-in one
    const watchdog = from === "vault" ? window.setTimeout(() => { if (!heard.current) failedRef.current("it didn't start in time", false); }, WATCHDOG_MS) : 0;
    return () => { removeEventListener("message", onMessage); offs.forEach((f) => f()); window.clearTimeout(watchdog); };
  }, [host]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(sendLocation, [location.key, location.pathname, location.search]); // eslint-disable-line react-hooks/exhaustive-deps

  return <iframe ref={ref} className="app-frame" data-frame={from} title="Parachute" sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={doc} />;
}
