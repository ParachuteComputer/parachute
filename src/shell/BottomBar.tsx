// The bar (docs/NAVIGATION.md): at the foot of the list, a vault, a note, an applet and Settings. The open bundle's bar,
// in its order: the app's own places it names (its home screen, Connect, Capture) and the pins this device can find.
// When nothing on it leads to the home screen, the shell adds that one place (the list, or Notes): a record can't take
// the way back away. Then, always last, Settings: the shell's own, which no record names, moves or hides, held on screen
// however full the bar is (T-476). The home applet is on it when it is pinned. The shell draws it, under the frame and
// under applets, so it is there on every screen, under a frame of the person's own too. A tap on a place is a real tap on a link inside the app: it marks that
// address, so an allowed applet starts. A long-press (or a right-click) on a place offers moving it, unpinning it, and
// open on start.
import { useEffect, useRef, useState } from "react";
import { useHold } from "../ui/hold";
import { Link, useLocation } from "react-router";
import { move, pinApplet, setStart, useSettings, type Found, type Pin, type Place } from "./homeSettings";
import { homeFace, type AppPlace } from "./bundles";
import { chooseStart, forgetStart } from "./start";
import { clearMark } from "../open/mark";
import { homeVault } from "./frameSource";
import { officialFace, officialPath, SIMPLE_HOME, type OfficialName } from "../applet/parachuteSource";
import { useVaults } from "../vault/hooks";
import { useBadge } from "../services/signals";
import { fromTab } from "./placeMotion";

type Item = Found & { place: Place; home: boolean };

export default function BottomBar() {
  const { bar, bundle } = useSettings();
  const notes = homeFace(bundle);
  const { pathname } = useLocation();
  const [asked, setAsked] = useState<Item | null>(null);
  const item = (p: Pin): Item => ({ ...p, home: !!bar.start && bar.start.href === p.href });
  const items = bar.pins.map(item);
  const here = (href: string) => pathname === href;
  useEffect(() => { setAsked(null); }, [pathname]);
  // a phone's bar scrolls sideways when full: the place you are in is brought into view, clear of the held Applets and
  // Settings (a start, or the hub's page coming back, opens it scrolled to its left end)
  const wayHome = bar.entries.some((e) => "screen" in e && e.screen === "home");
  const nav = useRef<HTMLElement>(null);
  const places = bar.entries.map((e) => ("href" in e ? e.href : JSON.stringify(e))).join(" ");
  // (the app's own places on the bar lead into the home vault, once it is read)
  const homeKey = homeVault(useVaults())?.key;
  useEffect(() => {
    const show = () => {
      const el = nav.current;
      // a sidebar (a Mac) doesn't scroll sideways
      if (!el || getComputedStyle(el).flexDirection !== "row") return;
      const held = el.querySelector<HTMLElement>(".home-bar-held")?.offsetWidth ?? 0;
      // a place reached with Tab scrolls clear of them too
      el.style.scrollPaddingInlineEnd = `${held + 8}px`;
      if (el.scrollWidth <= el.clientWidth) return;
      const cur = el.querySelector<HTMLElement>('.home-bar-place[aria-current="page"]');
      if (!cur || cur.closest(".home-bar-held")) return;
      const view = el.clientWidth - held;
      const left = cur.offsetLeft, right = left + cur.offsetWidth;
      if (left < el.scrollLeft) el.scrollLeft = left - 6;
      else if (right > el.scrollLeft + view) el.scrollLeft = right - view + 6;
    };
    show();
    // a turn of the phone or a narrower window moves it under them again
    addEventListener("resize", show);
    return () => removeEventListener("resize", show);
  }, [pathname, places, wayHome, homeKey]);
  return (
    <>
      <nav ref={nav} className="home-bar" aria-label="Bar" onClickCapture={(e) => { const tab = (e.target as Element).closest(".home-bar-place"); if (tab && e.detail > 0) fromTab(tab); }}>
        {bar.entries.map((e) => ("href" in e
          ? <Place key={e.href} item={item(e)} current={here(e.href)} onHold={() => setAsked(item(e))} />
          : <AppPlaceLink key={JSON.stringify(e)} place={e} notes={notes} pathname={pathname} />))}
        {/* the way home the app adds, and Settings, the shell's own: last, on every screen, whatever the bundle's bar or a
            frame of the person's own says; held together at the edge, so a full bar scrolls under them */}
        <span className="home-bar-held">
          {!wayHome && <AppPlaceLink place={{ screen: "home" }} notes={notes} pathname={pathname} />}
          <Link className="home-bar-place home-bar-settings" to="/settings" aria-current={pathname === "/settings" ? "page" : undefined}>
            <span className="home-bar-glyph" aria-hidden="true">⛭</span>Settings
          </Link>
        </span>
      </nav>
      {asked && <PlaceSheet item={asked} first={items[0]?.href === asked.href} last={items.at(-1)?.href === asked.href} onClose={() => setAsked(null)} />}
    </>
  );
}

