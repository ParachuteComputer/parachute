// A page's embeds (docs/design/EMBED.md): under the host applet's own content, each component in its own sealed frame
// that the shell makes and alone speaks to, with its own session (its own vault, through the person's sign-in there;
// the theme; its height), its own grant per place, and every decision on a sheet above the page. The shell's sentences
// say why one can't run; a hostile component can't hide them.
import { useEffect, useMemo, useRef, useState } from "react";
import { NO_DEVICES } from "../applet/frame";
import { Link } from "react-router";
import { VaultAuthError, VaultPermissionError, VaultUnreachableError, type Note } from "@openparachute/surface-client";
import { PAGE_STOPPED_MESSAGE, useSealedFrame } from "../applet/frame";
import { holdPage, pageHeld, releaseFromPage } from "../applet/violations";
import { buildSrcdoc } from "../applet/srcdoc";
import { buildKitSource } from "../applet/kits";
import vaultClientSource from "virtual:vault-client-kit";
import reactKitSource from "virtual:react-kit";
import reactNoteKitSource from "virtual:react-note-kit";
import { codeHash, modulePage, prepare, usesNote } from "../applet/code";
import { updateLine } from "../applet/level";
import { componentNewer, parseComponent, propsFor, type Component } from "../applet/component";
import { embedKey, embedSubject, embedTokens, type Embed } from "../applet/embeds";
import { deviceGrants } from "../applet/grants";
import { grantExpiry, fingerprint, type Grant } from "../applet/grant";
import GrantCard from "../applet/GrantCard";
import { readPointers, repin, type PointerNote } from "../applet/pointers";
import { runDecision } from "../applet/selftest/gate";
import { useGate } from "../applet/selftest/run";
import { createRouter } from "../applet/router";
import { createVaultModule } from "../applet/modules/vault";
import { createThemeModule } from "../applet/modules/theme";
import { createPageModule } from "../applet/modules/page";
import { vaultDeps } from "../applet/vaultDeps";
import { ownFolder } from "../applet/discovery";
import { stripExt } from "../applet/contract";
import { pageMarks } from "../applet/pageMark";
import { tokensNow } from "../theme/store";
import { cssOf } from "../theme/theme";
import { FONTS_CSS } from "../theme/fonts";
import { clientFor, signInState } from "../vault/client";
import { MAX_CODE_CHARS, TooLargeError } from "../vault/limited";
import { originOf, listVaults, hostOf, type VaultRecord } from "../vault/store";
import { whoseOf, type Whose } from "../vault/whose";
import { LINK_OUT_HOLD_MS } from "../shell/frameSource";
import { useSettledPress } from "../ui/press";
import { resolvedOf } from "../applet/discovery";
import type { Manifest } from "../applet/manifest";

const grants = deviceGrants();
const KIT = buildKitSource({ vaultClientSource });
/** The smallest and largest an embed is drawn, and how much a host page may grow to. */
export const EMBED_MIN = 40, EMBED_MAX = 2000, PAGE_MAX = 20_000;

type Found = { rec: VaultRecord; whose: Whose; noteId: string; path: string; kind: "tsx" | "jsx"; source: string; component: Component; pointer: PointerNote | null };
type Place =
  | { state: "reading" }
  | { state: "held" }
  | { state: "no-sign-in"; vault: string; host: string }
  | { state: "offline"; vault: string }
  | { state: "refused"; vault: string }
  | { state: "gone"; name: string; vault: string }
  | { state: "invalid"; name: string; why: string }
  | { state: "newer"; name: string; why: string }
  | { state: "found"; found: Found };

/** Why a read of someone's vault failed, as the shell says it. A 403 is the vault's plain answer, not a refusal. */
export function failureOf(e: unknown): "refused" | "offline" | "large" | "other" {
  if (e instanceof VaultAuthError && !(e instanceof VaultPermissionError) && e.status === 401) return "refused";
  if (e instanceof TooLargeError || (e instanceof Error && e.cause instanceof TooLargeError)) return "large";
  if (e instanceof VaultUnreachableError || e instanceof TypeError) return "offline";
  return "other";
}

