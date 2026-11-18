import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import type { Note } from "@openparachute/surface-client";
import { Bar } from "../../ui/Bar";
import { useApplets, useVault, useVaultQuery } from "../data";
import { folderOf, noteHref, titleOf } from "../../vault/notes";
import NoVault from "./NoVault";
import { appletPath } from "../../open/paths";

const LIMIT = 60;

/** The plain vault view: the newest notes, or what a search finds. Every row is a link to the note's own address. */
export default function VaultView() {
  const { vault: key } = useParams();
  const rec = useVault(key);
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  useEffect(() => { const t = window.setTimeout(() => setTerm(q.trim()), 250); return () => window.clearTimeout(t); }, [q]);
  const load = useVaultQuery<Note[]>(rec, (c) => (term
    ? c.queryNotes({ search: term, limit: LIMIT })
    : c.queryNotes({ orderBy: "updated_at", sort: "desc", limit: LIMIT })), [term]);
  const applets = useApplets(rec?.key);
  if (!rec) return <NoVault />;
  return (
    <main className="screen">
      <Bar title={rec.vault} back={true} />
      {applets?.ok && applets.entries.length > 0 && (
        <ul className="applets" aria-label="Applets">
          {applets.entries.map((a) => (
            <li key={a.noteId}><Link className="applet-chip" to={appletPath(rec.key, a.noteId)}><span aria-hidden="true">{a.manifest.glyph}{"\uFE0E"}</span>{a.manifest.name}</Link></li>
          ))}
        </ul>
      )}
      <p className="row-buttons"><Link className="secondary" to={`/v/${encodeURIComponent(rec.key)}/new`}>New note</Link></p>
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
