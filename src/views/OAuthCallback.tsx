import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Bar } from "../ui/Bar";
import { completeSignIn, PendingApprovalError } from "../vault/oauth";
import { saveVault } from "../vault/store";
import { setWhose, whoseOf } from "../vault/whose";

/** Where the hub sends the person back after signing in. */
export default function OAuthCallback() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [approve, setApprove] = useState<string | null>(null);
  const once = useRef(false);
  useEffect(() => {
    if (once.current) return;
    once.current = true;
    const code = params.get("code"), state = params.get("state"), denied = params.get("error");
    if (denied) { setError(denied === "access_denied" ? "You said no on the hub. Nothing was added." : `The hub stopped the sign-in (${denied.slice(0, 60)}).`); return; }
    if (!code || !state) { setError("This page needs a sign-in from a hub."); return; }
    completeSignIn(code, state).then(({ pending, token, vault }) => {
      const rec = saveVault({ issuer: pending.issuer, vault, tokenEndpoint: pending.tokenEndpoint, revocationEndpoint: pending.revocationEndpoint, clientId: pending.clientId, accessToken: token.access_token,
        refreshToken: token.refresh_token, expiresAt: token.expires_in ? Date.now() + token.expires_in * 1000 : undefined, scope: token.scope ?? "", addedAt: new Date().toISOString() });
      // what the person said on Add a vault; signing in again to a trusted vault doesn't drop its trust
      if (pending.whose && !(pending.whose === "theirs" && whoseOf(rec) === "trusted")) setWhose(rec, pending.whose);
      nav(`/v/${encodeURIComponent(rec.key)}`, { replace: true });
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
        </> : <p>Finishing the sign-in…</p>}
      </div>
    </main>
  );
}
