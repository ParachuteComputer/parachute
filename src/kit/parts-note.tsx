// The Note part: a note's text as the app's note view draws it (surface-render, rich notes included: recipes with
// servings and timers, tasks, logs, callouts, charts from tables), in the theme's look. Heavier than the other parts, so
// the app puts it in an applet's frame only when the applet's code imports `Note`.
//
// A link in it never moves the sealed frame (that would stop the applet). Its note links (links.tsx) are the kit's: a
// `[[wikilink]]` (a note beside it in the same vault), a `<vault>:<ULID>` in its text and a note's address open in the
// app through the shell, a web address in the browser; a short form or wikilink that leads nowhere stays plain text.
// With `onLink`, a tap goes there instead, with a wikilink's target as written (`[[Green herb rice]]` gives
// "Green herb rice"), the `<vault>:<ULID>` or the web address: the applet may open it itself, or call `link.follow`.
// With `fetchBlob`, a picture the note links in the vault's storage (`/api/storage/…`) is drawn from the bytes it hands
// back (Vault gives `vaults.file` for the record: docs/design/PICTURES.md); without it, pictures aren't drawn: the note
// shows the picture's name in their place.
import { memo, useMemo, type MouseEvent } from "react";
import { NoteRenderer } from "@openparachute/surface-render/note";
import type { WikilinkResolver } from "@openparachute/surface-render/markdown";
import "@openparachute/surface-render/styles.css";
import "@openparachute/surface-render/rich-notes-kit.css";
import "./parts.css";
import { findNoteRefs } from "../links/note";
import { link, useAnswers } from "./links";

const WIKI = "#parachute-wikilink:";
const SHORT = "#parachute-note:";
const count = (s: string, c: string) => s.split(c).length - 1;
const wikiTarget = (raw: string) => raw.split("|")[0].split("#")[0].trim();

/** The `[[targets]]` and `<vault>:<ULID>`s in a note's text, outside code. */
function linksIn(body: string): { wikis: string[]; shorts: string[] } {
  const wikis = new Set<string>(), shorts = new Set<string>();
  eachProse(body, (text) => {
    for (const m of text.matchAll(/\[\[([^\]\n]{1,512})\]\]/g)) { const t = wikiTarget(m[1]); if (t) wikis.add(t); }
    for (const f of findNoteRefs(text)) if (f.ref.kind === "short") shorts.add(f.raw);
    return text;
  });
  return { wikis: [...wikis], shorts: [...shorts] };
}
/** The note's text with `f` applied to its prose: not fenced code, not inline code. */
function eachProse(body: string, f: (text: string) => string): string {
  let fence: string | null = null;
  return body.split("\n").map((line) => {
    const m = /^\s{0,3}(```+|~~~+)/.exec(line);
    if (fence) { if (m && m[1][0] === fence[0] && m[1].length >= fence.length) fence = null; return line; }
    if (m) { fence = m[1]; return line; }
    // an indented code line stays as written too
    if (/^(?: {4}|\t)/.test(line)) return line;
    // inline code spans stay as written
    return line.split(/(`+[^`]*`+)/).map((part, i) => (i % 2 ? part : f(part))).join("");
  }).join("\n");
}

/** `tags` and `fields` (the record's) let it draw a typed note richly: a note tagged `recipe` as a recipe. Drawn again
 *  only when what it is given changes: a page that draws many notes (a journal) and re-renders on every key typed
 *  above them doesn't parse each note again (T-476: typing showed late in a long journal). */
