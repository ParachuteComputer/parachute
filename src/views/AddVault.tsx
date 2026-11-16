import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { Bar } from "../ui/Bar";
import { parseAddress } from "../vault/address";
import { beginSignIn, dropPending } from "../vault/oauth";
import { keySignIn, keysHere, useKey, type Refusal } from "../key/key";
import { Npub } from "../key/Npub";

const unreachable = (err: unknown) => err instanceof Error && /fetch|network|load/i.test(err.message) ? "The hub didn't answer at that address." : err instanceof Error ? err.message : "The hub didn't answer.";

/** Add a vault by its address, then sign in on its hub: with this device's key when it has one (the hub's key door,
 *  then its usual consent), or on the hub's own page (a password, or whatever else the hub offers). */
export default function AddVault({ first = false }: { first?: boolean }) {
  const key = useKey();
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [busy, setBusy] = useState(false);

  async function go(withKey: boolean) {
    const parsed = parseAddress(input);
    if (!parsed.ok) { setError(parsed.error); return; }
    setBusy(true); setError(null); setRefusal(null);
    let authorize: string;
    try {
      authorize = await beginSignIn(parsed.address);
    } catch (err) {
      setBusy(false); setError(unreachable(err)); return;
    }
    if (!withKey) { window.location.assign(authorize); return; }
    try {
      window.location.assign(await keySignIn(parsed.address.issuer, authorize));
    } catch (r) {
      dropPending();
      setBusy(false); setRefusal(r as Refusal);
    }
  }
  // in the app, wait to know whether there is a key: Enter before then mustn't take the password path
  const reading = keysHere() && key === undefined;
  const submit = (e: FormEvent) => { e.preventDefault(); if (!reading) void go(!!key); };

  return (
    <main className="screen">
      <Bar title={first ? "Parachute" : "Add a vault"} back={first ? undefined : "/"} />
      <form className="card stack" onSubmit={submit}>
        {first && <p className="lead">Your notes live in vaults. Add one by its address, and sign in on its hub.</p>}
        <label className="field">
          <span>Vault address</span>
          <input type="url" inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false} placeholder="https://your-hub/vault/name"
            value={input} onChange={(e) => setInput(e.target.value)} aria-invalid={!!error} aria-describedby={error ? "add-error" : undefined} />
        </label>
        {error && <p className="error" id="add-error" role="alert">{error}</p>}
        {refusal && <div className="error" role="alert">
          {refusal.code === "unknown_key" ? <>
            <p>This hub doesn't know your key yet. Ask its owner to link it to your account; this is your key's public half:</p>
            {key && <Npub npub={key.npub} />}
          </> : refusal.code === "no_door" ? <p>This hub doesn't take a key to sign in. Use another way below.</p>
            : <p>{refusal.message}</p>}
        </div>}
        {key ? <>
          <button className="primary" type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in with your key"}</button>
          <button className="secondary" type="button" disabled={busy} onClick={() => void go(false)}>Other ways to sign in</button>
        </> : <>
          <button className="primary" type="submit" disabled={busy || reading}>{busy ? "Opening your hub…" : "Sign in"}</button>
          {keysHere() && key === null && <p className="small"><Link to="/key">Sign in with your Nostr key instead</Link></p>}
        </>}
      </form>
    </main>
  );
}
