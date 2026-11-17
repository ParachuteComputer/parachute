import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Bar } from "../ui/Bar";
import { PendingApprovalError } from "../vault/oauth";
import { finishStep } from "../vault/signInFlow";
import { afterSignIn } from "../shell/parachutes";

/** Where the hub sends the person back after signing in: on to the next step (the consent for all their vaults), or,
 *  with every vault kept, to the launcher. */
export default function OAuthCallback() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [approve, setApprove] = useState<string | null>(null);
  const [saying, setSaying] = useState("Finishing the sign-in…");
  const once = useRef(false);
  useEffect(() => {
    if (once.current) return;
    once.current = true;
    const code = params.get("code"), state = params.get("state"), denied = params.get("error");
    if (denied) { setError(denied === "access_denied" ? "You said no on the hub. Nothing was added." : `The hub stopped the sign-in (${denied.slice(0, 60)}).`); return; }
    if (!code || !state) { setError("This page needs a sign-in from a hub."); return; }
    finishStep(code, state).then(async (next) => {
      // the next step: the consent for all the vaults, or the next vault's own sign-in, which the hub answers at once
      if ("go" in next) { setSaying(next.progress ? `Signing in to your vaults: ${next.progress.done} of ${next.progress.of}…` : "Asking your hub for your vaults…"); window.location.assign(next.go); return; }
      setSaying(`Signed in to ${next.done.length === 1 ? "one vault" : `${next.done.length} vaults`}.`);
      await afterSignIn(next.parachute.hub, next.done).catch(() => undefined);
      nav("/", { replace: true });
    }, (e: unknown) => {
      if (e instanceof PendingApprovalError) setApprove(e.approveUrl);
      else setError(e instanceof Error ? e.message : "The sign-in didn't finish.");
    });
  }, [params, nav]);
  return (
    <main className="screen">
      <Bar title="Signing in" back="/" />
      <div className="card" role="status">
        {approve ? <>
          <p>Your hub hasn't approved Parachute yet. Approve it there, then sign in again.</p>
          <a className="primary" href={approve}>Approve on your hub</a>
        </> : error ? <>
          <p className="error" role="alert">{error}</p>
          <Link to="/add">Try again</Link>
        </> : <p>{saying}</p>}
      </div>
    </main>
  );
}
