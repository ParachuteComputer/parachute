import { useCallback, useEffect, useRef, useState } from "react";
import { Loading } from "../../kit/screen";
import { siteOfHost } from "../../vault/site";
import { useHold } from "../../ui/hold";
import { Link } from "react-router";
import { updateLine } from "../../applet/level";
import type { Note } from "@openparachute/surface-client";
import type { FrameApplet, FrameComponent, FrameParachute, FramePointer, FrameVault } from "../../bridge/protocol";
import { addEmbed, addVault, bringIn, dismissVault, pinApplet, readerFor, startApplet, useApplets, useComponents, useHome, usePointers, useShownAgain, useVaultQuery, useVaults, useVaultsLoaded, useHomeLoaded } from "../data";
import { titleOf } from "../../vault/notes";
import { Days } from "../../kit/parts";
import { when } from "../../kit/when";
import { appletPath } from "../../open/paths";

/** A day inside a line of words: "today", "yesterday", "Monday, November 17". */
const inLine = (day: string) => (day === "Today" || day === "Yesterday" ? day.toLowerCase() : day);

const updated = (n: Note) => (n as { updatedAt?: string }).updatedAt ?? null;

/**
 * The list: the open app's applets (shell/bundles.ts decides which), one plain list, whatever vault each is in. It is
 * where Back from a first screen lands and what the bar's Applets opens; the home page itself is the app's home applet.
 * Vaults are in Settings (and in a Vault applet, when the app lists one). A long-press (or a right-click) on an applet
 * offers pinning it to the bar and opening it on start.
 */
