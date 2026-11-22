// Settings' sections from applets (applet/settingsSection.ts, docs/WRITE-AN-APPLET.md "A section of Settings"): for each
// applet in a vault of the person's own that the open bundle offers and that declares `settings`, a section after
// Settings' own, its heading drawn by the shell, then that screen of the applet in a small sealed frame.
//
// What it may do there is less than on its own screen: it reads, in the folders its card allowed, and has the look and
// its height; nothing else (no writes, no app, no servers, no saved state, no counts, no microphone). So a section is
// a second, quiet copy of an applet that may also be running on its own screen (shell/kept.tsx), and the two share
// nothing but the vault. It runs only as allowed on this device: the code and the card's key the person allowed (the
// section is on the card, and in its key), and not when a newer approval in the home vault took it back. Otherwise the
// section says why in one line, with a way to the applet. An applet that imports a component or has embeds has no
// section (its code would come from more than one record). The sections sit after the shell's own, so a frame that
// changes height moves nothing of Settings' under a tap.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import type { Note } from "@openparachute/surface-client";
import AppletFrame from "../applet/frame";
import { resolvedOf } from "../applet/discovery";
import { codeKindOf, modulePage, prepare, usesNote } from "../applet/code";
import reactKitSource from "virtual:react-kit";
import reactNoteKitSource from "virtual:react-note-kit";
import { importsOf } from "../applet/imports";
import { deviceGrants, subjectOf } from "../applet/grants";
import { forgetSaved } from "../shell/saved";
import { onFresh } from "../vault/readCache";
import { runDecision } from "../applet/selftest/gate";
import { useGate } from "../applet/selftest/run";
import { createRouter } from "../applet/router";
import { createVaultModule } from "../applet/modules/vault";
import { createThemeModule } from "../applet/modules/theme";
import { createPageModule } from "../applet/modules/page";
import { vaultDeps } from "../applet/vaultDeps";
import { asksOf } from "../applet/approvals";
import { approvalFor, subjectOf as approvalSubject } from "../applet/approvalStore";
import { SECTION_MAX, SECTION_MIN } from "../applet/settingsSection";
import { useApplets, type Keyed } from "../applet/useApplets";
import type { Manifest } from "../applet/manifest";
import { tokensNow } from "../theme/store";
import { clientFor, keptClientFor } from "../vault/client";
import { originOf, type VaultRecord } from "../vault/store";
import { useWhose } from "../vault/whose";
import { offered } from "../shell/bundles";
import { openBundleNow, useSettings } from "../shell/homeSettings";
import { homeVault } from "../shell/frameSource";

const grants = deviceGrants();
/** How long a section waits for the approvals in the home vault before it starts on what this device allowed. */
const APPROVALS_WAIT_MS = 1500;

/** Every section, from the vaults of the person's own on this device. */
export default function BundleSections({ vaults }: { vaults: VaultRecord[] }) {
  const isMine = useWhose();
  useSettings();
  return <>{vaults.filter((v) => isMine(v) === "mine").map((v) => <SectionsIn key={v.key} rec={v} all={vaults} />)}</>;
}

function SectionsIn({ rec, all }: { rec: VaultRecord; all: VaultRecord[] }) {
  const applets = useApplets(rec, false);
  const ever = useRef<string[]>([]);
  if (applets.state !== "ok") return null;
  // only what the open bundle offers (shell/bundles.ts), as the list of applets shows them
  const home = homeVault(all);
  const app = openBundleNow();
  const held = { hub: originOf(rec.issuer), vault: rec.vault };
  const with_ = applets.found.entries.filter((a) => a.settings && !a.newer && (!home || offered(app, held, a, originOf(home.issuer))));
  // a section shown this visit keeps its place (empty) when it leaves the list (its record changed, the bundle no longer
  // offers it): Settings above it doesn't move
  for (const a of with_) if (!ever.current.includes(a.noteId)) ever.current.push(a.noteId);
  return <>{ever.current.map((id) => { const a = with_.find((x) => x.noteId === id); return <Held key={id}>{a ? <Section rec={rec} a={a} /> : null}</Held>; })}</>;
}