/** A failure that looks like the network may be a refusal the browser couldn't read: the sign-in says which. "alive":
 *  the hub answered and gave a fresh token, so it was neither; the call may be tried again. */
async function settled(rec: VaultRecord, f: ReturnType<typeof failureOf>): Promise<ReturnType<typeof failureOf> | "alive"> {
  if (f !== "offline") return f;
  const s = await signInState(rec.key);
  return s === "refused" ? "refused" : s === "alive" ? "alive" : "offline";
}

const theirsOf = (p: Place) => p.state === "found" && p.found.whose !== "mine";

/** Find what an embed names: a pointer in the home vault (by id or path), else a component in the host's vault. */
async function find(host: VaultRecord, embed: Embed): Promise<Place> {
  const pointers = await readPointers().catch(() => [] as PointerNote[]);
  const named = pointers.find((p) => p.noteId === embed.record || stripExt(p.path) === stripExt(embed.record)) ?? null;
  let rec: VaultRecord | null = host, ref = embed.record;
  if (named) {
    if (named.pointer.kind !== "component") return { state: "invalid", name: named.pointer.name, why: "it points to an applet, not a component" };
    rec = listVaults().find((v) => originOf(v.issuer) === named.pointer.hub && v.vault === named.pointer.vault) ?? null;
    if (!rec) { let h = named.pointer.hub; try { h = new URL(h).host; } catch { /* as written */ } return { state: "no-sign-in", vault: named.pointer.vault, host: h }; }
    ref = named.pointer.record;
  }
  const whose = whoseOf(rec);
  let n: Note | null;
  const read = async (again: boolean): Promise<Note | null | { failed: ReturnType<typeof failureOf> }> => {
    try { return await clientFor(rec!).getNote(ref); } catch (e) {
      const f = await settled(rec!, failureOf(e));
      // the sign-in was renewed: one more try
      if (f === "alive") return again ? read(false) : { failed: "offline" };
      return { failed: f };
    }
  };
  const got = await read(true);
  if (got && "failed" in got) {
    const f = got.failed;
    if (f === "refused") return { state: "refused", vault: rec.vault };
    if (f === "large") return { state: "invalid", name: named?.pointer.name ?? embed.name, why: "its record is bigger than a component from someone else's vault may be" };
    return { state: "offline", vault: rec.vault };
  }
  n = got;
  const name = named?.pointer.name ?? embed.name;
  if (!n) return { state: "gone", name, vault: rec.vault };
  const ext = String((n as { extension?: string }).extension ?? "md").replace(/^\./, "").toLowerCase();
  if (!(n.tags ?? []).includes("component")) return { state: "invalid", name, why: "its record isn't a component" };
  if (ext !== "tsx" && ext !== "jsx") return { state: "invalid", name, why: "a component is TSX or JSX" };
  const source = n.content ?? "";
  if (whose !== "mine" && source.length > MAX_CODE_CHARS) return { state: "invalid", name, why: "its code is bigger than a component from someone else's vault may be" };
  const later = componentNewer(n.metadata);
  if (later) return { state: "newer", name, why: later };
  const c = parseComponent(((n.metadata ?? {}) as Record<string, unknown>).component);
  if (!c.ok) return { state: "invalid", name, why: c.error };
  if (c.component.allow.some((r) => r.path.toLowerCase().startsWith("applets/"))) return { state: "invalid", name: c.component.name, why: "a component can't reach Applets/" };
  return { state: "found", found: { rec, whose, noteId: n.id, path: n.path ?? "", kind: ext, source, component: c.component, pointer: named } };
}

