// The parts: what an applet (and the frame) builds a screen from, beside the data calls. Each is small, takes plain
// props, and is drawn only on the theme's tokens (parts.css), so the person's theme record restyles it. Every export
// here is a promise to applets written against it (docs/WRITE-AN-APPLET.md): add with care, never change a prop's
// meaning. Each part imports only React, so it could later be shared as a record of its own (step 6).
//   Days    what changed, a day at a time: a column of ink marks per day (a tally), weeks set apart, today marked
//   List    rows under a label: a title, a line below, a word at the right, and an optional glyph or box to tick; a row may be tapped
//   Card    a raised block with a title
//   Field   a line to write on, with one action (Enter does it too)
//   Empty   what shows when there is nothing yet: a sprig and a line
//   Note    in parts-note.tsx: a note's text drawn by surface-render, rich notes included (a heavier bundle)
import { useCallback, useId, useMemo, useRef, useState, type ReactNode, type CSSProperties } from "react";
import "./parts.css";

const DAY = 86_400_000;
const midnight = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };

/** Counts per day, oldest first, ending today: from counts given, or from times (ISO strings or ms) to bucket. */
export function daysFrom(times: readonly (string | number | null | undefined)[], days = 28, now = Date.now()): number[] {
  const out = new Array<number>(days).fill(0);
  const today = midnight(now);
  for (const t of times) {
    const ms = typeof t === "number" ? t : t ? Date.parse(t) : NaN;
    if (Number.isNaN(ms)) continue;
    const ago = Math.round((today - midnight(ms)) / DAY);
    if (ago >= 0 && ago < days) out[days - 1 - ago]++;
  }
  return out;
}

/** What changed, a day at a time. `counts` (oldest first, the last is today), or `times` to count by day. */
export function Days({ counts, times, days = 28, label, inline }: { counts?: readonly number[]; times?: readonly (string | number | null | undefined)[]; days?: number; label?: string; /** inside a line of text (a link, a row): drawn in a span, not a figure */ inline?: boolean }) {
  const n = Math.max(1, Math.min(366, Math.floor(days) || 28));
  const values = useMemo(() => { const v = counts ? counts.slice(-n) : daysFrom(times ?? [], n); return v.length ? v : [0]; }, [counts, times, n]);
  // marks drawn at most: a busier day is drawn full (the label's total still counts every change); as tall as the busiest
  // day needs (a done-or-not tally is two marks high, not eight), at the same scale, so no empty band sits over it
  const tall = Math.min(8, Math.max(2, ...values));
  const total = values.reduce((a, b) => a + b, 0);
  const width = values.length * 9 + Math.floor((values.length - 1) / 7) * 6;
  const said = `${label ? `${label}: ` : ""}${total} in ${values.length} days`;
  const Box = inline ? "span" : "figure";
  return (
    <Box className="pa-days" role="img" aria-label={said}>
      <svg viewBox={`0 0 ${width} ${tall * 5 + 12}`} preserveAspectRatio="xMinYMax meet" aria-hidden="true" style={{ "--pa-days-h": ((tall * 5 + 12) / 52).toFixed(3) } as CSSProperties}>
        {values.map((v, i) => {
          const x = i * 9 + Math.floor(i / 7) * 6;
          const base = tall * 5 + 2;
          return (
            <g key={i} transform={`translate(${x} 0)`}>
              {Array.from({ length: Math.min(v, tall) }, (_, k) => <rect key={k} className="pa-mark" x="0" y={base - 5 - k * 5} width="6" height="3.4" rx="1" />)}
              <rect className="pa-base" x="0" y={base} width="6" height="1" />
              {i === values.length - 1 && <circle className="pa-today" cx="3" cy={base + 6} r="1.8" />}
            </g>
          );
        })}
      </svg>
      {label && (inline ? <span className="pa-days-label">{label}</span> : <figcaption>{label}</figcaption>)}
    </Box>
  );
}

