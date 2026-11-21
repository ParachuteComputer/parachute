// The shell: the trusted part of the app. It holds the sign-ins and their tokens, the applets' grants and their card,
// the self-test and the screens that use them (adding a vault, an applet's screen, Settings, a link from outside).
// Everything else (the vault list, a vault, a note, open-with) is the frame (src/frame), which runs sealed in
// FrameHost and reaches the shell only through the bridge (src/bridge/protocol.ts).
import { useEffect, useRef, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from "react-router";
import AddParachute from "../views/AddParachute";
import AcceptInvite from "../views/AcceptInvite";
import OAuthCallback from "../views/OAuthCallback";
import OpenLink, { LinksIn } from "../links/LinksIn";
import AppletScreen from "../views/AppletScreen";
import Settings from "../views/Settings";
import { gateNow, SelfTestRunner } from "../applet/selftest/run";
import { officialPath } from "../applet/parachuteSource";
import { arrived, installTapListener } from "../open/mark";
import { useVaults } from "../vault/hooks";
import { listVaults } from "../vault/store";
import FrameArea from "./FrameArea";
import KeyStart from "../key/KeyStart";
import OfficialRoute from "../views/OfficialRoute";
import NoteEdit from "../views/NoteEdit";
import Pair from "../key/Pair";
import { keysHere, useKey } from "../key/key";
import BottomBar from "./BottomBar";
import { keptId, KeptApplets } from "./kept";
import { atFirstEntry } from "../ui/history";
import { startNow, startPlace } from "./start";
import { openBundleNow, readSettings, settingsReadNow, subscribeSettings, useSettings } from "./homeSettings";
import { relistVaults } from "../vault/newVaults";
import { isMine } from "../vault/whose";
import { homeVault, useFrameSource } from "./frameSource";
import { readTheme, watchTheme } from "../theme/store";
import WriteAsk from "./WriteAsk";
import Security from "./Security";

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
  // Parachute's own applets: a signed update, read once each time the app starts (docs/design/PARACHUTE-SOURCE.md)
  useEffect(() => { void import("../applet/parachuteSource").then((s) => s.syncParachuteSource()); }, []);
  // the bar's counts (services/signals.ts): counted from the start; the applet on screen has none (what comes while it
  // is in front of the person is seen)
  useEffect(() => { let off = () => {}; void import("../services/signals").then((s) => { off = s.startSignals(); }); return () => off(); }, []);
  const inApplet = /^\/v\/([^/]+)\/a\/([^/]+)$/.exec(location.pathname);
  // an address that doesn't decode is no applet's (a link from outside can say anything): never a throw here, which
  // would take every screen down with it, Settings too
  const decoded = (x: string) => { try { return decodeURIComponent(x); } catch { return null; } };
  const at = inApplet ? [decoded(inApplet[1]), decoded(inApplet[2])] as const : null;
  const appletAt = at && at[0] !== null && at[1] !== null ? at : null;
  useEffect(() => { void import("../services/signals").then((s) => s.setFront(appletAt?.[0] ?? null, appletAt?.[1] ?? null)); }, [appletAt?.[0], appletAt?.[1]]); // eslint-disable-line react-hooks/exhaustive-deps
  // a vault made on a Parachute since this device signed in: asked when the app opens and each time the list or
  // Settings shows, at most once a minute per hub (vault/newVaults.ts)
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current && location.pathname !== "/" && location.pathname !== "/settings") return;
    opened.current = true;
    void relistVaults();
  }, [location.pathname]);
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

/** How long after a start its decision may be made again, when the settings the vault answers differ from the copy. */
const REDECIDE_MS = 10_000;

/** Where the app opens (start.ts): at a start on the launcher (the first entry of this tab's history), the home applet
 *  if the person has one. Nothing is drawn until that is decided, so the launcher never shows and then gives way; but
 *  after a first sign-in on this device, the list the sign-in ends on gives way to the home once. */
