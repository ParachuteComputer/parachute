import { useCallback, useEffect, useState } from "react";
import { useHold } from "../../ui/hold";
import { Link } from "react-router";
import type { Note } from "@openparachute/surface-client";
import type { FrameApplet, FrameComponent, FrameParachute, FramePointer, FrameVault } from "../../bridge/protocol";
import { addEmbed, addVault, bringIn, dismissVault, pinApplet, startApplet, useApplets, useComponents, useHome, usePointers, useVaultQuery, useVaults } from "../data";
import { titleOf } from "../../vault/notes";
import { Days } from "../../kit/parts";
import { appletPath } from "../../open/paths";

/** "2 days ago", from an ISO time. */
export function ago(iso: string | null | undefined, now = Date.now()): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(t)) return "";
  const days = Math.floor((new Date(now).setHours(0, 0, 0, 0) - new Date(t).setHours(0, 0, 0, 0)) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  return new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "long" });
}

const updated = (n: Note) => (n as { updatedAt?: string }).updatedAt ?? null;

/**
 * The list: the open app's applets (shell/apps.ts decides which), one plain list, whatever vault each is in. It is
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
  const read = vaults.every((v) => counts[v.key] !== undefined);
  const many = vaults.length > 1;
  return (
    <main className="screen launcher">
      <h1 className="launcher-title">Applets</h1>
      {home.notice === "app-record" && <p className="launcher-notice" role="status">Your app record didn't load, so here is every applet. <Link to="/settings">Settings</Link></p>}
      <ol className="entries" aria-label="Applets">
        {vaults.map((v) => <VaultEntries key={v.key} v={v} many={many} onCount={count} onHold={(a) => setAsked({ v, a })} />)}
        {read && !Object.values(counts).some((n) => n > 0) && <li className="entry-quiet">No applets here yet.</li>}
      </ol>
      <Components vaults={vaults} onPart={(v, c) => setPart({ v, c })} />
      <p className="launcher-foot"><Link to="/settings">Settings</Link></p>
      {asked && <AppletSheet v={asked.v} a={asked.a} onClose={() => setAsked(null)} />}
      {part && <ComponentSheet v={part.v} c={part.c} onClose={() => setPart(null)} />}
    </main>
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
  const any = Object.values(some).some(Boolean);
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
  if (v.whose === "trusted") return `someone else's, trusted · at ${v.host}`;
  if (v.whose === "theirs") return `someone else's · at ${v.host}`;
  return null;
}

function Entry({ v, a, where, home, pinned, onHold }: { v: FrameVault; a: FrameApplet; where: string; home: boolean; pinned: boolean; onHold: () => void }) {
  const hold = useHold(onHold);
  const o = a.opens[0];
  const load = useVaultQuery<Note[]>(o ? v : null, (r) => r.queryNotes({ tag: o!.type, pathPrefix: o!.path, orderBy: "updated_at", sort: "desc", limit: 30 }), [o?.type, o?.path]);
  let life = home ? "opens on start" : a.manifest.note ?? "";
  if (o && load.state === "ok") {
    const newest = load.data[0];
    life = newest ? `${titleOf(newest)}, ${ago(updated(newest))}` : "nothing in it yet";
  }
  return (
    <li>
      <Link className="entry" to={appletPath(v.key, a.noteId)} {...hold}>
        <span className="entry-glyph" aria-hidden="true">{a.manifest.glyph}{"\uFE0E"}</span>
        <span className="entry-name">{a.manifest.name}{home && <span className="entry-home">home</span>}{pinned && !home && <span className="entry-pinned"><span aria-hidden="true">●</span> pinned</span>}</span>
        <span className="entry-life">{where && <span className="entry-where">{where} · </span>}{life}</span>
        {o && load.state === "ok" && <span className="entry-days" aria-hidden="true"><Days times={load.data.map(updated)} days={7} inline /></span>}
      </Link>
    </li>
  );
}

/** An applet brought in from someone else's Parachute (a pointer in the home vault): it opens where it lives, and says
 *  where that is. Its own screen checks the pin and asks before anything runs. */
function Brought({ p }: { p: FramePointer }) {
  const line = !p.at ? `from ${p.from.vault} · this device isn't signed in there` : p.changed ? `from ${p.from.vault} · changed since you brought it in` : `from ${p.from.vault} · at ${p.from.host}`;
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
