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
// At its own address it is a kept screen (shell/kept.tsx): while it runs, the person's own code, it stays running hidden
// when they go elsewhere, and shows again at once; hidden, it gets no tap and is told so (`shown`); shown again, its
// note is read again, and changed code or a changed grant puts the card in its place.
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
import { fingerprint, grantExpiry, grantKey, grantOf } from "../applet/grant";
import { deviceGrants, subjectOf } from "../applet/grants";
import { codeHash, codeKindOf, extensionOf, modulePage, prepare, usesNote, type CodeKind } from "../applet/code";
import { readImports, type Imported } from "../applet/resolveImports";
import { compositeHash } from "../applet/imports";
import reactKitSource from "virtual:react-kit";
import reactNoteKitSource from "virtual:react-note-kit";
import { embedsFrom, embedTargets, pointerFor, repin, type PointerNote } from "../applet/pointers";
import { createPageModule } from "../applet/modules/page";
import { PageEmbeds, PAGE_MAX } from "./Embeds";
import { isMine, useWhose, whoseOf } from "../vault/whose";
import { pageMarks } from "../applet/pageMark";
import { MAX_CODE_CHARS } from "../vault/limited";
import { findVault, hostOf } from "../vault/store";
import { covers } from "../vault/parachute";
import { appletLevel, canWrite, giveBack, heldLevel } from "../vault/reach";
import { homeVault } from "../shell/frameSource";
import { askVault } from "../vault/signInFlow";
import { screenOf } from "../applet/manifest";
import { createRouter } from "../applet/router";
import { createVaultModule } from "../applet/modules/vault";
import { createThemeModule } from "../applet/modules/theme";
import { tokensNow } from "../theme/store";
import { createAppModule, notTapped } from "../applet/modules/app";
import { createVoiceModule } from "../applet/modules/voice";
import { createStorageModule } from "../applet/modules/storage";
import { storageFor } from "../shell/device";
import { deviceSaved } from "../shell/saved";
import { asksHash } from "../applet/approvals";
import { approvalFor, floorOf, passcodeHere, raiseFloor, signApproval, signsHere, subjectOf as approvalSubject } from "../applet/approvalStore";
import type { Decision } from "../applet/approvals";
import { createSavedModule } from "../applet/modules/saved";
import { useDeviceSheets } from "./DeviceSheets";
import { createServicesModule } from "../applet/modules/services";
import { createBroker, type Broker } from "../services/broker";
import { useShellSheets } from "./ShellSheets";
import { lineOptions, useKeyring } from "../services/keyring";
import { launchOf } from "../services/notifyLink";
import { nativeNow } from "../services/native";
import { hubCheck, knownHubs } from "../services/hubs";
import type { Session } from "../applet/session";
import { appDeps, tappingIn } from "../shell/appDeps";
import { runDecision } from "../applet/selftest/gate";
import { useGate } from "../applet/selftest/run";
import { vaultDeps } from "../applet/vaultDeps";
import { takeMark } from "../open/mark";
import { chooseStart, startChosenHere, takeStart } from "../shell/start";
import { barNow, settingsReadNow } from "../shell/homeSettings";
import { backOrLauncher } from "../ui/Bar";
import NoVault from "../ui/NoVault";
import { useKept } from "../shell/kept";

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
  | { state: "ok"; entry: AppletEntry; page: string | null; source: { kind: CodeKind; text: string }; imports: Imported[]; note: Note | null; from: string[];
      /** the hash of what it asks as written, the same on every device (approvals.ts `asksHash`) */
      asks: string };

/** The pointer in the home is repinned only while the app may change notes there (a home read only waits: no ask is
 *  raised for something the person didn't do). */