function useStart(): boolean {
  const location = useLocation();
  const navigate = useNavigate();
  const [decided, setDecided] = useState(() => !(location.pathname === "/" && atFirstEntry() && listVaults().length > 0));
  // where the start put the person, while it may still be decided again (below), and when
  const landed = useRef<string | null>(null);
  const landedAt = useRef(0);
  useEffect(() => {
    if (decided) { if (listVaults().length) void readSettings(); return; }
    let on = true;
    void startPlace().then((to) => {
      if (!on) return;
      // only from where the app started: a link from outside that arrived meanwhile wins
      if (to && window.location.pathname === "/") { to.go(); navigate(to.href, { replace: true }); }
      if (window.location.pathname === (to?.href ?? "/")) { landed.current = window.location.pathname; landedAt.current = Date.now(); }
      setDecided(true);
    }, () => { if (on) setDecided(true); });
    return () => { on = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // The start is decided on the settings as this device read them last (vault/readCache.ts), at once. When the vault's
  // answer differs (an agent moved the home, say) and the person is still where the start put them, it is decided again,
  // as if the app had started now, within the first moments (REDECIDE_MS) and before the person has touched anything.
  // Anywhere else, or later, the next start is.
  useEffect(() => {
    if (!decided || landed.current === null) return;
    // a tap, a key or the focus going into a frame (a tap there) since: the person has taken over
    const touched = () => { landed.current = null; };
    addEventListener("pointerdown", touched, true); addEventListener("keydown", touched, true); addEventListener("blur", touched);
    const off = subscribeSettings(() => {
      const at = landed.current;
      if (at !== null && Date.now() - landedAt.current > REDECIDE_MS) { landed.current = null; return; }
      if (at === null || !settingsReadNow() || window.location.pathname !== at || !atFirstEntry()) { if (at !== null && (window.location.pathname !== at || !atFirstEntry())) landed.current = null; return; }
      // (a gate closed for a moment, a self-test running again, decides nothing)
      if (gateNow() === "closed") return;
      const to = startNow(), where = to?.href ?? "/";
      if (where === at) return;
      to?.go();
      landed.current = where;
      navigate(where, { replace: true });
    });
    return () => { off(); removeEventListener("pointerdown", touched, true); removeEventListener("keydown", touched, true); removeEventListener("blur", touched); };
  }, [decided]); // eslint-disable-line react-hooks/exhaustive-deps
  // the first sign-in on this device: the app started with no vault, so it decided nothing then. When the first one
  // arrives and the person is on the list, it decides as a start does: their settings' home opens, and their Allow or
  // Open on it is their choice of it as home here (otherwise the next start finds it stopped, waiting for a tap)
  // a vault of their own: someone else's first leaves it waiting for theirs
  const mine = useVaults().filter(isMine).length;
  const firstRun = useRef(listVaults().filter(isMine).length === 0);
  useEffect(() => {
    // once the sign-in is done and has brought the person to the list (it passes through its own page first)
    if (!firstRun.current || mine === 0 || location.pathname !== "/") return;
    firstRun.current = false;
    void startPlace({ firstRun: true }).then((to) => { if (to && window.location.pathname === "/") { to.go(); navigate(to.href, { replace: true }); } }, () => {});
  }, [mine, location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps
  return decided;
}

/** The addresses the bar is at the foot of: the frame's, an applet's, Settings. */
const withBar = (path: string, shell: boolean) => !shell || /^\/v\/[^/]+\/a\/[^/]+$/.test(path) || path === "/settings" || path === "/connect" || path === "/capture" || path === "/journal" || path === "/vault";
/** The app's own editor (a new note, a note's words): a shell screen, so the frame never writes (docs/SIMPLE.md). */
const isEditor = (path: string) => /^\/v\/[^/]+\/(?:new|n\/[^/]+\/edit)$/.test(path);

/** The shell's own screens; on any other address the frame shows. */
function ShellRoutes() {
  const location = useLocation();
  const vaults = useVaults();
  const decided = useStart();
  useSettings();
  const shell = /^\/(add|accept|oauth\/callback|settings|open-link|key|key\/pair|connect|capture|journal|vault)$/.test(location.pathname) || /^\/v\/[^/]+\/a\/[^/]+$/.test(location.pathname) || isEditor(location.pathname)
    || (location.pathname === "/" && !vaults.length);
  if (!decided) return null;
  // Parachute Simplified's home is Parachute's own Notes (docs/design/PARACHUTE-SOURCE.md); where the bundle leaves
  // Parachute's own out, the frame's Notes stays (and `/?with=vault`, the way back if Notes won't run)
  const homeKey = homeVault(vaults)?.key;
  if (location.pathname === "/" && !location.search.includes("with=vault") && !shell && homeKey && openBundleNow().look === "notes" && openBundleNow().parachute)
    return <Navigate to={officialPath(homeKey, "notes")} replace />;
  const bar = withBar(location.pathname, shell) && vaults.length > 0;
  const own = keptId(location) !== null;
  return (
    <div className={bar ? "with-bar" : undefined}>
      {shell && <Routes>
        <Route path="/" element={<FirstRun />} />
        <Route path="/add" element={<AddParachute />} />
        <Route path="/accept" element={<AcceptInvite />} />
        <Route path="/key" element={<KeyStart />} />
        <Route path="/key/pair" element={<Pair />} />
        <Route path="/oauth/callback" element={<OAuthCallback />} />
        <Route path="/v/:vault/a/:applet" element={own ? null : <AppletRoute />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/connect" element={<OfficialRoute key="connect" which="connect" />} />
        <Route path="/capture" element={<OfficialRoute key="capture" which="capture" />} />
        <Route path="/journal" element={<OfficialRoute key="journal" which="journal" />} />
        <Route path="/vault" element={<OfficialRoute key={`vault${location.search}`} which="vault" />} />
        <Route path="/v/:vault/new" element={<NoteEdit key={location.key} />} />
        <Route path="/v/:vault/n/:id/edit" element={<NoteEdit key={location.key} />} />
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
      <WriteAsk />
      <Security />
    </>
  );
}

export default function App() {
  return <BrowserRouter><AppRoutes /></BrowserRouter>;
}