/** The embeds of one page, under its content. `page`: the host's vault and note, for the mark and the grants. */
export function PageEmbeds({ host, hostNote, embeds, from }: { host: VaultRecord; hostNote: string; embeds: Embed[]; /** the other vaults the host's card named */ from: string[] }) {
  const page = `${host.key}|${hostNote}`;
  const marks = pageMarks();
  const [held, setHeld] = useState(() => marks.suspect(page));
  // the mark is set before the first embed is read and kept while any is read or runs (pageMark.ts)
  useEffect(() => { if (held || !embeds.length) return; return marks.hold(page); }, [held, page, embeds.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const [asking, setAsking] = useState(false);
  if (held) return (
    <section className="embeds" aria-label="Embedded">
      <div className="embed-place embed-said" role="status"><p>The app stopped while these were running.</p>
        <button type="button" className="quiet-button" onClick={(e) => { if (e.isTrusted) setAsking(true); }}>Review</button></div>
      {asking && <Sheet label="Run them again?" onClose={() => setAsking(false)}>
        <h2>Run them again?</h2>
        <p>The app stopped while this page's embeds were running: one of them may have held it up. Run them again only if you think it was something else.</p>
        <SettledActions act="Run them" onAct={() => { marks.clear(page); setHeld(false); setAsking(false); }} onCancel={() => setAsking(false)} />
      </Sheet>}
    </section>
  );
  return <section className="embeds" aria-label="Embedded">{embeds.map((e) => <EmbedPlace key={e.name} host={host} hostNote={hostNote} embed={e} from={from} />)}</section>;
}

function EmbedPlace({ host, hostNote, embed, from }: { host: VaultRecord; hostNote: string; embed: Embed; from: string[] }) {
  const mode = useGate();
  const [place, setPlace] = useState<Place>({ state: "reading" });
  const [keys, setKeys] = useState<{ scope: string; hash: string; props: Record<string, unknown> } | null>(null);
  const [asking, setAsking] = useState(false);
  const [broke, setBroke] = useState<"refused" | "offline" | null>(null);
  const [, bump] = useState(0);
  const placeEl = useRef<HTMLDivElement>(null);
  const subject = embedSubject(host.key, hostNote, embed.name, place.state === "found" ? place.found.rec.key : "");
  useEffect(() => {
    let on = true;
    setPlace({ state: "reading" }); setKeys(null); setBroke(null);
    void find(host, embed).then(async (p) => {
      if (!on) return;
      // something from someone else's vault that the host's card didn't name (its pointer changed since): not run
      if (p.state === "found" && p.found.whose !== "mine" && !(p.found.rec.key === host.key) && !from.includes(`${p.found.rec.vault} at ${hostOf(p.found.rec.issuer)}`)) {
        if (on) setPlace({ state: "invalid", name: p.found.component.name, why: "it comes from a vault this page's card didn't name. Open the page again" });
        return;
      }
      if (p.state === "found") {
        const f = p.found, props = propsFor(f.component, embed.props);
        const [scope, hash] = await Promise.all([embedKey({ hub: originOf(f.rec.issuer), vault: f.rec.vault, record: f.noteId, allow: f.component.allow, props }), codeHash(f.kind, f.source)]);
        if (on) setKeys({ scope, hash, props });
      }
      if (on) setPlace(p);
    });
    return () => { on = false; };
  }, [host.key, hostNote, embed.name, embed.record, JSON.stringify(embed.props)]); // eslint-disable-line react-hooks/exhaustive-deps

  const found = place.state === "found" ? place.found : null;
  const status = found && keys ? grants.status(subject, keys.scope, keys.hash) : "none";
  const decision = found && keys ? runDecision(mode, status, grants.grantedUnder(subject)) : "ask";
  const pinMoved = !!found?.pointer && !!keys && found.pointer.pointer.code !== keys.hash;
  const pageId = `${host.key}|${hostNote}`;
  // the page was stopped and no one frame could be named: what comes from someone else's vaults waits at Review
  const held = theirsOf(place) && pageHeld(pageId, embed.name);
  const run = decision === "run" && !broke && !held;
  const name = found?.component.name ?? embed.name;
  const glyph = found?.component.glyph ?? "◇";
  const theirs = found ? found.whose !== "mine" : false;

  const say = (text: React.ReactNode, extra?: React.ReactNode) => <div className="embed-place embed-said" data-embed={embed.name} role="status"><p>{text}</p>{extra}</div>;
  if (mode === "closed") return say("Embeds are off on this device until its self-test passes.");
  if (place.state === "reading") return <div className="embed-place embed-said" data-embed={embed.name} aria-busy="true"><p className="quiet">Opening «{embed.name}»…</p></div>;
  if (place.state === "no-sign-in") return say(`This comes from «${place.vault}» at «${place.host}» (as its record says), and this device doesn't read that vault yet: open it in Settings, or add its Parachute.`, <Link to="/add">Add a Parachute</Link>);
  if (place.state === "offline") return say(`${place.vault} can't be reached right now.`);
  if (place.state === "refused") return say(`${place.vault} no longer lets this device in. Sign in to ${place.vault} again.`, <Link to="/settings">Settings</Link>);
  if (place.state === "gone") return say(`«${place.name}» is gone from ${place.vault}.`);
  if (place.state === "invalid") return say(`«${place.name}» can't run: ${place.why}.`);
  if (place.state === "newer") return say(<strong>{updateLine(place.name)}</strong>, <p className="quiet">It was made for a newer Parachute ({place.why}).</p>);
  if (!found || !keys) return null;
  if (broke === "refused") return say(`${found.rec.vault} no longer lets this device in. Sign in to ${found.rec.vault} again.`, <Link to="/settings">Settings</Link>);
  if (broke === "offline") return say(`${found.rec.vault} can't be reached right now.`);

  const grant: Grant = { applet: { id: found.component.id, name }, vault: found.rec.key, allow: found.component.allow, opens: [], app: [] };
  const line = (
    <p className="embed-line">
      <span aria-hidden="true">{glyph}{"︎"}</span> {name}{theirs ? <> · {found.rec.vault}'s</> : null}
      {run && <button type="button" className="quiet-button" onClick={(e) => { if (e.isTrusted) { grants.revoke(subject); bump((n) => n + 1); } }}>Revoke</button>}
    </p>
  );
  return (
    <div className="embed-place" data-embed={embed.name} ref={placeEl} tabIndex={-1}>
      {line}
      {run ? <EmbedFrame found={found} name={name} props={keys.props} onBroke={setBroke} onPageStopped={() => holdPage(pageId)} />
        : <div className="embed-said" role="status">
          <p>{held && decision === "run" ? `The page was stopped while «${name}», from ${found.rec.vault}, was on it.` : pinMoved ? `${found.rec.vault} changed «${name}» since you brought it in.` : status === "updated" ? `«${name}» changed since you allowed it.` : `«${name}»${theirs ? `, from ${found.rec.vault},` : ""} asks to run here.`}</p>
          <button type="button" className="quiet-button" onClick={(e) => { if (e.isTrusted) setAsking(true); }}>Review</button>
        </div>}
      {asking && <Sheet label={`${name} is asking for access`} onClose={() => setAsking(false)} back={placeEl}>
        <GrantCard what="component" name={name} glyph={glyph} vault={found.rec.vault} whose={found.whose} host={hostOf(found.rec.issuer)} runs={mode === "approved-code" ? "approved-code" : "sealed"}
          grant={grant} ownFolder={ownFolder(found.path)} scope={keys.scope} code={keys.hash} status={status} was={grants.record(subject)}
          broughtChanged={pinMoved} handed={keys.props} fingerprint={fingerprint(keys.scope)} expires={grantExpiry(new Date())} settle={LINK_OUT_HOLD_MS}
          onAllow={(asked) => {
            grants.grant(subject, keys.scope, keys.hash, mode === "approved-code" ? "approved-code" : "sealed", grantExpiry, asked);
            releaseFromPage(pageId, embed.name);
            // the pointer now pins this code: so does what this place remembers of it (a later Revoke asks plainly again)
            const was = found.pointer;
            if (was && pinMoved) void repin(was, keys.hash).then((pinned) => { if (pinned) setPlace((p) => (p.state === "found" && p.found.pointer?.noteId === was.noteId && p.found.pointer.pointer.code === was.pointer.code
              ? { ...p, found: { ...p.found, pointer: { ...p.found.pointer, pointer: { ...p.found.pointer.pointer, code: keys.hash } } } } : p)); }, () => {});
            setAsking(false); bump((n) => n + 1);
          }}
          onNotNow={() => setAsking(false)} />
      </Sheet>}
    </div>
  );
}

/** A sheet over the whole screen, above every frame; the page under it is held still while it is open. It takes the focus
 *  when it opens, so a screen reader (and Android's accessibility) moves into it, and a frame no longer holds the focus. */
function Sheet({ label, onClose, children, back }: { label: string; onClose: () => void; children: React.ReactNode; /** where the focus goes after, when what opened it is gone */ back?: React.RefObject<HTMLElement | null> }) {
  const box = useRef<HTMLElement>(null);
  useEffect(() => {
    // into the sheet, unless something in it took the focus already (Run them's Not now); back where it was after
    const was = document.activeElement as HTMLElement | null;
    if (!box.current?.contains(document.activeElement)) box.current?.focus();
    return () => { if (was && document.contains(was) && was !== document.body) was.focus(); else back?.current?.focus(); };
  }, []);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    addEventListener("keydown", esc);
    const was = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => { removeEventListener("keydown", esc); document.documentElement.style.overflow = was; };
  }, [onClose]);
  return (
    <div className="sheet-scrim sheet-over-frames" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section ref={box} tabIndex={-1} className="sheet" role="dialog" aria-modal="true" aria-label={label}>{children}</section>
    </div>
  );
}

function SettledActions({ act, onAct, onCancel }: { act: string; onAct: () => void; onCancel: () => void }) {
  // the same timing as Allow on a sheet (ui/press.ts)
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <div className="grant-actions">
      <button ref={ref} type="button" className="quiet-button" onClick={onCancel}>Not now</button>
      <SettledButton label={act} onPress={onAct} />
    </div>
  );
}
function SettledButton({ label, onPress }: { label: string; onPress: () => void }) {
  const press = useSettledPress(LINK_OUT_HOLD_MS);
  return <button type="button" className="primary" {...press.bind} onClick={(e) => { if (press.counts(e)) onPress(); }}>{label}</button>;
}

