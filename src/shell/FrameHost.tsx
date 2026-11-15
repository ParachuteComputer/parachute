// The frame, as the shell holds it: one sealed iframe (frameDoc.ts) that stays mounted for the whole session, shown on
// the frame's addresses and hidden while a shell screen (an applet, Settings, signing in) is up. Only messages from its
// own window are read. The shell sends it each address it should show, and tells it when vaults, applets or the
// person's choices change.
import { useEffect, useMemo, useRef } from "react";
import { useLocation, useNavigate } from "react-router";
import frameKit from "virtual:frame-kit";
import { createFrameHost } from "./frameHost";
import { shellDeps } from "./frameDeps";
import { frameDocument } from "./frameDoc";
import { subscribeVaults } from "../vault/store";
import { subscribeDefaults } from "../open/defaults";
import { subscribeApplets } from "../applet/useApplets";
import { subscribeGate } from "../applet/selftest/run";

const FRAME_DOC = frameDocument(frameKit.js, frameKit.css);

export default function FrameHost({ visible, doc = FRAME_DOC }: { visible: boolean; doc?: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const navRef = useRef(navigate);
  navRef.current = navigate;
  const shown = useRef({ visible, location });
  shown.current = { visible, location };
  const host = useMemo(() => createFrameHost((m) => ref.current?.contentWindow?.postMessage(m, "*"), shellDeps((to, replace) => navRef.current(to, { replace }))), []);
  const sendLocation = () => {
    const { visible: v, location: l } = shown.current;
    if (v) host.event("location", { pathname: l.pathname, search: l.search, hash: l.hash, key: l.key });
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

  useEffect(sendLocation, [location.key, location.pathname, location.search, visible]); // eslint-disable-line react-hooks/exhaustive-deps

  return <iframe ref={ref} className="app-frame" hidden={!visible} title="Parachute" sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={doc} />;
}
