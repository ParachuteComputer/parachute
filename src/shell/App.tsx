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
import FrameHost from "./FrameHost";

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

/** The shell's own screens; on any other address the frame shows. */
function ShellRoutes() {
  const location = useLocation();
  const vaults = useVaults();
  const shell = /^\/(add|oauth\/callback|settings|open-link)$/.test(location.pathname) || /^\/v\/[^/]+\/a\/[^/]+$/.test(location.pathname)
    || (location.pathname === "/" && !vaults.length);
  return (
    <>
      {shell && <Routes>
        <Route path="/" element={<AddVault first />} />
        <Route path="/add" element={<AddVault />} />
        <Route path="/oauth/callback" element={<OAuthCallback />} />
        <Route path="/v/:vault/a/:applet" element={<AppletRoute />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/open-link" element={<OpenLink />} />
      </Routes>}
      <FrameHost visible={!shell} />
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