/** A section's place, never shorter than it has been while Settings is open: a frame that stops, goes or reads again
 *  (or one that collapses itself on purpose) leaves its room, so nothing of Settings above it slides under a tap. */
function Held({ children }: { children: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [most, setMost] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const o = new ResizeObserver(() => setMost((m) => Math.max(m, el.getBoundingClientRect().height)));
    o.observe(el);
    return () => o.disconnect();
  }, []);
  return <div ref={box} className="bundle-section-place" style={most ? { minHeight: most } : undefined}>{children}</div>;
}

type Read = { state: "reading" } | { state: "run"; html: string } | { state: "say"; line: string } | { state: "gone" };

function Section({ rec, a }: { rec: VaultRecord; a: Keyed }) {
  const mode = useGate();
  const [, bump] = useState(0);
  useEffect(() => grants.onChange(() => bump((n) => n + 1)), []);
  const subject = subjectOf(rec.key, a.noteId);
  const status = grants.status(subject, a.keys.scope, a.keys.html);
  const decision = runDecision(mode, status, grants.grantedUnder(subject));
  // only once allowed here as it is now: until then Settings draws nothing of it, not even its heading. (Where applets
  // run as approved code, not sealed, it runs so too: the person allowed it under that warning, its own screen can do
  // as much, and the section says whose it is under its frame.)
  const runs = status === "ok" && decision === "run";
  const name = a.manifest.name;
  const to = `/v/${encodeURIComponent(rec.key)}/a/${encodeURIComponent(a.noteId)}`;
  const [read, setRead] = useState<Read>({ state: "reading" });
  useEffect(() => {
    if (!runs) return;
    let on = true, offFresh = () => {}, t: ReturnType<typeof setTimeout> | null = null;
    setRead({ state: "reading" });
    void (async () => {
      const n = await keptClientFor(rec).getNote(a.noteId).catch(() => null) as (Note & { extension?: string; metadata?: Record<string, unknown> }) | null;
      if (!on) return;
      const kind = n ? codeKindOf(n) : null;
      const source = n?.content ?? "";
      if (!n || !kind) return setRead({ state: "say", line: `${name} can't be read right now.` });
      if (kind === "html" || importsOf(source).length || a.embeds.length) return setRead({ state: "say", line: `${name} can't show a section here: only a TSX or JSX applet that brings nothing in can.` });
      const code = await prepare(source, kind);
      // the code the person allowed, and nothing else: the list's key was read with it (useApplets.ts)
      if (code.hash !== a.keys.html) return on && setRead({ state: "gone" });
      if (!code.compiled || !code.compiled.ok) return on && setRead({ state: "say", line: `${name} doesn't compile right now.` });
      // a newer approval in the home vault that takes it back (another device's Revoke) stops it here too: waited for up
      // to APPROVALS_WAIT_MS before it starts, and heard whenever it comes after
      const asks = await asksOf(approvalSubject(rec, a.noteId, a.manifest.id), a, (n.metadata ?? {}) as Record<string, unknown>, []);
      // judged on the grant as it is when the answer comes (an Allow made meanwhile is newer than an old taking back),
      // and only while this section is on screen: the applet's own screen judges it otherwise
      const takenBack = (d: Awaited<ReturnType<typeof approvalFor>>) => on && !!d && !d.run && (d.why === "withdrawn" || d.why === "other") && !!d.newest
        && Date.parse(grants.record(subject)?.grantedAt ?? "") < Date.parse(d.newest.at);
      const answer = approvalFor(approvalSubject(rec, a.noteId, a.manifest.id), a.keys.html, asks).catch(() => null);
      // taken back elsewhere: taken back here too, as the applet's own screen does (its saved state goes only with a
      // withdrawal, not when older code was put back over a newer approval)
      const giveUp = (d: Awaited<ReturnType<typeof approvalFor>>) => { grants.revoke(subject); if (d && !d.run && d.why === "withdrawn") forgetSaved(subject); if (on) setRead({ state: "gone" }); };
      void answer.then((d) => { if (takenBack(d)) giveUp(d); });
      // the first answer may be the copy kept of the approvals: when the home vault's own answer differs, read again
      offFresh = onFresh((vault, key) => {
        if (vault !== homeVault()?.key || !/Parachute%2FApprovals%2F/.test(key) || t) return;
        t = setTimeout(() => { t = null; void approvalFor(approvalSubject(rec, a.noteId, a.manifest.id), a.keys.html, asks).catch(() => null).then((d) => { if (takenBack(d)) giveUp(d); }); }, 30);
      });
      if (!on) { offFresh(); return; }
      const signed = await Promise.race([answer, new Promise<null>((r) => setTimeout(() => r(null), APPROVALS_WAIT_MS))]);
      if (!on) return;
      if (takenBack(signed)) { giveUp(signed); return; }
      setRead({ state: "run", html: modulePage(code.compiled.js, usesNote(source) ? reactNoteKitSource : reactKitSource, [], name) });
    })();
    return () => { on = false; offFresh(); if (t) clearTimeout(t); };
  }, [runs, a.keys.html, a.keys.scope, rec.key]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!runs || read.state === "gone") return null;
  return (
    <section className="card bundle-section" aria-label={a.settings!.name}>
      <h2>{a.settings!.name}</h2>
      {/* whose it is, above its frame: what the frame draws under it is the applet's, not Settings' */}
      <p className="small quiet bundle-section-from">From <Link to={to}><span aria-hidden="true">{a.manifest.glyph}{"\uFE0E"}</span> {name}</Link></p>
      {read.state === "say" ? <p className="quiet">{read.line} <Link to={to}>Open {name}</Link></p>
        : read.state === "run" ? <SectionFrame html={read.html} rec={rec} a={a} /> : <p className="quiet" aria-busy="true">Opening…</p>}
    </section>
  );
}

