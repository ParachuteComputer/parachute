// The sealed frame (copied from the Uni app's src/interface/frame.tsx). The app's faces go in with the look, as data:
// URLs (theme/fonts.ts: the frame's content policy allows fonts only so), and the theme event names the same stacks.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import vaultClientSource from "virtual:vault-client-kit";
import reactKitSource from "virtual:react-kit";
import reactNoteKitSource from "virtual:react-note-kit";
import { modulePage, usesNote, type CodeKind } from "./code";
import { buildSrcdoc, NO_DEVICES } from "./srcdoc";
import { buildKitSource } from "./kits";
import { createSession, type Session } from "./session";
import { subscribeTheme, tokensNow } from "../theme/store";
import { cssOf } from "../theme/theme";
import { frameHead } from "../kit/frameCss";
import type { Router } from "./router";
import type { Resolved } from "./needs";
import { judge, loadedAgain } from "./violations";

/** Shown in place of a frame whose navigation the host CSP had to block. */
export const STOPPED_MESSAGE = "This applet tried to leave its sandbox and was stopped.";
/** The frame's devices (none: srcdoc.ts says why). */
export { NO_DEVICES };
/** When the app couldn't tell which frame on a page tried (docs/design/EMBED.md). */
export const PAGE_STOPPED_MESSAGE = "Something on this page tried to leave its sandbox, so the page was stopped.";
const KIT_SOURCE = buildKitSource({ vaultClientSource });

/** What runs in the frame for an applet's code: an HTML note as written; a TSX/JSX note as its transpiled module, with React. */
export const appletPage = (kind: CodeKind, content: string, js: string | null, name?: string): string => (kind === "html" ? content : modulePage(js ?? "", usesNote(content) ? reactNoteKitSource : reactKitSource, [], name));

/** The sealed srcdoc for an applet: CSP first, WebRTC removed, the kits, the look as it is now and the kit's sheets (so
 *  plain HTML and the parts are drawn in it from the first paint; later changes come as theme events), then the applet. */
export const frameSrcDoc = (html: string, { page = true }: { page?: boolean } = {}) => buildSrcdoc(html, { kitSource: KIT_SOURCE, headExtra: frameHead(cssOf(tokensNow()), { page }) });

/**
 * The sealed-frame host, shared by the real frame and the self-test's frame.
 * It owns the session (only messages from this iframe's own window are read),
 * the `ready`/`theme` events, and a host-side listener for `frame-src`
 * violations: the host CSP is what stops a navigation, and a violation is the
 * evidence that something tried one. The real frame stops on a violation.
 */
