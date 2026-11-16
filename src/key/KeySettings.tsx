import { useState } from "react";
import { Link } from "react-router";
import { forgetKey, keysHere, readKeyAgain, shortNpub, useKey, useKeyProblem } from "./key";
import { Npub } from "./Npub";

/** Settings: this device's key. Vaults stay signed in when it goes; the next sign-in needs a key again or a password. */
export default function KeySettings() {
  const key = useKey();
  const problem = useKeyProblem();
  const [sure, setSure] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!keysHere()) return null;
  return (
    <section className="card" aria-labelledby="s-key">
      <h2 id="s-key">Your key</h2>
      {key ? <>
        <Npub npub={key.npub} />
        {sure ? <div className="stack">
          <p className="small">Remove {shortNpub(key.npub)} from this device? Vaults stay signed in. If no other device has this key, it is gone for good, and hubs that knew it will need a new key linked.</p>
          <div className="row-buttons">
            <button type="button" className="quiet-button" onClick={() => { forgetKey().then(() => setSure(false), (e: unknown) => setError(String(e))); }}>Remove</button>
            <button type="button" className="quiet-button" onClick={() => setSure(false)}>Keep</button>
          </div>
        </div> : <button type="button" className="quiet-button" onClick={() => setSure(true)}>Remove from this device</button>}
      </> : problem?.code === "unavailable" ? <div className="stack">
        <p className="error">{problem.message}</p>
        <div className="row-buttons"><button type="button" className="quiet-button" onClick={() => void readKeyAgain()}>Try again</button></div>
      </div> : problem ? <div className="stack">
        <p className="error">{problem.message}</p>
        {sure ? <>
          <p className="small">Remove what is kept? If no other device has this key, it is gone for good, and hubs that knew it will need a new key linked.</p>
          <div className="row-buttons">
            <button type="button" className="quiet-button" onClick={() => { forgetKey().then(() => { setSure(false); setError(null); }, (e: unknown) => setError(String(e))); }}>Remove</button>
            <button type="button" className="quiet-button" onClick={() => setSure(false)}>Keep</button>
          </div>
        </> : <div className="row-buttons"><button type="button" className="quiet-button" onClick={() => setSure(true)}>Remove it from this device</button></div>}
      </div> : key === null ? <p className="quiet">None on this device. <Link to="/key">Add your key</Link></p> : null}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
