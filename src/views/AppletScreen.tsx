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
import { approvalCoversSection } from "../applet/settingsSection";
import { endManageFor } from "../vault/manage";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import type { Note } from "@openparachute/surface-client";
import { Bar } from "../ui/Bar";
import { useVault } from "../vault/hooks";
import { clientFor, keptClientFor, keptReaderFor } from "../vault/client";
import { askAgain, onFresh } from "../vault/readCache";
import { noteHref, titleOf } from "../vault/notes";
import AppletFrame, { appletPage } from "../applet/frame";
import GrantCard from "../applet/GrantCard";
import { readApplet, resolvedOf, ownFolder, type AppletEntry } from "../applet/discovery";
import { updateLine } from "../applet/level";
import { claimOf, withoutRoles } from "../applet/opens";
import { readRoleTags } from "../open/roles";
import { fingerprint, grantExpiry, grantKey, grantOf } from "../applet/grant";
import { deviceGrants, subjectOf } from "../applet/grants";
import { codeHash, codeKindOf, extensionOf, modulePage, prepare, usesNote, type CodeKind } from "../applet/code";
import { readImports, type Imported } from "../applet/resolveImports";
import { compositeHash, importsOf } from "../applet/imports";
import reactKitSource from "virtual:react-kit";
import reactNoteKitSource from "virtual:react-note-kit";
import { embedsFrom, embedTargets, pointerFor, repin, type PointerNote } from "../applet/pointers";
import { createPageModule } from "../applet/modules/page";
import { createBackModule, MAX_BACKS } from "../applet/modules/back";
import { holdNativeBack } from "../shell/nativeBack";
import { PageEmbeds, PAGE_MAX } from "./Embeds";
import { isMine, useWhose, whoseOf } from "../vault/whose";
import { pageMarks } from "../applet/pageMark";
import { MAX_CODE_CHARS } from "../vault/limited";
import { findVault, hostOf, listVaults, originOf } from "../vault/store";
import { covers } from "../vault/parachute";
import { appletLevel, canWrite, giveBack, heldLevel } from "../vault/reach";
import { homeVault } from "../shell/frameSource";
import { onLevels } from "../shell/levels";
import { askVault } from "../vault/signInFlow";
import { screenOf } from "../applet/manifest";
import { createRouter } from "../applet/router";
import { createVaultModule } from "../applet/modules/vault";
import { createThemeModule } from "../applet/modules/theme";
import { tokensNow } from "../theme/store";
import { createAppModule, notTapped } from "../applet/modules/app";
import { createVoiceModule } from "../applet/modules/voice";
import { createVaultsModule } from "../applet/modules/vaults";
import { MAX_TOTAL as IMPORT_MAX } from "../kit/zip";
import { vaultsDeps } from "../shell/vaultsDeps";
import { createStorageModule } from "../applet/modules/storage";
import { storageFor } from "../shell/device";
import { deviceSaved, forgetSaved } from "../shell/saved";
import { asksOf, dOf } from "../applet/approvals";
import { approvalFor, floorOf, ownKey, passcodeHere, signApproval, signPick, signsHere, subjectOf as approvalSubject, takeBack } from "../applet/approvalStore";
import { approvedOtherLine, changedLine, lastCodeChange, type NoteNow, type Version } from "../applet/changedBy";
import { versionsOf } from "../vault/client";
import { sha256Hex } from "../applet/needs";
import { userOf } from "../services/signals";
import type { Content, Decision } from "../applet/approvals";
import { createSavedModule } from "../applet/modules/saved";
import { createSignalsModule } from "../applet/modules/signals";
import { setOwn } from "../services/signals";
import { useDeviceSheets } from "./DeviceSheets";
import { createServicesModule } from "../applet/modules/services";
import { createBroker, type Broker } from "../services/broker";
import { useShellSheets } from "./ShellSheets";
import { useVaultPick, refOf } from "./useVaultPick";
import { hideLine, lineHidden, MissingLine, PickLine, PickSheet, PickTicks, namesOf, pickChoices, reachLine } from "./VaultPick";
import { pickToSign, type VaultRef } from "../applet/vaultPick";
import { setDevicePick } from "../applet/pickStore";
import { lineOptions, useKeyring } from "../services/keyring";
import { launchOf, vaultLaunchOf } from "../services/notifyLink";
import { nativeNow } from "../services/native";
import { hubCheck, knownHubs } from "../services/hubs";
import type { Session } from "../applet/session";
import { appDeps, tappingIn } from "../shell/appDeps";
import { runDecision } from "../applet/selftest/gate";
import { useGate, useSelfTestRun } from "../applet/selftest/run";
import { vaultDeps } from "../applet/vaultDeps";
import { takeMark } from "../open/mark";
import { chooseStart, startChosenHere, takeStart } from "../shell/start";
import { barNow, settingsReadNow, useSettings } from "../shell/homeSettings";
import { backOrLauncher } from "../ui/Bar";
import NoVault from "../ui/NoVault";
import { useKept } from "../shell/kept";
import { inParachuteSpace, officialFace, officialNow, officialOf } from "../applet/parachuteSource";
import { failureNow, settled, type Failure } from "../vault/failure";
import { siteOf } from "../vault/site";

const grants = deviceGrants();

