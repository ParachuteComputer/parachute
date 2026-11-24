// MailBody: a message's body as a good mail app draws it (docs/WRITE-AN-APPLET.md "MailBody"; Mail is its applet).
//   HTML   cleaned (mailClean.ts) and drawn in a shadow root of its own, so the mail's CSS can't touch the app and the
//          app's can't touch the mail; as tall as it is, and narrowed to fit the screen when the sender made it wider.
//          A mail that sets colours of its own sits on paper, as its sender saw it; one that doesn't takes the app's
//          look. Its links open in the browser through the kit's link.follow (the applet needs `links`), the address
//          they really go to shown while one is pointed at or held. Web pictures wait for "Show pictures" (the app's
//          `pictures`: the shell fetches them, never the frame); tracking pixels never load; the message's own inline
//          pictures (cid:) come from `inline`. A quoted reply folds.
//   text   wrapped, its web and mail addresses links, a quoted reply at its end folded.
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cleanMail, splitQuote } from "./mailClean";
import { findLinks } from "../links/note";
import { Link, link } from "./links";
import { Button, toast } from "./screen";
import "./parts.css";

type Got = { type: string; bytes: ArrayBuffer };
const kitApp = (): { picture?: (url: string) => Promise<Got> } => ((globalThis as unknown as { parachute?: { app?: { picture?: (url: string) => Promise<Got> } } }).parachute?.app ?? {});

/** The root's own CSS, under the mail's (which may override any of it but the root itself). */
const BASE = `
:host { display: block; position: relative; contain: paint; }
.pa-mail-fit { color: var(--text); font: var(--fs-body)/1.5 var(--sans); overflow-wrap: break-word; }
:host(.pa-mail-paper) .pa-mail-fit { background: #ffffff; color: #1d1d1f; color-scheme: light; border-radius: var(--radius-card, 10px); padding: 12px; }
a { color: var(--accent); }
:host(.pa-mail-paper) a { color: #0b57d0; }
img { max-width: 100%; height: auto; }
pre { white-space: pre-wrap; }
table { max-width: 100%; }
details.pa-quote { margin: 8px 0; }
details.pa-quote > summary { display: inline-block; cursor: pointer; list-style: none; font: var(--fs-small)/1.6 var(--sans); color: var(--muted); border: 1px solid var(--line); border-radius: 999px; padding: 0 10px; }
details.pa-quote > summary::-webkit-details-marker { display: none; }
:host(.pa-mail-paper) details.pa-quote > summary { color: #555555; border-color: #cccccc; }
`;
const style = (css: string) => { const s = document.createElement("style"); s.textContent = css; return s; };

/** A message's body: `html` when it has one, else `text`. */
export function MailBody({ html, text, pictures = false, onShowPictures, inline }: {
  html?: string | null;
  text?: string | null;
  /** Web pictures may load (the person showed them for this sender). */
  pictures?: boolean;
  /** Called by "Show pictures" (drawn when web pictures are hidden): show them, and remember the sender. */
  onShowPictures?: () => void;
  /** One of the message's own parts by its Content-ID, as a Blob (Mail: the gateway's raw blob), or null. */
  inline?: (cid: string) => Promise<Blob | null>;
}) {
  if (html) return <HtmlMail html={html} pictures={pictures} onShowPictures={onShowPictures} inline={inline} />;
  return <TextMail text={text ?? ""} />;
}

/** Web and mail addresses in plain text, as links (findLinks has the web ones; a bare www. address and an email
 *  address are a mail's own). */
