import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import type { Note } from "@openparachute/surface-client";
import { Bar } from "../ui/Bar";
import { useVault, useVaultQuery } from "../vault/hooks";
import { folderOf, noteHref, titleOf } from "../vault/notes";
import NoVault from "./NoVault";

const LIMIT = 60;

/** The plain vault view: the newest notes, or what a search finds. Every row is a link to the note's own address. */
export default function VaultView() {
  const { vault: key } = useParams();
  const rec = useVault(key);
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  useEffect(() => { const t = window.setTimeout(() => setTerm(q.trim()), 250); return () => window.clearTimeout(t); }, [q]);
  const load = useVaultQuery<Note[]>(rec, (c) => (term
    ? c.queryNotes({ search: term, limit: String(LIMIT) })
    : c.queryNotes({ orderBy: "updated_at", sort: "desc", limit: LIMIT })), [term]);
  if (!rec) return <NoVault />;
  return (
    <main className="screen">
      <Bar title={rec.vault} back="/" />
      <input className="search" type="search" placeholder="Search this vault" aria-label="Search this vault" value={q} onChange={(e) => setQ(e.target.value)} />
      {load.state === "loading" && <p className="quiet" role="status">Loading…</p>}
      {load.state === "error" && <p className="error" role="alert">{load.error}</p>}
      {load.state === "ok" && (load.data.length ? (
        <ul className="rows" aria-label={term ? "Search results" : "Notes"}>
          {load.data.map((n) => (
            <li key={n.id}><Link className="row" to={noteHref(rec.key, n.id)}>
              <span className="row-title">{titleOf(n)}</span>
              <span className="row-sub">{[folderOf(n), ...(n.tags ?? []).map((t) => `#${t}`)].filter(Boolean).join(" · ")}</span>
            </Link></li>
          ))}
        </ul>
      ) : <p className="quiet">{term ? "Nothing matches." : "This vault is empty."}</p>)}
    </main>
  );
}
