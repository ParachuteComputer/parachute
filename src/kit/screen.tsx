// The kit's screen parts: what every applet had built for itself (docs/INVENTORY.md), now one each, drawn on the
// theme's tokens and type scale (parts.css), so every applet looks and behaves the same. Like parts.tsx, every export
// is a promise to applets written against it (docs/WRITE-AN-APPLET.md): add with care, never change a prop's meaning.
//   Page      the applet's screen: its width and margins, its title, and pull to refresh
//   Loading   the quiet line while something is read
//   Problem   what went wrong, said once, with Try again
//   Button    a button in the app's look: primary, plain or quiet
//   Search    a search box: Enter (or typing, with `live`) searches; emptying it ends the search
//   Write     a box to write in, and its action: Save, Send (Ctrl or ⌘ Enter; Enter alone in a chat)
//   Record    the microphone button: the app's own recorder sheet, never the applet's
//   toast     a short word after an action ("Saved"), gone by itself
//   voiceNote a recording made a note whose words the hub writes in; useTranscripts waits for them
import { useEffect, useRef, useState, type ButtonHTMLAttributes, type KeyboardEvent, type ReactNode, type Ref } from "react";
import "./parts.css";

type Recording = { bytes: ArrayBuffer; type: string; duration: number };
type Rec = { id: string; updatedAt?: string | null };
type Kit = {
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
 *  `className` is for the applet's own CSS on what is inside. */
export function Page({ title, kicker, aside, onRefresh, className, children }: { title?: ReactNode; kicker?: ReactNode; aside?: ReactNode; onRefresh?: () => unknown; className?: string; children?: ReactNode }) {
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  const refresh = useRef(onRefresh);
  refresh.current = onRefresh;
  const on = !!onRefresh;
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
    <main className={className ? `pa-page ${className}` : "pa-page"}>
      {on && (pull > 0 || busy) && <div className="pa-pull" style={{ height: busy ? PULL * 0.6 : pull * 0.6 }} role="status">{busy ? "Reading again…" : pull >= PULL ? "Let go to read again" : "Pull to read again"}</div>}
      {(title || kicker || aside) && (
        <header className="pa-page-head">
          <div>{kicker && <p className="pa-kicker">{kicker}</p>}{title && <h1 className="pa-title">{title}</h1>}</div>
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
  return (
    <div className="pa-problem" role="alert">
      <p>{children}{children && why ? ": " : ""}{why}</p>
      {onRetry && <Button kind="plain" small onClick={onRetry}>Try again</Button>}
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

// ── Search ──

/** A search box. Enter searches (or each pause in typing, with `live` ms); emptying it searches for "" (the search
 *  is over). Keeps its own text unless `value` is given. */
export function Search({ label, placeholder, value, onChange, onSearch, live }: { label: string; placeholder?: string; value?: string; onChange?: (v: string) => void; onSearch: (term: string) => void; live?: number }) {
  const [own, setOwn] = useState("");
  const text = value ?? own;
  const go = useRef(onSearch);
  go.current = onSearch;
  // what was last searched: a pause in typing searches only for something new (Enter always searches)
  const last = useRef("");
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
 *  chat, Enter alone and Shift Enter a new line). Buttons of your own (`children`) sit beside the action. `line` lays
 *  it out as one line that grows as it is written in (a chat's composer). The text is yours (`value`, `onChange`):
 *  keep a draft with useSaved. No form submits (a sealed frame has none). */
export function Write({ label, value, onChange, placeholder, onSend, send = "Save", busy, enter = "newline", line, maxLength, inputRef, onKeyDown, children }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
  onSend?: () => void | Promise<unknown>; send?: ReactNode; busy?: boolean; enter?: "newline" | "send"; line?: boolean;
  maxLength?: number; inputRef?: Ref<HTMLTextAreaElement>; onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void; children?: ReactNode;
}) {
  const own = useRef<HTMLTextAreaElement | null>(null);
  const setRef = (el: HTMLTextAreaElement | null) => {
    own.current = el;
    if (typeof inputRef === "function") inputRef(el); else if (inputRef) (inputRef as { current: HTMLTextAreaElement | null }).current = el;
  };
  // a line grows with what is in it, up to a few lines, then scrolls
  useEffect(() => { const el = own.current; if (!line || !el) return; el.style.height = "auto"; el.style.height = `${Math.min(el.scrollHeight + 2, 9 * 24)}px`; }, [value, line]);
  const can = !!onSend && !busy && !!value.trim();
  const keys = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    onKeyDown?.(e);
    if (e.defaultPrevented || e.key !== "Enter" || e.nativeEvent.isComposing || e.keyCode === 229) return;
    const sends = enter === "send" ? !e.shiftKey : e.metaKey || e.ctrlKey;
    if (!sends) return;
    e.preventDefault();
    if (can) void onSend!();
  };
  const box = <textarea ref={setRef} className="pa-write-box" aria-label={label} placeholder={placeholder} value={value} maxLength={maxLength} rows={line ? 1 : undefined}
    onChange={(e) => onChange(e.target.value)} onKeyDown={keys} />;
  const action = onSend && <Button kind="primary" className="pa-write-send" busy={busy} disabled={!value.trim()} onClick={() => void onSend()}>{send}</Button>;
  if (line) return <div className="pa-write pa-line">{children}{box}{action}</div>;
  return <div className="pa-write">{box}{(action || children) && <div className="pa-write-row">{action}{children}</div>}</div>;
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

let host: HTMLElement | null = null;
let latest: HTMLElement | null = null;
/** A short word after an action, at the foot of the screen, gone by itself (an error stays longer, in the danger
 *  colour). A screen reader says it. One at a time: a new one takes the place of the last. */
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
  // a live region a screen reader has only just met says nothing: the words go in a moment after it is there (and a
  // newer toast meanwhile goes instead)
  const show = () => { if (latest !== p) return; into.replaceChildren(p); setTimeout(() => p.remove(), error ? 7000 : 3500); };
  if (fresh) setTimeout(show, 50); else show();
}