export default function Launcher() {
  const vaults = useVaults();
  const home = useHome();
  const [asked, setAsked] = useState<{ v: FrameVault; a: FrameApplet } | null>(null);
  const [part, setPart] = useState<{ v: FrameVault; c: FrameComponent } | null>(null);
  // how many each vault lists, once read: the list says when there is nothing in it at all
  const [counts, setCounts] = useState<Record<string, number>>({});
  const count = useCallback((key: string, n: number) => setCounts((c) => (c[key] === n ? c : { ...c, [key]: n })), []);
  // only the vaults held now count (one signed out of while the list shows leaves with its count)
  const read = vaults.every((v) => counts[v.key] !== undefined);
  const anyApplets = !!home.official?.length || vaults.some((v) => (counts[v.key] ?? 0) > 0);
  const many = vaults.length > 1;
  // Start here, above the list: known before the list draws (and kept per vault), so it never pushes the list down
  const homeVault = vaults.find((v) => v.home);
  // (the home record too: Start here's rows are its applets, so nothing is drawn above the list after it)
  const vaultsRead = useVaultsLoaded(), homeRead = useHomeLoaded();
  const fresh = useFresh(homeVault, vaultsRead && homeRead);
  return (
    <main className="screen launcher">
      <h1 className="launcher-title">Applets</h1>
      {home.notice === "bundle-record" && <p className="launcher-notice" role="status">Your bundle didn't load, so here is every applet. <Link to="/settings">Settings</Link></p>}
      {home.notice === "bundle-newer" && <p className="launcher-notice" role="status">{updateLine(home.noticeName ?? "your bundle")} For now this is another bundle. <Link to="/settings">Settings</Link></p>}
      {fresh === undefined ? <Loading /> : <>
      {fresh && homeVault && <StartHere v={homeVault} />}
      {fresh && homeVault && <h2 className="lately-label">All applets</h2>}
      <ol className="entries" aria-label="Applets">
        {/* Parachute's own (docs/design/PARACHUTE-SOURCE.md), in the home: first, from the app */}
        {(() => { const h = vaults.find((v) => v.home); return h ? (home.official ?? []).map((a) => <Entry key={a.noteId} v={h} a={a} where="" home={home.start?.vault === h.key && home.start.noteId === a.noteId} pinned={home.bar.some((p) => p.vault === h.key && p.noteId === a.noteId)} onHold={() => setAsked({ v: h, a })} />) : null; })()}
        {vaults.map((v) => <VaultEntries key={v.key} v={v} many={many} onCount={count} onHold={(a) => setAsked({ v, a })} />)}
        {read && !anyApplets && <li className="entry-quiet">No applets here yet.</li>}
      </ol>
      <Components vaults={vaults} onPart={(v, c) => setPart({ v, c })} />
      <p className="launcher-foot"><Link to="/settings">Settings</Link></p>
      </>}
      {asked && <AppletSheet v={asked.v} a={asked.a} onClose={() => setAsked(null)} />}
      {part && <ComponentSheet v={part.v} c={part.c} onClose={() => setPart(null)} />}
    </main>
  );
}

/** A record of the person's own, not one Parachute or a hub put there (the hub's #guide notes, the app's settings,
 *  applets, templates, views, receipts). */
const theirs = (n: Note) => {
  const path = (n as { path?: string }).path ?? "", tags = (n as { tags?: string[] }).tags ?? [];
  return !/^(Parachute|Applets|Templates|\.parachute)\//.test(path) && !tags.some((t) => t === "guide" || t === "applet" || t === "component" || t.startsWith("parachute"));
};

/** Whether a home vault holds something of the person's, per vault for this session: once it does, it stays known; a
 *  new vault is read again on each visit (the list waits for it). */
const known = new Map<string, boolean>();
const started = (n: Note) => theirs(n) || ((n as { path?: string }).path ?? "").startsWith("Parachute/Receipts/");
const FRESH_PAGE = 200;
/** At most this many pages (2,000 notes) are read: a vault with more of Parachute's own and none of the person's is
 *  taken as started (no Start here), so the read stays short. */
const FRESH_MAX_PAGES = 10;

/** Whether a vault holds nothing of the person's yet (neither a record of theirs nor a pack receipt). Pages past
 *  Parachute's own records and hub #guide notes instead of deciding from the 200 newest notes alone. */
export async function isFreshVault(reader: { queryNotes(q: { pathPrefix?: string; orderBy?: "updated_at" | "created_at"; sort?: "asc" | "desc"; limit?: number; offset?: number }): Promise<Note[]> }): Promise<boolean> {
  const [receipts, first] = await Promise.all([
    reader.queryNotes({ pathPrefix: "Parachute/Receipts/", limit: 1 }).catch(() => [] as Note[]),
    reader.queryNotes({ orderBy: "updated_at", sort: "desc", limit: FRESH_PAGE }),
  ]);
  if (receipts.length > 0 || first.some(started)) return false;
  if (first.length < FRESH_PAGE) return true;
  // the rest at once, so the answer comes in two reads' time, inside the list's wait (useFresh: 1.5 s)
  const pages = await Promise.all(Array.from({ length: FRESH_MAX_PAGES - 1 }, (_, i) => reader.queryNotes({ orderBy: "updated_at", sort: "desc", limit: FRESH_PAGE, offset: (i + 1) * FRESH_PAGE })));
  for (const notes of pages) {
    if (notes.some(started)) return false;
    if (notes.length < FRESH_PAGE) return true;
  }
  return false;
}

/** `undefined` until the vaults are read and, for a home vault not read before, while its first read runs (the list
 *  waits for it, at most 1.5 s: then it draws without Start here, which this visit then never adds above it). Never
 *  another vault's answer: a home that changes is read for itself. */
function useFresh(v: FrameVault | undefined, loaded: boolean): boolean | undefined {
  const [state, setState] = useState<{ key: string; fresh: boolean | undefined } | null>(null);
  // once the list has drawn, a home that changes under it (signed out of, another made home) neither blanks it nor
  // puts Start here above it: only a Start here already shown may go
  const shown = useRef(false);
  useEffect(() => {
    if (!loaded || !v) return;
    const key = v.key;
    const first = shown.current ? false : known.get(key);
    setState({ key, fresh: first });
    if (first === false) return;
    let live = true, drawn = false;
    const draw = (fresh: boolean) => { drawn = true; setState({ key, fresh }); };
    const late = setTimeout(() => { if (live && !drawn) draw(false); }, 1500);
    isFreshVault(readerFor(v)).then((isNew) => {
      // (only "not new" is kept: a vault read as new is read again on the next visit, which waits for it, so a Start
      // here that something since then ended never shows first and then goes)
      if (!isNew) known.set(key, false);
      // drawn already: only a Start here that goes may change it (nothing new pushes the list down)
      if (live && (!drawn || !isNew)) draw(isNew);
    }, () => { if (live && !drawn) draw(false); });
    return () => { live = false; clearTimeout(late); };
  }, [v?.key, loaded]);
  // shown again after a shell screen (a first note written in the editor, a pack added): a Start here shown is read
  // again, and goes once the vault holds something of the person's; nothing new is put above the list
  const again = useShownAgain();
  const seen = useRef(again);
  useEffect(() => {
    if (seen.current === again) return;
    seen.current = again;
    if (!v || state?.key !== v.key || state.fresh !== true) return;
    let live = true;
    const key = v.key;
    isFreshVault(readerFor(v)).then((isNew) => {
      if (isNew) return;
      known.set(key, false);
      if (live) setState({ key, fresh: false });
    }, () => {});
    return () => { live = false; };
  }, [again]); // eslint-disable-line react-hooks/exhaustive-deps
  const fresh = !loaded ? undefined : !v ? false : state?.key === v.key ? state.fresh : shown.current ? false : known.get(v.key);
  if (fresh !== undefined) shown.current = true;
  return fresh;
}

/** A new person's first screen (T-476 first run): while their home vault holds nothing of theirs, the two ways to
 *  make it theirs, as rows of the list. Gone once anything of theirs is in it, or a pack they added. */
function StartHere({ v }: { v: FrameVault }) {
  const home = useHome();
  const own = (name: string) => (home.official ?? []).find((a) => a.manifest.name === name);
  const vault = own("Vault"), connect = own("Connect");
  if (!vault && !connect) return null;
  const row = (a: FrameApplet, name: string, life: string) => (
    <li><Link className="entry" to={appletPath(v.key, a.noteId)}>
      <span className="entry-glyph" aria-hidden="true">{a.manifest.glyph}{"\uFE0E"}</span>
      <span className="entry-name">{name}</span>
      <span className="entry-life">{life}</span>
    </Link></li>
  );
  return (
    <section aria-label="Start here">
      <h2 className="lately-label">Start here</h2>
      <ol className="entries start-here">
        {vault && row(vault, "Bring in what you have", "Import from Notion, or start from a pack: clients and sessions, a reading list, people and projects")}
        {connect && row(connect, "Connect your AI", "one address for Claude or ChatGPT; choose Write so it can save here")}
      </ol>
    </section>
  );
}

/** One vault's applets in the list (and, in the home, the ones brought in from other Parachutes). */
function VaultEntries({ v, many, onCount, onHold }: { v: FrameVault; many: boolean; onCount: (key: string, n: number) => void; onHold: (a: FrameApplet) => void }) {
  const applets = useApplets(v.key);
  const home = useHome();
  const pointers = usePointers();
  const shown = applets?.ok ? applets.entries : [];
  const brought = v.home ? pointers.filter((p) => p.kind === "applet") : [];
  useEffect(() => { if (applets) onCount(v.key, shown.length + brought.length + (applets.ok ? 0 : 1)); }, [applets, shown.length, brought.length, v.key, onCount]);
  const where = many || (v.whose && v.whose !== "mine") ? [v.vault, whoseLine(v, false)].filter(Boolean).join(" · ") : "";
  return <>
    {shown.map((a) => {
      const isHome = home.start?.vault === v.key && home.start.noteId === a.noteId;
      const pinned = home.bar.some((p) => p.vault === v.key && p.noteId === a.noteId);
      return <Entry key={a.noteId} v={v} a={a} where={where} home={isHome} pinned={pinned} onHold={() => onHold(a)} />;
    })}
    {brought.map((p) => <Brought key={p.noteId} p={p} />)}
    {applets && !applets.ok && <li className="entry-quiet">The applets in {v.vault} couldn't be read.</li>}
  </>;
}

/** Components (docs/OTHER-PARACHUTES.md): what can be put on the home applet's page, a tap each. Shown only when there are some. */
function Components({ vaults, onPart }: { vaults: FrameVault[]; onPart: (v: FrameVault, c: FrameComponent) => void }) {
  const [some, setSome] = useState<Record<string, boolean>>({});
  const tell = useCallback((key: string, yes: boolean) => setSome((s) => (s[key] === yes ? s : { ...s, [key]: yes })), []);
  const any = vaults.some((v) => some[v.key]);
  return (
    <section className={any ? "launcher-parts" : "launcher-parts empty"} aria-label="Components" hidden={!any}>
      <h2 className="lately-label">Components</h2>
      <ul className="parts-list" aria-label="Components">
        {vaults.map((v) => <VaultComponents key={v.key} v={v} onSome={tell} onPart={(c) => onPart(v, c)} />)}
      </ul>
    </section>
  );
}
function VaultComponents({ v, onSome, onPart }: { v: FrameVault; onSome: (key: string, yes: boolean) => void; onPart: (c: FrameComponent) => void }) {
  const parts = useComponents(v.key);
  const list = parts?.ok ? parts.entries : [];
  useEffect(() => { onSome(v.key, list.length > 0); }, [list.length, v.key, onSome]);
  return <>{list.map((c) => <li key={c.noteId}><button type="button" className="part-chip" onClick={() => onPart(c)}><span aria-hidden="true">{c.glyph}{"\uFE0E"}</span> {c.name}</button></li>)}</>;
}

/** The person's vaults on a Parachute that this device doesn't read yet (docs/design/SCOPES.md): the sign-in reads only
 *  the home, and each other vault is one quiet line. A tap asks the hub to read that one vault (the shell's,
 *  vault/newVaults.ts); Not now stops offering it here. */
export function VaultsToOpen({ p }: { p: FrameParachute }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!p.fresh?.length) return null;
  const add = (v: string) => {
    if (busy) return;
    setBusy(true); setError("");
    // the app leaves for the hub; it stays busy until then
    addVault(p.hub, v).catch((e: unknown) => { setError(e instanceof Error && e.message !== "not_allowed" ? e.message : "That needs a tap."); setBusy(false); });
  };
  return (
    <ul className="parachute-new plain" aria-label={`Vaults to open on ${p.name}`}>
      {p.fresh.map((v) => (
        <li key={v}>
          <button type="button" className="parachute-new-add" disabled={busy} onClick={() => add(v)}>Open <b>{v}</b></button>
          <button type="button" className="quiet-button" disabled={busy} aria-label={`Not now: ${v}`} onClick={() => void dismissVault(p.hub, v).catch(() => undefined)}>Not now</button>
        </li>
      ))}
      {error && <li className="error" role="alert">{error}</li>}
    </ul>
  );
}

/** Whose a chapter is, under its name: the home, or someone else's (and where). The person's other vaults need no word. */
export function whoseLine(v: FrameVault, many: boolean): string | null {
  if (v.home) return many ? "your home" : null;
  if (v.whose === "trusted") return `someone else's, trusted · at ${siteOfHost(v.host)}`;
  if (v.whose === "theirs") return `someone else's · at ${siteOfHost(v.host)}`;
  return null;
}

function Entry({ v, a, where, home, pinned, onHold }: { v: FrameVault; a: FrameApplet; where: string; home: boolean; pinned: boolean; onHold: () => void }) {
  const hold = useHold(onHold);
  const o = a.opens[0];
  const load = useVaultQuery<Note[]>(o ? v : null, (r) => r.queryNotes({ tag: o!.type, pathPrefix: o!.path, orderBy: "updated_at", sort: "desc", limit: 30 }), [o?.type, o?.path]);
  let life = home ? "opens on start" : a.manifest.note ?? "";
  if (o && load.state === "ok") {
    const newest = load.data[0];
    life = newest ? `${titleOf(newest)}, ${inLine(when.day(updated(newest)))}` : "nothing in it yet";
  }
  return (
    <li>
      <Link className="entry" to={appletPath(v.key, a.noteId)} {...hold}>
        <span className="entry-glyph" aria-hidden="true">{a.manifest.glyph}{"\uFE0E"}</span>
        <span className="entry-name">{a.manifest.name}{home && <span className="entry-home">Home</span>}{pinned && !home && <span className="entry-pinned"><span aria-hidden="true">●</span> pinned</span>}</span>
        <span className="entry-life">{where && <span className="entry-where">{where} · </span>}{life}</span>
        {o && load.state === "ok" && <span className="entry-days" aria-hidden="true"><Days times={load.data.map(updated)} days={7} inline /></span>}
      </Link>
    </li>
  );
}

/** An applet brought in from someone else's Parachute (a pointer in the home vault): it opens where it lives, and says
 *  where that is. Its own screen checks the pin and asks before anything runs. */
function Brought({ p }: { p: FramePointer }) {
  const line = !p.at ? `from ${p.from.vault} · this device isn't signed in there` : p.changed ? `from ${p.from.vault} · changed since you brought it in` : `from ${p.from.vault} · at ${siteOfHost(p.from.host)}`;
  return (
    <li>
      <Link className="entry entry-brought" to={p.at ? appletPath(p.at, p.record) : "/add"}>
        <span className="entry-glyph" aria-hidden="true">{p.glyph ?? "◇"}{"\uFE0E"}</span>
        <span className="entry-name">{p.name}</span>
        <span className="entry-life">{line}</span>
      </Link>
    </li>
  );
}

/** A component: put it on the home's page, or (from someone else's vault) bring it in. Each a tap here, which the shell
 *  writes; it asks on its own sheet before it runs. */
function ComponentSheet({ v, c, onClose }: { v: FrameVault; c: FrameComponent; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState("");
  const theirs = !!v.whose && v.whose !== "mine";
  const pointers = usePointers();
  const isBrought = pointers.some((p) => p.kind === "component" && p.at === v.key && p.record === c.noteId);
  const act = (f: () => Promise<string | null>) => () => {
    if (busy) return;
    setBusy(true); setSaid("");
    f().then((done) => { if (done) { setSaid(done); setBusy(false); } else onClose(); }, (e: unknown) => { setSaid(e instanceof Error && e.message !== "not_allowed" ? e.message : "That needs a tap."); setBusy(false); });
  };
  useEffect(() => { const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; addEventListener("keydown", esc); return () => removeEventListener("keydown", esc); }, [onClose]);
  return (
    <div className="sheet-scrim" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="sheet" role="dialog" aria-modal="true" aria-label={c.name}>
        <h2><span aria-hidden="true">{c.glyph}{"\uFE0E"}</span> {c.name} <span className="quiet">in {v.vault}</span></h2>
        {c.note && <p className="quiet">{c.note}</p>}
        <ul className="plain sheet-list">
          <li><button type="button" className="sheet-choice" disabled={busy} onClick={act(async () => (await addEmbed(v.key, c.noteId)) === "already" ? "It's on your home already." : "Added to your home. It shows under your home applet, and asks before it runs.")}>Add to home</button></li>
          {theirs && !isBrought && <li><button type="button" className="sheet-choice" disabled={busy} onClick={act(async () => { await bringIn(v.key, c.noteId); return null; })}>Bring into my Parachute</button></li>}
        </ul>
        {said && <p role="status">{said}</p>}
        <div className="grant-actions"><button type="button" className="quiet-button" onClick={onClose}>{said ? "Done" : "Cancel"}</button></div>
      </section>
    </div>
  );
}

/** Pin to the bar, and open on start: each a tap here, which the shell writes into the person's settings note. */
function AppletSheet({ v, a, onClose }: { v: FrameVault; a: FrameApplet; onClose: () => void }) {
  const home = useHome();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const isHome = home.start?.vault === v.key && home.start.noteId === a.noteId;
  const pinned = home.bar.some((p) => p.vault === v.key && p.noteId === a.noteId);
  const pointers = usePointers();
  const theirs = !!v.whose && v.whose !== "mine";
  const isBrought = pointers.some((p) => p.kind === "applet" && p.at === v.key && p.record === a.noteId);
  const act = (f: () => Promise<unknown>) => () => {
    if (busy) return;
    setBusy(true); setError("");
    f().then(onClose, (e: unknown) => { setError(e instanceof Error && e.message !== "not_allowed" ? e.message : "That needs a tap."); setBusy(false); });
  };
  useEffect(() => { const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; addEventListener("keydown", esc); return () => removeEventListener("keydown", esc); }, [onClose]);
  return (
    <div className="sheet-scrim" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="sheet" role="dialog" aria-modal="true" aria-label={a.manifest.name}>
        <h2><span aria-hidden="true">{a.manifest.glyph}{"\uFE0E"}</span> {a.manifest.name} <span className="quiet">in {v.vault}</span></h2>
        <ul className="plain sheet-list">
          <li><button type="button" className="sheet-choice" disabled={busy} onClick={act(() => pinApplet(v.key, a.noteId, !pinned))}>{pinned ? "Unpin from the bar" : "Pin to the bar"}</button></li>
          {!theirs && <li><button type="button" className="sheet-choice" disabled={busy} onClick={act(() => startApplet(v.key, isHome ? null : a.noteId))}>{isHome ? "Don't open on start" : "Open on start"}</button></li>}
          {theirs && !isBrought && <li><button type="button" className="sheet-choice" disabled={busy} onClick={act(() => bringIn(v.key, a.noteId))}>Bring into my Parachute</button></li>}
          {theirs && isBrought && <li className="quiet sheet-note">Brought into your Parachute.</li>}
        </ul>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="grant-actions"><button type="button" className="quiet-button" onClick={onClose}>Cancel</button></div>
      </section>
    </div>
  );
}
