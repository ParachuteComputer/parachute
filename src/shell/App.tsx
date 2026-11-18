// The shell: the trusted part of the app. It holds the sign-ins and their tokens, the applets' grants and their card,
// the self-test and the screens that use them (adding a vault, an applet's screen, Settings, a link from outside).
// Everything else (the vault list, a vault, a note, open-with) is the frame (src/frame), which runs sealed in
// FrameHost and reaches the shell only through the bridge (src/bridge/protocol.ts).
import { useEffect, useState } from "react";
import { BrowserRouter, Route, Routes, useLocation, useNavigate } from "react-router";
import AddParachute from "../views/AddParachute";
import OAuthCallback from "../views/OAuthCallback";
import OpenLink, { LinksIn } from "../links/LinksIn";
import AppletScreen from "../views/AppletScreen";
import Settings from "../views/Settings";
import { SelfTestRunner } from "../applet/selftest/run";
import { arrived, installTapListener } from "../open/mark";
import { useVaults } from "../vault/hooks";
import { listVaults } from "../vault/store";
import FrameArea from "./FrameArea";
import KeyStart from "../key/KeyStart";
import Pair from "../key/Pair";
import { keysHere, useKey } from "../key/key";
import BottomBar from "./BottomBar";
import { keptId, KeptApplets } from "./kept";
import { atFirstEntry } from "../ui/history";
import { startPlace } from "./start";
import { readSettings } from "./homeSettings";
import { homeVault, useFrameSource } from "./frameSource";
import { readTheme, watchTheme } from "../theme/store";

/** The one listener for real taps on the shell's own links, and the rule that a tap's mark is gone once the person moves on. */
function Taps() {
  const location = useLocation();
  useEffect(() => installTapListener(), []);
  // notifications while the app is closed follow the grants (services/notify.ts): sent at start, on every change, and
  // when the app comes back to the front
  useEffect(() => {
    let off = () => {};
    let gone = false;
    void import("../services/notify").then(async ({ syncNotify }) => {
      const { deviceGrants } = await import("../applet/grants");
      if (gone) return;
      void syncNotify();
      const offGrants = deviceGrants().onChange(() => { void syncNotify(); });
      // back in front: the push distributor may have given a new endpoint meanwhile (notify.rs keeps what is unchanged)
      const back = () => { if (document.visibilityState === "visible") void syncNotify(); };
      document.addEventListener("visibilitychange", back);
      off = () => { offGrants(); document.removeEventListener("visibilitychange", back); };
    });
    return () => { gone = true; off(); };
  }, []);
  useEffect(() => { arrived(location.pathname); }, [location.pathname]);
  return null;
}

/** The person's look: their theme record, read once and then followed live while the app runs (src/theme/store.ts). */
function ThemeWatch() {
  useFrameSource(); // a change of home vault (Settings) is told there
  const home = homeVault(useVaults())?.key ?? null;
  useEffect(() => { if (!home) return; void readTheme(); return watchTheme(); }, [home]);
  return null;
}

/** An applet address that hands it a note (?note=, ?screen=): one screen per history entry, a new screen with nothing
 *  carried over, so it starts only if a tap led to it. An applet's own address is a kept screen (kept.tsx). */
function AppletRoute() {
  const location = useLocation();
  return <AppletScreen key={location.key} />;
}

/** The first screen, before any vault: getting a key when the device has none (in the app), else adding a vault. */
function FirstRun() {
  const key = useKey();
  if (key === undefined) return null;
  return keysHere() && key === null ? <KeyStart first /> : <AddParachute first />;
}

/** Where the app opens (start.ts): at a start on the launcher (the first entry of this tab's history), the home applet
 *  if the person has one. Nothing is drawn until that is decided, so the launcher never shows and then gives way. */
function useStart(): boolean {
  const location = useLocation();
  const navigate = useNavigate();
  const [decided, setDecided] = useState(() => !(location.pathname === "/" && atFirstEntry() && listVaults().length > 0));
  useEffect(() => {
    if (decided) { if (listVaults().length) void readSettings(); return; }
    let on = true;
    void startPlace().then((to) => {
      if (!on) return;
      // only from where the app started: a link from outside that arrived meanwhile wins
      if (to && window.location.pathname === "/") { to.go(); navigate(to.href, { replace: true }); }
      setDecided(true);
    }, () => { if (on) setDecided(true); });
    return () => { on = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return decided;
}

/** The addresses the bar is at the foot of: the frame's, an applet's, Settings. */
const withBar = (path: string, shell: boolean) => !shell || /^\/v\/[^/]+\/a\/[^/]+$/.test(path) || path === "/settings";

/** The shell's own screens; on any other address the frame shows. */
function ShellRoutes() {
  const location = useLocation();
  const vaults = useVaults();
  const decided = useStart();
  const shell = /^\/(add|oauth\/callback|settings|open-link|key|key\/pair)$/.test(location.pathname) || /^\/v\/[^/]+\/a\/[^/]+$/.test(location.pathname)
    || (location.pathname === "/" && !vaults.length);
  if (!decided) return null;
  const bar = withBar(location.pathname, shell) && vaults.length > 0;
  const own = keptId(location) !== null;
  return (
    <div className={bar ? "with-bar" : undefined}>
      {shell && <Routes>
        <Route path="/" element={<FirstRun />} />
        <Route path="/add" element={<AddParachute />} />
        <Route path="/key" element={<KeyStart />} />
        <Route path="/key/pair" element={<Pair />} />
        <Route path="/oauth/callback" element={<OAuthCallback />} />
        <Route path="/v/:vault/a/:applet" element={own ? null : <AppletRoute />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/open-link" element={<OpenLink />} />
      </Routes>}
      {/* the frame exists only while it is shown: hidden, it would keep its bridge (and a tap on a shell screen would
          count for it), and at boot it would learn the shell's address (a sign-in's return carries its code there) */}
      {!shell && <FrameArea />}
      {/* applets at their own address, and the ones kept running while hidden (kept.tsx), whatever is shown */}
      {vaults.length > 0 && <KeptApplets active={own} />}
      {bar && <BottomBar />}
    </div>
  );
}

export function AppRoutes() {
  return (
    <>
      <Taps />
      <ThemeWatch />
      <SelfTestRunner />
      <LinksIn />
      <ShellRoutes />
    </>
  );
}

export default function App() {
  return <BrowserRouter><AppRoutes /></BrowserRouter>;
}
