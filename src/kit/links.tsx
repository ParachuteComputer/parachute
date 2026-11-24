// Links in an applet: the kit's one way to draw and follow a link (docs/WRITE-AN-APPLET.md "Links"). Applets never
// make their own <a> or call the shell's link calls: they use these, and the Note part, which uses them too.
//   link     .to(record)  the one form a link to a note is written in (its address on its hub, links/note.ts), made by
//                         the shell for a note of the applet's own vault;  .follow(target, {from, choose})  open it;
//                         .open(record)  open a note of its own vault;  .parse(text) what a link names;
//                         .find(text) the links in plain text
//   Link     one link: a note's address, `<vault>:<ULID>`, `[[target]]` (with `from`, the note it is in) or a web
//            address. A note link is drawn as a link only when the shell says it leads somewhere ("note" or "away");
//            until then, and when it leads nowhere (a vault name the person doesn't have), it is the plain text. A tap
//            asks the shell to open it (open-with decides how); a long-press or right-click asks with Open with…
//   Linked   plain text with every link in it drawn as a Link
// What a link leads to is asked of the shell (app.links), a batch at a time, once a link a frame; one that led nowhere,
// or couldn't be asked, again when the applet is shown again or the app comes back to the front.
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { findLinks, LINKS_PER_CALL, parseNoteRef } from "../links/note";
import "./parts.css";

export type Answer = "note" | "away" | null;
type KitApp = {
  links?: (links: string[], from?: string) => Promise<Answer[]>;
  follow?: (link: string, o?: { from?: string; choose?: boolean }) => Promise<boolean>;
  address?: (note: string) => Promise<string | null>;
  openLink?: (url: string) => Promise<boolean>;
};
type Kit = { app?: KitApp; onShown?(cb: (on: boolean) => void): () => void };
const kit = (): Kit => (globalThis as unknown as { parachute?: Kit }).parachute ?? {};
const app = (): KitApp => kit().app ?? {};

