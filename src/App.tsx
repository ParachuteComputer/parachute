import { useEffect } from "react";
import { BrowserRouter, Route, Routes, useLocation } from "react-router";
import Home from "./views/Home";
import AddVault from "./views/AddVault";
import OAuthCallback from "./views/OAuthCallback";
import VaultView from "./views/VaultView";
import NoteRoute from "./views/NoteRoute";
import Sheet from "./open/Sheet";
import { installLongPress } from "./open/sheet";
import AppletScreen from "./views/AppletScreen";
import Settings from "./views/Settings";
import { SelfTestRunner } from "./applet/selftest/run";
import { arrived, installTapListener } from "./open/mark";

/** The one listener for real taps on links inside the app, and the rule that a tap's mark is gone once the person moves on. */
function Taps() {
  const location = useLocation();
  useEffect(() => installTapListener(), []);
  useEffect(() => installLongPress(), []);
  useEffect(() => { arrived(location.pathname); }, [location.pathname]);
  return null;
}

/** One applet screen per history entry: a move from one applet address to another (a link from outside while an
 *  applet runs) is a new screen with nothing carried over, so it starts only if a tap led to it. */
function AppletRoute() {
  const location = useLocation();
  return <AppletScreen key={location.key} />;
}

/** One note route per history entry, as for applets: nothing decided for one note carries to the next. */
function NoteRouteKeyed() {
  const location = useLocation();
  return <NoteRoute key={location.key} />;
}

export function AppRoutes() {
  return (
    <>
      <Taps />
      <SelfTestRunner />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/add" element={<AddVault />} />
        <Route path="/oauth/callback" element={<OAuthCallback />} />
        <Route path="/v/:vault" element={<VaultView />} />
        <Route path="/v/:vault/n/:id" element={<NoteRouteKeyed />} />
        <Route path="/v/:vault/a/:applet" element={<AppletRoute />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Home />} />
      </Routes>
      <Sheet />
    </>
  );
}

export default function App() {
  return <BrowserRouter><AppRoutes /></BrowserRouter>;
}