export const Note = memo(function Note({ body, path, tags, fields, onLink, fetchBlob }: { body: string; path?: string; tags?: readonly string[]; fields?: Record<string, unknown>; onLink?: (target: string) => void;
  /** The bytes of a file the note links in the vault's storage; keep it the same function between draws (useCallback). */
  fetchBlob?: (src: string) => Promise<Blob> }) {
  const found = useMemo(() => linksIn(body), [body]);
  // what the shell says each leads to: a wikilink is drawn missing when it leads nowhere, a short form only when it leads
  const wikis = useAnswers(onLink ? [] : found.wikis.map((t) => `[[${t}]]`), path);
  const shorts = useAnswers(found.shorts);
  const leads = found.shorts.filter((s) => shorts.get(s));
  const content = useMemo(() => (leads.length
    ? eachProse(body, (text) => {
      let out = "", at = 0;
      for (const f of findNoteRefs(text)) {
        // not inside a link's label (`[see uni:…](…)`): that link stands as written
        if (f.ref.kind !== "short" || !leads.includes(f.raw) || count(text.slice(0, f.start), "[") > count(text.slice(0, f.start), "]")) continue;
        out += text.slice(at, f.start) + `[${f.raw}](${SHORT}${encodeURIComponent(f.raw)})`;
        at = f.end;
      }
      return out + text.slice(at);
    })
    : body), [body, leads.join("\n")]); // eslint-disable-line react-hooks/exhaustive-deps
  const resolve: WikilinkResolver = (target) => {
    const t = wikiTarget(target);
    return { href: WIKI + encodeURIComponent(t), exists: onLink ? true : wikis.get(`[[${t}]]`) !== null };
  };
  const tap = (href: string) => {
    if (href.startsWith(WIKI)) {
      const t = decodeURIComponent(href.slice(WIKI.length));
      if (onLink) onLink(t); else void link.follow(`[[${t}]]`, { from: path });
    } else if (href.startsWith(SHORT)) {
      const s = decodeURIComponent(href.slice(SHORT.length));
      if (onLink) onLink(s); else void link.follow(s);
    } else if (onLink) onLink(href);
    else void link.follow(href, { from: path });
  };
  const hold = (href: string) => {
    if (onLink) return;
    if (href.startsWith(WIKI)) void link.follow(`[[${decodeURIComponent(href.slice(WIKI.length))}]]`, { from: path, choose: true });
    else if (href.startsWith(SHORT)) void link.follow(decodeURIComponent(href.slice(SHORT.length)), { choose: true });
    else if (link.parse(href)) void link.follow(href, { choose: true });
  };
  // the note, made once per change of what it is: a new object each render would redraw a rich note (and end cook mode)
  const note = useMemo(() => ({ path: path ?? "note.md", content, tags: tags ? [...tags] : undefined, metadata: fields }), [content, path, tags, fields]);
  const hrefAt = (e: MouseEvent) => (e.target as Element | null)?.closest?.("a[href]")?.getAttribute("href") ?? null;
  const onClickCapture = (e: MouseEvent) => {
    const href = hrefAt(e);
    if (href === null) return;
    e.preventDefault();
    e.stopPropagation();
    // a link within the note (a footnote) scrolls in place, here, not by moving the frame
    if (href.startsWith("#") && !href.startsWith(WIKI) && !href.startsWith(SHORT)) {
      let id = href.slice(1); try { id = decodeURIComponent(id); } catch { /* as written */ }
      document.getElementById(id)?.scrollIntoView();
      return;
    }
    tap(href);
  };
  return (
    <div className="pa-note rn-theme-uni" onClickCapture={onClickCapture}
      onContextMenuCapture={(e) => { const href = hrefAt(e); if (href === null || onLink) return; e.preventDefault(); hold(href); }}
      onAuxClickCapture={(e) => { if (hrefAt(e) !== null) e.preventDefault(); }}>
      {/* markdown whatever the path says (a dot in a title is not an extension); a note with no path is new with each body;
          drawn again once the wikilinks' answers are in (a missing one drawn as missing) */}
      <NoteRenderer key={`${path ?? body}\n${wikis.size}`} note={note} format="markdown" rich calm resolve={resolve} onNavigate={tap} openLink={tap} fetchBlob={fetchBlob} />
    </div>
  );
});
