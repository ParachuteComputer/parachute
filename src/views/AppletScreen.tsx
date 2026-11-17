// An applet's screen: /v/<vault>/a/<applet note id>[?note=<id>&screen=<id>]. The applet's note is read as it is now;
// its manifest, what it opens and its code decide what shows:
// - applets off on this device (the self-test hasn't passed): a calm line, nothing runs;
// - its code is HTML, or one TSX/JSX module (code.ts) the app transpiles here, before the card, once per code hash; code
//   that doesn't compile is refused with the reason, and nothing runs;
// - never allowed, changed what it reaches, or changed code: the grant card; nothing runs until Allow;
// - allowed: it runs only after a tap inside the app (a marked tap that led here, Allow, or Open), or when it is the
//   person's home, chosen on this device and still named in their settings (shell/start.ts); otherwise it waits,
//   stopped, with an Open button;
// - it is handed a note (`ready().open`) only when that note is one it claims (opens.ts), and only when the code that
//   loaded is the code that was allowed.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import type { Note } from "@openparachute/surface-client";
import { Bar } from "../ui/Bar";
import { useVault } from "../vault/hooks";
import { clientFor } from "../vault/client";
import { noteHref, titleOf } from "../vault/notes";
import AppletFrame, { appletPage } from "../applet/frame";
import GrantCard from "../applet/GrantCard";
import { readApplet, resolvedOf, ownFolder, type AppletEntry } from "../applet/discovery";
import { claimOf, withoutRoles } from "../applet/opens";
import { readRoleTags } from "../open/roles";
import { fingerprint, grantExpiry, grantKey, grantLines, grantOf } from "../applet/grant";
import { deviceGrants, subjectOf } from "../applet/grants";
import { codeHash, codeKindOf, extensionOf, modulePage, prepare, usesNote, type CodeKind } from "../applet/code";
import { importLines, readImports, type Imported } from "../applet/resolveImports";
import { compositeHash } from "../applet/imports";
import reactKitSource from "virtual:react-kit";
import reactNoteKitSource from "virtual:react-note-kit";
import { embedsFrom, pointerFor, repin, type PointerNote } from "../applet/pointers";
import { createPageModule } from "../applet/modules/page";
import { PageEmbeds, PAGE_MAX } from "./Embeds";
import { isMine, useWhose, whoseOf } from "../vault/whose";
import { pageMarks } from "../applet/pageMark";
import { MAX_CODE_CHARS } from "../vault/limited";
import { hostOf } from "../vault/store";
import { screenOf } from "../applet/manifest";
import { createRouter } from "../applet/router";
import { createVaultModule } from "../applet/modules/vault";
import { createThemeModule } from "../applet/modules/theme";
import { tokensNow } from "../theme/store";
import { createAppModule } from "../applet/modules/app";
import { appDeps } from "../shell/appDeps";
import { runDecision } from "../applet/selftest/gate";
import { useGate } from "../applet/selftest/run";
import { vaultDeps } from "../applet/vaultDeps";
import { takeMark } from "../open/mark";
import { chooseStart, startChosenHere, takeStart } from "../shell/start";
import { barNow, settingsReadNow } from "../shell/homeSettings";
import { backOrLauncher } from "../ui/Bar";
import NoVault from "../ui/NoVault";

const grants = deviceGrants();

/** An applet's page from its code and what it imports, each transpiled (and cached) on its own. */
async function buildPage(kind: CodeKind, source: string, imports: readonly Imported[]): Promise<{ ok: true; page: string } | { ok: false; error: string }> {
  if (kind === "html") return { ok: true, page: source };
  const [host, ...parts] = await Promise.all([prepare(source, kind), ...imports.map((i) => prepare(i.source, i.kind))]);
  if (host.compiled && !host.compiled.ok) return { ok: false, error: host.compiled.error };
  const bad = parts.findIndex((p) => p.compiled && !p.compiled.ok);
  if (bad >= 0) return { ok: false, error: `«${imports[bad].id}»: ${(parts[bad].compiled as { error: string }).error}` };
  const js = (c: Awaited<ReturnType<typeof prepare>>) => (c.compiled && c.compiled.ok ? c.compiled.js : "");
  const note = usesNote(source) || imports.some((i) => usesNote(i.source));
  return { ok: true, page: modulePage(js(host), note ? reactNoteKitSource : reactKitSource, imports.map((i, k) => ({ id: i.id, js: js(parts[k]) }))) };
}