export function useSealedFrame(opts: { srcDoc: string; router: Router; grant: Resolved; ready?: unknown; stopOnViolation?: boolean; onViolation?: () => void; onSession?: (s: Session | null) => void;
  /** The look the frame gets (an embed's is narrower, embeds.ts `embedTokens`); the app's own by default. */ tokens?: () => Record<string, string> }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const session = useRef<Session | null>(null);
  const loaded = useRef<string | null>(null);
  const srcDocRef = useRef(opts.srcDoc);
  srcDocRef.current = opts.srcDoc;
  const readyRef = useRef(opts.ready);
  readyRef.current = opts.ready;
  const onViolationRef = useRef(opts.onViolation);
  onViolationRef.current = opts.onViolation;
  const onSessionRef = useRef(opts.onSession);
  onSessionRef.current = opts.onSession;
  // stopped because this frame tried to leave ("named"), or because something on the page did and no one frame could be
  // named ("unnamed")
  const [stopped, setStopped] = useState<false | "named" | "unnamed">(false);
  // which frame this is, for telling whose navigation a violation was (violations.ts)
  const id = useRef(`f${Math.random().toString(36).slice(2)}`);
  const tokensRef = useRef(opts.tokens ?? tokensNow);
  tokensRef.current = opts.tokens ?? tokensNow;
  // The frame gets its document only once the session is listening: a document that posts while parsing
  // (WebKit loads srcdoc synchronously on mount) would otherwise talk to nobody.
  const [armed, setArmed] = useState<string | null>(null);
  const { srcDoc, router, grant, stopOnViolation } = opts;

  useEffect(() => {
    setStopped(false);
    // targetOrigin must be "*": a sandboxed srcdoc frame's origin is opaque.
    const s = createSession({ post: (m) => frame.current?.contentWindow?.postMessage(m, "*"), router, grant });
    session.current = s;
    onSessionRef.current?.(s);
    // The frame can finish loading before this effect runs (WebKit does): tell a late session it is ready.
    if (loaded.current === srcDoc) s.sendEvent("ready", { contract: 1, ...(readyRef.current as object), theme: tokensRef.current() });
    const onMessage = (e: MessageEvent) => { if (e.source === null || e.source !== frame.current?.contentWindow) return; s.handle(e.data); };
    const onViolation = (e: SecurityPolicyViolationEvent) => {
      if (!(e.effectiveDirective || e.violatedDirective || "").startsWith("frame-src")) return;
      onViolationRef.current?.();
      // stop this frame if it is the one that navigated, or if no one frame can be named
      if (stopOnViolation) void judge(id.current).then((w) => { if (w !== "other") { s.close(); setStopped(w === "mine" ? "named" : "unnamed"); } });
    };
    window.addEventListener("message", onMessage);
    document.addEventListener("securitypolicyviolation", onViolation);
    setArmed(srcDoc);
    // the look changed (the person's theme record, or the device's light/dark): sent only when the tokens did
    let sent = JSON.stringify(tokensRef.current());
    const offTheme = subscribeTheme(() => { const t = tokensRef.current(), now = JSON.stringify(t); if (now !== sent) { sent = now; s.sendEvent("theme", t); } });
    return () => { s.close(); window.removeEventListener("message", onMessage); document.removeEventListener("securitypolicyviolation", onViolation); offTheme(); session.current = null; onSessionRef.current?.(null); };
  }, [srcDoc, router, grant, stopOnViolation]);

  const armedRef = useRef(armed);
  armedRef.current = armed;
  const onLoad = useCallback(() => {
    if (armedRef.current !== srcDocRef.current) return;
    // a second load of the same document is a navigation (stopped by the host CSP): say which frame it was
    if (loaded.current === srcDocRef.current) { loadedAgain(id.current); return; }
    loaded.current = srcDocRef.current;
    session.current?.sendEvent("ready", { contract: 1, ...(readyRef.current as object), theme: tokensRef.current() });
  }, []);
  return { frame, stopped, onLoad, srcDoc: armed === srcDoc ? srcDoc : undefined };
}

/**
* Applet HTML runs in `sandbox="allow-scripts"` (never allow-same-origin, so it
 * has an opaque origin, no storage, no Tauri) under a CSP that forbids all
 * network, inside a host whose own CSP allows only `frame-src about:`. Its
 * only door is the contract session.
 */
export default function AppletFrame({ html, title, router, grant, ready, onSession, onElement, height }: { html: string; title: string; router: Router; grant: Resolved; ready: unknown; /** The live session (null when it ends): the host's way to push events such as `open`. */ onSession?: (s: Session | null) => void;
  /** This frame's element, for the shell to tell a tap in it from a tap anywhere else. */ onElement?: (el: HTMLIFrameElement | null) => void;
  /** A page with embeds: the frame is as tall as its content, and the page scrolls as a whole. */ height?: number }) {
  // a page with embeds sits in the shell's own margins beside them: its frame is not a page of its own (no column)
  const sized = height !== undefined;
  const srcDoc = useMemo(() => frameSrcDoc(html, { page: !sized }), [html, sized]);
  const { frame, stopped, onLoad, srcDoc: liveDoc } = useSealedFrame({ srcDoc, router, grant, ready, stopOnViolation: true, onSession });
  const onElementRef = useRef(onElement);
  onElementRef.current = onElement;
  const ref = useCallback((el: HTMLIFrameElement | null) => { frame.current = el; onElementRef.current?.(el); }, [frame]);
  if (stopped) return <p className="applet-stopped error" role="alert">{stopped === "unnamed" ? PAGE_STOPPED_MESSAGE : STOPPED_MESSAGE}</p>;
  return <iframe ref={ref} className={height === undefined ? "applet-frame" : "applet-frame applet-frame-sized"} style={height === undefined ? undefined : { height }} title={title} sandbox="allow-scripts" allow={NO_DEVICES} referrerPolicy="no-referrer" srcDoc={liveDoc} onLoad={onLoad} />;
}
