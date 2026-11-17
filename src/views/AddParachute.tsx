import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router";
import { Bar } from "../ui/Bar";
import { CLOUD, CLOUD_NAME, parseHub } from "../vault/parachute";
import { startSignIn } from "../vault/signInFlow";
import { keysHere, useKey, type Refusal } from "../key/key";
import { Npub } from "../key/Npub";

const words = (err: unknown) => err instanceof Error && /fetch|network|load/i.test(err.message) ? "The hub didn't answer at that address." : err instanceof Error ? err.message : "The hub didn't answer.";
const isRefusal = (e: unknown): e is Refusal => !!e && typeof e === "object" && typeof (e as Refusal).code === "string" && typeof (e as Refusal).message === "string" && !(e instanceof Error);

/** Add a Parachute (docs/design/ONE-SIGN-IN.md): its address, or Parachute Cloud; whose it is; then one sign-in on its
 *  hub that brings every vault the person may reach there. With this device's key: the hub's key door and one consent.
 *  Without: the hub's own sign-in, a consent to see which vaults are theirs, and one for all of them. */
export default function AddParachute({ first = false }: { first?: boolean }) {
  const key = useKey();
  const [params] = useSearchParams();
  // a Parachute from the person's list (the launcher's or Settings' Sign in): filled in, still asked about
  const [input, setInput] = useState(() => params.get("hub") ?? "");
  const [error, setError] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [busy, setBusy] = useState(false);
  // whose it is (vault/whose.ts): asked every time, nothing chosen beforehand
  const [whose, setWhoseHere] = useState<"mine" | "theirs" | null>(null);

  async function go(hubInput: string, withKey: boolean) {
    const parsed = parseHub(hubInput);
    if (!parsed.ok) { setError(parsed.error); return; }
    if (!whose) { setError("Say whose Parachute it is first."); return; }
    setBusy(true); setError(null); setRefusal(null);
    try {
      window.location.assign(await startSignIn(parsed.hub, whose, withKey));
    } catch (e) {
      setBusy(false);
      if (isRefusal(e)) setRefusal(e); else setError(words(e));
    }
  }
  // in the app, wait to know whether there is a key: Enter before then mustn't take the other path
  const reading = keysHere() && key === undefined;
  const submit = (e: FormEvent) => { e.preventDefault(); if (!reading) void go(input, !!key); };

  return (
    <main className="screen">
      <Bar title={first ? "Parachute" : "Add a Parachute"} back={first ? undefined : "/"} />
      <form className="card stack" onSubmit={submit}>
        {first && <p className="lead">Your notes live in vaults on your Parachute. Sign in there once and every vault comes with it.</p>}
        <label className="field">
          <span>Your Parachute's address</span>
          <input type="url" inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false} placeholder="your-hub.example"
            value={input} onChange={(e) => setInput(e.target.value)} aria-invalid={!!error} aria-describedby={error ? "add-error" : undefined} />
        </label>
        <fieldset className="plain whose">
          <legend>Whose Parachute is this?</legend>
          <label className="line"><span><input type="radio" name="whose" checked={whose === "mine"} onChange={() => setWhoseHere("mine")} /> Mine</span></label>
          <label className="line"><span><input type="radio" name="whose" checked={whose === "theirs"} onChange={() => setWhoseHere("theirs")} /> Someone else's <span className="quiet">(an org's, a friend's)</span></span></label>
        </fieldset>
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
          <button className="secondary" type="button" disabled={busy} onClick={() => void go(input, false)}>Other ways to sign in</button>
        </> : <>
          <button className="primary" type="submit" disabled={busy || reading}>{busy ? "Opening your hub…" : reading ? "Reading your key…" : "Sign in"}</button>
          {keysHere() && key === null && <p className="small"><Link to="/key">Sign in with your Nostr key instead</Link></p>}
        </>}
        {/* Parachute Cloud signs in by an emailed link, on its own page */}
        <button className="quiet-button" type="button" disabled={busy} onClick={() => { setInput(CLOUD); void go(CLOUD, false); }}>Use {CLOUD_NAME} instead</button>
      </form>
    </main>
  );
}