/** A page with embeds grows to its content, up to PAGE_MAX; one that grows by the same amount three times running (a
 *  layout measured from the screen, plus a margin) is held where it is. */
export function grow(was: { h: number; steps: number[] }, reported: number): { h: number; steps: number[] } {
  const h = Math.max(0, Math.min(PAGE_MAX, Math.round(reported)));
  if (h <= was.h) return { h, steps: [] };
  const steps = [...was.steps, h - was.h].slice(-3);
  if (steps.length === 3 && steps.every((d) => d === steps[0])) return { h: was.h, steps };
  return { h, steps };
}
/** Whether this history entry was reached by a marked tap: decided once per entry (StrictMode renders twice). */
const startedByTap = new Map<string, boolean>();
/** The entries a start led to (start.ts), and whether the person chose that applet as home on this device. */
const startedAtStart = new Map<string, { chosen: boolean; vault: string; noteId: string }>();

/** `page` is null for code from someone else's vault until it is allowed: it is transpiled only then (`source` waits). */
type Loaded = { state: "loading" } | { state: "error"; error: string } | { state: "refused"; error: string }
  | { state: "ok"; entry: AppletEntry; page: string | null; source: { kind: CodeKind; text: string }; imports: Imported[]; note: Note | null; from: string[] };

export default function AppletScreen() {
  const { vault: key, applet: appletId } = useParams();
  const [params] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const navRef = useRef(navigate);
  const frameEl = useRef<HTMLIFrameElement | null>(null);
  navRef.current = navigate;
  const rec = useVault(key);
  const mode = useGate();
  const askedNote = params.get("note");
  const askedScreen = params.get("screen");
  if (!startedByTap.has(location.key)) {
    const tapped = takeMark(location.pathname), start = takeStart(location.pathname);
    if (start) startedAtStart.set(location.key, start);
    // a start runs it by itself only when the person chose it as home here (and, as always, allowed its code)
    startedByTap.set(location.key, tapped || !!start?.chosen);
  }
  // so does any other way to that home (Back to it, the bar), when it isn't asked to open a note: while the settings, as
  // read from the vault this session (not the copy kept from before), still name it, and the person chose it here
  const home = settingsReadNow() ? barNow().start : null;
  // a home applet is in a vault of the person's own: someone else's code never runs by itself
  const chosenHome = !askedNote && !!rec && !!appletId && isMine(rec) && home?.vault === rec.key && home.noteId === appletId && startChosenHere(rec.key, appletId);
  const atStart = startedAtStart.get(location.key) ?? null;
  // the person's tap on Allow or Open, on the screen a start led to, is their choice of it as home on this device
  const chooseHere = () => { if (atStart && !atStart.chosen) { chooseStart(atStart.vault, atStart.noteId); startedAtStart.set(location.key, { ...atStart, chosen: true }); } };
  const [started, setStarted] = useState(() => (startedByTap.get(location.key) ?? false) || chosenHome);
  // a tap counts for the first screen drawn for this entry only: Back or Forward to it later starts nothing (but the home
  // the person chose here, above)
  useEffect(() => () => { startedByTap.set(location.key, false); }, [location.key]);
  const [declined, setDeclined] = useState(false);
  const [, setBump] = useState(0);
  const bump = () => setBump((n) => n + 1);
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  const [keys, setKeys] = useState<{ scope: string; html: string } | null>(null);
  // a page with embeds: how tall its own content is (and the last few steps it grew by, to stop a page that measures
  // the screen growing for ever)
  const [hostHeight, setHostHeight] = useState<{ h: number; steps: number[] }>({ h: 0, steps: [] });
  // a pointer in the home vault that brought this record in, and the code it was brought in with
  const [brought, setBrought] = useState<PointerNote | null>(null);
  // whose its vault is, read again when the person changes it
  const whoseNow = useWhose();
  const notMine = !!rec && whoseNow(rec) !== "mine";

  // the applet's note as it is now, and the note it is asked to open
  useEffect(() => {
    if (!rec || !appletId) return;
    let on = true;
    setLoaded({ state: "loading" }); setKeys(null);
    const c = clientFor(rec);
    void (async () => {
      try {
        const n = await c.getNote(appletId);
        if (!n) { if (on) setLoaded({ state: "refused", error: "its note is gone" }); return; }
        const kind = codeKindOf(n as { extension?: string });
        if (!kind) { if (on) setLoaded({ state: "refused", error: `its note is ${extensionOf(n as { extension?: string })}, and an applet's note is html, tsx or jsx` }); return; }
        if (notMine && (n.content ?? "").length > MAX_CODE_CHARS) { if (on) setLoaded({ state: "refused", error: "its code is bigger than an applet from someone else's vault may be" }); return; }
        const a = readApplet(n, rec.key, notMine);
        if (!a.ok) { if (on) setLoaded({ state: "refused", error: a.error }); return; }
        // the vault's role tags are no applet's to open or to tag with: dropped before the card, the key and the writer
        a.entry.opens = withoutRoles(a.entry.opens, await readRoleTags(c));
        const note = askedNote ? await c.getNote(askedNote).catch(() => null) : null;
        const source = n.content ?? "";
        // someone else's code is only hashed here; it is transpiled once it is allowed (below)
        // a page that shows things from someone else's vaults says so on its card, and in its key (docs/design/EMBED.md)
        const from = a.entry.embeds.length ? await embedsFrom(rec, a.entry.embeds) : [];
        // what it imports (component:<id>), from the person's own vaults or ones they trust: its hash covers each
        const imp = kind === "html" ? { ok: true as const, imports: [] } : await readImports(rec, source);
        if (!imp.ok) { if (on) setLoaded({ state: "refused", error: imp.error }); return; }
        const imports = imp.imports;
        // code from someone else's vault, its own or imported, is transpiled only once it is allowed
        const late = notMine || imports.some((i) => i.whose !== "mine");
        const [scope, code, pointer] = await Promise.all([grantKey({ ...grantOf(a.entry.manifest, rec.key, a.entry.opens, a.entry.app), embedsFrom: from }, a.entry.path),
          late || imports.length ? codeHash(kind, source).then((hash) => ({ hash, compiled: null })) : prepare(source, kind), pointerFor(rec, n.id).catch(() => null)]);
        const hash = imports.length && kind !== "html" ? await compositeHash(kind, source, imports) : code.hash;
        if (!on) return;
        if (code.compiled && !code.compiled.ok) { setLoaded({ state: "refused", error: `its code doesn't compile: ${code.compiled.error}` }); return; }
        let page: string | null = null;
        if (kind === "html") page = source;
        else if (!late && !imports.length) page = appletPage(kind, source, code.compiled?.js ?? null);
        else if (!late) { const built = await buildPage(kind, source, imports); if (!on) return; if (!built.ok) { setLoaded({ state: "refused", error: `its code doesn't compile: ${built.error}` }); return; } page = built.page; }
        setLoaded({ state: "ok", entry: a.entry, page, source: { kind, text: source }, imports, note, from });
        setKeys({ scope, html: hash });
        setBrought(pointer);
      } catch (e) {
        if (on) setLoaded({ state: "error", error: e instanceof Error ? e.message : "the vault couldn't be read" });
      }
    })();
    return () => { on = false; };
  }, [rec?.key, appletId, askedNote, notMine]); // eslint-disable-line react-hooks/exhaustive-deps

  const entry = loaded.state === "ok" ? loaded.entry : null;
  const subject = rec && entry ? subjectOf(rec.key, entry.noteId) : null;
  const status = subject && keys ? grants.status(subject, keys.scope, keys.html) : "none";
  const decision = runDecision(mode, status, subject ? grants.grantedUnder(subject) : null);
  const granted = decision === "run";
  // brought in at other code than this: the card is headed so, even where this device never allowed it
  const pinMoved = !!brought && !!keys && brought.pointer.code !== keys.html;
  // someone else's code, allowed: transpiled now, once
  const [late, setLate] = useState<{ hash: string; page: string } | { hash: string; error: string } | null>(null);
  useEffect(() => {
    if (!granted || loaded.state !== "ok" || loaded.page !== null || !keys || late?.hash === keys.html) return;
    let on = true;
    const { kind, text } = loaded.source;
    void buildPage(kind, text, loaded.imports).then((b) => { if (on) setLate(b.ok ? { hash: keys.html, page: b.page } : { hash: keys.html, error: b.error }); });
    return () => { on = false; };
  }, [granted, loaded, keys?.html]); // eslint-disable-line react-hooks/exhaustive-deps
  const page = loaded.state === "ok" ? loaded.page ?? (late && keys && late.hash === keys.html && "page" in late ? late.page : null) : null;
  // the page mark (applet/pageMark.ts) covers code it imports from another vault, as it covers embeds
  const marks = pageMarks();
  const pageId = rec && appletId ? `${rec.key}|${appletId}` : "";
  const importsElsewhere = loaded.state === "ok" && loaded.imports.some((i) => !i.own);
  const [hangCleared, setHangCleared] = useState(false);
  const heldForHang = importsElsewhere && !hangCleared && marks.suspect(pageId);
  const runningImports = importsElsewhere && granted && started && !!page && !heldForHang;
  useEffect(() => (runningImports ? marks.hold(pageId) : undefined), [runningImports, pageId]); // eslint-disable-line react-hooks/exhaustive-deps
  const grant = useMemo(() => (entry ? resolvedOf(entry.manifest) : {}), [entry]);
  // keyed on the vault, not the record object: a token refresh rewrites the record, and rebuilding the router would close
  // the frame's session with the very call that caused the refresh still waiting
  const router = useMemo(() => (rec && entry ? createRouter([
    createVaultModule(vaultDeps(clientFor(rec)), { opens: entry.opens, name: rec.vault }),
    createThemeModule({ theme: tokensNow }),
    createAppModule(entry.app, appDeps((href) => navRef.current(href), () => frameEl.current)),
    // a page with embeds grows to its content, and they follow it (docs/design/EMBED.md)
    ...(entry.embeds.length ? [createPageModule((l) => setHostHeight((h) => grow(h, l.height)))] : []),
  ]) : null), [rec?.key, rec?.issuer, rec?.vault, entry]); // eslint-disable-line react-hooks/exhaustive-deps

  // the note it is handed: one it claims, never its own note, and only to the code that was allowed
  const note = loaded.state === "ok" ? loaded.note : null;
  const claim = entry && note && note.id !== entry.noteId ? claimOf(entry.opens, note) : null;
  const handed = decision === "run" && claim && note ? { note: { id: note.id, path: note.path ?? "" }, screen: screenOf(entry!.manifest, claim.screen ?? askedScreen).id } : null;
  const name = entry?.manifest.name ?? "Applet";
  const sized = !!entry?.embeds.length;
  const ready = useMemo(() => ({ applet: { id: entry?.manifest.id, name }, ...(handed ? { open: handed } : {}), ...(sized ? { page: { embeds: entry!.embeds.map((e) => e.name) } } : {}) }), [entry?.manifest.id, name, handed?.note.id, handed?.screen, sized]); // eslint-disable-line react-hooks/exhaustive-deps
  const tap = (f: () => void) => (e: React.MouseEvent) => { if (e.isTrusted) f(); };

  if (!rec) return <NoVault />;
  // Back returns where the person came from; on the first screen of a start, to the launcher
  const back = backOrLauncher;
  const plainNote = note ? <Link to={`${noteHref(rec.key, note.id)}?with=vault`}>Open {titleOf(note)} in the vault view</Link> : null;
  const theirsLabel = notMine ? ` · ${rec.vault}'s` : "";
  const shell = (body: React.ReactNode) => <main className="screen applet-screen"><Bar title={entry ? `${entry.manifest.glyph} ${name}${theirsLabel}` : "Applet"} back={true} onBack={back} />{atStart && !atStart.chosen && <p className="quiet start-line">Your settings open {name} when the app starts.</p>}{body}</main>;

  if (mode === "closed") return shell(<div className="card" role="status"><p>Applets are off on this device until its self-test passes. See Settings.</p>{plainNote}</div>);
  if (loaded.state === "loading" || (loaded.state === "ok" && !keys)) return shell(<p className="quiet" role="status">Opening…</p>);
  if (loaded.state === "error") return shell(<p className="error" role="alert">Couldn't open this applet: {loaded.error}.</p>);
  if (loaded.state === "refused") return shell(<div className="card" role="alert"><p>This applet can't open. It was not run: {loaded.error}.</p>{plainNote}</div>);
  if (!entry || !keys || !subject) return null;

  if (!granted) {
    if (declined) return shell(<div className="card"><p>{name} isn't allowed to run.</p><button type="button" className="primary" onClick={tap(() => setDeclined(false))}>Ask again</button> {plainNote}</div>);
    return shell(<>
      {note && <p className="quiet">{name} asks before it opens {titleOf(note)}.</p>}
      <GrantCard name={name} glyph={entry.manifest.glyph} vault={rec.vault} whose={whoseOf(rec)} host={hostOf(rec.issuer)} runs={mode === "approved-code" ? "approved-code" : "sealed"} codeChanged={decision === "ask-updated" && status === "updated"}
        broughtChanged={pinMoved} asksOther={status === "none" && !!grants.record(subject)}
        lines={[...grantLines({ ...grantOf(entry.manifest, rec.key, entry.opens, entry.app), embedsFrom: loaded.state === "ok" ? loaded.from : [] }, ownFolder(entry.path)), ...importLines(loaded.state === "ok" ? loaded.imports : [])]}
        withImports={loaded.state === "ok" && loaded.imports.length > 0} fingerprint={fingerprint(keys.scope)} expires={grantExpiry(new Date())}
        onAllow={() => { grants.grant(subject, keys.scope, keys.html, mode === "approved-code" ? "approved-code" : "sealed", grantExpiry); if (brought && pinMoved) void repin(brought, keys.html).then((pinned) => { if (pinned) setBrought({ ...brought, pointer: { ...brought.pointer, code: keys.html } }); }, () => {}); chooseHere(); setStarted(true); bump(); }}
        onNotNow={() => setDeclined(true)} />
    </>);
  }
  const revoke = () => { grants.revoke(subject); setStarted(false); bump(); };
  // code imported from another vault runs inside it: a start after it hung the app holds it, until a tap
  if (heldForHang) return shell(<div className="card" role="status">
    <p>The app stopped while {name} was running. It imports code from another vault, which may have held it up.</p>
    <button type="button" className="primary" onClick={tap(() => { marks.clear(pageId); setHangCleared(true); setStarted(true); })}>Open {name}</button> {plainNote}
  </div>);
  if (!started) return shell(<div className="card" role="status">
    <p>{name} is stopped.{note && claim ? ` It will open ${titleOf(note)}.` : ""}</p>
    <button type="button" className="primary" onClick={tap(() => { chooseHere(); setStarted(true); })}>Open {name}</button> {plainNote}
  </div>);
  return shell(<>
    <div className="applet-bar">
      <span className="quiet">{mode === "approved-code" ? "Approved code only" : "Sealed"}{handed ? ` · ${titleOf(note!)}` : ""}</span>
      {plainNote && <Link className="quiet-button" to={`${noteHref(rec.key, note!.id)}?with=vault`}>Vault</Link>}
      <button type="button" className="quiet-button" onClick={tap(() => setStarted(false))}>Stop</button>
      <button type="button" className="quiet-button" onClick={tap(revoke)}>Revoke</button>
    </div>
    {late && "error" in late && late.hash === keys.html && <p className="error" role="alert">This applet can't run: its code doesn't compile: {late.error}.</p>}
    {router && page && <AppletFrame key={`${keys.html}:${handed?.note.id ?? ""}`} html={page} title={name} router={router} grant={grant} ready={ready} onElement={(el) => { frameEl.current = el; }} height={sized ? Math.max(hostHeight.h, 80) : undefined} />}
    {router && page && sized && rec && isMine(rec) && <PageEmbeds host={rec} hostNote={entry.noteId} embeds={entry.embeds} from={loaded.state === "ok" ? loaded.from : []} />}
  </>);
}
