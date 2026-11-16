// The shell: the trusted part of the app. It holds the sign-ins and their tokens, the applets' grants and their card,
// the self-test and the screens that use them (adding a vault, an applet's screen, Settings, a link from outside).
// Everything else (the vault list, a vault, a note, open-with) is the frame (src/frame), which runs sealed in
// FrameHost and reaches the shell only through the bridge (src/bridge/protocol.ts).
import { useEffect } from "react";
import { BrowserRouter, Route, Routes, useLocation } from "react-router";
import AddVault from "../views/AddVault";
import OAuthCallback from "../views/OAuthCallback";
import OpenLink, { LinksIn } from "../links/LinksIn";
import AppletScreen from "../views/AppletScreen";
import Settings from "../views/Settings";
import { SelfTestRunner } from "../applet/selftest/run";
import { arrived, installTapListener } from "../open/mark";
import { useVaults } from "../vault/hooks";
import FrameArea from "./FrameArea";
import KeyStart from "../key/KeyStart";
import Pair from "../key/Pair";
import { keysHere, useKey } from "../key/key";

/** The one listener for real taps on the shell's own links, and the rule that a tap's mark is gone once the person moves on. */
function Taps() {
  const location = useLocation();
  useEffect(() => installTapListener(), []);
  useEffect(() => { arrived(location.pathname); }, [location.pathname]);
  return null;
}

/** One applet screen per history entry: a move from one applet address to another (a link from outside while an
 *  applet runs) is a new screen with nothing carried over, so it starts only if a tap led to it. */
function AppletRoute() {
  const location = useLocation();
  return <AppletScreen key={location.key} />;
}

/** The first screen, before any vault: getting a key when the device has none (in the app), else adding a vault. */
function FirstRun() {
  const key = useKey();
  if (key === undefined) return null;
  return keysHere() && key === null ? <KeyStart first /> : <AddVault first />;
}

/** The shell's own screens; on any other address the frame shows. */
function ShellRoutes() {
  const location = useLocation();
  const vaults = useVaults();
  const shell = /^\/(add|oauth\/callback|settings|open-link|key|key\/pair)$/.test(location.pathname) || /^\/v\/[^/]+\/a\/[^/]+$/.test(location.pathname)
    || (location.pathname === "/" && !vaults.length);
  return (
    <>
      {shell && <Routes>
        <Route path="/" element={<FirstRun />} />
        <Route path="/add" element={<AddVault />} />
        <Route path="/key" element={<KeyStart />} />
        <Route path="/key/pair" element={<Pair />} />
        <Route path="/oauth/callback" element={<OAuthCallback />} />
        <Route path="/v/:vault/a/:applet" element={<AppletRoute />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/open-link" element={<OpenLink />} />
      </Routes>}
      {/* the frame exists only while it is shown: hidden, it would keep its bridge (and a tap on a shell screen would
          count for it), and at boot it would learn the shell's address (a sign-in's return carries its code there) */}
      {!shell && <FrameArea />}
    </>
  );
}

export function AppRoutes() {
  return (
    <>
      <Taps />
      <SelfTestRunner />
      <LinksIn />
      <ShellRoutes />
    </>
  );
}

export default function App() {
  return <BrowserRouter><AppRoutes /></BrowserRouter>;
}
