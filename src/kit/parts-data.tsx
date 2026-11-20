// The kit's parts for records with fields (T-476, the Vault applet): a table of records, and a record's fields read
// and changed in place. Like every part: plain props, the theme's tokens (parts.css), nothing an applet must style.
import { Fragment, useEffect, useId, useRef, useState, type ReactNode } from "react";
import "./parts.css";

export type Column = { key: string; label: ReactNode; /** numbers and dates line up at the right */ align?: "start" | "end"; /** ch, at least */ width?: number; /** false: its header doesn't sort */ sortable?: boolean };
export type TableRow = { key: string; cells: Record<string, ReactNode>; onPress?: () => void; current?: boolean; /** what a screen reader says for the row's button */ label?: string };
export type TableGroup = { key: string; label: ReactNode; count?: number; rows: readonly TableRow[] };

/** A table of records: the first column stays in view as the rest scroll across (a phone shows two or three), a
 *  header's tap sorts by it (again: the other way), a row's tap opens it. A long table costs little: a row off screen
 *  isn't drawn, and `more` reads the next page by itself as its foot comes near (or on a tap). `groups` draws the rows
 *  under headings instead of `rows`. */
export function Table({ label, columns, rows, groups, sort, onSort, more }: {
  label: string; columns: readonly Column[]; rows?: readonly TableRow[]; groups?: readonly TableGroup[];
  sort?: { by: string; dir: "asc" | "desc" }; onSort?: (key: string) => void;
  more?: { label: string; onPress: () => void; busy?: boolean };
}) {
  const foot = useRef<HTMLDivElement | null>(null);
  const moreRef = useRef(more);
  moreRef.current = more;
  // the next page as its foot comes into view: the browser says when (no timer)
  useEffect(() => {
    const el = foot.current;
    if (!el || !more || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((seen) => { if (seen.some((s) => s.isIntersecting) && moreRef.current && !moreRef.current.busy) moreRef.current.onPress(); }, { rootMargin: "600px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [!!more]); // eslint-disable-line react-hooks/exhaustive-deps
  const template = columns.map((c, i) => (i === 0 ? `minmax(${Math.max(c.width ?? 16, 12)}ch, 2fr)` : `minmax(${c.width ?? 10}ch, 1fr)`)).join(" ");
  const line = (r: TableRow) => (
    <div role="row" key={r.key} className="pa-trow" aria-current={r.current ? "true" : undefined}>
      {columns.map((c, i) => (
        <div role={i === 0 ? "rowheader" : "cell"} key={c.key} className={`pa-tcell${c.align === "end" ? " pa-tend" : ""}`}>
          {i === 0 && r.onPress
            ? <button type="button" className="pa-topen" onClick={r.onPress} aria-label={r.label}>{r.cells[c.key] ?? ""}</button>
            : r.cells[c.key] ?? ""}
        </div>
      ))}
    </div>
  );
  return (
    <section className="pa-table" aria-label={label} style={{ ["--pa-cols" as string]: template }}>
      <div role="table" aria-label={label} className="pa-tgrid">
        <div role="rowgroup">
          <div role="row" className="pa-thead">
            {columns.map((c) => {
              const on = sort?.by === c.key;
              return (
                <div role="columnheader" key={c.key} className={`pa-tcell${c.align === "end" ? " pa-tend" : ""}`} aria-sort={on ? (sort!.dir === "asc" ? "ascending" : "descending") : undefined}>
                  {onSort && c.sortable !== false ? <button type="button" className="pa-tsort" onClick={() => onSort(c.key)}>{c.label}{on && <span aria-hidden="true">{sort!.dir === "asc" ? " ↑" : " ↓"}</span>}</button> : c.label}
                </div>
              );
            })}
          </div>
        </div>
        <div role="rowgroup">
          {groups
            ? groups.map((g) => (
              <Fragment key={g.key}>
                <div role="row" className="pa-tgroup"><div role="cell" className="pa-tcell">{g.label}{g.count != null && <span className="pa-tcount">{g.count}</span>}</div></div>
                {g.rows.map(line)}
              </Fragment>
            ))
            : (rows ?? []).map(line)}
        </div>
      </div>
      {more && <div ref={foot}><button type="button" className="pa-more" disabled={more.busy} onClick={more.onPress}>{more.busy ? "Reading…" : more.label}</button></div>}
    </section>
  );
}

export type FieldKind = "text" | "number" | "yesno" | "choice" | "date" | "list" | "long";
export type FieldItem = { name: string; label?: ReactNode; kind?: FieldKind; choices?: readonly string[]; value: unknown; /** shown, not changed */ readOnly?: boolean };

/** A value as one line of text: yes or no, a list joined, nothing as a dash. */
export function valueText(v: unknown): string {
  if (v === null || v === undefined || v === "") return "–";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (Array.isArray(v)) return v.map((x) => (x !== null && typeof x === "object" ? JSON.stringify(x) : String(x))).join(", ") || "–";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** A typed value from what was typed, by the field's kind: a number, yes/no, a list; "" is none (null). */
export function valueFrom(kind: FieldKind, text: string): unknown {
  const typed = text.trim();
  if (kind === "yesno") return typed === "true" ? true : typed === "false" ? false : null;
  if (!typed) return null;
  if (kind === "number") { const n = Number(typed); return Number.isFinite(n) ? n : typed; }
  if (kind === "list") return typed.split(",").map((s) => s.trim()).filter(Boolean);
  return kind === "long" ? text : typed;
}
const textOf = (kind: FieldKind, v: unknown) => (v === null || v === undefined ? "" : kind === "list" && Array.isArray(v) ? v.join(", ") : typeof v === "object" ? JSON.stringify(v) : String(v));

/** A record's fields, name and value; with `onSave`, each is changed where it stands (a choice from its list, a box
 *  for yes or no, a number, a date), saved on Enter or on leaving it (a choice and yes or no: on the pick). `onSave` should say what went
 *  wrong itself (a toast): a rejection puts the value back. */
export function Fields({ label, fields, onSave }: { label?: string; fields: readonly FieldItem[]; onSave?: (name: string, value: unknown) => Promise<unknown> | void }) {
  return (
    <dl className="pa-fields" aria-label={label}>
      {fields.map((f) => <FieldLine key={f.name} f={f} onSave={f.readOnly ? undefined : onSave} />)}
    </dl>
  );
}

function FieldLine({ f, onSave }: { f: FieldItem; onSave?: (name: string, value: unknown) => Promise<unknown> | void }) {
  const id = useId();
  const kind = f.kind ?? "text";
  const [text, setText] = useState(textOf(kind, f.value));
  const [busy, setBusy] = useState(false);
  const was = textOf(kind, f.value);
  useEffect(() => { setText(was); }, [was]);
  const save = async (next: string) => {
    if (!onSave || next === was || busy) return;
    setBusy(true);
    try { await onSave(f.name, valueFrom(kind, next)); } catch { setText(was); } finally { setBusy(false); }
  };
  const name = <dt className="pa-fname"><label htmlFor={id}>{f.label ?? f.name.replace(/_/g, " ")}</label></dt>;
  if (!onSave) return <>{name}<dd className="pa-fvalue" id={id}>{valueText(f.value)}</dd></>;
  const common = { id, disabled: busy, className: "pa-finput", "aria-busy": busy || undefined };
  let input: ReactNode;
  if (kind === "yesno") input = <input {...common} type="checkbox" className="pa-fcheck" checked={text === "true"} onChange={(e) => { const v = String(e.target.checked); setText(v); void save(v); }} />;
  else if (kind === "choice") input = (
    <select {...common} value={text} onChange={(e) => { setText(e.target.value); void save(e.target.value); }}>
      <option value="">–</option>
      {[...new Set([...(f.choices ?? []), ...(text && !(f.choices ?? []).includes(text) ? [text] : [])])].map((c) => <option key={c} value={c}>{c}</option>)}
    </select>
  );
  else if (kind === "long") input = <textarea {...common} rows={3} value={text} onChange={(e) => setText(e.target.value)} onBlur={() => void save(text)} />;
  else input = (
    <input {...common} type={kind === "number" ? "number" : kind === "date" ? "date" : "text"} value={text} placeholder="–"
      onChange={(e) => setText(e.target.value)}
      onBlur={() => void save(text)}
      onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); (e.target as HTMLInputElement).blur(); } if (e.key === "Escape") { setText(was); } }} />
  );
  return <>{name}<dd className="pa-fvalue">{input}</dd></>;
}