const homeWritable = () => { const h = homeVault(); return !!h && canWrite(h.key); };

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
  // a kept screen lives across history entries: a tap that led to a new one (the bar, a pin) starts it, as it would a
  // new screen
  useEffect(() => { if (startedByTap.get(location.key)) setStarted(true); }, [location.key]);
  const [declined, setDeclined] = useState(false);
  // the hub couldn't be asked for what an Allow needs
  const [hubError, setHubError] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [, setBump] = useState(0);
  const bump = () => setBump((n) => n + 1);
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  const [keys, setKeys] = useState<{ scope: string; html: string } | null>(null);
  const kept = useKept();
  // shown again after being kept hidden: its note is read again (below), quietly while nothing changed
  const [recheck, setRecheck] = useState(0);
  const rechecked = useRef(0);
  const was = useRef({ loaded, keys });
  was.current = { loaded, keys };
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
    // a recheck of a screen that runs keeps it running unless what was allowed changed
    const quiet = recheck !== rechecked.current && was.current.loaded.state === "ok" && !!was.current.keys;
    rechecked.current = recheck;
    if (!quiet) { setLoaded({ state: "loading" }); setKeys(null); }
    const c = clientFor(rec);
    void (async () => {
      try {
        const n = await c.getNote(appletId);
        if (!n) { if (on) setLoaded({ state: "refused", error: "its note is gone" }); return; }
        const kind = codeKindOf(n as { extension?: string });
        if (!kind) { if (on) setLoaded({ state: "refused", error: `its note is ${extensionOf(n as { extension?: string })}, and an applet's note is html, tsx or jsx` }); return; }
        if (notMine && (n.content ?? "").length > MAX_CODE_CHARS) { if (on) setLoaded({ state: "refused", error: "its code is bigger than an applet from someone else's vault may be" }); return; }
        const a = readApplet(n, rec.key, notMine, hubCheck());
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
        const [scope, code, pointer] = await Promise.all([grantKey({ ...grantOf(a.entry.manifest, rec.key, a.entry.opens, a.entry.app, a.entry.services), embedsFrom: from }, a.entry.path),
          late || imports.length ? codeHash(kind, source).then((hash) => ({ hash, compiled: null })) : prepare(source, kind), pointerFor(rec, n.id).catch(() => null)]);
        const hash = imports.length && kind !== "html" ? await compositeHash(kind, source, imports) : code.hash;
        if (!on) return;
        if (quiet && was.current.keys?.scope === scope && was.current.keys?.html === hash) return;
        if (code.compiled && !code.compiled.ok) { setLoaded({ state: "refused", error: `its code doesn't compile: ${code.compiled.error}` }); return; }
        let page: string | null = null;
        if (kind === "html") page = source;
        else if (!late && !imports.length) page = appletPage(kind, source, code.compiled?.js ?? null);
        else if (!late) { const built = await buildPage(kind, source, imports); if (!on) return; if (!built.ok) { setLoaded({ state: "refused", error: `its code doesn't compile: ${built.error}` }); return; } page = built.page; }
        const asks = await asksHash(approvalSubject(rec, n.id, a.entry.manifest.id), a.entry.path, (n.metadata ?? {}) as Record<string, unknown>,
          { opens: a.entry.opens.map((o) => ({ type: o.type, path: o.path, screen: o.screen ?? null })), from: await embedTargets(a.entry.embeds).catch(() => ["unread"]) });
        if (!on) return;
        setLoaded({ state: "ok", entry: a.entry, page, source: { kind, text: source }, imports, note, from, asks });
        setKeys({ scope, html: hash });
        setBrought(pointer);
      } catch (e) {
        // a recheck the vault couldn't answer (offline a moment) leaves the running screen as it is
        if (on && !quiet) setLoaded({ state: "error", error: e instanceof Error ? e.message : "the vault couldn't be read" });
      }
    })();
    return () => { on = false; };
  }, [rec?.key, appletId, askedNote, notMine, recheck]); // eslint-disable-line react-hooks/exhaustive-deps

  const entry = loaded.state === "ok" ? loaded.entry : null;
  const subject = rec && entry ? subjectOf(rec.key, entry.noteId) : null;
  const status = subject && keys ? grants.status(subject, keys.scope, keys.html) : "none";
  // a signed approval in the home vault (applet/approvalStore.ts): read for this exact code and asks, on a device that
  // holds the person's key. One that covers it allows it here too; a newer one that takes it back stops it here.
  const signedFor = entry && rec && keys && loaded.state === "ok" ? `${keys.html}|${loaded.asks}` : null;
  const [signed, setSigned] = useState<{ for: string; d: Decision | null } | null>(null);
  const [signing, setSigning] = useState<string | null>(null);
  const [passcode, setPasscode] = useState("");
  const [needsPasscode, setNeedsPasscode] = useState(false);
  useEffect(() => { void passcodeHere().then(setNeedsPasscode); }, []);
  useEffect(() => {
    if (!signedFor || !entry || !rec || loaded.state !== "ok" || !keys) return;
    let on = true;
    void approvalFor(approvalSubject(rec, entry.noteId, entry.manifest.id), keys.html, loaded.asks).then((d) => { if (on) setSigned({ for: signedFor, d }); }, () => { if (on) setSigned({ for: signedFor, d: null }); });
    return () => { on = false; };
  }, [signedFor, recheck]); // eslint-disable-line react-hooks/exhaustive-deps
  const signedNow = signed && signed.for === signedFor ? signed.d : undefined;
  // taken back on another device after it was allowed here, or a newer approval for other code (this code was put back
  // over it): it stops here too
  useEffect(() => {
    if (!subject || !signedNow || signedNow.run || (signedNow.why !== "withdrawn" && signedNow.why !== "other") || !signedNow.newest) return;
    const r = grants.record(subject);
    if (r && Date.parse(r.grantedAt) < Date.parse(signedNow.newest.at)) { grants.revoke(subject); setStarted(false); bump(); }
  }, [signedNow, subject]); // eslint-disable-line react-hooks/exhaustive-deps
  // approved on another device, for this exact code and asks: allowed here too, when this device already holds what
  // its vault needs at the hub (else the card says so, and one tap asks the hub)
  // only from an approval no older than what this device has seen since (a Revoke here raises that), and, on a device
  // that runs approved code only, one made under that same warning
  const approvedElsewhere = !!signedNow?.run && status !== "ok" && !!subject && signedNow.content.n >= Math.floor(floorOf(approvalSubject(rec!, entry!.noteId, entry!.manifest.id)) ?? 0)
    && (mode !== "approved-code" || signedNow.content.runs === "approved-code");
  const hubCovers = !!entry && !!rec && covers(heldLevel(rec), appletLevel(entry.manifest));
  useEffect(() => {
    if (!approvedElsewhere || !hubCovers || !subject || !keys || !signedNow?.run) return;
    const c = signedNow.content;
    grants.grant(subject, keys.scope, keys.html, mode === "approved-code" ? "approved-code" : "sealed", () => new Date(c.expires), c.face ? { face: c.face, others: [] } : undefined);
    bump();
  }, [approvedElsewhere, hubCovers]); // eslint-disable-line react-hooks/exhaustive-deps
  const decision = runDecision(mode, status, subject ? grants.grantedUnder(subject) : null);
  const granted = decision === "run";
  // brought in at other code than this: the card is headed so, even where this device never allowed it
  const pinMoved = !!brought && !!keys && brought.pointer.code !== keys.html;
  // an Allow that went through the hub (vault/signInFlow.ts finishStep) was recorded on the way back, for this exact
  // code: the pointer that brought it in follows, as it does after an Allow made here
  const repinned = useRef<string | null>(null);
  useEffect(() => {
    if (!granted || !pinMoved || !brought || !keys || !subject || repinned.current === keys.html) return;
    if (grants.record(subject)?.code !== keys.html || !homeWritable()) return;
    repinned.current = keys.html;
    void repin(brought, keys.html).then((pinned) => { if (pinned) setBrought({ ...brought, pointer: { ...brought.pointer, code: keys.html } }); }, () => {});
  }, [granted, pinMoved, keys?.html]); // eslint-disable-line react-hooks/exhaustive-deps
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
  // the servers it declared (docs/design/SERVICES.md): a broker for each of its frame's sessions, opened with the session
  // and closed with it; its calls wait for it
  const brokerRef = useRef<{ session: Session; broker: Promise<Broker | null> } | null>(null);
  const sheets = useShellSheets(() => frameEl.current);
  // the recorder and the file picker (docs/design/KEYRING.md "Voice, files, links, storage"): stable, as the router keeps them
  const device = useDeviceSheets(entry?.manifest.name ?? "This applet");
  const keyring = useKeyring();
  const servicesWhy = useRef<string | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const onSession = (s: Session | null) => {
    sessionNow.current = s;
    const was = brokerRef.current;
    if (was && was.session !== s) { void was.broker.then((b) => b?.close()); brokerRef.current = null; }
    // a recorder or picker open for the frame that went answers none (its session can't take the answer)
    if (sessionRef.current && sessionRef.current !== s) device.cancel();
    sessionRef.current = s;
    if (!s || !entry?.services.length || !rec || !subject) return;
    const services = entry.services;
    brokerRef.current = { session: s, broker: nativeNow().then((native) => {
      if (!native) { servicesWhy.current = "its servers need the Parachute app on a device, which holds your key"; return null; }
      return createBroker({ native, session: `s${Math.random().toString(36).slice(2)}`, applet: { name: entry.manifest.name, subject }, services, hubs: knownHubs(), emit: (event, data) => s.sendEvent(event, data), shell: sheets.shell });
    }) };
  };
  useEffect(() => () => { void brokerRef.current?.broker.then((b) => b?.close()); brokerRef.current = null; }, []);
  const router = useMemo(() => (rec && entry ? createRouter([
    createVaultModule(vaultDeps(clientFor(rec)), { opens: entry.opens, name: rec.vault }),
    createThemeModule({ theme: tokensNow }),
    createAppModule(entry.app, appDeps((href) => navRef.current(href), () => frameEl.current, device, () => findVault(rec.key), entry.manifest.allow.filter((r) => r.verbs.includes("read")).map((r) => r.path))),
    // the microphone (manifest `reach: [voice]`) and a little storage on this device (`app: [storage]`): not_granted without
    createVoiceModule(!!entry.manifest.reach?.includes("voice"), { record: (max) => (tappingIn(() => frameEl.current) ? device.record(max) : Promise.reject(notTapped())) }),
    createStorageModule(entry.app.includes("storage"), storageFor(subjectOf(rec.key, entry.noteId))),
    // what the kit saves as the person goes (drafts, where it was): every applet's, the same store as `storage`
    createSavedModule({ all: () => deviceSaved().load(subjectOf(rec.key, entry.noteId)), put: (entries) => deviceSaved().put(subjectOf(rec.key, entry.noteId), entries) }),
    ...(entry.services.length ? [createServicesModule(async () => (brokerRef.current ? brokerRef.current.broker : null), () => servicesWhy.current)] : []),
    // a page with embeds grows to its content, and they follow it (docs/design/EMBED.md)
    ...(entry.embeds.length ? [createPageModule((l) => setHostHeight((h) => grow(h, l.height)))] : []),
  ]) : null), [rec?.key, rec?.issuer, rec?.vault, entry]); // eslint-disable-line react-hooks/exhaustive-deps

  // the note it is handed: one it claims, never its own note, and only to the code that was allowed
  const note = loaded.state === "ok" ? loaded.note : null;
  const claim = entry && note && note.id !== entry.noteId ? claimOf(entry.opens, note) : null;
  const handed = decision === "run" && claim && note ? { note: { id: note.id, path: note.path ?? "" }, screen: screenOf(entry!.manifest, claim.screen ?? askedScreen).id } : null;
  const name = entry?.manifest.name ?? "Applet";
  const sized = !!entry?.embeds.length;
  // a notification's tap opens the applet at a room and message (services/notifyLink.ts)
  const launch = launchOf(params);
  const launchKey = launch ? `${launch.room}|${launch.event ?? ""}` : "";
  // what it was allowed, as its card said it (the folders, and each server with its rooms and keys): an applet reads its
  // room, or which key is Uni's, from here rather than from a copy of its own
  // `shown`: a frame that boots while its screen is kept hidden knows so from the start
  // what it saved (drafts, where it was), read before its frame starts and handed back in `ready`, so its first paint has it
  const [saved, setSaved] = useState<{ subject: string; values: Record<string, unknown> } | null>(null);
  useEffect(() => {
    if (!subject) return;
    let on = true;
    void deviceSaved().load(subject).then((values) => { if (on) setSaved({ subject, values }); });
    return () => { on = false; };
  }, [subject]);
  const savedNow = saved && saved.subject === subject ? saved : null;
  const ready = useMemo(() => ({ applet: { id: entry?.manifest.id, name }, access: entry?.manifest.allow ?? [], services: entry?.services ?? [], ...(handed ? { open: handed } : {}), ...(sized ? { page: { embeds: entry!.embeds.map((e) => e.name) } } : {}), ...(launch ? { launch } : {}), shown: kept.shown,
    // read as it is sent (frame.tsx spreads it at each start), so a frame started again gets what was saved since
    get saved() { return subject ? deviceSaved().now(subject) : {}; } }), [entry?.manifest.id, name, handed?.note.id, handed?.screen, sized, launchKey, entry, kept.shown, savedNow]); // eslint-disable-line react-hooks/exhaustive-deps
  const sessionNow = useRef<Session | null>(null);
  useEffect(() => { if (launch) sessionNow.current?.sendEvent("launch", launch); }, [launchKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // kept running while hidden (shell/kept.tsx) only while it runs the person's own code, with nothing from another vault
  // (no imports from one, no embeds), and no note handed to it
  const keepable = granted && started && !!page && !handed && !sized && !!rec && isMine(rec) && loaded.state === "ok" && loaded.imports.every((i) => i.own && i.whose === "mine");
  useEffect(() => { kept.keepable(keepable); }, [keepable]); // eslint-disable-line react-hooks/exhaustive-deps
  // hidden: it is told, and a sheet or recorder open for it closes; shown again: told, and its note read again
  const shownBefore = useRef(kept.shown);
  useEffect(() => {
    if (shownBefore.current === kept.shown) return;
    shownBefore.current = kept.shown;
    sessionNow.current?.sendEvent("shown", { shown: kept.shown });
    if (!kept.shown) { device.cancel(); sheets.cancel(); setMenu(false); } else setRecheck((n) => n + 1);
  }, [kept.shown]); // eslint-disable-line react-hooks/exhaustive-deps
  // a grant changed elsewhere (revoked in Settings while this was kept): drawn again, so it stops at once
  useEffect(() => grants.onChange(bump), []); // eslint-disable-line react-hooks/exhaustive-deps
  const tap = (f: () => void) => (e: React.MouseEvent) => { if (e.isTrusted) f(); };

  if (!rec) return <NoVault />;
  // Back returns where the person came from; on the first screen of a start, to the launcher
  const back = backOrLauncher;
  const plainNote = note ? <Link to={`${noteHref(rec.key, note.id)}?with=vault`}>Open {titleOf(note)} in the vault view</Link> : null;
  const theirsLabel = notMine ? ` · ${rec.vault}'s` : "";
  const shell = (body: React.ReactNode, onMenu?: () => void) => <main className="screen applet-screen"><Bar title={entry ? `${entry.manifest.glyph} ${name}${theirsLabel}` : "Applet"} back={true} onBack={back} onMenu={onMenu} />{atStart && !atStart.chosen && <p className="quiet start-line">Your settings open {name} when the app starts.</p>}{body}</main>;

  if (mode === "closed") return shell(<div className="card" role="status"><p>Applets are off on this device until its self-test passes. See Settings.</p>{plainNote}</div>);
  if (loaded.state === "loading" || (loaded.state === "ok" && !keys)) return shell(<p className="quiet" role="status">Opening…</p>);
  if (loaded.state === "error") return shell(<p className="error" role="alert">Couldn't open this applet: {loaded.error}.</p>);
  if (loaded.state === "refused") return shell(<div className="card" role="alert"><p>This applet can't open. It was not run: {loaded.error}.</p>{plainNote}</div>);
  if (!entry || !keys || !subject) return null;

  if (!granted && signedNow === undefined) return shell(<p className="quiet" role="status">Opening…</p>);
  if (!granted) {
    if (declined) return shell(<div className="card"><p>{name} isn't allowed to run.</p><button type="button" className="primary" onClick={tap(() => setDeclined(false))}>Ask again</button> {plainNote}</div>);
    return shell(<>
      {note && <p className="quiet">{name} asks before it opens {titleOf(note)}.</p>}
      {hubError && <p className="error" role="alert">{hubError}</p>}
      {needsPasscode && !approvedElsewhere && <label className="line passcode-line"><span>Your passcode, to approve it</span> <input type="password" autoComplete="off" aria-label="Your passcode" value={passcode} onChange={(e) => setPasscode(e.target.value)} /></label>}
      <GrantCard name={name} glyph={entry.manifest.glyph} vault={rec.vault} whose={whoseOf(rec)} host={hostOf(rec.issuer)} runs={mode === "approved-code" ? "approved-code" : "sealed"}
        grant={{ ...grantOf(entry.manifest, rec.key, entry.opens, entry.app, entry.services), embedsFrom: loaded.state === "ok" ? loaded.from : [] }} ownFolder={ownFolder(entry.path)} keyring={lineOptions(keyring)}
        imports={loaded.state === "ok" ? loaded.imports : []} scope={keys.scope} code={keys.html} status={status} was={grants.record(subject)}
        broughtChanged={pinMoved} fingerprint={fingerprint(keys.scope)} expires={grantExpiry(new Date())}
        hubAsk={covers(heldLevel(rec), appletLevel(entry.manifest)) ? null : { host: hostOf(rec.issuer), level: appletLevel(entry.manifest) }}
        approvedElsewhere={approvedElsewhere ? signedNow && signedNow.run ? signedNow.content.device ?? "another device" : null : null}
        signing={signing}
        onAllow={(asked) => void (async () => {
          // on a device with the person's key, Allow is an approval for every device: signed here, after the device
          // unlock (and the passcode, when one is set), and kept in the home vault. Approved elsewhere already: no new one
          if (!approvedElsewhere && await signsHere()) {
            setSigning(null);
            try {
              await signApproval({ subject: approvalSubject(rec, entry.noteId, entry.manifest.id), name, approved: true, code: keys.html, scope: loaded.state === "ok" ? loaded.asks : "", face: asked.face, passcode: needsPasscode && passcode ? passcode : null, runs: mode === "approved-code" ? "approved-code" : "sealed" });
            } catch (e) {
              setSigning(`Not approved: ${(e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : "it couldn't be signed").replace(/\.$/, "")}.`);
              return;
            }
          }
          // what its manifest needs at the hub, when this device doesn't hold it yet: asked there first (one vault, one
          // consent), and the Allow recorded only when the hub says yes (vault/signInFlow.ts finishStep)
          const need = appletLevel(entry.manifest);
          if (!covers(heldLevel(rec), need)) {
            setHubError(null);
            void askVault(rec, need, "allow", `${location.pathname}${location.search}`, { subject, scope: keys.scope, html: keys.html, mode: mode === "approved-code" ? "approved-code" : "sealed", asked })
              .then((url) => window.location.assign(url), (e: unknown) => setHubError(e instanceof Error ? e.message : "Your hub didn't answer."));
            return;
          }
          grants.grant(subject, keys.scope, keys.html, mode === "approved-code" ? "approved-code" : "sealed", grantExpiry, asked); if (brought && pinMoved && homeWritable()) void repin(brought, keys.html).then((pinned) => { if (pinned) setBrought({ ...brought, pointer: { ...brought.pointer, code: keys.html } }); }, () => {}); chooseHere(); setStarted(true); bump(); })()}
        onNotNow={() => setDeclined(true)} onBack={() => back((to, o) => (typeof to === "number" ? navigate(to) : navigate(to, o)))} />
    </>);
  }
  // revoked: when nothing else allowed here needs write, the app gives write back to the hub (vault/reach.ts)
  const revoke = () => {
    void (async () => {
      // on a device with the person's key, Revoke takes the approval back on every device (signed, after the unlock;
      // stopping never asks the passcode). It stops here whatever happens there, and says when it couldn't go further.
      let said: string | null = null;
      // whatever happens to the taking back, this device won't allow it again from an approval it saw before
      const sub = approvalSubject(rec, entry.noteId, entry.manifest.id);
      const seen = signedNow && (signedNow.run ? signedNow.content : signedNow.newest);
      if (seen) raiseFloor(sub, seen.n + 0.5);
      if (await signsHere()) {
        try {
          const r = await signApproval({ subject: approvalSubject(rec, entry.noteId, entry.manifest.id), name, approved: false, code: "", scope: "" });
          if (!r.written) said = `Stopped on this device. Your other devices keep running it until Parachute can change notes in your home vault.`;
        } catch (e) { said = `Stopped on this device only: ${e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : "the taking back couldn't be signed"}.`; }
      }
      grants.revoke(subject); setSigned(null); setStarted(false); setHubError(said); bump(); setRecheck((n) => n + 1);
      void giveBack(rec.key, `${location.pathname}${location.search}`);
    })();
  };
  // code imported from another vault runs inside it: a start after it hung the app holds it, until a tap
  if (heldForHang) return shell(<div className="card" role="status">
    <p>The app stopped while {name} was running. It imports code from another vault, which may have held it up.</p>
    <button type="button" className="primary" onClick={tap(() => { marks.clear(pageId); setHangCleared(true); setStarted(true); })}>Open {name}</button> {plainNote}
  </div>);
  if (!started) return shell(<div className="card" role="status">
    <p>{name} is stopped.{note && claim ? ` It will open ${titleOf(note)}.` : ""}</p>
    <button type="button" className="primary" onClick={tap(() => { chooseHere(); setStarted(true); })}>Open {name}</button> {plainNote}
  </div>);
  // how it runs, and Stop and Revoke: in the bar's menu (⋯), so the applet has the screen
  const closeMenu = () => setMenu(false);
  return shell(<>
    {menu && kept.shown && <AppletMenu glyph={entry.manifest.glyph} name={name} runs={mode === "approved-code" ? "Approved code only" : "Sealed"} onClose={closeMenu}
      note={note ? { title: handed ? titleOf(note) : undefined, href: `${noteHref(rec.key, note.id)}?with=vault` } : null}
      onStop={tap(() => { closeMenu(); setStarted(false); })} onRevoke={tap(() => { closeMenu(); revoke(); })} />}
    {late && "error" in late && late.hash === keys.html && <p className="error" role="alert">This applet can't run: its code doesn't compile: {late.error}.</p>}
    {router && page && savedNow && <AppletFrame key={`${keys.html}:${handed?.note.id ?? ""}`} html={page} title={name} router={router} grant={grant} ready={ready} onSession={onSession} onElement={(el) => { frameEl.current = el; }} height={sized ? Math.max(hostHeight.h, 80) : undefined} />}
    {sheets.ui}
    {device.ui}
    {router && page && sized && rec && isMine(rec) && <PageEmbeds host={rec} hostNote={entry.noteId} embeds={entry.embeds} from={loaded.state === "ok" ? loaded.from : []} />}
  </>, () => setMenu(true));
}

/** A running applet's menu, from the bar's ⋯: how it runs (and the note it was handed), then the note in the vault,
 *  Stop, Revoke and Settings. A sheet over the frame, as the bar's own long-press menu is. */
function AppletMenu({ glyph, name, runs, note, onStop, onRevoke, onClose }: { glyph: string; name: string; runs: string; note: { title?: string; href: string } | null;
  onStop: (e: React.MouseEvent) => void; onRevoke: (e: React.MouseEvent) => void; onClose: () => void }) {
  useEffect(() => { const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; addEventListener("keydown", esc); return () => removeEventListener("keydown", esc); }, [onClose]);
  return (
    <div className="sheet-scrim sheet-over-frames" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="sheet" role="dialog" aria-modal="true" aria-label={`${name} menu`}>
        <h2><span aria-hidden="true">{glyph}</span> {name}</h2>
        <p className="quiet sheet-line">{runs}{note?.title ? ` · ${note.title}` : ""}</p>
        <ul className="plain sheet-list">
          {note && <li><Link className="sheet-choice" to={note.href} onClick={onClose}>Open the note in the vault view</Link></li>}
          <li><button type="button" className="sheet-choice" onClick={onStop}>Stop</button></li>
          <li><button type="button" className="sheet-choice" onClick={onRevoke}>Revoke</button></li>
          <li><Link className="sheet-choice" to="/settings" onClick={onClose}>Settings</Link></li>
        </ul>
      </section>
    </div>
  );
}
