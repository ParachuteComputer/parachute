import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import type { Note } from "@openparachute/surface-client";
import type { FrameVault } from "../../bridge/protocol";
import { readerFor, useVaults } from "../data";
import { isAppOwn, noteHref, titleOf } from "../../vault/notes";
import { Empty } from "../../kit/parts";
import { ago } from "./Launcher";

/** The newest notes (or what a search finds) of the chosen vaults, newest first: one list across them. */
type Row = { v: FrameVault; n: Note };
const updated = (n: Note) => (n as { updatedAt?: string }).updatedAt ?? "";
const PER_VAULT = 40, SHOWN = 60;

function useNotes(vaults: FrameVault[], term: string): Row[] | null {
  const [rows, setRows] = useState<Row[] | null>(null);
  const keys = vaults.map((v) => v.key).join("|");
  useEffect(() => {
    let live = true;
    setRows(null);
    void Promise.all(vaults.map((v) => readerFor(v).queryNotes(term ? { search: term, limit: PER_VAULT } : { orderBy: "updated_at", sort: "desc", limit: PER_VAULT })
      .then((ns) => ns.filter((n) => !isAppOwn(n)).map((n) => ({ v, n })), () => [] as Row[])))
      .then((per) => { if (live) setRows(per.flat().sort((a, b) => updated(b.n).localeCompare(updated(a.n))).slice(0, SHOWN)); });
    return () => { live = false; };
  }, [keys, term]); // eslint-disable-line react-hooks/exhaustive-deps
  return rows;
}

/**
 * Notes: the simple app's home (docs/SIMPLE.md). Every vault's newest notes in one list, a search across them, the
 * vaults as tabs, and a new note. A tap opens the note (where Edit is); the bar below has Capture and Connect.
 */
export default function NotesHome() {
  const all = useVaults();
  const [params, setParams] = useSearchParams();
  const pick = params.get("in");
  const chosen = all.find((v) => v.key === pick) ?? null;
  const [q, setQ] = useState(params.get("q") ?? "");
  const [term, setTerm] = useState(q.trim());
  useEffect(() => { const t = window.setTimeout(() => setTerm(q.trim()), 250); return () => window.clearTimeout(t); }, [q]);
  // the search and the tab live in the address, so Back from a note comes back to the same list
  useEffect(() => {
    const next = new URLSearchParams(params);
    if (term) next.set("q", term); else next.delete("q");
    if (next.toString() !== params.toString()) setParams(next, { replace: true });
  }, [term]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = chosen ? [chosen] : all;
  const rows = useNotes(shown, term);
  const home = all.find((v) => v.home) ?? all[0];
  const into = chosen ?? home;
  const tab = (v: FrameVault | null) => {
    const next = new URLSearchParams(params);
    if (v) next.set("in", v.key); else next.delete("in");
    setParams(next, { replace: true });
  };
  return (
    <main className="screen notes-home">
      <header className="notes-head">
        <h1>Notes</h1>
        {into && <Link className="primary notes-new" to={`/v/${encodeURIComponent(into.key)}/new`}>New note</Link>}
      </header>
      <input className="search notes-search" type="search" placeholder={chosen ? `Search ${chosen.vault}` : "Search every vault"} aria-label={chosen ? `Search ${chosen.vault}` : "Search every vault"}
        value={q} onChange={(e) => setQ(e.target.value)} />
      {all.length > 1 && (
        <nav className="notes-tabs" aria-label="Vaults">
          <button type="button" className="notes-tab" aria-pressed={!chosen} onClick={() => tab(null)}>All</button>
          {all.map((v) => <button key={v.key} type="button" className="notes-tab" aria-pressed={chosen?.key === v.key} onClick={() => tab(v)}>{v.vault}</button>)}
        </nav>
      )}
      {rows === null && <p className="quiet" role="status">Reading your notes…</p>}
      {rows && rows.length > 0 && (
        <ul className="rows" aria-label={term ? "Search results" : "Notes"}>
          {rows.map(({ v, n }) => (
            <li key={`${v.key}/${n.id}`}><Link className="row" to={noteHref(v.key, n.id)}>
              <span className="row-title">{titleOf(n)}</span>
              <span className="row-sub">{[shown.length > 1 ? v.vault : null, ago(updated(n))].filter(Boolean).join(" · ")}</span>
            </Link></li>
          ))}
        </ul>
      )}
      {rows && !rows.length && (term ? <p className="quiet">Nothing matches “{term}”.</p> : <Empty>Nothing written here yet. Start with New note, or Capture below.</Empty>)}
      <p className="launcher-foot"><Link to="/add">Add a Parachute</Link><Link to="/settings">Settings</Link></p>
    </main>
  );
}
