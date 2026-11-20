import { useState } from "react";
import { Link, useParams } from "react-router";
import type { Note } from "@openparachute/surface-client";
import { Bar } from "../../ui/Bar";
import { useApplets, useVault, useVaultQuery } from "../data";
import { folderOf, noteHref, titleOf } from "../../vault/notes";
import NoVault from "./NoVault";
import NoteRows from "./NoteRows";
import { Loading, Problem, Search } from "../../kit/screen";
import { appletPath } from "../../open/paths";

const LIMIT = 60;

/** The plain vault view: the newest notes, or what a search finds. Every row is a link to the note's own address. */
export default function VaultView() {
  const { vault: key } = useParams();
  const rec = useVault(key);
  const [term, setTerm] = useState("");
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
      <Search label="Search this vault" onSearch={setTerm} live={250} />
      {load.state === "loading" && <Loading />}
      {load.state === "error" && <Problem error={load.error}>Couldn't read {rec.vault}</Problem>}
      {load.state === "ok" && (load.data.length
        ? <NoteRows label={term ? "Search results" : "Notes"} rows={load.data.map((n) => ({
          key: n.id, to: noteHref(rec.key, n.id), title: titleOf(n), meta: [folderOf(n), ...(n.tags ?? []).map((t) => `#${t}`)].filter(Boolean).join(" · "),
        }))} />
        : <p className="quiet">{term ? "Nothing matches." : "This vault is empty."}</p>)}
    </main>
  );
}