export type Row = {
  key?: string; title: ReactNode; meta?: ReactNode; aside?: ReactNode; glyph?: string; onPress?: () => void;
  /** a box to tick, in the glyph's place: true draws the tick, false the same circle empty (a habit not done today) */
  check?: boolean;
  /** a mark after the title: a count of new things, a word */
  badge?: ReactNode;
  /** drawn bold: something new in it */
  strong?: boolean;
  /** the one open now (aria-current) */
  current?: boolean;
  /** a line under the rest, in the accent: what wants the person */
  under?: ReactNode;
  /** what a screen reader says for a row that is a button, when its text isn't enough */
  label?: string;
  /** data- attributes, for an applet's own tests: { room: "…" } is data-room */
  data?: Record<string, string>;
};
/** Rows under a label. A row with `onPress` is a button. A long list costs little: a row off screen isn't drawn until
 *  it scrolls near. `more` puts a button under the last row that asks for the next page (older entries, more mail). */
export function List({ label, hideLabel, rows, more }: { label?: ReactNode; /** said to a screen reader only: the page's title says it already */ hideLabel?: boolean; rows: readonly Row[]; more?: { label: string; onPress: () => void; busy?: boolean } }) {
  // a row added to the rows already there comes in (parts.css .pa-fresh): a book added, a message come in, the next
  // page. Rows that replace others (a search, a filter, another tab) are there at once, as typing should be.
  const seen = useRef<Set<string> | null>(null);
  const last = useRef<string[]>([]);
  const fresh = useRef(new Set<string>());
  const keys = rows.map((r) => r.key).filter((k): k is string => typeof k === "string");
  if (seen.current === null) seen.current = new Set(keys);
  else {
    // added: some of the rows that were there still are, and no more went than came (the next page, a book added, a
    // chat that lets its oldest go as a new one comes); else the rows were swapped (a search, a filter)
    const now = new Set(keys);
    const kept = last.current.filter((k) => now.has(k)).length;
    const novel = keys.filter((k) => !seen.current!.has(k));
    const added = kept > 0 && last.current.length - kept <= novel.length;
    for (const k of novel) { seen.current.add(k); if (added) fresh.current.add(k); }
  }
  last.current = keys;
  return (
    <section className="pa-list" aria-label={typeof label === "string" ? label : undefined}>
      {label && <h3 className={hideLabel ? "pa-list-label pa-unseen" : "pa-list-label"}>{label}</h3>}
      <ul>
        {rows.map((r, i) => {
          const data = Object.fromEntries(Object.entries(r.data ?? {}).filter(([k]) => /^[a-z][a-z0-9-]*$/.test(k)).map(([k, v]) => [`data-${k}`, v]));
          const cls = `pa-row${r.strong ? " pa-strong" : ""}`;
          const ticks = typeof r.check === "boolean";
          const inner = (
            <>
              {ticks ? <span className={`pa-row-mark pa-check${r.check ? " pa-on" : ""}`} aria-hidden="true">{r.check ? "✓\ufe0e" : ""}</span>
                : r.glyph && <span className="pa-row-mark" aria-hidden="true">{r.glyph}{"\ufe0e"}</span>}
              <span className="pa-row-title">{r.title}{r.badge != null && r.badge !== "" && <span className="pa-badge">{r.badge}</span>}</span>
              {r.meta != null && r.meta !== "" && <span className="pa-row-meta">{r.meta}</span>}
              {r.aside != null && r.aside !== "" && <span className="pa-row-aside">{r.aside}</span>}
              {r.under != null && r.under !== "" && <span className="pa-row-under">{r.under}</span>}
            </>
          );
          return <li key={r.key ?? i} className={r.key !== undefined && fresh.current.has(r.key) ? "pa-fresh" : undefined}>{r.onPress
            ? <button type="button" className={cls} onClick={r.onPress} aria-label={r.label} aria-current={r.current ? "true" : undefined} aria-pressed={ticks ? r.check : undefined} {...data}>{inner}</button>
            : <div className={cls} aria-current={r.current ? "true" : undefined} {...data}>{inner}</div>}</li>;
        })}
      </ul>
      {more && <button type="button" className="pa-more" disabled={more.busy} onClick={more.onPress}>{more.busy ? "Reading…" : more.label}</button>}
    </section>
  );
}

/** A raised block with a title. */
export function Card({ title, children }: { title?: ReactNode; children?: ReactNode }) {
  return <section className="pa-card">{title && <h3 className="pa-card-title">{title}</h3>}{children}</section>;
}

/** A line to write on, and its one action (a tap, or Enter). Keeps its own text unless `value` is given, and clears it
 *  after the action unless `clearOnAction` is false. `onAction` should catch its own errors and say so: a rejection
 *  leaves the text as it was. */