/** One of the app's own places a bundle's bar names (docs/SIMPLE.md): its home screen (Notes, or the list), Connect an
 *  AI, or one of Parachute's own applets, Journal, Capture or Vault (docs/design/PARACHUTE-SOURCE.md). */
function AppPlaceLink({ place, notes: face, pathname }: { place: AppPlace; notes: ReturnType<typeof homeFace>; pathname: string }) {
  const home = homeVault(useVaults());
  if ("shipped" in place) return <ShippedPlace which={place.shipped} pathname={pathname} />;
  // Connect is Parachute's own applet now (docs/design/PARACHUTE-SOURCE.md)
  if (place.screen === "connect") return <ShippedPlace which="connect" pathname={pathname} />;
  // the home: "/", which opens Parachute's own Vault in Parachute Simplified (shell/App.tsx), or the list
  const at = pathname === "/" || (face.vault && !!home && (pathname === officialPath(home.key, SIMPLE_HOME) || pathname === `/${SIMPLE_HOME}`));
  return <Link className="home-bar-place" to="/" aria-current={at ? "page" : undefined}><span className="home-bar-glyph" aria-hidden="true">{face.glyph === "⁂" ? face.glyph : `${face.glyph}\uFE0E`}</span>{face.name}</Link>;
}
function ShippedPlace({ which, pathname }: { which: OfficialName; pathname: string }) {
  // named on the bar, it is there, whatever the bundle's publishers say (they decide what is offered on their own: the
  // list, where a record opens, Simplified's home)
  const home = homeVault(useVaults());
  const href = home ? officialPath(home.key, which) : `/${which}`;
  const face = officialFace(which);
  return <Link className="home-bar-place" to={href} aria-current={pathname === href || pathname === `/${which}` ? "page" : undefined}><span className="home-bar-glyph" aria-hidden="true">{face.glyph}{"\uFE0E"}</span>{face.name}</Link>;
}

function Place({ item, current, onHold }: { item: Item; current: boolean; onHold: () => void }) {
  // the click that ends a long-press opens nothing, and the mark the tap listener (on the document, first) made for it goes
  const hold = useHold(onHold, clearMark);
  // the applet's signals (services/signals.ts): nothing while it is the screen in front
  const count = useBadge(item.vault, item.noteId);
  const shown = current ? 0 : count;
  return (
    <Link className="home-bar-place" to={item.href} aria-current={current ? "page" : undefined} {...hold}>
      <span className="home-bar-glyph" aria-hidden="true">{item.glyph}{"\uFE0E"}</span>
      {shown > 0 && <span className="home-bar-badge" aria-hidden="true">{shown > 99 ? "99+" : shown}</span>}
      {item.name}{shown > 0 && <span className="sr-only">, {shown} new</span>}{item.home && <span className="sr-only"> (home)</span>}
    </Link>
  );
}

/** What a long-press on a place offers. Every choice is a tap here, in the shell. */
function PlaceSheet({ item, first, last, onClose }: { item: Item; first: boolean; last: boolean; onClose: () => void }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const act = (f: () => Promise<void>) => (e: React.MouseEvent) => {
    if (!e.isTrusted || busy) return;
    setBusy(true); setError("");
    f().then(onClose, (err: unknown) => { setError(err instanceof Error ? err.message : "That couldn't be saved."); setBusy(false); });
  };
  useEffect(() => { const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; addEventListener("keydown", esc); return () => removeEventListener("keydown", esc); }, [onClose]);
  return (
    <div className="sheet-scrim" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="sheet" role="dialog" aria-modal="true" aria-label={item.name}>
        <h2><span aria-hidden="true">{item.glyph}</span> {item.name}{item.home && <span className="quiet"> · opens on start</span>}</h2>
        <ul className="plain sheet-list">
          {!first && <li><button type="button" className="sheet-choice" disabled={busy} onClick={act(() => move(item.place, -1))}>Move left</button></li>}
          {!last && <li><button type="button" className="sheet-choice" disabled={busy} onClick={act(() => move(item.place, 1))}>Move right</button></li>}
          <li><button type="button" className="sheet-choice" disabled={busy} onClick={act(() => pinApplet(item.vault, item.noteId, false))}>Unpin from the bar</button></li>
          {item.home
            ? <li><button type="button" className="sheet-choice" disabled={busy} onClick={act(async () => { await setStart(null); forgetStart(); })}>Don't open on start</button></li>
            : <li><button type="button" className="sheet-choice" disabled={busy} onClick={act(async () => { await setStart(item.place); chooseStart(item.vault, item.noteId); })}>Open on start</button></li>}
        </ul>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="grant-actions"><button type="button" className="quiet-button" onClick={onClose}>Cancel</button></div>
      </section>
    </div>
  );
}
