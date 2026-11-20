// The bar (docs/NAVIGATION.md): at the foot of the list, a vault, a note, an applet and Settings. The open bundle's bar,
// in its order: the app's own places it names (its home screen, Connect, Capture) and the pins this device can find.
// When nothing on it leads to the home screen, the shell adds that one place at the end (the list, or Notes), the one
// way to the rest and to Settings: a record can't take the way back away. The home applet is on it when it is pinned. The shell
// draws it, under the frame and under applets, so it is there on every screen, under a frame of the person's own too
// (which also gets the app's own Settings). A tap on a place is a real tap on a link inside the app: it marks that
// address, so an allowed applet starts. A long-press (or a right-click) on a place offers moving it, unpinning it, and
// open on start.
import { useEffect, useState } from "react";
import { useHold } from "../ui/hold";
import { Link, useLocation } from "react-router";
import { move, pinApplet, setStart, useSettings, type Found, type Pin, type Place } from "./homeSettings";
import type { AppPlace } from "./bundles";
import { chooseStart, forgetStart } from "./start";
import { clearMark } from "../open/mark";
import { homeVault, useFrameSource } from "./frameSource";
import { SHIPPED, shippedIn, type ShippedName } from "../applet/shipped";
import { useApplets } from "../applet/useApplets";
import { useVaults } from "../vault/hooks";
import { appletPath } from "../open/paths";
import { useBadge } from "../services/signals";

type Item = Found & { place: Place; home: boolean };

export default function BottomBar() {
  const { bar, bundle } = useSettings();
  const notes = bundle.look === "notes";
  const ownFrame = useFrameSource().choice.run === "vault";
  const { pathname } = useLocation();
  const [asked, setAsked] = useState<Item | null>(null);
  const item = (p: Pin): Item => ({ ...p, home: !!bar.start && bar.start.href === p.href });
  const items = bar.pins.map(item);
  const here = (href: string) => pathname === href;
  useEffect(() => { setAsked(null); }, [pathname]);
  const wayHome = bar.entries.some((e) => "screen" in e && e.screen === "home");
  return (
    <>
      <nav className="home-bar" aria-label="Bar">
        {bar.entries.map((e) => ("href" in e
          ? <Place key={e.href} item={item(e)} current={here(e.href)} onHold={() => setAsked(item(e))} />
          : <AppPlaceLink key={JSON.stringify(e)} place={e} notes={notes} pathname={pathname} />))}
        {!wayHome && <AppPlaceLink place={{ screen: "home" }} notes={notes} pathname={pathname} />}
        {/* under a frame of the person's own, the app keeps its own way to Settings, whatever that frame draws */}
        {ownFrame && (
          <Link className="home-bar-place home-bar-own" to="/settings" aria-label="Settings (the app's own)" aria-current={pathname === "/settings" ? "page" : undefined}>
            <span className="home-bar-glyph" aria-hidden="true">◠</span>Settings
          </Link>
        )}
      </nav>
      {asked && <PlaceSheet item={asked} first={items[0]?.href === asked.href} last={items.at(-1)?.href === asked.href} onClose={() => setAsked(null)} />}
    </>
  );
}

/** One of the app's own places a bundle's bar names (docs/SIMPLE.md): its home screen (Notes, or the list), Connect an
 *  AI, or an applet the app ships, Journal, Capture or Vault (the one in the home vault, or the screen that adds it). */
function AppPlaceLink({ place, notes, pathname }: { place: AppPlace; notes: boolean; pathname: string }) {
  if ("shipped" in place) return <ShippedPlace which={place.shipped} pathname={pathname} />;
  const [href, glyph, name] = place.screen === "connect" ? ["/connect", "⌁", "Connect"] : notes ? ["/", "¶", "Notes"] : ["/", "⁂", "Applets"];
  return <Link className="home-bar-place" to={href} aria-current={pathname === href ? "page" : undefined}><span className="home-bar-glyph" aria-hidden="true">{glyph}</span>{name}</Link>;
}
function ShippedPlace({ which, pathname }: { which: ShippedName; pathname: string }) {
  const home = homeVault(useVaults());
  useApplets(home, false);
  const id = shippedIn(home, which);
  const href = home && id ? appletPath(home.key, id) : `/${which}`;
  return <Link className="home-bar-place" to={href} aria-current={pathname === href || pathname === `/${which}` ? "page" : undefined}><span className="home-bar-glyph" aria-hidden="true">{which === "journal" ? "✎" : which === "vault" ? "▦" : "◉"}{"\uFE0E"}</span>{SHIPPED[which].name}</Link>;
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
          <li><button type="button" className="sheet-choice" disabled={busy} onClick={act(() => pinApplet(item.vault, item.noteId, false))}>Unpin</button></li>
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
