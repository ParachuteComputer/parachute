// A newer build, said once above the bar (shell/updates.ts): Download, or Later (until a later build). On Android it
// then says how the download goes and when Android is asking, and that an update didn't install (Why: Settings → Updates,
// which says the same at length, and what this build is).
import { useEffect } from "react";
import { useNavigate } from "react-router";
import { builtOn, download, laterAt, putOff, share, useInstall, useUpdate, useUpdateChecks } from "./updates";

export default function UpdateLine() {
  useUpdateChecks();
  const s = useUpdate();
  const { install, after } = useInstall();
  const navigate = useNavigate();
  const showing = s.kind === "offer" && laterAt() < s.offer.at;
  // the foot grows by the line, so nothing under it (an Allow, a composer, a frame's foot) is covered
  useEffect(() => { document.documentElement.classList.toggle("update-showing", showing); return () => document.documentElement.classList.remove("update-showing"); }, [showing]);
  if (s.kind !== "offer" || !showing) return null;
  const go = () => void download(s.offer, s.platform);
  const missed = s.platform === "android" && (install.kind === "failed" || (install.kind === "idle" && after.kind === "stuck" && after.to === s.offer.commit));
  return (
    <aside className="update-line" aria-label="A newer Parachute">
      {install.kind === "downloading" ? <span role="status">Downloading the newer Parachute… {share(install.got, install.total)}</span>
        : install.kind === "installing" ? <span role="status">Android is asking: tap Update</span>
        : missed ? <span role="status">The update didn't install</span>
        : <span>A newer Parachute is ready <span className="quiet">(built {builtOn(s.offer.at)})</span></span>}
      {(install.kind === "idle" || install.kind === "failed") && <>
        {missed ? <button type="button" className="quiet-button" onClick={() => void navigate("/settings#s-updates")}>Why</button>
          : <button type="button" className="quiet-button" onClick={go}>Download</button>}
        <button type="button" className="quiet-button" onClick={() => putOff(s.offer.at)}>Later</button>
      </>}
    </aside>
  );
}
