import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { Bar } from "../ui/Bar";
import { createKey, errorText, importKey, type KeyInfo } from "./key";
import { Npub } from "./Npub";

/** Getting a key into the app, in the order most people need: pair it from a device that has it, make a new one, or
 *  (advanced) paste it. On first run this is the first screen; Settings comes here when the device has no key. */
export default function KeyStart({ first = false }: { first?: boolean }) {
  const nav = useNavigate();
  const [made, setMade] = useState<KeyInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState("");
  const say = (e: unknown) => setError(errorText(e, "That didn't work."));

  async function make() {
    setBusy(true); setError(null);
    try { setMade(await createKey()); } catch (e) { say(e); } finally { setBusy(false); }
  }
  async function keep(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try { await importKey(secret); setSecret(""); nav("/", { replace: true }); } catch (err) { say(err); } finally { setBusy(false); }
  }

  if (made) return (
    <main className="screen">
      <Bar title="Your new key" />
      <section className="card">
        <p className="lead">This is your new key's public half.</p>
        <Npub npub={made.npub} />
        <p>A hub signs you in with it once its owner links it to your account. Send them this.</p>
        <button type="button" className="primary" onClick={() => nav("/", { replace: true })}>Continue</button>
      </section>
    </main>
  );

  return (
    <main className="screen">
      <Bar title={first ? "Parachute" : "Your key"} back={first ? undefined : "/settings"} />
      <section className="card stack">
        <p className="lead">Parachute signs you in with your Nostr key.</p>
        <Link className="primary" to="/key/pair">Pair from a device that has your key</Link>
        <p className="quiet small">The Uni app or Buzz desktop sends it here, encrypted end to end.</p>
        <button type="button" className="secondary" onClick={() => void make()} disabled={busy}>Make a new key</button>
        <p className="quiet small">If you don't have one yet.</p>
        <details>
          <summary>Advanced: paste a secret key</summary>
          <form onSubmit={keep} className="stack">
            <p className="small">Only paste a secret key (nsec) you copied from somewhere you trust. Anyone who sees it can sign in as you, and other apps can read the clipboard. Pairing is safer.</p>
            <label className="field">
              <span>Secret key</span>
              <input type="password" autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false} placeholder="nsec1…" value={secret} onChange={(e) => setSecret(e.target.value)} />
            </label>
            <button type="submit" className="secondary" disabled={busy || !secret.trim()}>Keep this key</button>
          </form>
        </details>
        {error && <p className="error" role="alert">{error}</p>}
      </section>
      {first && <p className="screen-foot"><Link to="/add">Other ways to sign in</Link></p>}
    </main>
  );
}