const answers = new Map<string, Promise<Answer>>();
/** What each asking came to, once it came (a link asked again lets go only of an answer of nothing). */
const came = new WeakMap<Promise<Answer>, Answer>();
let waiting: { link: string; from?: string; res: (a: Answer) => void }[] = [];
const keyOf = (link: string, from?: string) => (link.startsWith("[[") ? `${from ?? ""}\n${link}` : link);
function flush() {
  const all = waiting;
  waiting = [];
  const groups = new Map<string, typeof all>();
  for (const w of all) { const k = w.from ?? ""; groups.set(k, [...(groups.get(k) ?? []), w]); }
  // a few links a call, one call after another: each costs reads from the frame's budget, so a long history's links
  // are asked over a little time instead of all at once (the kit's line waits out a busy shell)
  const parts: [string, typeof all][] = [];
  for (const [from, ws] of groups) for (let i = 0; i < ws.length; i += LINKS_PER_CALL) parts.push([from, ws.slice(i, i + LINKS_PER_CALL)]);
  const ask = app().links;
  // over the frame's read budget, the shell says so in its own words: this batch waits out the ten seconds by itself,
  // without stopping the applet's other calls
  const once = (links: string[], from: string | undefined, tries = 0): Promise<unknown> => ask!(links, from).catch((e: { code?: string; message?: string }) =>
    e?.code === "rate_limited" && e.message !== "rate_limited" && tries < 6 ? new Promise((r) => setTimeout(r, 5000)).then(() => once(links, from, tries + 1)) : Promise.reject(e));
  void parts.reduce((prev, [from, part]) => prev.then(() => {
    // without the shell's answer (an applet not allowed `open`, an older app) nothing is a note link
    const asked = ask ? once(part.map((w) => w.link), from || undefined) : Promise.reject(new Error("no links call"));
    return asked.then((a) => part.forEach((w, j) => w.res(Array.isArray(a) && (a[j] === "note" || a[j] === "away") ? a[j] : null)), () => part.forEach((w) => {
      // asked again by the next draw that wants it (a busy shell, a lapse); for now it is text
      answers.delete(keyOf(w.link, w.from));
      w.res(null);
    }));
  }), Promise.resolve());
}
/** What a note link leads to, asked of the shell once a frame. */
export function answerFor(link: string, from?: string): Promise<Answer> {
  const k = keyOf(link, from);
  let p = answers.get(k);
  if (!p) {
    p = new Promise<Answer>((res) => { if (!waiting.length) queueMicrotask(flush); waiting.push({ link, from, res }); });
    answers.set(k, p);
    // nothing, for now: asked again by a draw a minute on, or once the person is back (useAnswers)
    const mine = p;
    void p.then((a) => { came.set(mine, a); if (a === null) lastAt.set(k, Date.now()); else lastAt.delete(k); if (a === null) setTimeout(() => { if (answers.get(k) === mine) answers.delete(k); }, 60_000); });
  }
  return p;
}
// the person back (the applet shown again, the app back in front): links that led nowhere ask again, each at most once a
// minute after its last answer (the shell keeps a miss that long), and no more than one call's worth a return (each link
// asked costs the frame's reads): the links whose answer is oldest first, across the frame, so each has its turn. Uni may
// cite a note a moment before the hub has it, a vault's hub may have been away, and a busy shell or a lapse leaves a link
// without an answer; a link drawn stays drawn
export const AGAIN_MS = 60_000;
/** When each link that led nowhere had that answer (only those: a link drawn is never asked again). */
const lastAt = new Map<string, number>();
type Asker = { nowhere(): { l: string; k: string }[]; again(ls: Set<string>): void };
const askers = new Set<Asker>();
let heard = false;
function back() {
  const now = Date.now();
  const due: { a: Asker; l: string; k: string; at: number }[] = [];
  for (const a of askers) for (const x of a.nowhere()) {
    const at = lastAt.get(x.k) ?? 0;
    if (now - at >= AGAIN_MS) due.push({ a, ...x, at });
  }
  due.sort((x, y) => x.at - y.at);
  const keys = new Set<string>(), picks = new Map<Asker, Set<string>>();
  for (const d of due) {
    // the same link in two places is asked once
    if (!keys.has(d.k)) { if (keys.size >= LINKS_PER_CALL) continue; keys.add(d.k); }
    picks.set(d.a, (picks.get(d.a) ?? new Set()).add(d.l));
  }
  picks.forEach((ls, a) => a.again(ls));
}
function hearBacks() {
  if (heard) return;
  heard = true;
  kit().onShown?.((on) => { if (on) back(); });
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") back(); });
}
/** The answers for these links (undefined while asked). */
export function useAnswers(links: readonly string[], from?: string): Map<string, Answer> {
  const [got, setGot] = useState<Map<string, Answer>>(() => new Map());
  // the links a return picked to ask again
  const [again, setAgain] = useState<Set<string>>(() => new Set());
  const nowhere = useRef<{ l: string; k: string }[]>([]);
  useEffect(() => { nowhere.current = [...new Set(links)].filter((l) => got.get(l) === null).map((l) => ({ l, k: keyOf(l, from) })); });
  useEffect(() => {
    hearBacks();
    const me: Asker = { nowhere: () => nowhere.current, again: (ls) => setAgain(ls) };
    askers.add(me);
    return () => { askers.delete(me); };
  }, []);
  const key = links.join("\n") + "\n" + (from ?? "");
  const handled = useRef(again);
  useEffect(() => {
    let on = true;
    // the run a return started (not a later change of links): its picks let go of their last answer of nothing first
    // (one another link is asking now stays)
    const picked = again !== handled.current ? again : null;
    handled.current = again;
    for (const l of new Set(links)) {
      // one a return didn't pick waits for a later return (its cached nothing may be gone, a minute on)
      if (picked && got.get(l) === null && !picked.has(l)) continue;
      if (picked?.has(l) && got.get(l) === null) {
        const k = keyOf(l, from), was = answers.get(k);
        if (was && came.get(was) === null) answers.delete(k);
      }
      void answerFor(l, from).then((a) => { if (on) setGot((m) => (m.get(l) === a ? m : new Map(m).set(l, a))); });
    }
    return () => { on = false; };
  }, [key, again]); // eslint-disable-line react-hooks/exhaustive-deps
  return got;
}

const WEB = /^(https?:|mailto:)/i;
const isWeb = (s: string) => WEB.test(s) && !/[\u0000- \u007f]/.test(s);

