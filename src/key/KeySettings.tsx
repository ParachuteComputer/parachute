import { useState } from "react";
import { Link } from "react-router";
import { forgetKey, keysHere, shortNpub, useKey } from "./key";
import { Npub } from "./Npub";

/** Settings: this device's key. Vaults stay signed in when it goes; the next sign-in needs a key again or a password. */
export default function KeySettings() {
  const key = useKey();
  const [sure, setSure] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!keysHere()) return null;
  return (
    <section className="card" aria-labelledby="s-key">
      <h2 id="s-key">Your key</h2>
      {key ? <>
        <Npub npub={key.npub} />
        {sure ? <div className="stack">
          <p className="small">Remove {shortNpub(key.npub)} from this device? Vaults stay signed in. To sign in again with it, pair it back from another device.</p>
          <div className="row-buttons">
            <button type="button" className="quiet-button" onClick={() => { forgetKey().then(() => setSure(false), (e: unknown) => setError(String(e))); }}>Remove</button>
            <button type="button" className="quiet-button" onClick={() => setSure(false)}>Keep</button>
          </div>
        </div> : <button type="button" className="quiet-button" onClick={() => setSure(true)}>Remove from this device</button>}
      </> : key === null ? <p className="quiet">None on this device. <Link to="/key">Add your key</Link></p> : null}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
