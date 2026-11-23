// Settings → Updates (shell/updates.ts): which build this is, and a newer one when the build's feed has it. On Android
// Download installs it from here (with how far the download is, and Android's refusal in words), and after a try this
// says whether it took. Only in a build made with an update feed; the others say their build at the foot of Settings.
import { useEffect } from "react";
import { share } from "../shell/UpdateLine";
import { builtOn, checkUpdates, download, OWN, useInstall, useUpdate } from "../shell/updates";

const mb = (n: number) => `${(n / 1e6).toFixed(0)} MB`;

export default function UpdateSettings() {
  const s = useUpdate();
  const { install, after } = useInstall();
  useEffect(() => { void checkUpdates(true); }, []);
  if (s.kind === "none") return null;
  const busy = install.kind === "downloading" || install.kind === "installing";
  return (
    <section className="card" aria-labelledby="s-updates">
      <h2 id="s-updates">Updates</h2>
      <p>This build: {OWN.at ? <>built {builtOn(OWN.at)} <span className="quiet">({OWN.commit})</span></> : "not from a release"}.</p>
      {after.kind === "updated" && <p className="quiet">The update installed.</p>}
      {after.kind === "stuck" && install.kind === "idle" && <div role="status">
        <p>The update to the build of {builtOn(after.at)} didn't install: this is still the old one.</p>
        <p className="small">{after.why || "Tap Download to try again, and Update when Android asks. If Android says Parachute isn't allowed to install apps, allow it there and come back."}</p>
      </div>}
      {s.kind === "checking" && <p className="quiet">Looking for a newer one…</p>}
      {s.kind === "current" && <p className="quiet">It's the newest.</p>}
      {s.kind === "error" && <p className="small" role="status">{s.message}</p>}
      {s.kind === "offer" && <>
        <p>A newer one is ready: built {builtOn(s.offer.at)} <span className="quiet">({s.offer.commit})</span>.</p>
        {install.kind === "downloading" && <div role="status">
          <progress className="update-progress" value={install.total ? install.got : undefined} max={install.total || undefined} aria-label="Download" />
          <p className="small">Downloading… {install.total ? `${mb(install.got)} of ${mb(install.total)}` : share(install.got, 0)}</p>
        </div>}
        {install.kind === "installing" && <div role="status">
          <p>Android is asking whether to update Parachute: tap Update. The app closes while it installs; open it again after.</p>
          <p className="small quiet">{install.checked ? "The file matches the update list." : "The update list doesn't say what the file should be, so the app couldn't check it. Android still installs it only if it comes from the same maker."}</p>
        </div>}
        {!busy && <div className="row-buttons"><button type="button" className="primary" onClick={() => void download(s.offer, s.platform)}>Download</button></div>}
        {install.kind === "failed" && <p className="error" role="alert">{install.message}</p>}
        {!busy && <p className="small quiet">{s.platform === "android"
          ? "Parachute downloads it and Android installs it over this one. Android asks first (the first time, to let Parachute install apps), and installs it only if it comes from the same maker as this one."
          : "Your browser downloads it; open it and drag Parachute to Applications, over this one."}</p>}
      </>}
    </section>
  );
}
