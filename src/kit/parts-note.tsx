// The Note part: a note's text as the app's note view draws it (surface-render, rich notes included: recipes with
// servings and timers, tasks, logs, callouts, charts from tables), in the theme's look. Heavier than the other parts, so
// the app puts it in an applet's frame only when the applet's code imports `Note`.
//
// A link in it never moves the sealed frame (that would stop the applet): a tap on one goes to `onLink`, with a
// wikilink's target as written (`[[Green herb rice]]` gives "Green herb rice") or a web link's address.
import { useMemo, type MouseEvent } from "react";
import { NoteRenderer } from "@openparachute/surface-render/note";
import type { WikilinkResolver } from "@openparachute/surface-render/markdown";
import "@openparachute/surface-render/styles.css";
import "@openparachute/surface-render/rich-notes-kit.css";
import "./parts.css";

const WIKI = "#parachute-wikilink:";
const resolve: WikilinkResolver = (target) => ({ href: WIKI + encodeURIComponent(target.split("|")[0].split("#")[0]), exists: true });

/** `tags` and `fields` (the record's) let it draw a typed note richly: a note tagged `recipe` as a recipe. */
export function Note({ body, path, tags, fields, onLink }: { body: string; path?: string; tags?: readonly string[]; fields?: Record<string, unknown>; onLink?: (target: string) => void }) {
  const tap = (href: string) => onLink?.(href.startsWith(WIKI) ? decodeURIComponent(href.slice(WIKI.length)) : href);
  // the note, made once per change of what it is: a new object each render would redraw a rich note (and end cook mode)
  const note = useMemo(() => ({ path: path ?? "note.md", content: body, tags: tags ? [...tags] : undefined, metadata: fields }), [body, path, tags, fields]);
  const onClickCapture = (e: MouseEvent) => {
    const a = (e.target as Element | null)?.closest?.("a[href]");
    if (!a) return;
    const href = a.getAttribute("href") ?? "";
    // a link within the note (a footnote) scrolls in place: the kit does that, without moving the frame
    if (href.startsWith("#") && !href.startsWith(WIKI)) return;
    e.preventDefault();
    e.stopPropagation();
    tap(href);
  };
  return (
    <div className="pa-note rn-theme-uni" onClickCapture={onClickCapture} onAuxClickCapture={(e) => { if ((e.target as Element | null)?.closest?.("a[href]")) e.preventDefault(); }}>
      {/* markdown whatever the path says (a dot in a title is not an extension); a note with no path is new with each body */}
      <NoteRenderer key={path ?? body} note={note} format="markdown" rich calm resolve={resolve} onNavigate={tap} openLink={tap} />
    </div>
  );
}
