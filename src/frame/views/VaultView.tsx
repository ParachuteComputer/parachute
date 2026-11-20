import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router";
import { carryOn } from "../FrameRouter";
import ViewerLine, { viewerHref } from "./ViewerLine";
import type { Note } from "@openparachute/surface-client";
import { Bar } from "../../ui/Bar";
import { useApplets, useHome, useHomeLoaded, useVault, useVaultQuery } from "../data";
import { folderOf, noteHref, titleOf } from "../../vault/notes";
import NoVault from "./NoVault";
import NoteRows from "./NoteRows";
import { Loading, Problem, Search } from "../../kit/screen";
import { appletPath } from "../../open/paths";

const LIMIT = 60;

/** A vault: in Vault when it is there and allowed (applet/shipped.ts, docs/VAULT.md); else the plain view, the newest
 *  notes or what a search finds, under a line that leads to Vault. Every row is a link to the note's own address. */
export default function VaultView() {
  // one per vault: what one vault's visit decided (Vault or the plain view) doesn't carry to the next
  const { vault } = useParams();
  return <VaultVisit key={vault} />;
}

function VaultVisit() {
  const { vault: key } = useParams();
  const rec = useVault(key);
  const location = useLocation();
  const homeRead = useHomeLoaded();
  const viewer = useHome().viewer;
  // a carry-on the shell refused (the person already left, say) leaves the plain view here, never "Opening…" for good
  const [stay, setStay] = useState(false);
  // `?with=vault`: the plain view, asked for (the way back when Vault itself won't do)
  const plain = new URLSearchParams(location.search).get("with") === "vault";
  // decided once per visit: a Vault the home's read finds late doesn't take over a plain view the person is reading
  const firstRead = useRef<boolean | null>(null);
  if (homeRead && firstRead.current === null) firstRead.current = viewer?.status === "ok";
  const toViewer = firstRead.current === true && !!rec && viewer?.status === "ok" && !stay && !plain;
  useEffect(() => { if (toViewer && viewer && rec) carryOn(location.pathname, viewerHref(viewer, rec.key)).catch(() => setStay(true)); }, [toViewer]); // eslint-disable-line react-hooks/exhaustive-deps
  const [term, setTerm] = useState("");
  const load = useVaultQuery<Note[]>(rec, (c) => (term
    ? c.queryNotes({ search: term, limit: LIMIT })
    : c.queryNotes({ orderBy: "updated_at", sort: "desc", limit: LIMIT })), [term]);
  const applets = useApplets(rec?.key);
  if (!rec) return <NoVault />;
  if (!homeRead || toViewer) return <main className="screen"><Bar title={rec.vault} back={true} /><Loading>Opening…</Loading></main>;
  return (
    <main className="screen">
      <Bar title={rec.vault} back={true} />
      <ViewerLine vault={rec.key} />
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