/** Open what a link leads to: a note link through the shell (an address it can't place opens as a web address). */
async function go(to: string, from: string | undefined, choose: boolean): Promise<boolean> {
  const ref = parseNoteRef(to);
  // the shell decides at once (its answer may still be on its way here): the tap is fresh only for a moment
  if (ref) {
    if ((await app().follow?.(to, { from, choose }).catch(() => false)) === true) return true;
    if (ref.kind !== "address") return false;
  }
  return isWeb(to) ? ((await app().openLink?.(to).catch(() => false)) ?? false) : false;
}

/** Each note's address, once asked (a second tap opens at once, inside the tap's moment). */
const addresses = new Map<string, string>();
export const link = Object.freeze({
  /** The one form a link to a note of this applet's vault is written in: its address on its hub. */
  async to(record: string | { id: string }): Promise<string> {
    const id = typeof record === "string" ? record : record?.id;
    const made = typeof id === "string" ? await app().address?.(id) : null;
    if (typeof made !== "string") throw new Error("this note has no address here (does the applet ask for open?)");
    return made;
  },
  /** Open what a link leads to (during a tap): a note in the app, a web address in the browser. */
  follow: (to: string, o?: { from?: string; choose?: boolean }) => go(to, o?.from, o?.choose === true),
  /** Open a note of this applet's vault (during a tap: a row's onPress), where the person reads and edits it. */
  async open(record: string | { id: string }): Promise<boolean> {
    const id = typeof record === "string" ? record : record?.id;
    if (typeof id !== "string") return false;
    let to = addresses.get(id);
    if (!to) { to = await link.to(id).catch(() => ""); if (to) addresses.set(id, to); }
    return to ? go(to, undefined, false) : false;
  },
  parse: parseNoteRef,
  find: findLinks,
});

const HOLD_MS = 500;
/** One link. `to`: a note's address, `<vault>:<ULID>`, `[[target]]` (with `from`, the path of the note it is in) or a
 *  web address; `children`: what it shows (the link as written, else). */
export function Link({ to, from, children }: { to: string; from?: string; children?: ReactNode }) {
  const ref = parseNoteRef(to);
  const got = useAnswers(ref ? [to] : [], from);
  const answer = ref ? got.get(to) : undefined;
  const down = useRef<{ at: number; mouse: boolean } | null>(null);
  const held = useRef(false);
  const shown = children ?? to;
  // a short form or wikilink that leads nowhere (or isn't known yet to lead anywhere) is its text; an address is a link
  // whatever the answer (one the shell can't place opens as a web address)
  if (ref && ref.kind !== "address" && !answer) return <>{shown}</>;
  if (!ref && !isWeb(to)) return <>{shown}</>;
  const open = (choose: boolean) => { void go(to, from, choose); };
  return (
    <a className={ref && answer ? "pa-link pa-note-link" : "pa-link"} href={to} title={to} rel="noreferrer"
      onPointerDown={(e) => { down.current = { at: Date.now(), mouse: e.pointerType === "mouse" }; held.current = false; }}
      onPointerUp={(e) => {
        // held on a touch screen: Open with… (the lift is the tap the shell needs), unless the hold's menu already asked
        if (ref && !held.current && e.pointerType !== "mouse" && down.current && Date.now() - down.current.at >= HOLD_MS) { held.current = true; open(true); }
      }}
      // a right-click, or a webview's long-press menu (which may cancel the press, so no lift follows)
      onContextMenu={(e) => { e.preventDefault(); if (ref && !held.current) { held.current = true; open(true); } }}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (held.current) { held.current = false; return; } open(false); }}>
      {shown}
    </a>
  );
}

/** Plain text, with its note links (note addresses, `<vault>:<ULID>`) drawn as a Link; with `web`, its other web
 *  addresses too (which open only for an applet allowed `links`). */
export function Linked({ text, web = false }: { text: string; web?: boolean }) {
  const found = findLinks(text).filter((f) => web || f.ref);
  if (!found.length) return <>{text}</>;
  const out: ReactNode[] = [];
  let at = 0;
  found.forEach((f, i) => {
    if (f.start > at) out.push(<Fragment key={`t${i}`}>{text.slice(at, f.start)}</Fragment>);
    out.push(<Link key={`l${i}`} to={f.raw} />);
    at = f.end;
  });
  if (at < text.length) out.push(<Fragment key="end">{text.slice(at)}</Fragment>);
  return <>{out}</>;
}
