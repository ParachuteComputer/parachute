import { useState, type FormEvent } from "react";
import { Bar } from "../ui/Bar";
import { parseAddress } from "../vault/address";
import { beginSignIn } from "../vault/oauth";

/** Add a vault by its address, then sign in on its hub. */
export default function AddVault({ first = false }: { first?: boolean }) {
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = parseAddress(input);
    if (!parsed.ok) { setError(parsed.error); return; }
    setBusy(true); setError(null);
    try {
      window.location.assign(await beginSignIn(parsed.address));
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error && /fetch|network|load/i.test(err.message) ? "The hub didn't answer at that address." : err instanceof Error ? err.message : "The hub didn't answer.");
    }
  }
  return (
    <main className="screen">
      <Bar title={first ? "Parachute" : "Add a vault"} back={first ? undefined : "/"} />
      <form className="card" onSubmit={submit}>
        {first && <p className="lead">Your notes live in vaults. Add one by its address, and sign in on its hub.</p>}
        <label className="field">
          <span>Vault address</span>
          <input type="url" inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false} placeholder="https://your-hub/vault/name"
            value={input} onChange={(e) => setInput(e.target.value)} aria-invalid={!!error} aria-describedby={error ? "add-error" : undefined} />
        </label>
        {error && <p className="error" id="add-error" role="alert">{error}</p>}
        <button className="primary" type="submit" disabled={busy}>{busy ? "Opening your hub…" : "Sign in"}</button>
      </form>
    </main>
  );
}
