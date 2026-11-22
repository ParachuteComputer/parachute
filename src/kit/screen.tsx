// The kit's screen parts: what every applet had built for itself (docs/INVENTORY.md), now one each, drawn on the
// theme's tokens and type scale (parts.css), so every applet looks and behaves the same. Like parts.tsx, every export
// is a promise to applets written against it (docs/WRITE-AN-APPLET.md): add with care, never change a prop's meaning.
//   Page      the applet's screen: its width and margins, its title, a way back, two columns (wide), pull to refresh
//   Loading   the quiet line while something is read
//   Problem   what went wrong, said once, with Try again
//   Button    a button in the app's look: primary, plain or quiet
//   Tabs      places to switch between in one screen, the one shown marked
//   Search    a search box: Enter (or typing, with `live`) searches; emptying it ends the search
//   Write     a box to write in, and its action: Save, Send (Ctrl or ⌘ Enter; Enter alone in a chat)
//   Record    the microphone button: the app's own recorder sheet, never the applet's
//   toast     a short word after an action ("Saved"), gone by itself
//   voiceNote a recording made a note whose words the hub writes in; useTranscripts waits for them
//   still     whether nothing should move now (reduce-motion, an e-paper screen, Daylight, a still theme)
import { useEffect, useId, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type KeyboardEvent, type ReactNode, type Ref } from "react";
import "./parts.css";

type Recording = { bytes: ArrayBuffer; type: string; duration: number };
type Rec = { id: string; updatedAt?: string | null };
type Kit = {
  onFresh?(cb: () => void): () => void;
  voice?: { record(o?: { max_s?: number }): Promise<Recording | null> };
  vault?: {
    attach(id: string, bytes: ArrayBuffer, type: string, o?: { transcribe?: boolean }): Promise<unknown>;
    updateRecord(id: string, p: { body: string; if_updated_at?: string | null }): Promise<unknown>;
  };
};
const kit = () => (globalThis as unknown as { parachute?: Kit }).parachute;
/** What an error says, short: its message, or the thing itself. */
export const said = (e: unknown) => String((e as { message?: unknown })?.message ?? e ?? "it failed").slice(0, 300);

// ── Page ──

const PULL = 64;
/** The applet's screen: one width and margin for every applet, its title in the type scale (with a small `kicker`
 *  above it and `aside` at its right, a button or two), and, with `onRefresh`, pull down at the top to read again.
 *  `back` puts a way back above the title (from a room to the list: `{ label: "Matrix", onPress }`).
 *  `wide` for a page of two columns on a computer (an area: its notes beside its room); `className` is for the
 *  applet's own CSS on what is inside. */
export function Page({ title, kicker, aside, back, onRefresh, wide, className, children }: { title?: ReactNode; kicker?: ReactNode; aside?: ReactNode; back?: { label: string; onPress: () => void }; onRefresh?: () => unknown; wide?: boolean; className?: string; children?: ReactNode }) {
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  const refresh = useRef(onRefresh);
  refresh.current = onRefresh;
  const on = !!onRefresh;
  // a page that reads again on pull is drawn from what the app read before, at once, and read again when the vault's
  // answer differs (frameKit onFresh, T-476); before its own effects read (a layout effect runs first)
  useLayoutEffect(() => (on ? kit()?.onFresh?.(() => { void Promise.resolve().then(() => refresh.current?.()).catch(() => {}); }) : undefined), [on]);
  useEffect(() => {
    if (!on) return;
    let start: number | null = null, dist = 0, running = false;
    // a frame drawn at its content's height (a page with embeds) never scrolls itself: the page around it does
    const sized = () => getComputedStyle(document.documentElement).overflowY === "hidden" || getComputedStyle(document.body).overflowY === "hidden";
    // a touch for something else: in a box being written in, or in a part scrolled away from its own top
    const elsewhere = (t: EventTarget | null) => {
      for (let el = t instanceof Element ? t : null; el && el !== document.body; el = el.parentElement) {
        if (el.matches("textarea, input, select, [contenteditable]") || el.scrollTop > 0) return true;
      }
      return false;
    };
    const down = (e: TouchEvent) => {
      start = !running && window.scrollY <= 0 && e.touches.length === 1 && !sized() && !elsewhere(e.target) ? e.touches[0].clientY : null;
      dist = 0;
    };
    const move = (e: TouchEvent) => {
      if (start === null) return;
      if (window.scrollY > 0) { start = null; setPull(0); return; }
      dist = Math.max(0, e.touches[0].clientY - start);
      setPull(Math.min(dist, PULL * 1.6));
    };
    const up = () => {
      if (start === null) return;
      start = null;
      setPull(0);
      if (dist < PULL || running) return;
      running = true;
      setBusy(true);
      void Promise.resolve().then(() => refresh.current?.()).catch(() => {}).finally(() => { running = false; setBusy(false); });
    };
    addEventListener("touchstart", down, { passive: true });
    addEventListener("touchmove", move, { passive: true });
    addEventListener("touchend", up);
    addEventListener("touchcancel", up);
    return () => { removeEventListener("touchstart", down); removeEventListener("touchmove", move); removeEventListener("touchend", up); removeEventListener("touchcancel", up); };
  }, [on]);
  return (
    <main className={`pa-page${wide ? " pa-wide" : ""}${className ? ` ${className}` : ""}`}>
      {on && (pull > 0 || busy) && <div className="pa-pull" style={{ height: busy ? PULL * 0.6 : pull * 0.6 }} role="status">{busy ? "Reading again…" : pull >= PULL ? "Let go to read again" : "Pull to read again"}</div>}
      {(title || kicker || aside || back) && (
        <header className="pa-page-head">
          <div>
            {back && <Button kind="quiet" className="pa-back" onClick={back.onPress}>← {back.label}</Button>}
            {kicker && <p className="pa-kicker">{kicker}</p>}{title && <h1 className="pa-title">{title}</h1>}
          </div>
          {aside && <div className="pa-page-aside">{aside}</div>}
        </header>
      )}
      {children}
    </main>
  );
}

