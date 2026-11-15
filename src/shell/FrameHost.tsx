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

const FRAME_DOC = frameDocument(frameKit.js, frameKit.css);

export default function FrameHost({ doc = FRAME_DOC }: { doc?: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const navRef = useRef(navigate);
  navRef.current = navigate;
  const shown = useRef(location);
  shown.current = location;
  const host = useMemo(() => createFrameHost((m) => ref.current?.contentWindow?.postMessage(m, "*"), shellDeps((to, replace) => navRef.current(to, { replace }), () => ref.current)), []);
  const sendLocation = () => {
    const l = shown.current;
    const decided = decidedFor(l.key);
    host.event("location", { pathname: l.pathname, search: l.search, hash: l.hash, key: l.key, ...(decided ? { decided } : {}) });
  };

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      // targetOrigin "*" and this check: a sandboxed srcdoc frame's origin is opaque, so its window is what identifies it
      if (e.source === null || e.source !== ref.current?.contentWindow) return;
      const d = e.data as { pf?: unknown; hello?: unknown } | null;
      if (d && typeof d === "object" && d.pf === 1 && d.hello === 1) { sendLocation(); return; }
      host.handle(e.data);
    };
    addEventListener("message", onMessage);
    const changed = (what: "vaults" | "applets" | "defaults") => () => host.event("changed", { what });
    const offs = [subscribeVaults(changed("vaults")), subscribeDefaults(changed("defaults")), subscribeApplets(changed("applets")), subscribeGate(changed("applets"))];
    return () => { removeEventListener("message", onMessage); offs.forEach((f) => f()); };
  }, [host]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(sendLocation, [location.key, location.pathname, location.search]); // eslint-disable-line react-hooks/exhaustive-deps

  return <iframe ref={ref} className="app-frame" title="Parachute" sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={doc} />;
}
