// The Note part: a note's text as the app's note view draws it (surface-render, rich notes included: recipes with
// servings and timers, tasks, logs, callouts, charts from tables), in the theme's look. Heavier than the other parts, so
// the app puts it in an applet's frame only when the applet's code imports `Note`.
//
// A link in it never moves the sealed frame (that would stop the applet): a tap on one goes to `onLink`, with a
// wikilink's target as written (`[[Green herb rice]]` gives "Green herb rice") or a web link's address.
import type { MouseEvent } from "react";
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
  const onClickCapture = (e: MouseEvent) => {
    const a = (e.target as Element | null)?.closest?.("a[href]");
    if (!a) return;
    e.preventDefault();
    e.stopPropagation();
    tap(a.getAttribute("href") ?? "");
  };
  return (
    <div className="pa-note rn-theme-uni" onClickCapture={onClickCapture}>
      <NoteRenderer note={{ path: path ?? "note.md", content: body, tags: tags ? [...tags] : undefined, metadata: fields }} rich calm resolve={resolve} onNavigate={tap} openLink={tap} />
    </div>
  );
}