/** One embed's sealed frame: the component's code, its own session, its own vault (the shell watches those calls and
 *  says so when that hub refuses this device or can't be reached), the look as embeds get it, and its height. */
function EmbedFrame({ found, name, props, onBroke, onPageStopped }: { found: Found; name: string; props: Record<string, unknown>; onBroke: (why: "refused" | "offline") => void; onPageStopped: () => void }) {
  const [page, setPage] = useState<{ ok: true; html: string } | { ok: false; error: string } | null>(null);
  const [height, setHeight] = useState(EMBED_MIN);
  const brokeRef = useRef(onBroke);
  brokeRef.current = onBroke;
  // someone else's code is transpiled only now, after its Allow
  useEffect(() => {
    let on = true;
    void prepare(found.source, found.kind).then((c) => {
      if (!on) return;
      if (!c.compiled || !c.compiled.ok) { setPage({ ok: false, error: c.compiled && !c.compiled.ok ? c.compiled.error : "it couldn't be read" }); return; }
      setPage({ ok: true, html: modulePage(c.compiled.js, usesNote(found.source) ? reactNoteKitSource : reactKitSource, [], name) });
    });
    return () => { on = false; };
  }, [found.source, found.kind, name]);
  const router = useMemo(() => {
    const deps = vaultDeps(clientFor(found.rec));
    // the shell watches its own calls to that vault: a refusal of this device, or a hub that can't be reached
    const watch = <A extends unknown[], R>(f: (...a: A) => Promise<R>) => async (...a: A): Promise<R> => {
      try { return await f(...a); } catch (e) {
        const w = failureOf(e);
        if (w === "refused") brokeRef.current(w);
        else if (w === "offline") void settled(found.rec, w).then((x) => { if (x === "refused" || x === "offline") brokeRef.current(x); });
        throw e;
      }
    };
    return createRouter([
      createVaultModule({ listPaths: watch(deps.listPaths), getNote: watch(deps.getNote), search: watch(deps.search), create: deps.create && watch(deps.create), save: deps.save && watch(deps.save) }, { name: found.rec.vault }),
      createThemeModule({ theme: () => embedTokens(tokensNow() as unknown as Record<string, string>) }),
      createPageModule((l) => setHeight(Math.max(EMBED_MIN, Math.min(EMBED_MAX, l.height)))),
    ]);
  }, [found.rec.key, found.noteId]); // eslint-disable-line react-hooks/exhaustive-deps
  const ready = useMemo(() => ({ applet: { id: found.component.id, name }, props, page: { sized: true } }), [found.component.id, name, JSON.stringify(props)]); // eslint-disable-line react-hooks/exhaustive-deps
  // what its card allowed: its rules, in its own vault
  const grant = useMemo(() => resolvedOf({ allow: found.component.allow } as Manifest), [found.component]);
  if (!page) return <p className="quiet embed-said">Opening…</p>;
  if (!page.ok) return <p className="embed-said error" role="alert">«{name}» can't run: its code doesn't compile: {page.error}.</p>;
  return <EmbedIframe html={page.html} name={name} router={router} grant={grant} ready={ready} height={height} props={props} onPageStopped={onPageStopped} />;
}

