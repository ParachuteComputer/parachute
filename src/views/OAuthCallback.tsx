import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Bar } from "../ui/Bar";
import { dropPending, peekPending, PendingApprovalError } from "../vault/oauth";
import { finishStep, keptSoFar, type VaultPick } from "../vault/signInFlow";
import PickVaults from "./PickVaults";
import { afterSignIn } from "../shell/parachutes";

/** Where the hub sends the person back after signing in: on to the next step (the consent for all their vaults), or,
 *  with every vault kept, to the launcher. */
export default function OAuthCallback() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [approve, setApprove] = useState<string | null>(null);
  const [saying, setSaying] = useState("Finishing the sign-in…");
  const [kept, setKept] = useState(false);
  const [pick, setPick] = useState<VaultPick | null>(null);
  const once = useRef(false);
  useEffect(() => {
    if (once.current) return;
    once.current = true;
    const code = params.get("code"), state = params.get("state"), denied = params.get("error");
    // what this sign-in kept before this step: a stop partway keeps it, and says so
    const before = keptSoFar(peekPending(state));
    const stopped = async (why: string, after?: ReturnType<typeof keptSoFar>) => {
      // what the step kept, if it got that far; else what the steps before it kept
      const sofar = after ?? before;
      if (!sofar) { setError(/Nothing was added/.test(why) ? why : `${why} Nothing was added.`); return; }
      dropPending();
      await afterSignIn(sofar.parachute.hub, sofar.done).catch(() => undefined);
      setError(`${why} The ${sofar.done.length === 1 ? "vault" : `${sofar.done.length} vaults`} signed in to before that stay: ${sofar.done.map((v) => v.vault).join(", ")}.`);
      setKept(true);
    };
    if (denied) { void stopped(denied === "access_denied" ? "You said no on the hub." : `The hub stopped the sign-in (${denied.slice(0, 60)}).`); return; }
    if (!code || !state) { setError("This page needs a sign-in from a hub."); return; }
    finishStep(code, state).then(async (next) => {
      // the next step: the consent for all the vaults, or the next vault's own sign-in, which the hub answers at once
      if ("pick" in next) { setPick(next.pick); return; }
      if ("go" in next) { setSaying(next.progress ? `Signing in to your vaults: ${next.progress.done} of ${next.progress.of}…` : "Asking your hub for your vaults…"); window.location.assign(next.go); return; }
      setSaying(`Signed in to ${next.done.length === 1 ? "one vault" : `${next.done.length} vaults`}.`);
      await afterSignIn(next.parachute.hub, next.done).catch(() => undefined);
      nav("/", { replace: true });
    }, (e: unknown) => {
      if (e instanceof PendingApprovalError) setApprove(e.approveUrl);
      else void stopped(e instanceof Error ? e.message : "The sign-in didn't finish.", (e as { kept?: ReturnType<typeof keptSoFar> } | null)?.kept ?? undefined);
    });
  }, [params, nav]);
  return (
    <main className="screen">
      <Bar title="Signing in" back="/" />
      {pick ? <section className="card stack"><PickVaults pick={pick} onCancel={() => nav("/add", { replace: true })} onError={(e) => { setPick(null); setError(e instanceof Error ? e.message : "The hub didn't answer."); }} /></section> : <div className="card" role="status">
        {approve ? <>
          <p>Your hub hasn't approved Parachute yet. Approve it there, then sign in again.</p>
          <a className="primary" href={approve}>Approve on your hub</a>
        </> : error ? <>
          <p className="error" role="alert">{error}</p>
          {kept ? <Link to="/">Open your launcher</Link> : <Link to="/add">Try again</Link>}
        </> : <p>{saying}</p>}
      </div>}
    </main>
  );
}
