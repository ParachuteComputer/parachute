import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { atFirstEntry } from "./history";

/** In the shell: one step back in this tab's history, or the launcher when this is its first entry (a start, a link
 *  from outside). In a frame, history is the shell's: the frame's navigator asks the shell, which does the same. */
export function backOrLauncher(nav: (to: string | number, o?: { replace?: boolean }) => void) {
  if (!atFirstEntry()) nav(-1); else nav("/", { replace: true });
}

/** The one top bar: Back (when there is somewhere to go back to), the title, and the way to Settings. */
export function Bar({ title, back, onBack, children }: { title: string; back?: string | true; onBack?: (nav: (to: string | number, o?: { replace?: boolean }) => void) => void; children?: ReactNode }) {
  const nav = useNavigate();
  const go = nav as (to: string | number, o?: { replace?: boolean }) => void;
  return (
    <header className="bar">
      {back === true ? <button type="button" className="bar-back" aria-label="Back" onClick={() => (onBack ? onBack(go) : nav(-1))}>‹</button>
        : back ? <Link className="bar-back" aria-label="Back" to={back}>‹</Link> : <span className="bar-mark" aria-hidden="true">◠</span>}
      <h1 className="bar-title">{title}</h1>
      {children}
      <Link className="bar-menu" aria-label="Settings" to="/settings">⋯</Link>
    </header>
  );
}
