// Links into the app. In the shell, the deep-link plugin hands over `parachute://open?url=…` (at a cold start, and
// whenever one is tapped while the app runs). Every link goes through one screen, /open-link?url=<link>, which opens
// the note when this device holds that vault on that hub, and otherwise shows why, with a Copy button. The app never
// sends a link back out. A link opens the note's route with no tap mark: an applet it leads to waits, stopped.
// The link the app was started with is handled once: a reload or a return to the app doesn't open it again (a return
// after Android killed the process too: MainActivity drops the old intent), and a fresh tap of the same link does.
// On desktop a link opens the app from cold when the app is installed from its .deb (which registers the scheme; an
// AppImage registers nothing); a second link while it runs starts a second window (no single-instance plugin in step 1).
import { useEffect, useRef } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { inShell } from "../vault/oauth";
import { vaultAt } from "../vault/store";
import { noteHref } from "../vault/notes";
import { parseLinkIn } from "./parse";
import { Bar } from "../ui/Bar";

export const HANDLED_KEY = "parachute.links.handled";
export const openLinkPath = (raw: string) => `/open-link?url=${encodeURIComponent(raw)}`;

type Plugin = { getCurrent(): Promise<string[] | null>; onOpenUrl(cb: (urls: string[]) => void): Promise<() => void> };

/** Wire the shell's links to the app. `plugin` and `store` are for tests; the shell's plugin otherwise. */
export function listenForLinks(go: (path: string) => void, plugin?: Plugin, store: Pick<Storage, "getItem" | "setItem"> = sessionStorage): () => void {
  let stop: (() => void) | undefined, gone = false;
  void (async () => {
    const p: Plugin = plugin ?? (await import("@tauri-apps/plugin-deep-link"));
    const start = (await p.getCurrent().catch(() => null))?.[0];
    const startedAt = Date.now();
    if (start && store.getItem(HANDLED_KEY) !== start) { store.setItem(HANDLED_KEY, start); if (!gone) go(openLinkPath(start)); }
    const un = await p.onOpenUrl((urls) => {
      const u = urls[0];
      if (!u || gone) return;
      // some platforms also send the start link as an event: the same link within moments of starting is that, not a tap
      if (u === start && Date.now() - startedAt < 3000) return;
      store.setItem(HANDLED_KEY, u);
      go(openLinkPath(u));
    });
    if (gone) un(); else stop = un;
  })();
  return () => { gone = true; stop?.(); };
}

/** Mounted once at the root, in the shell only. */
export function LinksIn() {
  const nav = useNavigate();
  // subscribe once: useNavigate's function changes with every navigation, and a link arriving while re-subscribing
  // would be lost
  const navRef = useRef(nav);
  navRef.current = nav;
  useEffect(() => (inShell() ? listenForLinks((path) => navRef.current(path)) : undefined), []);
  return null;
}

/** /open-link?url=… : open the note, or say why not. */
export default function OpenLink() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const raw = params.get("url") ?? "";
  const parsed = parseLinkIn(raw);
  const rec = parsed.ok ? vaultAt(parsed.issuer, parsed.vault) : null;
  useEffect(() => { if (parsed.ok && rec) nav(noteHref(rec.key, parsed.note), { replace: true }); }, [raw]); // eslint-disable-line react-hooks/exhaustive-deps
  if (parsed.ok && rec) return null;
  const why = !parsed.ok ? parsed.reason : `This device doesn't hold the ${parsed.vault} vault on ${new URL(parsed.issuer).host}.`;
  return (
    <main className="screen">
      <Bar title="Can't open this link" back="/" />
      <section className="card" role="alert">
        <p>{why}</p>
        <p className="link-raw"><code>{raw.slice(0, 300)}{raw.length > 300 ? "…" : ""}</code></p>
        <div className="grant-actions">
          {parsed.ok && <Link className="quiet-button" to="/add">Add a Parachute</Link>}
          <button type="button" className="quiet-button" onClick={() => void navigator.clipboard?.writeText(raw)}>Copy</button>
        </div>
      </section>
    </main>
  );
}
