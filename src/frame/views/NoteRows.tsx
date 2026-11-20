// Notes as rows, drawn as the kit's List draws them (parts.css: pa-list, pa-row), each row a link to the note's own
// address so Back comes back here. The frame moves by its router; an applet's List can't (it has no links of its own).
import { Link } from "react-router";
import type { ReactNode } from "react";
import "../../kit/parts.css";

export type NoteRow = { key: string; to: string; title: ReactNode; meta?: ReactNode; aside?: ReactNode };
export default function NoteRows({ label, rows }: { label: string; rows: readonly NoteRow[] }) {
  return (
    <section className="pa-list">
      <ul aria-label={label}>
        {rows.map((r) => (
          <li key={r.key}><Link className="pa-row" to={r.to}>
            <span className="pa-row-title">{r.title}</span>
            {r.meta != null && r.meta !== "" && <span className="pa-row-meta">{r.meta}</span>}
            {r.aside != null && r.aside !== "" && <span className="pa-row-aside">{r.aside}</span>}
          </Link></li>
        ))}
      </ul>
    </section>
  );
}