// ── Loading, Problem ──

/** The quiet line while something is read: "Reading…", or what you give it. */
export function Loading({ children }: { children?: ReactNode }) {
  return <p className="pa-loading" role="status">{children ?? "Reading…"}</p>;
}

/** What went wrong: your words, then the error's ("Couldn't read your rooms: offline"), and Try again with `onRetry`. */
export function Problem({ error, onRetry, children }: { error?: unknown; onRetry?: () => void; children?: ReactNode }) {
  const why = error === undefined || error === null || error === "" ? "" : said(error);
  // the plain sentence says what failed; the error's own words (an address, a code, the hub's answer) are under Details
  return (
    <div className="pa-problem" role="alert">
      <p>{children ?? why}{typeof children === "string" && !/[.!?…:]$/.test(children.trim()) ? "." : ""}</p>
      {onRetry && <Button kind="plain" small onClick={onRetry}>Try again</Button>}
      {children && why && <details className="pa-problem-why"><summary>Details</summary>{why}</details>}
    </div>
  );
}

// ── Button ──

type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> & {
  /** primary: the one main action, filled; plain (the default): outlined; quiet: text only */
  kind?: "primary" | "plain" | "quiet";
  small?: boolean;
  /** while its action runs: disabled, and says so to a screen reader */
  busy?: boolean;
};
/** A button in the app's look. */
export function Button({ kind = "plain", small, busy, className, disabled, children, ...rest }: ButtonProps) {
  return <button type="button" {...rest} className={`pa-button pa-${kind}${small ? " pa-small" : ""}${className ? ` ${className}` : ""}`} disabled={disabled || busy} aria-busy={busy || undefined}>{children}</button>;
}

// ── Tabs ──

export type Tab = { key: string; label: ReactNode; count?: number };
/** Places to switch between in one screen (a mailbox's Inbox, Later, Sent; a vault of several): the one shown is marked,
 *  a count follows a label ("Inbox · 3"). */
