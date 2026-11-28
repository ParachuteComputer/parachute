import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Bar } from "../ui/Bar";
import { dropPending, peekPending, PendingApprovalError } from "../vault/oauth";
import { finishStep, signInWords, type FirstVault as First, type VaultPick } from "../vault/signInFlow";
import FirstVault from "./FirstVault";
import PickVaults from "./PickVaults";
import { afterSignIn, listWaiting } from "../shell/parachutes";
import { homeVault } from "../shell/frameSource";
import { listVaults } from "../vault/store";
import { hostedNow } from "../vault/hosted";
import { markTap } from "../open/mark";

/** Where the hub sends the person back: after a sign-in's listing, on to the consent for one vault (or a pick first);
 *  after a vault's consent, to the launcher, or back where the ask came from (an applet's Allow, a change that needed
 *  write, the launcher's Open). */
export default function OAuthCallback() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [approve, setApprove] = useState<string | null>(null);
  const [saying, setSaying] = useState("Finishing the sign-in…");
  const [back, setBack] = useState<string | null>(null);
  const [pick, setPick] = useState<VaultPick | null>(null);
  const [first, setFirst] = useState<First | null>(null);
  const once = useRef(false);
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => {
    if (once.current) return;
    once.current = true;
    const code = params.get("code"), state = params.get("state"), denied = params.get("error");
    // where the ask came from: the way back after a no, too
    // (with no vault held there is nowhere inside to go back to: the first screen)
    const from = listVaults().length ? peekPending(state)?.back ?? null : null;
    setBack(from);
    if (denied) {
      dropPending();
      setError(denied === "access_denied" ? "You said no on the hub. Nothing changed." : `The hub stopped (${denied.slice(0, 60)}). Nothing changed.`);
      return;
    }
    if (!code || !state) { setError("This page needs a sign-in from a hub."); return; }
    finishStep(code, state, params.get("iss")).then(async (next) => {
      if ("pick" in next) { setPick(next.pick); return; }
      // left before the answer came: the first-vault step never shows, so its token is ended here
      if ("first" in next) { if (!live.current) void next.first.end(); else setFirst(next.first); return; }
      if ("go" in next) { setSaying("Asking your hub for your home vault…"); window.location.assign(next.go); return; }
      setSaying(next.signIn ? "Signed in." : next.why === "manage" ? `You can manage who reaches ${next.done.vault}.` : `Parachute now ${next.done.scope.includes(`vault:${next.done.vault}:write`) ? "reads and changes" : "reads"} ${next.done.vault}.`);
      if (next.signIn) await afterSignIn(next.parachute.hub, [next.done], next.parachute.door === "cloud", next.firstHome && next.solo).catch(() => undefined);
      // the home may be written now: the person's list of Parachutes, waiting for that, goes there
      else if (next.why !== "manage" && next.done.key === homeVault()?.key && next.done.scope.includes(`vault:${next.done.vault}:write`)) await listWaiting().catch(() => undefined);
      // an applet allowed on its card, and then by the hub: it opens as after the Allow tap (the tap was the person's,
      // and this return is the one their Allow started: its state was this app's, used once)
      if (next.why === "allow" && next.back) markTap(new URL(next.back, window.location.origin).pathname);
      nav(next.back ?? "/", { replace: true });
    }, (e: unknown) => {
      if (e instanceof PendingApprovalError) setApprove(e.approveUrl);
      else setError(e instanceof Error ? e.message : "The sign-in didn't finish.");
    });
  }, [params, nav]);
  return (
    <main className="screen">
      <Bar title={first ? "Your first vault" : "Signing in"} back="/" />
      {first ? <section className="card stack"><FirstVault first={first} onCancel={() => nav("/", { replace: true })} onError={(e) => { setFirst(null); setError(signInWords(e)); }} /></section> : pick ? <section className="card stack"><PickVaults pick={pick} onCancel={() => nav(`/add?hub=${encodeURIComponent(pick.hub)}`, { replace: true })} onError={(e) => { setPick(null); setError(signInWords(e)); }} /></section> : <div className="card" role="status">
        {approve ? <>
          <p>Your hub hasn't approved Parachute yet. Approve it there, then sign in again.</p>
          <a className="primary" href={approve}>Approve on your hub</a>
        </> : error ? <>
          <p className="error" role="alert">{error}</p>
          {back ? <Link to={back}>Go back</Link> : listVaults().length ? <Link to="/">Open your applets</Link> : <Link to={hostedNow()?.cloud ? "/" : "/add"}>Try again</Link>}
        </> : <p>{saying}</p>}
      </div>}
    </main>
  );
}