/** Reads only, in the folders its card allowed: what a section may do. */
const readsOnly = (m: Manifest) => m.allow.map((r) => ({ path: r.path, verbs: r.verbs.filter((v) => v === "read") })).filter((r) => r.verbs.length > 0);

function SectionFrame({ html, rec, a }: { html: string; rec: VaultRecord; a: Keyed }) {
  const [height, setHeight] = useState(SECTION_MIN);
  const allow = useMemo(() => readsOnly(a.manifest), [a.manifest]);
  const grant = useMemo(() => resolvedOf({ allow } as Manifest), [allow]);
  const router = useMemo(() => {
    const deps = vaultDeps(clientFor(rec));
    return createRouter([
      // reads only: no create, no save
      createVaultModule({ listPaths: deps.listPaths, getNote: deps.getNote, search: deps.search, listFields: deps.listFields, list: deps.list }, { name: rec.vault }),
      createThemeModule({ theme: tokensNow }),
      // it grows and never shrinks while it is on screen: a frame that shrank under a tap would slide what is above it
      createPageModule((l) => setHeight((h) => Math.max(h, Math.min(SECTION_MAX, l.height)))),
    ]);
  }, [rec.key, a.noteId]); // eslint-disable-line react-hooks/exhaustive-deps
  const ready = useMemo(() => ({ applet: { id: a.manifest.id, name: a.manifest.name }, access: allow, services: [], place: "settings", screen: a.settings!.screen, page: { sized: true }, shown: true }), [a.manifest.id, a.manifest.name, a.settings!.screen, allow]); // eslint-disable-line react-hooks/exhaustive-deps
  return <AppletFrame html={html} title={a.settings!.name} router={router} grant={grant} ready={ready} height={height} />;
}