export function Tabs({ label, tabs, current, onChange }: { label: string; tabs: readonly Tab[]; current: string; onChange: (key: string) => void }) {
  const nav = useRef<HTMLElement>(null);
  // which ends have more past them (a fade says so; no bar is drawn): `start` and `end` as the row reads, either way
  const edges = () => {
    const n = nav.current;
    if (!n) return;
    const from = Math.abs(n.scrollLeft);
    const more = [from > 1 ? "start" : "", from + n.clientWidth < n.scrollWidth - 1 ? "end" : ""].filter(Boolean).join(" ");
    if (more) n.dataset.more = more; else delete n.dataset.more;
  };
  // the one shown stays in view on the one line, clear of the fades (scrolled sideways, never the page): when it
  // changes and when the places arrive or change; a count or a font that widens a tab, or the row's width changing,
  // re-places it only while the row is where the kit put it (a scroll the person made is theirs)
  const places = tabs.map((t) => t.key).join("|");
  const counts = tabs.map((t) => `${t.key}:${t.count ?? ""}`).join("|");
  // placed: the row is where keepClear put it, at placedAt, when the row could scroll placedSpan
  const placed = useRef(true), placedAt = useRef(0), placedSpan = useRef(0);
  /** The row's scroll range, as the row reads (scrollLeft runs negative right to left). */
  const range = (n: HTMLElement): [number, number] => { const span = n.scrollWidth - n.clientWidth; return getComputedStyle(n).direction === "rtl" ? [-span, 0] : [0, span]; };
  /** Scroll the row (never the page) so this tab is clear of the fades, at the ends that have one. */
  const keepClear = (on: HTMLElement | null | undefined) => {
    const n = nav.current;
    if (!n || !on) return;
    const [lo, hi] = range(n);
    const FADE = 32, left = n.scrollLeft > lo + 1 ? FADE : 0, right = n.scrollLeft < hi - 1 ? FADE : 0;
    const r = on.getBoundingClientRect(), box = n.getBoundingClientRect();
    if (r.left < box.left + left || r.right > box.right - right) n.scrollLeft += r.left + r.width / 2 - (box.left + box.width / 2);
    placed.current = true;
    placedAt.current = n.scrollLeft;
    placedSpan.current = n.scrollWidth - n.clientWidth;
  };
  const shown = () => nav.current?.querySelector<HTMLElement>('[aria-current="page"]');
  useLayoutEffect(() => { keepClear(shown()); edges(); }, [current, places]);
  // a count that widens a tab (read here too, where a webview has no ResizeObserver)
  useLayoutEffect(() => { if (placed.current) keepClear(shown()); edges(); }, [counts]);
  // the row's width or a tab's changing (a phone turned, a column, the faces loading)
  useEffect(() => {
    const n = nav.current;
    if (!n || typeof ResizeObserver !== "function") return;
    const o = new ResizeObserver(() => { if (placed.current) keepClear(shown()); edges(); });
    o.observe(n);
    n.querySelectorAll(".pa-tab").forEach((t) => o.observe(t));
    return () => o.disconnect();
  }, [places]);
  // a scroll is the person's (a finger, a wheel, a key, a screen reader) unless it is where the kit put the row, or the
  // browser clamping a row whose scroll extent changed (a resize): theirs, the row stays where they put it
  const scrolled = () => {
    const n = nav.current;
    if (n && placed.current) {
      const span = n.scrollWidth - n.clientWidth, [lo, hi] = range(n);
      // a clamp: the extent changed and the row sits pinned at an end of it
      const pinned = Math.abs(n.scrollLeft - lo) <= 1 || Math.abs(n.scrollLeft - hi) <= 1;
      if (Math.abs(span - placedSpan.current) > 0.5 && pinned) { placedAt.current = n.scrollLeft; placedSpan.current = span; }
      else if (Math.abs(n.scrollLeft - placedAt.current) > 1) placed.current = false;
    }
    edges();
  };
  const focused = (el: HTMLElement) => { try { return el.matches(":focus-visible"); } catch { return false; } };
  return (
    // a tab reached from the keyboard is kept clear of the fades too (a tap needs nothing: it chooses, and the row follows)
    <nav className="pa-tabs" aria-label={label} ref={nav} onScroll={scrolled} onFocus={(e) => { if (focused(e.target as HTMLElement)) keepClear(e.target as HTMLElement); }}>
      {tabs.map((t) => <button key={t.key} type="button" className="pa-tab" aria-current={t.key === current ? "page" : undefined} onClick={() => onChange(t.key)}>{t.label}{t.count ? ` · ${t.count}` : ""}</button>)}
    </nav>
  );
}

// ── Search ──

/** A search box. Enter searches (or each pause in typing, with `live` ms); emptying it searches for "" (the search
 *  is over). Keeps its own text unless `value` is given. */