/** An applet's page from its code and what it imports, each transpiled (and cached) on its own. */
async function buildPage(kind: CodeKind, source: string, imports: readonly Imported[], name?: string): Promise<{ ok: true; page: string } | { ok: false; error: string }> {
  if (kind === "html") return { ok: true, page: source };
  const [host, ...parts] = await Promise.all([prepare(source, kind), ...imports.map((i) => prepare(i.source, i.kind))]);
  if (host.compiled && !host.compiled.ok) return { ok: false, error: host.compiled.error };
  const bad = parts.findIndex((p) => p.compiled && !p.compiled.ok);
  if (bad >= 0) return { ok: false, error: `«${imports[bad].id}»: ${(parts[bad].compiled as { error: string }).error}` };
  const js = (c: Awaited<ReturnType<typeof prepare>>) => (c.compiled && c.compiled.ok ? c.compiled.js : "");
  const note = usesNote(source) || imports.some((i) => usesNote(i.source));
  return { ok: true, page: modulePage(js(host), note ? reactNoteKitSource : reactKitSource, imports.map((i, k) => ({ id: i.id, js: js(parts[k]) })), name) };
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
/** How long an applet this device allowed waits for the home vault's approvals before it starts anyway. */
export const APPROVALS_WAIT_MS = 1500;
/** Whether this history entry was reached by a marked tap: decided once per entry (StrictMode renders twice). */
const startedByTap = new Map<string, boolean>();
/** The entries a start led to (start.ts), and whether the person chose that applet as home on this device. */
const startedAtStart = new Map<string, { chosen: boolean; vault: string; noteId: string }>();
/** The entries a start ran by itself (the home chosen here), with no tap: they stop if the settings stop naming it. */
const startedAsHome = new Set<string>();
/** A read's `id`, as the app asks for a note by it. */
const idOf = (read: string) => { try { return new URLSearchParams(read.slice(read.indexOf("?") + 1)).get("id"); } catch { return null; } };

/** `page` is null for code from someone else's vault until it is allowed: it is transpiled only then (`source` waits). */
type Loaded = { state: "loading" } | { state: "error"; error: string; failure: Failure } | { state: "refused"; error: string } | { state: "newer"; entry: AppletEntry }
  /** one of Parachute's own, asked for in a vault other than the home: it runs in the home (parachuteSource.ts) */
  | { state: "home"; to: string }
  | { state: "ok"; entry: AppletEntry;
      /** Parachute's own (parachuteSource.ts): loaded from the Parachute source, never from the vault; no card */
      official: boolean; page: string | null; source: { kind: CodeKind; text: string }; imports: Imported[]; note: Note | null; from: string[];
      /** the hash of what it asks as written, the same on every device (approvals.ts `asksHash`) */
      asks: string;
      /** that hash with a pick in it (docs/ACCESS.md proposal 5): the pick is read from the approval first */
      asksFor: (vaults: VaultRef[] | null) => Promise<string>;
      /** its note as the hub says it is now: its content's hash, who made it and wrote it last (applet/changedBy.ts) */
      now: NoteNow };

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
  const selfTest = useSelfTestRun();
  const keyring = useKeyring();
  const askedNote = params.get("note");
  const askedScreen = params.get("screen");
  if (!startedByTap.has(location.key)) {
    const tapped = takeMark(location.pathname), start = takeStart(location.pathname);
    if (start) startedAtStart.set(location.key, start);
    // a start runs it by itself only when the person chose it as home here (and, as always, allowed its code)
    startedByTap.set(location.key, tapped || !!start?.chosen);
    if (!tapped && start?.chosen) startedAsHome.add(location.key);
  }
  // so does any other way to that home (Back to it, the bar), when it isn't asked to open a note: while the settings, as
  // read this session, still name it, and the person chose it here. That read may be answered from the copy kept on
  // this device while the hub is asked behind it (vault/readCache.ts); a home the hub's answer no longer names stops (below)
  useSettings();
  const home = settingsReadNow() ? barNow().start : null;
  // a home applet is in a vault of the person's own: someone else's code never runs by itself
  const chosenHome = !askedNote && !!rec && !!appletId && isMine(rec) && home?.vault === rec.key && home.noteId === appletId && startChosenHere(rec.key, appletId);
  const atStart = startedAtStart.get(location.key) ?? null;
  // the person's tap on Allow or Open, on the screen a start led to, is their choice of it as home on this device
  const chooseHere = () => { if (atStart && !atStart.chosen) { chooseStart(atStart.vault, atStart.noteId); startedAtStart.set(location.key, { ...atStart, chosen: true }); } };
  const [started, setStarted] = useState(() => (startedByTap.get(location.key) ?? false) || chosenHome);
  // started as the home chosen here, by no tap: it stops when the settings, as read again, no longer name it
  const asHomeOnly = useRef(startedAsHome.has(location.key) || (!(startedByTap.get(location.key) ?? false) && chosenHome));
  const startByTap = () => { asHomeOnly.current = false; setStarted(true); };
  const named = !!rec && !!appletId && home?.vault === rec.key && home.noteId === appletId;
  useEffect(() => { if (asHomeOnly.current && settingsReadNow() && !named) { asHomeOnly.current = false; setStarted(false); } }, [named]); // eslint-disable-line react-hooks/exhaustive-deps
  // a tap counts for the first screen drawn for this entry only: Back or Forward to it later starts nothing (but the home
  // the person chose here, above)
  useEffect(() => () => { startedByTap.set(location.key, false); }, [location.key]);
  // a kept screen lives across history entries: a tap that led to a new one (the bar, a pin) starts it, as it would a
  // new screen
  // (a start that ran the home by itself is no tap: it still stops when the settings stop naming it)
  useEffect(() => { if (startedByTap.get(location.key)) { if (startedAsHome.has(location.key)) setStarted(true); else startByTap(); } }, [location.key]); // eslint-disable-line react-hooks/exhaustive-deps
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
    // answered from the copies kept of these reads at once, the hub asked behind them (vault/readCache.ts): when its
    // answer differs, the screen reads again (below), quietly, and changed code or a changed grant shows the card
    const c = keptClientFor(rec);
    void (async () => {
      try {
        // Parachute's own: decided by the address alone, before anything is read from the vault (an id in Parachute's
        // space is never asked of the hub), and loaded from the Parachute source (docs/design/PARACHUTE-SOURCE.md)
        const which = officialOf(appletId);
        if (inParachuteSpace(appletId) && !which) { if (on) setLoaded({ state: "newer", entry: { manifest: { contract: 2, id: "newer-parachute", name: "this applet", glyph: "·", allow: [], search: [], screens: [{ id: "home", name: "this applet" }] }, vault: rec.key, noteId: appletId, path: "", opens: [], app: [], embeds: [], services: [], signals: [], newer: true, newerWhy: "it is one of Parachute's own that this Parachute doesn't have" } }); return; }
        if (which) {
          const h = homeVault();
          if (!h) { if (on) setLoaded({ state: "refused", error: "it runs in your home vault, and this device has none yet" }); return; }
          if (h.key !== rec.key) { if (on) setLoaded({ state: "home", to: `/v/${encodeURIComponent(h.key)}/a/${encodeURIComponent(appletId)}${location.search}` }); return; }
        }
        const o = which ? await officialNow(which) : null;
        const n = o ? ({ id: appletId, path: o.record.path, content: o.body, tags: o.record.tags, metadata: o.record.fields, extension: o.record.extension } as unknown as Note) : await c.getNote(appletId);
        if (!n) { if (on) setLoaded({ state: "refused", error: "its note is gone" }); return; }
        // the note is the one asked for: a hub that answers with another id (one in Parachute's own space, say) would
        // give it another applet's saved state, counts and Revoke
        if (!o && (n.id !== appletId || inParachuteSpace(n.id))) { if (on) setLoaded({ state: "refused", error: "the hub answered with another note than the one asked for" }); return; }
        const kind = codeKindOf(n as { extension?: string });
        if (!kind) { if (on) setLoaded({ state: "refused", error: `its note is ${extensionOf(n as { extension?: string })}, and an applet's note is html, tsx or jsx` }); return; }
        if (notMine && (n.content ?? "").length > MAX_CODE_CHARS) { if (on) setLoaded({ state: "refused", error: "its code is bigger than an applet from someone else's vault may be" }); return; }
        const a = readApplet(n, rec.key, notMine, hubCheck());
        if (!a.ok) { if (on) setLoaded({ state: "refused", error: a.error }); return; }
        // written for a newer app (level.ts): nothing of it is compiled, asked or run
        if (a.entry.newer) { if (on) setLoaded({ state: "newer", entry: a.entry }); return; }
        // the vault's role tags are no applet's to open or to tag with: dropped before the card, the key and the writer
        a.entry.opens = withoutRoles(a.entry.opens, await readRoleTags(c));
        const note = askedNote ? await c.getNote(askedNote).catch(() => null) : null;
        const source = n.content ?? "";
        // someone else's code is only hashed here; it is transpiled once it is allowed (below)
        // a page that shows things from someone else's vaults says so on its card, and in its key (docs/design/EMBED.md)
        // Parachute's own run with no card, so nothing of a vault's may come into them: no imports, no embeds
        if (o && (a.entry.embeds.length || importsOf(source).length)) { if (on) setLoaded({ state: "refused", error: "Parachute's own applets bring in nothing from a vault (an import or an embed)" }); return; }
        const from = a.entry.embeds.length ? await embedsFrom(rec, a.entry.embeds) : [];
        // what it imports (component:<id>), from the person's own vaults or ones they trust: its hash covers each
        const imp = kind === "html" ? { ok: true as const, imports: [] } : await readImports(rec, source);
        if (!imp.ok) { if (on) setLoaded(imp.newer ? { state: "newer", entry: { ...a.entry, newerWhy: imp.error } } : { state: "refused", error: imp.error }); return; }
        const imports = imp.imports;
        // code from someone else's vault, its own or imported, is transpiled only once it is allowed
        const late = notMine || imports.some((i) => i.whose !== "mine");
        const [scope, code, pointer] = await Promise.all([grantKey({ ...grantOf(a.entry.manifest, rec.key, a.entry.opens, a.entry.app, a.entry.services, a.entry.signals, a.entry.settings), embedsFrom: from }, a.entry.path),
          late || imports.length ? codeHash(kind, source).then((hash) => ({ hash, compiled: null })) : prepare(source, kind), o ? null : pointerFor(rec, n.id).catch(() => null)]);
        const hash = imports.length && kind !== "html" ? await compositeHash(kind, source, imports) : code.hash;
        if (!on) return;
        // a recheck that finds what it allowed as it was keeps the screen as it is, unless its note itself changed (a page
        // drawn from the copy kept of it, whose record now hands its embeds other props, say)
        const prev = was.current.loaded.state === "ok" ? was.current.loaded : null;
        const sameNote = !!prev && prev.now.updatedAt === ((x: unknown) => (typeof x === "string" ? x : null))((n as unknown as Record<string, unknown>).updatedAt) && prev.note?.id === note?.id && (prev.note as { updatedAt?: string } | null)?.updatedAt === (note as { updatedAt?: string } | null)?.updatedAt;
        if (quiet && was.current.keys?.scope === scope && was.current.keys?.html === hash && sameNote) return;
        if (code.compiled && !code.compiled.ok) { setLoaded({ state: "refused", error: `its code doesn't compile: ${code.compiled.error}` }); return; }
        let page: string | null = null;
        if (kind === "html") page = source;
        else if (!late && !imports.length) page = appletPage(kind, source, code.compiled?.js ?? null, a.entry.manifest.name);
        else if (!late) { const built = await buildPage(kind, source, imports, a.entry.manifest.name); if (!on) return; if (!built.ok) { setLoaded({ state: "refused", error: `its code doesn't compile: ${built.error}` }); return; } page = built.page; }
        const targets = await embedTargets(a.entry.embeds).catch(() => ["unread"]);
        const asksFor = (vaults: VaultRef[] | null) => asksOf(approvalSubject(rec, n.id, a.entry.manifest.id), a.entry, (n.metadata ?? {}) as Record<string, unknown>, targets, vaults);
        const asks = await asksFor(null);
        if (!on) return;
        const said = n as unknown as Record<string, unknown>;
        const str = (x: unknown) => (typeof x === "string" ? x : null);
        const now: NoteNow = { hash: await sha256Hex(source), createdAt: str(said.createdAt), createdBy: str(said.createdBy), createdVia: str(said.createdVia), updatedAt: str(said.updatedAt), updatedBy: str(said.lastUpdatedBy), updatedVia: str(said.lastUpdatedVia) };
        if (!on) return;
        // a reload that isn't a quiet recheck (another note asked of it, say) reads the approvals again, and waits for them
        if (!quiet) { setSigned(null); setWaitedFor(null); }
        setLoaded({ state: "ok", entry: a.entry, official: !!o, page, source: { kind, text: source }, imports, note, from, asks, asksFor, now });
        setKeys({ scope, html: hash });
        setBrought(pointer);
      } catch (e) {
        // a recheck the vault couldn't answer (offline a moment) leaves the running screen as it is
        if (!on || quiet) return;
        setLoaded({ state: "error", error: e instanceof Error ? e.message : "the vault couldn't be read", failure: failureNow(rec, e) });
      }
    })();
    return () => { on = false; };
  }, [rec?.key, appletId, askedNote, notMine, recheck]); // eslint-disable-line react-hooks/exhaustive-deps

  // the hub's answer to a read this screen was drawn from differs from the copy: read again (quietly while it runs). Its
  // note, the vault's role tags, the pointers and components, and the approvals in the home vault
  useEffect(() => {
    if (!rec || !appletId) return;
    let t: ReturnType<typeof setTimeout> | null = null;
    // the vaults what it imports comes from (a component read by its id there)
    const from = new Set(was.current.loaded.state === "ok" ? was.current.loaded.imports.filter((i) => !i.own).map((i) => listVaults().find((v) => v.vault === i.vault && hostOf(v.issuer) === i.host)?.key).filter(Boolean) : []);
    const mine = (vault: string, key: string) => (vault === rec.key && (idOf(key) === appletId || (!!askedNote && idOf(key) === askedNote) || /[?&]id=\.parachute%2Fnotes%2Fsettings|[?&]tag=(?:component|parachute-pointer)(?:&|$)/.test(key)))
      || (vault === homeVault()?.key && /[?&]tag=parachute-pointer(?:&|$)|Parachute%2FApprovals%2F|[?&]tag=parachute-keys(?:&|$)/.test(key))
      || (from.has(vault) && (idOf(key) !== null || /[?&]tag=component(?:&|$)/.test(key)));
    const off = onFresh((vault, key) => { if (mine(vault, key) && !t) t = setTimeout(() => { t = null; setRecheck((n) => n + 1); }, 30); });
    return () => { off(); if (t) clearTimeout(t); };
  }, [rec?.key, appletId, askedNote, loaded.state === "ok" ? loaded.imports.map((i) => `${i.host} ${i.vault}`).join() : ""]); // eslint-disable-line react-hooks/exhaustive-deps

  const entry = loaded.state === "ok" ? loaded.entry : null;
  // Parachute's own: no card, no approval to read, no tap to wait for (docs/design/PARACHUTE-SOURCE.md)
  const official = loaded.state === "ok" && loaded.official;
  useEffect(() => { if (official) setStarted(true); }, [official]);
  // read by the saved and signals modules, which a running frame keeps
  const officialRef = useRef(false);
  officialRef.current = official;
  const subject = rec && entry ? subjectOf(rec.key, entry.noteId) : null;
  const status = subject && keys ? grants.status(subject, keys.scope, keys.html) : "none";
  // a signed approval in the home vault (applet/approvalStore.ts): read for this exact code and asks, on a device that
  // holds the person's key. One that covers it allows it here too; a newer one that takes it back stops it here.
  const signedFor = entry && rec && keys && loaded.state === "ok" && !loaded.official ? `${keys.html}|${loaded.asks}` : null;
  const [signed, setSigned] = useState<{ for: string; d: Decision | null } | null>(null);
  const [signing, setSigning] = useState<string | null>(null);
  // the sheet that changes what it reaches (and the vault it opens with ticked: Home's link to one it wasn't given)
  const [picking, setPicking] = useState<{ add: VaultRef | null; done?: (changed: boolean) => void } | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  // the card's ticks, before Allow
  const [ticked, setTicked] = useState<VaultRef[] | null>(null);
  const [passcode, setPasscode] = useState("");
  const [needsPasscode, setNeedsPasscode] = useState(false);
  // asked again when the levels change (the open bundle's record raised them after this screen opened)
  useEffect(() => { const ask = () => void passcodeHere().then(setNeedsPasscode); ask(); return onLevels(ask); }, []);
  useEffect(() => {
    if (!signedFor || !entry || !rec || loaded.state !== "ok" || !keys) return;
    let on = true;
    // the asks' hash is taken with the pick the newest approval holds, read before it (docs/ACCESS.md proposal 5)
    void approvalFor(approvalSubject(rec, entry.noteId, entry.manifest.id), keys.html, loaded.asksFor).then((d) => { if (on) setSigned({ for: signedFor, d }); }, () => { if (on) setSigned({ for: signedFor, d: null }); });
    return () => { on = false; };
  }, [signedFor, recheck]); // eslint-disable-line react-hooks/exhaustive-deps
  const signedNow = signed && signed.for === signedFor ? signed.d : undefined;
  // a device that allowed it waits for that read before starting it, up to APPROVALS_WAIT_MS: a taking back on another
  // device stops it before it runs. Slower than that (or offline), it starts on what this device allowed, and the answer
  // stops it when it comes (below). Review finding 16 (T-476); docs/design/APP-RECORD.md.
  const [waitedFor, setWaitedFor] = useState<string | null>(null);
  useEffect(() => {
    if (!signedFor) return;
    const t = setTimeout(() => setWaitedFor(signedFor), APPROVALS_WAIT_MS);
    return () => clearTimeout(t);
  }, [signedFor]);
  // the vaults it reaches (docs/ACCESS.md proposal 5): an applet whose `app` reaches across vaults reaches only its pick,
  // read from the approval checked here (or kept on this device), else the home (and its own vault)
  const approvalAt = rec && entry ? approvalSubject(rec, entry.noteId, entry.manifest.id) : null;
  const pickNow = useVaultPick({ rec, entry, official, subject: approvalAt, signed: official ? null : signedNow, recheck });
  // Parachute's own wait for their pick as an applet with a card waits for its approvals, up to the same time; then they
  // start on the home alone, and the pick, once read, starts them again on it
  const [pickWaited, setPickWaited] = useState<string | null>(null);
  const pickFor = official && pickNow.asks && approvalAt ? dOf(approvalAt) : null;
  useEffect(() => {
    if (!pickFor) return;
    const t = setTimeout(() => setPickWaited(pickFor), APPROVALS_WAIT_MS);
    return () => clearTimeout(t);
  }, [pickFor]);
  const approvalsRead = (official && (pickNow.read || pickWaited === pickFor)) || (!official && (signedNow !== undefined || (!!signedFor && waitedFor === signedFor)));
  // taken back on another device after it was allowed here, or a newer approval for other code (this code was put back
  // over it): it stops here too
  useEffect(() => {
    if (!subject || !signedNow || signedNow.run || (signedNow.why !== "withdrawn" && signedNow.why !== "other") || !signedNow.newest) return;
    const r = grants.record(subject);
    // taken back by the person on another device: what it saved here goes too, as with Revoke here
    if (r && Date.parse(r.grantedAt) < Date.parse(signedNow.newest.at)) { grants.revoke(subject); if (signedNow.why === "withdrawn") forgetSaved(subject); setStarted(false); bump(); }
  }, [signedNow, subject]); // eslint-disable-line react-hooks/exhaustive-deps
  // approved on another device, for this exact code and asks: allowed here too, when this device already holds what
  // its vault needs at the hub (else the card says so, and one tap asks the hub)
  // only from an approval no older than what this device has seen since (a Revoke here raises that), and, on a device
  // that runs approved code only, one made under that same warning
  const approvedElsewhere = !!signedNow?.run && status !== "ok" && !!subject && signedNow.content.n >= (floorOf(approvalSubject(rec!, entry!.noteId, entry!.manifest.id)) ?? 0)
    && (mode !== "approved-code" || signedNow.content.runs === "approved-code")
    // a section of Settings is out of the approval's hash: the card that was signed must have said it
    && approvalCoversSection(entry?.settings, entry?.manifest.name ?? "", signedNow.content.face);
  const hubCovers = !!entry && !!rec && covers(heldLevel(rec), appletLevel(entry.manifest));
  useEffect(() => {
    if (!approvedElsewhere || !hubCovers || !subject || !keys || !signedNow?.run) return;
    const c = signedNow.content;
    grants.grant(subject, keys.scope, keys.html, mode === "approved-code" ? "approved-code" : "sealed", () => new Date(c.expires), c.face ? { face: c.face, others: [] } : undefined);
    bump();
  }, [approvedElsewhere, hubCovers]); // eslint-disable-line react-hooks/exhaustive-deps
  const decision = runDecision(mode, status, subject ? grants.grantedUnder(subject) : null);
  // taken back since this device allowed it (the effect above forgets the grant): not drawn running in between
  const takenBack = !!subject && !!signedNow && !signedNow.run && (signedNow.why === "withdrawn" || signedNow.why === "other") && !!signedNow.newest
    && Date.parse(grants.record(subject)?.grantedAt ?? "") < Date.parse(signedNow.newest.at);
  const granted = official || (decision === "run" && !takenBack);
  // the passcode is typed for one card: gone once that card is answered, and when another takes its place (changed code
  // on a screen kept running would otherwise find it still filled in, and Allow would ask the unlock alone)
  useEffect(() => { setPasscode(""); }, [signedFor, granted]);
  // brought in at other code than this: the card is headed so, even where this device never allowed it
  const pinMoved = !!brought && !!keys && brought.pointer.code !== keys.html;
  // on the card: who changed the code, when, which version of the day it is (the note's kept versions, read once per
  // code shown, only for a card that says so), and an approval of other code this device read (approval fatigue: six
  // changes used to give six cards alike)
  const otherApproved = keys && signedNow && !signedNow.run && signedNow.why === "other" ? approvedOtherLine(signedNow.newest, keys.html, Date.now()) : null;
  const saysChange = !granted && (status !== "none" || pinMoved || !!otherApproved);
  const [kept_, setKept] = useState<{ for: string; versions: Version[] | null; key: string | null } | null>(null);
  useEffect(() => {
    if (!saysChange || !rec || !keys || loaded.state !== "ok" || kept_?.for === keys.html) return;
    let on = true;
    const at = keys.html;
    void Promise.all([versionsOf(rec, loaded.entry.noteId), ownKey()]).then(([versions, key]) => { if (on) setKept({ for: at, versions, key }); });
    return () => { on = false; };
  }, [saysChange, keys?.html, loaded.state]); // eslint-disable-line react-hooks/exhaustive-deps
  const keptNow = kept_ && keys && kept_.for === keys.html && loaded.state === "ok" ? kept_ : null;
  const changeNow = keptNow && loaded.state === "ok" ? (() => {
    const t = Date.now(), c = lastCodeChange(loaded.now, keptNow.versions, t);
    return changedLine(c.changed, { now: t, version: c.version, own: { key: keptNow.key, account: rec ? userOf(rec.accessToken) : null }, named: lineOptions(keyring).approverName });
  })() : null;
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
    void buildPage(kind, text, loaded.imports, loaded.entry.manifest.name).then((b) => { if (on) setLate(b.ok ? { hash: keys.html, page: b.page } : { hash: keys.html, error: b.error }); });
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
  // what was allowed, as one key: the note, its grant and its code. The frame's session (its router, its grant) is made
  // again only when that changes; a change to the note alone (its fields, a page's embeds) leaves a running frame as it is
  // (and the page's embeds: a frame learns it has them only as it starts, so adding or taking away one starts it again)
  const embedsKey = entry ? entry.embeds.map((e) => e.name).join(",") : "";
  const allowedKey = entry && keys ? `${entry.noteId}|${keys.scope}|${keys.html}|${embedsKey}` : null;
  const grant = useMemo(() => (entry ? resolvedOf(entry.manifest) : {}), [allowedKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // keyed on the vault, not the record object: a token refresh rewrites the record, and rebuilding the router would close
  // the frame's session with the very call that caused the refresh still waiting
  // the servers it declared (docs/design/SERVICES.md): a broker for each of its frame's sessions, opened with the session
  // and closed with it; its calls wait for it
  const brokerRef = useRef<{ session: Session; broker: Promise<Broker | null> } | null>(null);
  const sheets = useShellSheets(() => frameEl.current);
  const sheetsRef = useRef(sheets);
  sheetsRef.current = sheets;
  // the recorder and the file picker (docs/design/KEYRING.md "Voice, files, links, storage"): stable, as the router keeps them
  const device = useDeviceSheets(entry?.manifest.name ?? "This applet");
  const servicesWhy = useRef<string | null>(null);
  const sessionRef = useRef<Session | null>(null);
  // Back, held by the applet while it has screens of its own open (the kit's onBack, modules/back.ts). It gets one Back for
  // each it opened during the person's tap in it, so it can't keep anyone in: Backs it wasn't given leave, as before
  const backHold = useRef({ depth: 0, given: 0 });
  const [backHeld, setBackHeld] = useState(false);
  const onSession = (s: Session | null) => {
    // a frame made again (or gone) holds nothing until it says so
    if (sessionNow.current !== s) { backHold.current = { depth: 0, given: 0 }; setBackHeld(false); }
    // a frame made again (or gone) leaves no live watch behind it (modules/vaults.ts): the new one asks for its own
    if (sessionNow.current && sessionNow.current !== s) vaultsModule?.stop();
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
  // what the vaults words (Vault) read from the kept copies, per vault: the frame is told when one of those changes
  const vaultsReads = useRef(new Map<string, Set<string>>());
  const vaultsModule = useMemo(() => (rec && entry && (entry.app.includes("vaults") || entry.app.includes("sharing"))
    ? createVaultsModule(entry.app, vaultsDeps({ confirm: (q) => sheetsRef.current.confirm(q), emit: (event, data) => sessionNow.current?.sendEvent(event, data), back: () => window.location.pathname + window.location.search,
      // what it manages is its own, and a key's secret is shown on the shell's sheet (vault/manage.ts, ShellSheets.tsx)
      applet: subjectOf(rec.key, entry.noteId), reveal: (k) => sheetsRef.current.reveal(k),
      // only the vaults it was given (docs/ACCESS.md proposal 5), asked at each call; and the shell's sheet to change
      // that, during a tap in it (`vaults.ask`)
      given: pickNow.given,
      ask: () => (tappingIn(() => frameEl.current) ? new Promise<boolean>((done) => setPicking({ add: null, done })) : Promise.reject(notTapped())),
      // the shell's own picker, as `app.pick` opens it: only while the person taps in this applet
      // (a Notion export carries its images: up to the import's own limit, not an attachment's 25 MB)
      pick: (accept, multiple) => (tappingIn(() => frameEl.current) ? device.pick(accept, multiple, IMPORT_MAX, "Parachute reads it and writes it into this vault, under Notion/.") : Promise.reject(notTapped())),
      // Parachute's own Vault draws a record again when told: it may be answered from the copies kept of its reads
      ...(officialOf(entry.noteId) === "vault" ? { read: (vault: string, read: string) => { let m = vaultsReads.current.get(vault); if (!m) vaultsReads.current.set(vault, m = new Set()); if (m.size < 1000) m.add(read); } } : {}) }))
    : null), [rec?.key, allowedKey, pickNow.key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => vaultsModule?.stop(), [vaultsModule]);
  // left (another applet, the launcher, the shell's Back): whatever this applet was managing ends with it
  const managing = rec && entry ? subjectOf(rec.key, entry.noteId) : null;
  useEffect(() => () => { if (managing) endManageFor(managing); }, [managing]);
  // the frame's reads, from the kept copies while its page redraws on fresh data: noted, so it is told only of those
  const reader = useMemo(() => (rec ? keptReaderFor(rec) : null), [rec?.key, rec?.issuer]); // eslint-disable-line react-hooks/exhaustive-deps
  const router = useMemo(() => (rec && entry && reader ? createRouter([
    createVaultModule(vaultDeps(clientFor(rec), reader.client), { opens: entry.opens, name: rec.vault }),
    createThemeModule({ theme: tokensNow }),
    createAppModule(entry.app, appDeps((href) => navRef.current(href), () => frameEl.current, device, () => findVault(rec.key), entry.manifest.allow.filter((r) => r.verbs.includes("read")).map((r) => r.path), pickNow.given)),
    // the microphone (manifest `reach: [voice]`) and a little storage on this device (`app: [storage]`): not_granted without
    createVoiceModule(!!entry.manifest.reach?.includes("voice"), { record: (max) => (tappingIn(() => frameEl.current) ? device.record(max) : Promise.reject(notTapped())) }),
    createStorageModule(entry.app.includes("storage"), storageFor(subjectOf(rec.key, entry.noteId))),
    // what the kit saves as the person goes (drafts, where it was): every applet's, the same store as `storage`
    // only while it is allowed: a frame still going for a moment after Revoke leaves nothing behind
    createSavedModule({ all: () => deviceSaved().load(subjectOf(rec.key, entry.noteId)), put: (entries) => (officialRef.current || grants.record(subjectOf(rec.key, entry.noteId)) ? deviceSaved().put(subjectOf(rec.key, entry.noteId), entries) : Promise.reject(new Error("not allowed"))) }),
    // only while it is allowed, as saved state: a frame still going for a moment after Revoke says nothing
    createSignalsModule({ set: (id, count) => entry.signals.some((s) => s.id === id) && (officialRef.current || !!grants.record(subjectOf(rec.key, entry.noteId))) && setOwn(rec.key, entry.noteId, id, count) }),
    ...(entry.services.length ? [createServicesModule(async () => (brokerRef.current ? brokerRef.current.broker : null), () => servicesWhy.current)] : []),
    // a page with embeds grows to its content, and they follow it (docs/design/EMBED.md)
    ...(entry.embeds.length ? [createPageModule((l) => setHostHeight((h) => grow(h, l.height)))] : []),
    // one Back for a hold that grew during a tap (one, however much it grew), and never more than MAX_BACKS waiting
    createBackModule((depth) => {
      const b = backHold.current;
      if (depth > b.depth && tappingIn(() => frameEl.current)) b.given += 1;
      b.depth = depth;
      b.given = Math.min(b.given, depth, MAX_BACKS);
      setBackHeld(b.given > 0);
    }),
    // every vault this device holds (the Vault applet's words: modules/vaults.ts), and what reaches each
    ...(vaultsModule ? [vaultsModule] : []),
  ]) : null), [rec?.key, rec?.issuer, rec?.vault, allowedKey, vaultsModule, reader, pickNow.key]); // eslint-disable-line react-hooks/exhaustive-deps

  // the note it is handed: one it claims, never its own note, and only to the code that was allowed
  const note = loaded.state === "ok" ? loaded.note : null;
  const claim = entry && note && note.id !== entry.noteId ? claimOf(entry.opens, note) : null;
  const handed = (official || decision === "run") && claim && note ? { note: { id: note.id, path: note.path ?? "" }, screen: screenOf(entry!.manifest, claim.screen ?? askedScreen).id } : null;
  const name = entry?.manifest.name ?? "Applet";
  const sized = !!entry?.embeds.length;
  // a notification's tap opens the applet at a room and message (services/notifyLink.ts)
  const launch: { room: string; event?: string } | { vault: string; record?: string; show?: "changes" | "sharing" } | null = launchOf(params) ?? (entry?.app.includes("vaults") ? vaultLaunchOf(params) : null);
  const launchKey = launch ? ("room" in launch ? `${launch.room}|${launch.event ?? ""}` : `${launch.vault}|${launch.record ?? ""}|${launch.show ?? ""}|${location.key}`) : "";
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
  // the hub's answer to a read the frame made differs from the copy it was answered with: the frame is told, and the
  // kit's Page reads again (frameKit onFresh). Only its own reads: what changed elsewhere in the vault isn't its business
  useEffect(() => {
    if (!rec || !reader) return;
    let t: ReturnType<typeof setTimeout> | null = null;
    const off = onFresh((vault, read) => {
      if (!((vault === rec.key && reader.reads.has(read)) || vaultsReads.current.get(vault)?.has(read)) || t) return;
      t = setTimeout(() => { t = null; sessionNow.current?.sendEvent("vault.fresh", {}); }, 60);
    });
    return () => { off(); if (t) clearTimeout(t); };
  }, [rec?.key, reader]); // eslint-disable-line react-hooks/exhaustive-deps
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
    // shown again: its note and what it was judged on are asked of the hub again now, whenever they were last asked
    // hidden: what it was managing ends (vault/manage.ts), as when it is left
    if (!kept.shown) { device.cancel(); sheets.cancel(); setMenu(false); if (rec && entry) endManageFor(subjectOf(rec.key, entry.noteId)); } else {
      if (rec) askAgain(rec.key);
      const h = homeVault(); if (h && h.key !== rec?.key) askAgain(h.key, (read) => /Parachute%2FApprovals%2F|[?&]tag=parachute-(?:pointer|keys)(?:&|$)/.test(read));
      setRecheck((n) => n + 1);
    }
  }, [kept.shown]); // eslint-disable-line react-hooks/exhaustive-deps
  /** Give this Back to the applet, when it holds one it was given: true when it took it. */
  const backToApplet = () => {
    const b = backHold.current;
    if (!kept.shown || b.given <= 0 || !sessionNow.current) return false;
    b.given -= 1;
    setBackHeld(b.given > 0);
    sessionNow.current.sendEvent("back", {});
    return true;
  };
  // Android's Back, while it holds one (shell/nativeBack.ts); else the webview goes back, as before
  useEffect(() => (backHeld && kept.shown ? holdNativeBack(() => { if (!backToApplet()) backOrLauncher((to, o) => (typeof to === "number" ? navigate(to) : navigate(to, o))); }) : undefined), [backHeld, kept.shown]); // eslint-disable-line react-hooks/exhaustive-deps
  // a grant changed elsewhere (revoked in Settings while this was kept): drawn again, so it stops at once
  useEffect(() => grants.onChange(bump), []); // eslint-disable-line react-hooks/exhaustive-deps
  const tap = (f: () => void) => (e: React.MouseEvent) => { if (e.isTrusted) f(); };

  // ── what it reaches (docs/ACCESS.md proposal 5) ──
  // Save on the sheet, or Allow on the card: on a device with the person's key, a new approval signed after the unlock
  // (Parachute's own: the pick alone; an applet with a card: this code and asks, with the pick in them), so every device
  // follows it and nothing without the key can widen it; on a device without the key, kept here. Then a vault picked
  // that this device doesn't hold is asked of its hub (one page). Returns the approval signed, if one was.
  async function keepPick(ticked: VaultRef[], face?: string[]): Promise<Content | null> {
    if (!rec || !entry || !keys || !approvalAt || loaded.state !== "ok") throw new Error("it isn't open");
    const h = homeVault();
    const toSign = pickToSign(ticked, h ? refOf(h) : null, official ? null : refOf(rec));
    if (await signsHere()) {
      const code = passcode && needsPasscode ? passcode : null;
      // signed, then kept in the home vault: what it reaches follows at once, not after that write
      const r = official ? await signPick(approvalAt, name, toSign, code, (c) => pickNow.took(c.vaults ?? null))
        : await signApproval({ subject: approvalAt, name, approved: true, code: keys.html, scope: await loaded.asksFor(toSign), face, passcode: code, runs: mode === "approved-code" ? "approved-code" : "sealed", vaults: toSign,
          signed: (c) => { if (signedFor) setSigned({ for: signedFor, d: { run: true, content: c } }); } });
      return JSON.parse(r.ev.content) as Content;
    }
    // a device that reads signed picks but can't sign one (an anchor alone): a pick kept here would count for nothing
    if (pickNow.signed) throw new Error("Change it on a device that holds your key: this one reads the vaults you picked there");
    setDevicePick(dOf(approvalAt), toSign);
    return null;
  }
  const openPicked = (r: VaultRef) => void askVault({ issuer: r.hub, vault: r.vault }, "read", "open", `${location.pathname}${location.search}`)
    .then((url) => window.location.assign(url), (e: unknown) => setPickError(e instanceof Error ? e.message : "Its hub didn't answer."));
  const savePick = (ticked: VaultRef[]) => void (async () => {
    setPickError(null);
    let mine: Content | null;
    try {
      const was = signedNow && signedNow.run ? signedNow.content : null;
      mine = await keepPick(ticked, was?.face ?? (subject ? grants.record(subject)?.asked?.face : undefined));
    } catch (e) {
      setPickError(`Not changed: ${(e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : "it couldn't be signed").replace(/\.$/, "")}.`);
      return;
    }
    // the approval just signed is the newest: it holds here at once, whatever the home's copy says yet
    if (mine && !official && signedFor) setSigned({ for: signedFor, d: { run: true, content: mine } });
    picking?.done?.(true); setPicking(null); setPasscode(""); pickNow.again(); setRecheck((x) => x + 1);
    const first = ticked.find((r) => !listVaults().some((v) => refOf(v).hub === r.hub && v.vault === r.vault));
    if (first) openPicked(first);
  })();

  // Settings' Change (`?vaults=change`) opens the sheet over the applet once it runs
  const askedChange = params.get("vaults") === "change";
  useEffect(() => { if (askedChange && pickNow.asks && granted) setPicking({ add: null }); }, [askedChange, pickNow.asks, granted]); // eslint-disable-line react-hooks/exhaustive-deps
  const [, setLineGone] = useState(0);

  if (!rec) return <NoVault />;
  // Back returns where the person came from; on the first screen of a start, to the launcher
  const back = (nav: Parameters<typeof backOrLauncher>[0]) => { if (!backToApplet()) backOrLauncher(nav); };
  const plainNote = note ? <Link to={`${noteHref(rec.key, note.id)}?with=vault`}>Open {titleOf(note)} in the vault view</Link> : null;
  const theirsLabel = notMine ? ` · ${rec.vault}'s` : "";
  const shell = (body: React.ReactNode, onMenu?: () => void) => <main className="screen applet-screen"><Bar title={entry ? `${entry.manifest.glyph} ${name}${theirsLabel}` : loaded.state === "newer" ? `${loaded.entry.manifest.glyph} ${loaded.entry.manifest.name}${theirsLabel}` : "Applet"} back={true} onBack={back} onMenu={onMenu} />{atStart && !atStart.chosen && <p className="quiet start-line">Your settings open {name} when the app starts.</p>}{body}</main>;

  // Parachute's own run whatever the self-test found: it guards against code the person hasn't trusted, and this is the
  // app's own (docs/design/PARACHUTE-SOURCE.md). Not while it runs, though: its probes' escapes would stop any frame
  // beside them (applet/violations.ts), so a first start waits those few seconds
  if (officialOf(appletId) && (!selfTest.known || selfTest.running)) return shell(<p className="quiet" role="status">Opening…</p>);
  if (mode === "closed" && !officialOf(appletId)) return shell(<div className="card" role="status"><p>Applets are off on this device until its self-test passes. See Settings.</p>{plainNote}</div>);
  if (loaded.state === "loading" || (loaded.state === "ok" && !keys)) return shell(<p className="quiet" role="status">Opening…</p>);
  // a vault the app can't reach or whose sign-in was refused: what is wrong and what to do, in plain words; the hub's own
  // answer (an address, an id) under Details for anything else
  // Try again: a read that reached no hub may have been a refused sign-in the browser couldn't read (core 0.9): the
  // sign-in is asked first, at the person's tap only (a refresh retires the one before)
  const tryAgain = async (f: Failure) => {
    if (!rec) return;
    const now = await settled(rec, f).catch(() => f);
    if (now === "refused" && f !== "refused") setLoaded({ state: "error", error: "this device's sign-in was refused", failure: "refused" });
    else setRecheck((n) => n + 1);
  };
  if (loaded.state === "error" && rec && (loaded.failure === "offline" || loaded.failure === "refused")) {
    const which = officialOf(appletId), isHome = homeVault()?.key === rec.key;
    const runs = which ? ` ${officialFace(which).name} runs there.` : "";
    return shell(<div className="card" role="alert">
      {loaded.failure === "offline"
        ? <><p>Parachute can't reach {rec.vault}{isHome ? ", your home vault," : ""} just now.{runs}</p>
          <p className="small quiet">Its Parachute is {siteOf(rec.issuer)}.{isHome ? <> In <Link to="/settings">Settings</Link> you can make another vault your home.</> : null}</p></>
        : <><p>{rec.vault} on {siteOf(rec.issuer)} wants you to sign in again.{runs}</p>
          <p className="small quiet"><Link to={`/add?hub=${encodeURIComponent(originOf(rec.issuer))}`}>Sign in again</Link>{isHome ? <>, or make another vault your home in <Link to="/settings">Settings</Link></> : null}.</p></>}
      <p><button type="button" className="quiet-button" onClick={() => void tryAgain(loaded.failure)}>Try again</button></p>
    </div>);
  }
  if (loaded.state === "error") return shell(<div role="alert"><p className="error">Couldn't open this applet.</p><details className="small"><summary>Details</summary>{loaded.error}</details></div>);
  if (loaded.state === "home") return <Navigate to={loaded.to} replace />;
  if (loaded.state === "refused") return shell(<div className="card" role="alert"><p>This applet can't open. It was not run: {loaded.error}.</p>{plainNote}</div>);
  if (loaded.state === "newer") return shell(<div className="card" role="status"><p><strong>{updateLine(loaded.entry.manifest.name)}</strong></p><p className="quiet">It was made for a newer Parachute than this one, so nothing of it ran here{loaded.entry.newerWhy ? ` (${loaded.entry.newerWhy})` : ""}.</p>{plainNote}</div>);
  if (!entry || !keys || !subject) return null;

  if (!granted && signedNow === undefined) return shell(<p className="quiet" role="status">Opening…</p>);
  if (!granted) {
    if (declined) return shell(<div className="card"><p>{name} isn't allowed to run.</p><button type="button" className="primary" onClick={tap(() => setDeclined(false))}>Ask again</button> {plainNote}</div>);
    return shell(<>
      {note && <p className="quiet">{name} asks before it opens {titleOf(note)}.</p>}
      {hubError && <p className="error" role="alert">{hubError}</p>}
      {needsPasscode && !approvedElsewhere && <label className="line passcode-line"><span>Your passcode, to approve it</span> <input type="password" autoComplete="off" aria-label="Your passcode" value={passcode} onChange={(e) => setPasscode(e.target.value)} /></label>}
      <GrantCard name={name} glyph={entry.manifest.glyph} vault={rec.vault} whose={whoseOf(rec)} host={hostOf(rec.issuer)} runs={mode === "approved-code" ? "approved-code" : "sealed"}
        grant={{ ...grantOf(entry.manifest, rec.key, entry.opens, entry.app, entry.services, entry.signals, entry.settings), embedsFrom: loaded.state === "ok" ? loaded.from : [] }} ownFolder={ownFolder(entry.path)} keyring={lineOptions(keyring)}
        imports={loaded.state === "ok" ? loaded.imports : []} scope={keys.scope} code={keys.html} status={status} was={grants.record(subject)}
        broughtChanged={pinMoved} fingerprint={fingerprint(keys.scope)} expires={grantExpiry(new Date())}
        hubAsk={covers(heldLevel(rec), appletLevel(entry.manifest)) ? null : { host: hostOf(rec.issuer), level: appletLevel(entry.manifest) }}
        approvedElsewhere={approvedElsewhere ? signedNow && signedNow.run ? signedNow.content.device ?? "another device" : null : null}
        signing={signing} history={{ changed: changeNow, other: otherApproved }}
        pick={pickNow.asks && !approvedElsewhere ? <PickTicks choices={pickChoices()} ticked={ticked ?? pickNow.reach} onChange={setTicked} /> : undefined}
        onAllow={(asked) => void (async () => {
          // on a device with the person's key, Allow is an approval for every device: signed here, after the device
          // unlock (and the passcode, when one is set), and kept in the home vault. Approved elsewhere already: no new one
          let mine: Content | null = null;
          // what its ticks say, when it reaches across vaults: signed with the approval, or kept on this device
          const h = homeVault();
          const cardPick = pickNow.asks && !approvedElsewhere ? pickToSign(ticked ?? pickNow.reach, h ? refOf(h) : null, refOf(rec)) : null;
          const signsNow = !approvedElsewhere && await signsHere();
          if (pickNow.asks && !approvedElsewhere && !signsNow && approvalAt) setDevicePick(dOf(approvalAt), cardPick);
          if (signsNow) {
            setSigning(null);
            try {
              mine = JSON.parse((await signApproval({ subject: approvalSubject(rec, entry.noteId, entry.manifest.id), name, approved: true, code: keys.html, scope: loaded.state === "ok" ? await loaded.asksFor(cardPick) : "", face: asked.face, passcode: needsPasscode && passcode ? passcode : null, runs: mode === "approved-code" ? "approved-code" : "sealed", vaults: cardPick })).ev.content) as Content;
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
            void askVault(rec, need, "allow", `${location.pathname}${location.search}`, { subject, scope: keys.scope, html: keys.html, mode: mode === "approved-code" ? "approved-code" : "sealed", asked,
              // tapped on the screen a start led to: their choice of it as home, recorded with the grant when the hub says
              // yes (the page goes to the hub and comes back as another)
              ...(atStart && !atStart.chosen ? { home: { vault: atStart.vault, noteId: atStart.noteId } } : {}) })
              .then((url) => window.location.assign(url), (e: unknown) => setHubError(e instanceof Error ? e.message : "Your hub didn't answer."));
            return;
          }
          grants.grant(subject, keys.scope, keys.html, mode === "approved-code" ? "approved-code" : "sealed", grantExpiry, asked);
          // the approval just signed here is the newest: an older read (a taking back dated by a clock that runs ahead)
          // can't hold the card up
          if (mine && signedFor) setSigned({ for: signedFor, d: { run: true, content: mine } });
          if (brought && pinMoved && homeWritable()) void repin(brought, keys.html).then((pinned) => { if (pinned) setBrought({ ...brought, pointer: { ...brought.pointer, code: keys.html } }); }, () => {}); chooseHere(); startByTap(); bump(); })()}
        onNotNow={() => setDeclined(true)} onBack={() => back((to, o) => (typeof to === "number" ? navigate(to) : navigate(to, o)))} />
    </>);
  }
  // revoked: when nothing else allowed here needs write, the app gives write back to the hub (vault/reach.ts)
  const revoke = () => {
    void (async () => {
      // on a device with the person's key, Revoke takes the approval back on every device (signed, after the unlock;
      // stopping never asks the passcode). It stops here whatever happens there, and says when it couldn't go further
      // (applet/approvalStore.ts `takeBack`, as Revoke in Settings does).
      const seen = signedNow && (signedNow.run ? signedNow.content : signedNow.newest);
      const said = await takeBack(rec, entry.noteId, name, entry.manifest.id, seen?.n ?? null);
      grants.revoke(subject); forgetSaved(subject); if (approvalAt) setDevicePick(dOf(approvalAt), null); setSigned(null); setStarted(false); setHubError(said); bump(); setRecheck((n) => n + 1);
      void giveBack(rec.key, `${location.pathname}${location.search}`);
    })();
  };
  if (!approvalsRead) return shell(<p className="quiet" role="status">Opening…</p>);
  // code imported from another vault runs inside it: a start after it hung the app holds it, until a tap
  if (heldForHang) return shell(<div className="card" role="status">
    <p>The app stopped while {name} was running. It imports code from another vault, which may have held it up.</p>
    <button type="button" className="primary" onClick={tap(() => { marks.clear(pageId); setHangCleared(true); startByTap(); })}>Open {name}</button> {plainNote}
  </div>);
  if (!started) return shell(<div className="card" role="status">
    <p>{name} is stopped.{note && claim ? ` It will open ${titleOf(note)}.` : ""}</p>
    <button type="button" className="primary" onClick={tap(() => { chooseHere(); startByTap(); })}>Open {name}</button> {plainNote}
  </div>);
  // how it runs, and Stop and Revoke: in the bar's menu (⋯), so the applet has the screen
  const closeMenu = () => setMenu(false);
  // over it, one line at most: a vault it was opened on that it wasn't given (Home's count of changes), a vault it was
  // given that this device doesn't hold, or, for one of Parachute's own with no pick yet, what it reaches
  const pickLines = () => {
    if (!pickNow.asks || !approvalAt) return null;
    const launched = launch && "vault" in launch ? findVault(launch.vault) : null;
    if (launched && !pickNow.given(launched.key)) {
      const ref = refOf(launched);
      return <PickLine text={`${namesOf([ref])[0]} isn't one of ${name}'s vaults`} act="Add" onChange={() => setPicking({ add: ref })} />;
    }
    if (pickNow.missing.length) return <MissingLine refs={pickNow.missing} onOpen={openPicked} />;
    const d = dOf(approvalAt);
    if (official && pickNow.read && pickNow.pick === null && !lineHidden(d) && pickChoices().length > 1)
      return <PickLine text={reachLine(name, pickNow.reach)} onChange={() => setPicking({ add: null })} onDismiss={() => { hideLine(d); setLineGone((x) => x + 1); }} />;
    return null;
  };
  return shell(<>
    {menu && kept.shown && <AppletMenu glyph={entry.manifest.glyph} name={name} runs={official ? "Parachute's own" : mode === "approved-code" ? "Approved code only" : "Sealed"} onClose={closeMenu}
      note={note ? { title: handed ? titleOf(note) : undefined, href: `${noteHref(rec.key, note.id)}?with=vault` } : null}
      onStop={tap(() => { closeMenu(); setStarted(false); })} onRevoke={official ? null : tap(() => { closeMenu(); revoke(); })}
      onVaults={pickNow.asks ? tap(() => { closeMenu(); setPicking({ add: null }); }) : null} />}
    {pickLines()}
    {late && "error" in late && late.hash === keys.html && <p className="error" role="alert">This applet can't run: its code doesn't compile: {late.error}.</p>}
    {router && page && savedNow && <AppletFrame key={`${keys.html}:${handed?.note.id ?? ""}:${embedsKey}:${pickNow.key}`} html={page} title={name} router={router} grant={grant} ready={ready} onSession={onSession} onElement={(el) => { frameEl.current = el; }} height={sized ? Math.max(hostHeight.h, 80) : undefined} />}
    {sheets.ui}
    {device.ui}
    {picking && <PickSheet name={name} initial={picking.add && !pickNow.reach.some((r) => r.hub === picking.add!.hub && r.vault === picking.add!.vault) ? [...pickNow.reach, picking.add] : pickNow.reach}
      onSave={savePick} onCancel={() => { picking.done?.(false); setPicking(null); setPickError(null); }} error={pickError} passcode={needsPasscode ? { value: passcode, set: setPasscode } : null} />}
    {router && page && sized && rec && isMine(rec) && <PageEmbeds host={rec} hostNote={entry.noteId} embeds={entry.embeds} from={loaded.state === "ok" ? loaded.from : []} />}
  </>, () => setMenu(true));
}

/** A running applet's menu, from the bar's ⋯: how it runs (and the note it was handed), then the note in the vault,
 *  Stop, Revoke and Settings. A sheet over the frame, as the bar's own long-press menu is. */
function AppletMenu({ glyph, name, runs, note, onStop, onRevoke, onVaults, onClose }: { glyph: string; name: string; runs: string; note: { title?: string; href: string } | null;
  onStop: (e: React.MouseEvent) => void; onRevoke: ((e: React.MouseEvent) => void) | null; onVaults: ((e: React.MouseEvent) => void) | null; onClose: () => void }) {
  useEffect(() => { const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; addEventListener("keydown", esc); return () => removeEventListener("keydown", esc); }, [onClose]);
  return (
    <div className="sheet-scrim sheet-over-frames" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="sheet" role="dialog" aria-modal="true" aria-label={`${name} menu`}>
        <h2><span aria-hidden="true">{glyph}</span> {name}</h2>
        <p className="quiet sheet-line">{runs}{note?.title ? ` · ${note.title}` : ""}</p>
        <ul className="plain sheet-list">
          {note && <li><Link className="sheet-choice" to={note.href} onClick={onClose}>Open the note in the vault view</Link></li>}
          {onVaults && <li><button type="button" className="sheet-choice" onClick={onVaults}>Vaults it reaches</button></li>}
          <li><button type="button" className="sheet-choice" onClick={onStop}>Stop</button></li>
          {onRevoke && <li><button type="button" className="sheet-choice" onClick={onRevoke}>Revoke</button></li>}
          <li><Link className="sheet-choice" to="/settings" onClick={onClose}>Settings</Link></li>
        </ul>
      </section>
    </div>
  );
}
