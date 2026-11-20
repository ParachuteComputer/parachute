// A shipped applet's place on Parachute Simplified's bar before it is in the home vault (docs/SIMPLE.md): what it is,
// and one tap to add it. Once it is there, the bar goes straight to the applet, and this screen sends anyone who lands
// here on. Capture and Journal.
import { useState } from "react";
import { Navigate, useNavigate } from "react-router";
import { Bar } from "../ui/Bar";
import { homeVault } from "../shell/frameSource";
import { useVaults } from "../vault/hooks";
import { addShipped, SHIPPED, shippedIn, type ShippedName } from "../applet/shipped";
import { useApplets } from "../applet/useApplets";
import { appletPath } from "../open/paths";
import { markTap } from "../open/mark";
import { pendingWriteAsk } from "../vault/writeAsk";

const WORDS: Record<ShippedName, { lead: (vault: string) => React.ReactNode; asks: string }> = {
  capture: { lead: (v) => <>Write a line or say it, and it lands in <b>{v}</b>, in Inbox/, as a note of its own.</>,
    asks: "Inbox/, the microphone through the app, and opening the notes you tap in it" },
  journal: { lead: (v) => <>A line a day, or many: written or said, kept by day in <b>{v}</b>, in Journal/.</>,
    asks: "Journal/, the microphone through the app, and opening the entries you tap in it" },
};

export default function ShippedEntry({ which }: { which: ShippedName }) {
  const home = homeVault(useVaults());
  // read the home's applets (again): it may be there already
  useApplets(home);
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const s = SHIPPED[which];
  const there = shippedIn(home, which);
  if (!home) return <main className="screen"><Bar title={s.name} back={true} /><p className="quiet">Sign in to a vault of yours first.</p></main>;
  if (there && !busy) return <Navigate to={appletPath(home.key, there)} replace />;
  const add = async () => {
    setBusy(true); setError("");
    try {
      const id = await addShipped(home, which);
      const to = appletPath(home.key, id);
      // the person's tap led here: the applet's card shows, and their Allow starts it
      markTap(to);
      nav(to, { replace: true });
    } catch (e) {
      setBusy(false);
      // the home is only read so far: the app's sheet asks to let Parachute change notes there, and says what to do;
      // no second, rawer line under the button
      if (pendingWriteAsk() === home.key) return;
      setError(e instanceof Error ? e.message : `${s.name} couldn't be added.`);
    }
  };
  return (
    <main className="screen capture-entry">
      <Bar title={s.name} back={true} />
      <section className="card stack">
        <p className="lead">{WORDS[which].lead(home.vault)}</p>
        <p className="small">{s.name} is an applet: a note in your vault ({s.path}) that this app runs. Adding it writes that note; then it asks once for what it may do: {WORDS[which].asks}.</p>
        <button type="button" className="primary" disabled={busy} onClick={() => void add()}>{busy ? "Adding…" : `Add ${s.name}`}</button>
        {error && <p className="error" role="alert">{error}</p>}
      </section>
    </main>
  );
}