export function Search({ label, placeholder, value, onChange, onSearch, live }: { label: string; placeholder?: string; value?: string; onChange?: (v: string) => void; onSearch: (term: string) => void; live?: number }) {
  const [own, setOwn] = useState("");
  const text = value ?? own;
  const go = useRef(onSearch);
  go.current = onSearch;
  // what was last searched: a pause in typing searches only for something new (Enter always searches)
  const last = useRef((value ?? "").trim());
  const search = (t: string) => { last.current = t.trim(); go.current(last.current); };
  useEffect(() => {
    if (live === undefined) return;
    const t = setTimeout(() => { if (text.trim() !== last.current) search(text); }, Math.max(0, live));
    return () => clearTimeout(t);
  }, [text, live]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (v: string) => { if (value === undefined) setOwn(v); onChange?.(v); if (!v.trim() && live === undefined && last.current) search(""); };
  return <input className="pa-search" type="search" aria-label={label} placeholder={placeholder ?? label} value={text} enterKeyHint="search"
    onChange={(e) => set(e.target.value)}
    onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229) { e.preventDefault(); search(text); } }} />;
}

// ── Write ──

/** A box to write in. `onSend` is its action (the button `send` names, or Ctrl/⌘ Enter; with `enter="send"`, as in a
 *  chat, Enter alone on a computer, Shift Enter a new line). Buttons of your own (`children`) sit beside the action. `line` lays
 *  it out as one line that grows as it is written in (a chat's composer). The text is yours (`value`, `onChange`):
 *  keep a draft with useSaved. No form submits (a sealed frame has none). */
export function Write({ label, labelled, value, onChange, placeholder, onSend, send = "Save", sendLabel, canSend, busy, enter = "newline", line, maxLength, inputRef, onKeyDown, children }: {
  label: string; /** the label shown above the box, as a Field's (else it is only said to a screen reader) */ labelled?: boolean; value: string; onChange: (v: string) => void; placeholder?: string;
  onSend?: () => void | Promise<unknown>; send?: ReactNode; /** what a screen reader calls the action, when `send` is short */ sendLabel?: string;
  /** whether there is something to send (a file with no words); else, whether there are words */ canSend?: boolean; busy?: boolean; enter?: "newline" | "send"; line?: boolean;
  maxLength?: number; inputRef?: Ref<HTMLTextAreaElement>; onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void; children?: ReactNode;
}) {
  const own = useRef<HTMLTextAreaElement | null>(null);
  const setRef = (el: HTMLTextAreaElement | null) => {
    own.current = el;
    if (typeof inputRef === "function") inputRef(el); else if (inputRef) (inputRef as { current: HTMLTextAreaElement | null }).current = el;
  };
  // a line grows with what is in it, up to a few lines, then scrolls
  useEffect(() => { const el = own.current; if (!line || !el) return; el.style.height = "auto"; el.style.height = `${Math.min(el.scrollHeight + 2, 9 * 24)}px`; }, [value, line]);
  const something = canSend ?? !!value.trim();
  const can = !!onSend && !busy && something;
  const keys = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    onKeyDown?.(e);
    if (e.defaultPrevented || e.key !== "Enter" || e.nativeEvent.isComposing || e.keyCode === 229) return;
    // a chat's Enter sends on a computer; on a touch screen it is a new line, and the button sends
    const sends = (enter === "send" && !e.shiftKey && !matchMedia("(pointer: coarse)").matches) || e.metaKey || e.ctrlKey;
    if (!sends) return;
    e.preventDefault();
    if (can) void onSend!();
  };
  const id = useId();
  const box = <textarea ref={setRef} id={id} className="pa-write-box" aria-label={labelled && !line ? undefined : label} placeholder={placeholder} value={value} maxLength={maxLength} rows={line ? 1 : undefined}
    onChange={(e) => onChange(e.target.value)} onKeyDown={keys} />;
  const action = onSend && <Button kind="primary" className="pa-write-send" busy={busy} disabled={!something} aria-label={sendLabel} onClick={() => void onSend()}>{send}</Button>;
  if (line) return <div className="pa-write pa-line">{children}{box}{action}</div>;
  return <div className="pa-write">{labelled && <label className="pa-field-label" htmlFor={id}>{label}</label>}{box}{(action || children) && <div className="pa-write-row">{action}{children}</div>}</div>;
}

// ── Record ──

/** The microphone button. A tap opens the app's own recorder sheet (the applet never touches the microphone; it needs
 *  `reach: [voice]`); `onRecorded` gets what was recorded on Send, nothing on Cancel. A failure is said as a toast. */
