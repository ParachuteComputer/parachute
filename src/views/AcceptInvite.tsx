import { useState, type FormEvent } from "react";
import { Bar } from "../ui/Bar";
import { useKey } from "../key/key";
import { acceptWithKey, lookInvite, parseInviteLink } from "../vault/sharing";
import { startSignIn, signInWords } from "../vault/signInFlow";
import type { InviteView } from "../services/native";

const hostOf = (hub: string) => hub.replace(/^https?:\/\//, "");

/** Accept an invite to someone's vault (docs/design/SHARING.md): paste the link, read who and what, Accept. Your key
 *  signs the acceptance; then the usual sign-in to their Parachute, as someone else's, and the vault opens. */
export default function AcceptInvite() {
  const key = useKey();
  const [link, setLink] = useState("");
  const [invite, setInvite] = useState<(InviteView & { hub: string; code: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function read(e: FormEvent) {
    e.preventDefault();
    const at = parseInviteLink(link);
    if (!at) { setError("That isn't an invite link. It looks like https://their-hub.example/invite#…"); return; }
    setBusy(true); setError(null);
    try {
      const v = await lookInvite(at.hub, at.code);
      if (!v) setError("That invite isn't open: it may be used, taken back or past its date. Ask for a new one.");
      else setInvite({ ...v, ...at });
    } catch (x) { setError(x instanceof Error ? x.message : "The hub didn't answer."); } finally { setBusy(false); }
  }

  async function accept() {
    if (!invite) return;
    setBusy(true); setError(null);
    try {
      const done = await acceptWithKey(invite.hub, invite.code);
      if (!done) { setBusy(false); setError("Accepting is signed with your key: open Parachute on your phone or Mac and accept it there."); return; }
      // in: now the usual sign-in to their Parachute, as someone else's, with the key when this device has one
      const next = await startSignIn(invite.hub, "theirs", !!key);
      if ("pick" in next) { window.location.assign(`/add?hub=${encodeURIComponent(invite.hub)}`); return; }
      window.location.assign(next.go);
    } catch (x) {
      setBusy(false);
      const r = x as { code?: string; message?: string };
      setError(typeof r?.code === "string" && typeof r.message === "string" ? r.message : signInWords(x));
    }
  }

  return (
    <main className="screen">
      <Bar title="Accept an invite" back="/settings" />
      {!invite ? <form className="card stack" onSubmit={read}>
        <label className="field">
          <span>The invite link</span>
          <input type="url" inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false} placeholder="https://their-hub.example/invite#…"
            value={link} onChange={(e) => setLink(e.target.value)} aria-invalid={!!error} aria-describedby={error ? "accept-error" : undefined} />
        </label>
        {error && <p className="error" id="accept-error" role="alert">{error}</p>}
        <button className="primary" type="submit" disabled={busy || !link.trim()}>{busy ? "Reading it…" : "Read the invite"}</button>
      </form> : <section className="card stack" aria-label="The invite">
        <p className="lead">{invite.from ?? "Someone"} invites you to <strong>{invite.vault}</strong>, on {hostOf(invite.hub)}.</p>
        <p>You can read and change everything in it. Your changes show as {invite.name}'s{invite.from ? `, and ${invite.from} can end your access any time` : ""}.</p>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="primary" type="button" disabled={busy} onClick={() => void accept()}>{busy ? "Accepting…" : "Accept"}</button>
        <button className="secondary" type="button" disabled={busy} onClick={() => { setInvite(null); setError(null); }}>Not now</button>
      </section>}
    </main>
  );
}