function linked(text: string): ReactNode {
  type Hit = { start: number; end: number; to: string; shown: string };
  const hits: Hit[] = findLinks(text).filter((f) => /^https?:/i.test(f.raw)).map((f) => ({ start: f.start, end: f.end, to: f.raw, shown: f.raw }));
  const taken = (i: number) => hits.some((h) => i >= h.start && i < h.end);
  for (const m of text.matchAll(/\bwww\.[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/[^\s<>"]*)?|[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/gi)) {
    if (taken(m.index!)) continue;
    const raw = m[0].replace(/[.,;:!?)\]'"]+$/, "");
    hits.push({ start: m.index!, end: m.index! + raw.length, to: raw.includes("@") && !raw.startsWith("www.") ? `mailto:${raw}` : `https://${raw}`, shown: raw });
  }
  hits.sort((a, b) => a.start - b.start);
  const out: ReactNode[] = [];
  let at = 0;
  hits.forEach((h, i) => {
    if (h.start < at) return;
    if (h.start > at) out.push(<Fragment key={`t${i}`}>{text.slice(at, h.start)}</Fragment>);
    out.push(<Link key={`l${i}`} to={h.to}>{h.shown}</Link>);
    at = h.end;
  });
  if (at < text.length) out.push(<Fragment key="end">{text.slice(at)}</Fragment>);
  return out;
}

function TextMail({ text }: { text: string }) {
  const { said, quoted } = useMemo(() => splitQuote(text), [text]);
  return <div className="pa-mail-text">
    {linked(said)}
    {quoted && <details className="pa-quote"><summary>Quoted text</summary>{linked(quoted)}</details>}
  </div>;
}

/** At most this many web pictures asked of the shell at once. */
const AT_ONCE = 4;

function HtmlMail({ html, pictures, onShowPictures, inline }: { html: string; pictures: boolean; onShowPictures?: () => void; inline?: (cid: string) => Promise<Blob | null> }) {
  const host = useRef<HTMLDivElement>(null);
  // what has come: a picture's address (web or cid) → its blob: URL; what was asked, so nothing is asked twice
  const [got, setGot] = useState<ReadonlyMap<string, string>>(() => new Map());
  const asked = useRef(new Set<string>());
  const made = useRef<string[]>([]);
  const [failed, setFailed] = useState(0);
  const [dest, setDest] = useState<string | null>(null);
  const clean = useMemo(() => cleanMail(html, { show: pictures, web: (u) => got.get(u) ?? null, cid: (c) => got.get(`cid:${c}`) ?? null }), [html, pictures, got]);

  // the blobs made here go when it does
  useEffect(() => () => { for (const u of made.current) URL.revokeObjectURL(u); }, []);
  // what came is put in together, a moment after, so many pictures clean the mail a few times, not once each
  const pending = useRef(new Map<string, string>());
  const flush = useRef<ReturnType<typeof setTimeout> | null>(null);
  const arrived = (key: string, blob: Blob) => {
    const u = URL.createObjectURL(blob);
    made.current.push(u);
    pending.current.set(key, u);
    if (!flush.current) flush.current = setTimeout(() => { flush.current = null; const add = pending.current; pending.current = new Map(); setGot((m) => new Map([...m, ...add])); }, 60);
  };
  useEffect(() => () => { if (flush.current) clearTimeout(flush.current); }, []);

  // the message's own pictures, at once
  useEffect(() => {
    if (!inline) return;
    for (const c of clean.cids) {
      const key = `cid:${c}`;
      if (asked.current.has(key)) continue;
      asked.current.add(key);
      void inline(c).then((b) => { if (b) arrived(key, b); }, () => {});
    }
  }, [clean.cids.join("\n")]); // eslint-disable-line react-hooks/exhaustive-deps
  // web pictures, once shown: a few at a time, through the shell
  useEffect(() => {
    if (!pictures) return;
    const fetch = kitApp().picture;
    const todo = clean.web.filter((u) => !asked.current.has(u));
    if (!todo.length) return;
    if (typeof fetch !== "function") { setFailed((n) => n + todo.length); for (const u of todo) asked.current.add(u); return; }
    for (const u of todo) asked.current.add(u);
    let next = 0, gone = false;
    const one = async (): Promise<void> => {
      const u = todo[next++];
      if (u === undefined || gone) return;
      try { const r = await fetch(u); arrived(u, new Blob([r.bytes], { type: r.type })); } catch { setFailed((n) => n + 1); }
      return one();
    };
    for (let i = 0; i < Math.min(AT_ONCE, todo.length); i++) void one();
    return () => { gone = true; };
  }, [pictures, clean.web.join("\n")]); // eslint-disable-line react-hooks/exhaustive-deps

  // drawn into its own shadow root, and narrowed to fit when wider than the screen
  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    const root = el.shadowRoot ?? el.attachShadow({ mode: "open" });
    const fit = document.createElement("div");
    fit.className = "pa-mail-fit";
    fit.append(clean.root.cloneNode(true));
    root.replaceChildren(style(BASE), style(clean.css), fit);
    const size = () => {
      fit.style.removeProperty("zoom");
      const wide = fit.scrollWidth, room = el.clientWidth;
      if (room > 0 && wide > room + 1) fit.style.setProperty("zoom", String(Math.max(0.4, room / wide)));
    };
    size();
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(size) : null;
    ro?.observe(el);
    for (const img of root.querySelectorAll("img")) img.addEventListener("load", size, { once: true });
    return () => ro?.disconnect();
  }, [clean]);

  // a tap on a link opens it in the browser; pointing at one (or holding it) shows where it goes
  useEffect(() => {
    const root = host.current?.shadowRoot;
    if (!root) return;
    const linkOf = (e: Event) => (e.target instanceof Element ? e.target.closest("a[href]") : null);
    const click = (e: Event) => {
      const a = linkOf(e);
      if (!a) return;
      e.preventDefault();
      const to = a.getAttribute("href")!;
      setDest(to);
      void link.follow(to).then((went) => { if (!went) toast(`Couldn't open ${to}`, { error: true }); });
    };
    const over = (e: Event) => { const a = linkOf(e); setDest(a ? a.getAttribute("href") : null); };
    const hold = (e: Event) => { const a = linkOf(e); if (a) { e.preventDefault(); setDest(a.getAttribute("href")); } };
    const out = () => setDest(null);
    root.addEventListener("click", click);
    root.addEventListener("pointerover", over);
    root.addEventListener("focusin", over);
    root.addEventListener("pointerleave", out);
    root.addEventListener("contextmenu", hold);
    return () => { root.removeEventListener("click", click); root.removeEventListener("pointerover", over); root.removeEventListener("focusin", over); root.removeEventListener("pointerleave", out); root.removeEventListener("contextmenu", hold); };
  }, []);

  return <div className="pa-mail">
    {!pictures && clean.hidden > 0 && onShowPictures && <div className="pa-mail-pictures">
      <span>Pictures are hidden, so the sender can't tell when you read this.</span>
      <Button small onClick={onShowPictures}>Show pictures</Button>
    </div>}
    {pictures && failed > 0 && <p className="pa-mail-note">{failed === 1 ? "A picture" : `${failed} pictures`} couldn't load.</p>}
    <div ref={host} data-pa-mail="" className={clean.colored ? "pa-mail-paper" : undefined} onPointerLeave={() => setDest(null)} />
    {dest && <p className="pa-mail-dest" aria-live="polite"><span>Opens</span> {dest}</p>}
  </div>;
}
