// A note's route, /v/<vault>/n/<id>: the one place open-with is decided (open/resolve.ts). Links, wikilinks, search
// hits, Back and links from outside all arrive here. `?with=vault` always shows the plain vault view.
import { useEffect } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { useVault } from "../vault/hooks";
import { titleOf } from "../vault/notes";
import { carryMark } from "../open/mark";
import { openSheet } from "../open/sheet";
import { useOpenWith } from "../open/useOpenWith";
import { appletHref, appletPath } from "../open/paths";
import NoteView from "./NoteView";
import NoVault from "./NoVault";
import { Bar } from "../ui/Bar";

/** The history entries whose decision has been acted on: the route decides once per visit (a default the sheet
 *  stores a moment later must not send the person on a second time). */
const decided = new Map<string, string>();

export default function NoteRoute() {
  const { vault: key, id } = useParams();
  const [params] = useSearchParams();
  const location = useLocation();
  const nav = useNavigate();
  const rec = useVault(key);
  const plain = params.get("with") === "vault";
  const ow = useOpenWith(plain ? null : rec, id);
  const decision = ow.state === "ok" ? ow.decision : null;

  useEffect(() => {
    if (!rec || !id || !decision || decided.has(location.key)) return;
    decided.set(location.key, decision.kind);
    if (decision.kind === "applet") {
      const to = appletHref(rec.key, decision.candidate, id);
      // a tap that led to this note leads on to the applet, once; anything else arrives there stopped
      carryMark(location.pathname, appletPath(rec.key, decision.candidate.entry.noteId));
      nav(to, { replace: true });
    } else if (decision.kind === "ask" && ow.state === "ok" && ow.note) {
      openSheet(rec.key, id, true, { note: ow.note, cands: decision.candidates });
    }
  }, [decision, rec, id, location.key, location.pathname, nav]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!rec) return <NoVault />;
  if (plain) return <NoteView />;
  const first = decided.get(location.key) ?? decision?.kind;
  if (ow.state === "loading" || first === "applet") return <main className="screen"><Bar title="Note" back={`/v/${encodeURIComponent(rec.key)}`} /><p className="quiet" role="status">Opening…</p></main>;
  // what shows is the decision made on arrival (a default stored from the sheet a moment later changes nothing here)
  const line = first === "vault" && decision?.kind === "vault" && decision.line && ow.state === "ok" && ow.note ? (
    <p className="open-line" role="status">
      <Link to={appletHref(rec.key, decision.line.candidate, ow.note.id)}>
        <span aria-hidden="true">{decision.line.candidate.entry.manifest.glyph}</span>{" "}
        {decision.line.status === "updated" ? `${decision.line.candidate.entry.manifest.name} changed since you allowed it.` : `${decision.line.candidate.entry.manifest.name} can open this.`}
      </Link>
    </p>
  ) : first === "ask" && ow.state === "ok" && ow.note ? (
    <p className="open-line"><button type="button" className="link-button" onClick={() => openSheet(rec.key, ow.note!.id, true, { note: ow.note!, cands: ow.cands })}>Open {titleOf(ow.note)} with…</button></p>
  ) : null;
  return <NoteView above={line} note={ow.state === "ok" ? ow.note : undefined} />;
}
