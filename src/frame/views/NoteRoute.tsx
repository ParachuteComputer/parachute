// A note's route, /v/<vault>/n/<id>: the one place open-with is decided (open/resolve.ts). Links, wikilinks, search
// hits, Back and links from outside all arrive here. `?with=vault` always shows the plain vault view.
import { useEffect } from "react";
import { Link, useLocation, useParams, useSearchParams } from "react-router";
import { useVault } from "../data";
import { titleOf } from "../../vault/notes";
import { openSheet } from "../open/sheet";
import { useOpenWith } from "../open/useOpenWith";
import { appletHref } from "../../open/paths";
import { carryOn } from "../FrameRouter";
import { call } from "../bridge";
import type { Decided } from "../../bridge/protocol";
import NoteView from "./NoteView";
import NoVault from "./NoVault";
import { Bar } from "../../ui/Bar";

/** The history entries whose decision has been acted on: the route decides once per visit (a default the sheet
 *  stores a moment later must not send the person on a second time). The shell keeps them too, across frames (the
 *  frame is made afresh after a shell screen), and hands them back in the location's state. */
const decided = new Map<string, string>();

export default function NoteRoute() {
  const { vault: key, id } = useParams();
  const [params] = useSearchParams();
  const location = useLocation();
  const rec = useVault(key);
  const plain = params.get("with") === "vault";
  const ow = useOpenWith(plain ? null : rec, id);
  const kept = (location.state as { decided?: Decided } | null)?.decided;
  if (kept && !decided.has(location.key)) decided.set(location.key, kept);
  const decision = ow.state === "ok" ? ow.decision : null;

  useEffect(() => {
    if (!rec || !id || !decision || decided.has(location.key)) return;
    decided.set(location.key, decision.kind);
    // the shell keeps it for a return to this entry; "applet" only once the shell has sent the person on
    if (decision.kind !== "applet") void call("nav.decided", { key: location.key, kind: decision.kind });
    if (decision.kind === "applet") {
      // a tap that led to this note leads on to the applet, once (the shell keeps the tap); anything else arrives stopped
      const key = location.key;
      // a move the shell refuses (the person already left) is forgotten: this entry decides again when it is shown again
      carryOn(location.pathname, appletHref(rec.key, decision.candidate, id))
        .then(() => call("nav.decided", { key, kind: "applet" }), () => { decided.delete(key); });
    } else if (decision.kind === "ask" && ow.state === "ok" && ow.note) {
      openSheet(rec.key, id, true, { note: ow.note, cands: decision.candidates });
    }
  }, [decision, rec, id, location.key, location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!rec) return <NoVault />;
  if (plain) return <NoteView />;
  const first = decided.get(location.key) ?? decision?.kind;
  if (ow.state === "loading" || first === "applet") return <main className="screen"><Bar title="Note" back={`/v/${encodeURIComponent(rec.key)}`} /><p className="quiet" role="status">Opening…</p></main>;
  // what shows is the decision made on arrival (a default stored from the sheet a moment later changes nothing here)
  const l = first === "vault" && decision?.kind === "vault" ? decision.line : null;
  const line = l && ow.state === "ok" && ow.note ? (
    <p className="open-line" role="status">
      {l.others.length === 0 ? (
        <Link to={appletHref(rec.key, l.candidate, ow.note.id)}>
          <span aria-hidden="true">{l.candidate.entry.manifest.glyph}</span>{" "}
          {l.status === "updated" ? `${l.candidate.entry.manifest.name} changed since you allowed it.` : `${l.candidate.entry.manifest.name} can open this.`}
        </Link>
      ) : (
        // several could: the sheet lets the person pick which to allow
        <button type="button" className="link-button" onClick={() => openSheet(rec.key, ow.note!.id, true, { note: ow.note!, cands: ow.cands })}>
          {[l.candidate, ...l.others].map((c) => c.entry.manifest.name).join(" or ")} can open this.
        </button>
      )}
    </p>
  ) : first === "ask" && ow.state === "ok" && ow.note ? (
    <p className="open-line"><button type="button" className="link-button" onClick={() => openSheet(rec.key, ow.note!.id, true, { note: ow.note!, cands: ow.cands })}>Open {titleOf(ow.note)} with…</button></p>
  ) : null;
  return <NoteView above={line} note={ow.state === "ok" ? ow.note : undefined} />;
}