export function Field({ label, value, onChange, placeholder, action, onAction, clearOnAction = true }: {
  label: ReactNode; value?: string; onChange?: (v: string) => void; placeholder?: string;
  action?: string; onAction?: (v: string) => void | Promise<unknown>; clearOnAction?: boolean;
}) {
  const id = useId();
  const [own, setOwn] = useState("");
  const [busy, setBusy] = useState(false);
  const text = value ?? own;
  const set = (v: string) => { if (value === undefined) setOwn(v); onChange?.(v); };
  // no <form> here (the kit's own part): a sealed frame (no allow-forms) drops a form's submit, which the kit then sends
  // itself (frameKit.ts); this part needs none of that
  const submit = async () => {
    if (!onAction || busy || !text.trim()) return;
    setBusy(true);
    try { await onAction(text.trim()); if (clearOnAction) set(""); } catch { /* the text stays, to try again */ } finally { setBusy(false); }
  };
  return (
    <div className="pa-field">
      <label className="pa-field-label" htmlFor={id}>{label}</label>
      <span className="pa-field-row">
        <input id={id} value={text} placeholder={placeholder} onChange={(e) => set(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229) { e.preventDefault(); void submit(); } }} enterKeyHint={action ? "done" : undefined} />
        {action && <button type="button" className="pa-field-action" disabled={busy || !text.trim()} onClick={() => void submit()}>{action}</button>}
      </span>
    </div>
  );
}

const sprig = (
  <svg className="pa-sprig" viewBox="0 0 120 40" aria-hidden="true">
    <path d="M4 30 C30 26 60 18 116 8" fill="none" stroke="currentColor" strokeWidth="1.4" />
    {[18, 34, 50, 66, 82, 98].map((x, i) => {
      const y = 29 - x * 0.19, up = i % 2 === 0;
      return (
        <g key={x}>
          <path d={`M${x} ${y} q${up ? -2 : 6} ${up ? -10 : 9} 12 ${up ? -6 : 4}`} fill="none" stroke="currentColor" strokeWidth="1.1" />
          <ellipse cx={x + 9} cy={y + (up ? -7 : 6)} rx="4.5" ry="2" transform={`rotate(${up ? -30 : 30} ${x + 9} ${y + (up ? -7 : 6)})`} fill="currentColor" opacity=".55" />
        </g>
      );
    })}
  </svg>
);
/** What shows when there is nothing yet. */
export function Empty({ children }: { children?: ReactNode }) {
  return <div className="pa-empty">{sprig}{children && <p>{children}</p>}</div>;
}

// ── saved state (docs/WRITE-AN-APPLET.md "Saved state") ──

type SavedKit = { saved?: { get(key: string): unknown; set(key: string, value: unknown): void } };
const savedKit = () => (globalThis as unknown as { parachute?: SavedKit }).parachute?.saved;

/**
 * useState that the app keeps on this device: a draft, the tab it was on, the item open. What it holds comes back when
 * the applet starts again, after it was hidden, unloaded, the app closed or the phone restarted. Setting it back to
 * `initial` forgets it. Values are JSON.
 *   const [draft, setDraft] = useSaved("draft", "");
 */
export function useSaved<T>(key: string, initial: T): [T, (next: T | ((was: T) => T)) => void] {
  const read = (k: string): T => { const kept = savedKit()?.get(k); return kept === null || kept === undefined ? initial : (kept as T); };
  const [state, setState] = useState<{ key: string; value: T }>(() => ({ key, value: read(key) }));
  // another key (the draft of another room): what that one holds
  const value = state.key === key ? state.value : read(key);
  if (state.key !== key) setState({ key, value });
  const setValue = (f: (was: T) => T) => setState((s) => ({ key, value: f(s.key === key ? s.value : read(key)) }));
  const initialText = JSON.stringify(initial);
  const set = useCallback((next: T | ((was: T) => T)) => {
    setValue((was) => {
      const v = typeof next === "function" ? (next as (w: T) => T)(was) : next;
      savedKit()?.set(key, JSON.stringify(v) === initialText ? null : v);
      return v;
    });
  }, [key, initialText]); // eslint-disable-line react-hooks/exhaustive-deps
  return [value, set];
}
