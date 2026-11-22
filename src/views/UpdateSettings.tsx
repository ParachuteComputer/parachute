// Settings → Updates (shell/updates.ts): which build this is, and a newer one when the build's feed has it. Only in a
// build made with an update feed; the others say their build at the foot of Settings.
import { useEffect, useState } from "react";
import { openLinkOut } from "../shell/device";
import { builtOn, checkUpdates, OWN, useUpdate } from "../shell/updates";

export default function UpdateSettings() {
  const s = useUpdate();
  const [error, setError] = useState("");
  useEffect(() => { void checkUpdates(true); }, []);
  if (s.kind === "none") return null;
  const download = (url: string) => { setError(""); void openLinkOut(url).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e))); };
  return (
    <section className="card" aria-labelledby="s-updates">
      <h2 id="s-updates">Updates</h2>
      <p>This build: {OWN.at ? <>built {builtOn(OWN.at)} <span className="quiet">({OWN.commit})</span></> : "not from a release"}.</p>
      {s.kind === "checking" && <p className="quiet">Looking for a newer one…</p>}
      {s.kind === "current" && <p className="quiet">It's the newest.</p>}
      {s.kind === "error" && <p className="small" role="status">{s.message}</p>}
      {s.kind === "offer" && <>
        <p>A newer one is ready: built {builtOn(s.offer.at)} <span className="quiet">({s.offer.commit})</span>.</p>
        <div className="row-buttons"><button type="button" className="primary" onClick={() => download(s.offer.url)}>Download</button></div>
        <p className="small quiet">{s.platform === "android"
          ? "Your browser downloads it; open it to install. Android asks once to let your browser install apps, and installs it only if it comes from the same maker as this one."
          : "Your browser downloads it; open it and drag Parachute to Applications, over this one."}</p>
      </>}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