export function Record({ onRecorded, children, max_s, disabled, kind = "plain", small, label }: {
  onRecorded: (r: Recording) => void | Promise<unknown>; children?: ReactNode; max_s?: number; disabled?: boolean;
  kind?: ButtonProps["kind"]; small?: boolean; label?: string;
}) {
  const [busy, setBusy] = useState(false);
  const tap = async () => {
    const v = kit()?.voice;
    if (!v) { toast("This Parachute can't record here.", { error: true }); return; }
    let r: Recording | null;
    try { r = await v.record(max_s ? { max_s } : undefined); } catch (e) { toast(`Not recorded: ${said(e)}`, { error: true }); return; }
    if (!r) return;
    setBusy(true);
    try { await onRecorded(r); } catch (e) { toast(`Not saved: ${said(e)}`, { error: true }); } finally { setBusy(false); }
  };
  return <Button kind={kind} small={small} className="pa-record" busy={busy} disabled={disabled} aria-label={label ?? "Record"} onClick={() => void tap()}>{children ?? "Record"}</Button>;
}

// ── voice notes ──

/** The hub's marker in a voice note while its words are on their way (the hub puts them in its place). */
const PENDING = "_Transcript pending._";
/** A recording made a note: `create(body)` makes the record your way (its path is yours), then the recording is
 *  attached with transcription asked. If it can't be attached, the note says so rather than wait for words that won't
 *  come, and this throws. Resolves the record. */
export async function voiceNote<R extends Rec>(recording: Recording, create: (body: string) => Promise<R>): Promise<R> {
  const v = kit()?.vault;
  if (!v) throw new Error("no vault here");
  const made = await create(PENDING);
  try { await v.attach(made.id, recording.bytes, recording.type, { transcribe: true }); } catch (e) {
    await v.updateRecord(made.id, { body: "_The recording couldn't be attached._", if_updated_at: made.updatedAt ?? undefined }).catch(() => {});
    throw e;
  }
  return made;
}

/** While a voice note waits for its words: `reload` every 10 seconds, twelve times, not for ever. `say(body)` is the
 *  line to show under a note still waiting (or null), `strip(body)` the note's text without the marker, and `again()`
 *  starts the count over (after a new recording). */
export function useTranscripts(bodies: readonly (string | null | undefined)[], reload: () => unknown, { every = 10_000, times = 12 } = {}) {
  const [looks, setLooks] = useState(0);
  const waiting = bodies.some((b) => (b ?? "").includes(PENDING));
  const again = useRef(reload);
  again.current = reload;
  const key = bodies.join("\u0000");
  useEffect(() => {
    if (!waiting || looks >= times) return;
    const t = setTimeout(() => { setLooks((n) => n + 1); void Promise.resolve().then(() => again.current()).catch(() => {}); }, every);
    return () => clearTimeout(t);
  }, [waiting, looks, key]); // eslint-disable-line react-hooks/exhaustive-deps
  return {
    say: (body: string | null | undefined) => ((body ?? "").includes(PENDING) ? (looks >= times ? "Still transcribing. It shows here once the hub has it." : "Transcribing…") : null),
    strip: (body: string | null | undefined) => (body ?? "").replace(PENDING, "").trim(),
    again: () => setLooks(0),
  };
}

// ── toast ──

/** When what an element is doing now (its transitions, its animations) has run: at once when nothing moves (reduce
 *  motion, a still theme), never later than `most` ms (a frame out of sight may not run them). Never waits on
 *  transitionend, which a time of 0 never sends. */
export function settled(el: Element, most = 1000): Promise<void> {
  void getComputedStyle(el).opacity; // the change just made is styled now, so what it starts is there to wait for
  const running = typeof el.getAnimations === "function" ? el.getAnimations({ subtree: true }) : [];
  if (!running.length) return Promise.resolve();
  return Promise.race([Promise.all(running.map((a) => a.finished.catch(() => {}))).then(() => {}), new Promise<void>((r) => setTimeout(r, most))]);
}
/** Whether nothing should move now: the device asks for less motion, the screen is slow to redraw (e-paper), it shows
 *  Daylight, or the theme is still. It asks the same thing the kit's CSS does (every time is 0, theme.ts MOTION_CSS), so
 *  an applet's own motion, the kit's and the app's agree. Under still, a finger doesn't drag anything: a drag that goes
 *  far enough does what letting go would, at once (docs/LOOK.md, "Still"). */
export function still(): boolean {
  if (typeof document === "undefined" || typeof getComputedStyle !== "function") return true;
  return getComputedStyle(document.documentElement).getPropertyValue("--t-state").trim() === "0ms";
}
/** How far a finger goes under still before it counts, in px: then the thing turns, goes or closes at once. */
export const STILL_DRAG = 48;

/** Into its place: drawn first as it starts (`data-state="before"`), then, the same moment, moved to "open", so the
 *  change is a transition (which a newer change can take over from where it is). */