function EmbedIframe({ html, name, router, grant, ready, height, props, onPageStopped }: { html: string; name: string; router: ReturnType<typeof createRouter>; grant: ReturnType<typeof resolvedOf>; ready: unknown; height: number; props: Record<string, unknown>; onPageStopped: () => void }) {
  const tokens = () => embedTokens(tokensNow() as unknown as Record<string, string>);
  const srcDoc = useMemo(() => buildSrcdoc(html, { kitSource: KIT, headExtra: `<style>${FONTS_CSS}${cssOf(tokens() as never).replace(/</g, "")}</style>` }), [html]); // eslint-disable-line react-hooks/exhaustive-deps
  const { frame, stopped, onLoad, srcDoc: live } = useSealedFrame({ srcDoc, router, grant, ready, stopOnViolation: true, tokens, onSession: (s) => { session.current = s; } });
  const session = useRef<{ sendEvent(e: string, d: unknown): void } | null>(null);
  const first = useRef(true);
  useEffect(() => { if (first.current) { first.current = false; return; } session.current?.sendEvent("props", props); }, [JSON.stringify(props)]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (stopped === "unnamed") onPageStopped(); }, [stopped]); // eslint-disable-line react-hooks/exhaustive-deps
  if (stopped === "unnamed") return <p className="embed-said error" role="alert">{PAGE_STOPPED_MESSAGE}</p>;
  if (stopped) return <p className="embed-said error" role="alert">«{name}» tried to leave its sandbox and was stopped.</p>;
  return <iframe ref={frame} className="embed-frame" title={name} sandbox="allow-scripts" allow={NO_DEVICES} referrerPolicy="no-referrer" srcDoc={live} onLoad={onLoad} style={{ height }} />;
}
