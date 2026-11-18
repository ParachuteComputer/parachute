// Capture's place on the simple app's bar before Capture is in the home vault (docs/SIMPLE.md): what it is, and one
// tap to add it. Once it is there, the bar goes straight to the applet, and this screen sends anyone who lands here on.
import { useState } from "react";
import { Navigate, useNavigate } from "react-router";
import { Bar } from "../ui/Bar";
import { homeVault } from "../shell/frameSource";
import { useVaults } from "../vault/hooks";
import { addCapture, captureIn } from "../applet/capture";
import { useApplets } from "../applet/useApplets";
import { appletPath } from "../open/paths";
import { markTap } from "../open/mark";

export default function CaptureEntry() {
  const home = homeVault(useVaults());
  // read the home's applets (again): Capture may be there already
  useApplets(home);
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const there = captureIn(home);
  if (!home) return <main className="screen"><Bar title="Capture" back={true} /><p className="quiet">Sign in to a vault of yours first.</p></main>;
  if (there && !busy) return <Navigate to={appletPath(home.key, there)} replace />;
  const add = async () => {
    setBusy(true); setError("");
    try {
      const id = await addCapture(home);
      const to = appletPath(home.key, id);
      // the person's tap led here: the applet's card shows, and their Allow starts it
      markTap(to);
      nav(to, { replace: true });
    } catch (e) { setError(e instanceof Error ? e.message : "Capture couldn't be added."); setBusy(false); }
  };
  return (
    <main className="screen capture-entry">
      <Bar title="Capture" back={true} />
      <section className="card stack">
        <p className="lead">Write a line or say it, and it lands in <b>{home.vault}</b>, in Inbox/, as a note of its own.</p>
        <p className="small">Capture is an applet: a note in your vault (Applets/Capture) that this app runs. Adding it writes that note; then it asks once for what it may do: Inbox/, the microphone through the app, and opening the notes you tap in it.</p>
        <button type="button" className="primary" disabled={busy} onClick={() => void add()}>{busy ? "Adding…" : "Add Capture"}</button>
        {error && <p className="error" role="alert">{error}</p>}
      </section>
    </main>
  );
}
