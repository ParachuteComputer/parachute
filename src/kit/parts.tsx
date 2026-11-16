// The parts: what an applet (and the frame) builds a screen from, beside the data calls. Each is small, takes plain
// props, and is drawn only on the theme's tokens (parts.css), so the person's theme record restyles it. Every export
// here is a promise to applets written against it (docs/WRITE-AN-APPLET.md): add with care, never change a prop's
// meaning. Each part imports only React, so it could later be shared as a record of its own (step 6).
//   Days    what changed, a day at a time: a column of ink marks per day (a tally), weeks set apart, today marked
//   List    rows under a label: a title, a line below, a word at the right, and an optional glyph; a row may be tapped
//   Card    a raised block with a title
//   Field   a line to write on, with one action (Enter does it too)
//   Empty   what shows when there is nothing yet: a sprig and a line
//   Note    in parts-note.tsx: a note's text drawn by surface-render, rich notes included (a heavier bundle)
import { useId, useMemo, useState, type ReactNode } from "react";
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
  const tall = 8; // marks drawn at most: a busier day is drawn full (the label's total still counts every change)
  const total = values.reduce((a, b) => a + b, 0);
  const width = values.length * 9 + Math.floor((values.length - 1) / 7) * 6;
  const said = `${label ? `${label}: ` : ""}${total} in ${values.length} days`;
  const Box = inline ? "span" : "figure";
  return (
    <Box className="pa-days" role="img" aria-label={said}>
      <svg viewBox={`0 0 ${width} ${tall * 5 + 12}`} preserveAspectRatio="xMinYMax meet" aria-hidden="true">
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

export type Row = { key?: string; title: ReactNode; meta?: ReactNode; aside?: ReactNode; glyph?: string; onPress?: () => void };
/** Rows under a label. A row with `onPress` is a button. */
export function List({ label, rows }: { label?: ReactNode; rows: readonly Row[] }) {
  return (
    <section className="pa-list" aria-label={typeof label === "string" ? label : undefined}>
      {label && <h3 className="pa-list-label">{label}</h3>}
      <ul>
        {rows.map((r, i) => {
          const inner = (
            <>
              {r.glyph && <span className="pa-row-mark" aria-hidden="true">{r.glyph}{"︎"}</span>}
              <span className="pa-row-title">{r.title}</span>
              {r.meta != null && r.meta !== "" && <span className="pa-row-meta">{r.meta}</span>}
              {r.aside != null && r.aside !== "" && <span className="pa-row-aside">{r.aside}</span>}
            </>
          );
          return <li key={r.key ?? i}>{r.onPress ? <button type="button" className="pa-row" onClick={r.onPress}>{inner}</button> : <div className="pa-row">{inner}</div>}</li>;
        })}
      </ul>
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
  // no <form>: a sealed frame (no allow-forms) blocks a form's submit before any handler sees it
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
