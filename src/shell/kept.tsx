// Applets kept running while the person is elsewhere in the app, so going back to one is instant: its frame, its
// session and its servers' connections stay as they were, hidden, instead of being closed and started again.
//
// What is kept, and what never is:
// - an applet's own address only (/v/<vault>/a/<applet>, or with a notification's room and message, which go to it as a
//   `launch` event); an address that hands it a note (?note=, ?screen=) is a new screen, started fresh, as before;
// - only while it runs: allowed, started, the person's own code with nothing imported from another vault, and no note
//   handed to it (AppletScreen says so: `keepable`). One that is stopped, revoked, asking on its card, refused or
//   loading goes when the person leaves it, as every screen did before;
// - at most KEEP of them hidden; the one left longest ago goes first.
// While hidden an applet gets no tap (shell/appDeps.ts `tappingIn` and views/ShellSheets.tsx `useTapOnce` need its frame
// on screen), its recorder or picker is cancelled, and it is told (`shown` event, kit `onShown`) so it can hold what
// only a person looking may do (a room marks nothing read). Shown again, its record is read again: changed code or a
// changed grant shows the card, as on any open.
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { Route, Routes, useLocation, type Location } from "react-router";
import AppletScreen from "../views/AppletScreen";

/** How many applets may stay running while hidden. */
export const KEEP = 3;

const APPLET = /^\/v\/([^/]+)\/a\/([^/]+)$/;
/** The query words that keep an address the applet's own (a notification's launch); any other makes it a fresh screen. */
const LAUNCH_WORDS = new Set(["room", "event"]);

/** The applet an address is in, its own address or not. */
const appletOf = (pathname: string) => { const m = APPLET.exec(pathname); return m ? `${m[1]}|${m[2]}` : null; };

/** The kept screen this address is, or null when it is no applet's own address. */
export function keptId(location: Pick<Location, "pathname" | "search">): string | null {
  const m = APPLET.exec(location.pathname);
  if (!m) return null;
  for (const k of new URLSearchParams(location.search).keys()) if (!LAUNCH_WORDS.has(k)) return null;
  return `${m[1]}|${m[2]}`;
}

type Entry = { id: string; location: Location; keepable: boolean; at: number };
export type Kept = { shown: boolean; keepable(yes: boolean): void };
const KeptContext = createContext<Kept>({ shown: true, keepable: () => {} });
/** For an applet's screen: whether it is on screen, and how it says it may be kept running while hidden. */
export const useKept = () => useContext(KeptContext);

/** Which entries stay: the one shown, and up to KEEP others that may be kept, the most recently shown first. */
export function stays(entries: readonly Entry[], current: string | null): Entry[] {
  const hidden = entries.filter((e) => e.id !== current && e.keepable).sort((a, b) => b.at - a.at).slice(0, KEEP);
  return entries.filter((e) => e.id === current || hidden.includes(e));
}

/** Every applet screen at its own address: the one at the address now, shown, and the kept ones, hidden. Rendered only
 *  on the shell's screens; `active` says whether the address now is one of them. */
export function KeptApplets({ active }: { active: boolean }) {
  const location = useLocation();
  const current = active ? keptId(location) : null;
  const [entries, setEntries] = useState<Entry[]>([]);
  const at = useRef(0);
  // what each screen last said about being kept, also before its entry is in `entries` (a screen's effects run before
  // this component's, so its first word can come before the entry that would hold it)
  const said = useRef(new Map<string, boolean>());
  // an address that hands a kept applet a note opens it fresh: the kept one goes, so it never runs twice
  const fresh = !current ? appletOf(location.pathname) : null;
  useEffect(() => {
    setEntries((was) => {
      const next = current ? [...was.filter((e) => e.id !== current), { id: current, location, keepable: said.current.get(current) ?? false, at: ++at.current }] : was.filter((e) => e.id !== fresh);
      return stays(next, current);
    });
  }, [current, fresh, location]);
  const keepable = (id: string) => (yes: boolean) => { said.current.set(id, yes); setEntries((was) => {
    const e = was.find((x) => x.id === id);
    if (!e || e.keepable === yes) return was;
    return stays(was.map((x) => (x.id === id ? { ...x, keepable: yes } : x)), current);
  }); };
  // the screen at the address now draws at once, before the effect above has added it
  const list = (current && !entries.some((e) => e.id === current) ? [...entries, { id: current, location, keepable: false, at: Infinity }] : entries).filter((e) => e.id !== fresh);
  return <>{list.map((e) => {
    const shown = e.id === current;
    return <div key={e.id} className="kept-applet" hidden={!shown}>
      <KeptContext.Provider value={{ shown, keepable: keepable(e.id) }}>
        <Routes location={shown ? location : e.location}>
          <Route path="/v/:vault/a/:applet" element={<AppletScreen />} />
        </Routes>
      </KeptContext.Provider>
    </div>;
  })}</>;
}
