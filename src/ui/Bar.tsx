import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router";

/** The one top bar: Back (when there is somewhere to go back to), the title, and the way to Settings. */
export function Bar({ title, back, children }: { title: string; back?: string | true; children?: ReactNode }) {
  const nav = useNavigate();
  return (
    <header className="bar">
      {back === true ? <button type="button" className="bar-back" aria-label="Back" onClick={() => nav(-1)}>‹</button>
        : back ? <Link className="bar-back" aria-label="Back" to={back}>‹</Link> : <span className="bar-mark" aria-hidden="true">◠</span>}
      <h1 className="bar-title">{title}</h1>
      {children}
      <Link className="bar-menu" aria-label="Settings" to="/settings">⋯</Link>
    </header>
  );
}
