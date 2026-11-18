import { useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";
import type { Note } from "@openparachute/surface-client";
import { NoteRenderer } from "@openparachute/surface-render/note";
import { unresolvedLink, type WikilinkResolver } from "@openparachute/surface-render/markdown";
import { Bar } from "../../ui/Bar";
import { useVault, useVaultQuery } from "../data";
import { call } from "../bridge";
import { folderOf, isAppPath, isCodeNote, noteHref, titleOf } from "../../vault/notes";
import NoVault from "./NoVault";
import { linkFor } from "../../links/parse";

// a link out of the app (web, mail, phone): the frame can't open one itself (it has no popups), so it asks the shell,
// during the tap
const RouterLink = ({ href, className, children }: { href: string; className?: string; children?: ReactNode }) =>
  isAppPath(href) ? <Link to={href} className={className}>{children}</Link>
    : <a href={href} className={className} rel="noreferrer noopener" onClick={(e) => { e.preventDefault(); void call("link.out", { url: href }); }}>{children}</a>;

/** A note, read: its title, where it sits, its tags, and its content drawn by surface-render. An applet's own note is shown as text. */
export default function NoteView({ above, note: given }: { above?: ReactNode; /** the note, when the route already read it */ note?: Note | null }) {
  const { vault: key, id } = useParams();
  const rec = useVault(key);
  const navigate = useNavigate();
  const fetched = useVaultQuery<Note | null>(given === undefined ? rec : null, (c) => c.getNote(id ?? ""), [id]);
  const load: typeof fetched = given === undefined ? fetched : { state: "ok", data: given };
  // a wikilink names a note by its path; the vault answers a path where an id goes
  const resolve: WikilinkResolver = useMemo(() => (target) => (rec ? unresolvedLink(noteHref(rec.key, target.split("|")[0].split("#")[0])) : null), [rec]);
  const note = load.state === "ok" ? load.data : null;
  // the note as the renderer takes it, made once per note: a new object each render would redraw a rich note
  const drawn = useMemo(() => (note ? { ...note, path: `${note.path ?? "note"}.${(note as { extension?: string }).extension?.replace(/^\./, "") || "md"}`, content: note.content ?? "" } : null), [note]);
  if (!rec) return <NoVault />;
  return (
    <main className="screen">
      <Bar title={note ? titleOf(note) : "Note"} back={true} />
      {above}
      {load.state === "loading" && <p className="quiet" role="status">Loading…</p>}
      {load.state === "error" && <p className="error" role="alert">{load.error}</p>}
      {load.state === "ok" && !note && <p className="error" role="alert">There's no such note.</p>}
      {note && (
        <article className="note">
          <p className="note-where">{[folderOf(note), ...(note.tags ?? []).map((t) => `#${t}`)].filter(Boolean).join(" · ") || " "}
            <CopyLink link={linkFor(rec.url ?? `${rec.issuer}/vault/${encodeURIComponent(rec.vault)}`, note.id)} /></p>
          {isCodeNote(note)
            ? <pre className="note-code" aria-label="The note's text">{note.content ?? ""}</pre>
            : <div className="rn-theme-uni"><NoteRenderer className="prose-note" rich calm note={drawn!} resolve={resolve} linkComponent={RouterLink}
                onNavigate={(href) => { if (isAppPath(href)) navigate(href); }} openLink={(url) => { void call("link.out", { url }); }} /></div>}
        </article>
      )}
    </main>
  );
}

/** The note's link for someone else's Parachute (or another app): it opens here only where that vault is held. */
function CopyLink({ link }: { link: string }) {
  const [done, setDone] = useState(false);
  return <button type="button" className="link-button note-copy" onClick={() => { void call("clipboard.write", { text: link }).then(setDone, () => setDone(false)); }}>{done ? "Link copied" : "Copy link"}</button>;
}