export function arrive(el: HTMLElement) {
  el.dataset.state = "before";
  void el.getBoundingClientRect();
  el.dataset.state = "open";
}

let host: HTMLElement | null = null;
let latest: HTMLElement | null = null;
/** How each toast on screen goes away (its timer and listeners with it). */
const goes = new WeakMap<HTMLElement, () => void>();
/** A swipe this far down (px), or this fast (px/ms), puts a toast away (Sonner's numbers). */
const SWIPE = 45, FLICK = 0.11;
/** A short word after an action, at the foot of the screen, gone by itself (an error stays longer, in the danger
 *  colour). A screen reader says it. One at a time: a new one takes the place of the last. It rises into place and goes
 *  back down; its time stops while a pointer is on it, a finger holds it, or the app is out of sight, and a tap or a
 *  swipe down puts it away at once (so it is never in the way of what is under it for more than a tap). */
export function toast(text: string, { error = false }: { error?: boolean } = {}) {
  if (typeof document === "undefined") return;
  const fresh = !host || !host.isConnected;
  if (fresh) {
    host = document.createElement("div");
    host.className = "pa-toasts";
    host.setAttribute("role", "status");
    document.body.appendChild(host);
  }
  const p = document.createElement("p");
  p.className = error ? "pa-toast pa-toast-error" : "pa-toast";
  p.textContent = String(text).slice(0, 300);
  const into = host!;
  latest = p;
  // its time: running unless something holds it (a pointer on it, a finger, the app out of sight)
  let left = error ? 7000 : 3500, since = 0, timer = 0, done = false;
  const holds = new Set<string>();
  const go = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    document.removeEventListener("visibilitychange", seen);
    p.dataset.state = "gone";
    p.setAttribute("aria-hidden", "true"); // the live region says only the one that stays
    void settled(p).then(() => p.remove());
  };
  goes.set(p, go);
  const hold = (why: string) => {
    if (!holds.size && since) { clearTimeout(timer); left = Math.max(1000, left - (Date.now() - since)); since = 0; }
    holds.add(why);
  };
  const free = (why: string) => {
    holds.delete(why);
    if (!holds.size && !since && !done) { since = Date.now(); timer = window.setTimeout(go, left); }
  };
  function seen() { if (document.hidden) hold("hidden"); else free("hidden"); }
  p.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse") hold("pointer"); });
  p.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") free("pointer"); });
  // a swipe down: it follows the finger 1:1; upward it only gives a little; let go far or fast enough, or tap it, and it
  // goes (still: it doesn't follow, and 48 px down puts it away at once)
  let y0: number | null = null, t0 = 0, dy = 0, moved = 0, calm = false;
  p.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || done) return;
    y0 = e.clientY; t0 = e.timeStamp; dy = 0; moved = 0; calm = still();
    p.setPointerCapture?.(e.pointerId);
    hold("finger");
  });
  p.addEventListener("pointermove", (e) => {
    if (y0 === null) return;
    const d = e.clientY - y0;
    moved = Math.max(moved, Math.abs(d));
    // still: it doesn't follow the finger; far enough down, it goes at once
    if (calm) { dy = d; if (d >= STILL_DRAG) { y0 = null; go(); } return; }
    dy = d >= 0 ? d : d / (1.5 + Math.abs(d) / 20);
    p.dataset.swiping = "";
    p.style.setProperty("--pa-swipe", `${dy}px`);
  });
  const up = (e: PointerEvent) => {
    if (y0 === null) return;
    y0 = null;
    delete p.dataset.swiping;
    const fast = dy / Math.max(1, e.timeStamp - t0) > FLICK;
    if (e.type === "pointerup" && (moved < 6 || dy >= SWIPE || (dy > 4 && fast))) { go(); return; }
    p.style.setProperty("--pa-swipe", "0px");
    free("finger");
  };
  p.addEventListener("pointerup", up);
  p.addEventListener("pointercancel", up);
  // a live region a screen reader has only just met says nothing: the words go in a moment after it is there (and a
  // newer toast meanwhile goes instead)
  const show = () => {
    if (latest !== p) return;
    for (const was of Array.from(into.children) as HTMLElement[]) if (was !== p) (goes.get(was) ?? (() => was.remove()))();
    into.appendChild(p);
    arrive(p);
    document.addEventListener("visibilitychange", seen);
    seen();
  };
  if (fresh) setTimeout(show, 50); else show();
}
