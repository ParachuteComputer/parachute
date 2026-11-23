// A newer build, said once above the bar (shell/updates.ts): Download, or Later (until a later build). On Android it
// then says how the download goes and when Android is asking, and that an update didn't install. Settings → Updates
// says the same at length, and what this build is.
import { useEffect } from "react";
import { builtOn, download, laterAt, putOff, useInstall, useUpdate, useUpdateChecks } from "./updates";

/** "40%", or "12 MB" when the server didn't say how much */
export function share(got: number, total: number) {
  return total > 0 ? `${Math.min(100, Math.floor((got / total) * 100))}%` : `${(got / 1e6).toFixed(0)} MB`;
}

export default function UpdateLine() {
  useUpdateChecks();
  const s = useUpdate();
  const { install, after } = useInstall();
  const showing = s.kind === "offer" && laterAt() < s.offer.at;
  // the foot grows by the line, so nothing under it (an Allow, a composer, a frame's foot) is covered
  useEffect(() => { document.documentElement.classList.toggle("update-showing", showing); return () => document.documentElement.classList.remove("update-showing"); }, [showing]);
  if (s.kind !== "offer" || !showing) return null;
  const go = () => void download(s.offer, s.platform);
  const missed = s.platform === "android" && (install.kind === "failed" || (install.kind === "idle" && after.kind === "stuck"));
  return (
    <aside className="update-line" aria-label="A newer Parachute">
      {install.kind === "downloading" ? <span role="status">Downloading the newer Parachute… {share(install.got, install.total)}</span>
        : install.kind === "installing" ? <span role="status">Android is asking: tap Update</span>
        : missed ? <span role="status">The update didn't install <span className="quiet">(Settings says why)</span></span>
        : <span>A newer Parachute is ready <span className="quiet">(built {builtOn(s.offer.at)})</span></span>}
      {(install.kind === "idle" || install.kind === "failed") && <>
        <button type="button" className="quiet-button" onClick={go}>{missed ? "Try again" : "Download"}</button>
        <button type="button" className="quiet-button" onClick={() => putOff(s.offer.at)}>Later</button>
      </>}
    </aside>
  );
}
