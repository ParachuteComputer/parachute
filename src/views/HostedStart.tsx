// The first screen where a Parachute serves this page (vault/hosted.ts): Parachute Cloud's own address, most often.
// There is nothing to type: the person signs in to the Parachute they are already on. Its console and welcome mail send
// them with `/?add=<their vault's address>` (and `redirect=/new` to start a note, `/import` for its tables): that goes straight to the one
// sign-in for that vault, or to the vault when this device holds it already.
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Bar } from "../ui/Bar";
import { CLOUD_NAME } from "../vault/parachute";
import type { Hosted } from "../vault/hosted";
import { signInWords as words, startAdded, startSignIn } from "../vault/signInFlow";
import { useVaults } from "../vault/hooks";

/** Was this page reached by Back or Forward? Then a sign-in its address asks for isn't started again by itself (Back
 *  from the hub's page mustn't bounce the person forward to it); a fresh tap on the link is a new load, and starts it. */
const cameBack = () => (performance.getEntriesByType?.("navigation")[0] as PerformanceNavigationTiming | undefined)?.type === "back_forward";

/** `/?add=…` on a page Parachute Cloud serves: mounted at the root, for a person signed in here already as for a new one. */
export function AddedVault({ hosted }: { hosted: Hosted }) {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const add = params.get("add");
  const redirect = params.get("redirect");
  const then = redirect === "/new" ? "new" as const : redirect === "/import" ? "tables" as const : null;
  const more = params.get("more") === "1";
  const once = useRef<string | null>(null);
  useEffect(() => {
    if (!add || once.current === add) return;
    once.current = add;
    // the address has done its work, or has none to do: it is left for the plain one, so the home shows as itself
    const plain = () => nav("/", { replace: true });
    if (add.length > 500 || cameBack()) { plain(); return; }
    let on = true;
    startAdded(hosted.hub, add, then, more).then((next) => {
      if (!on) return;
      if (!next) plain(); else if ("open" in next) nav(next.open, { replace: true }); else window.location.assign(next.go);
    }, plain);
    return () => { on = false; };
  }, [add, then, more, hosted.hub, nav]);
  return null;
}

export default function HostedStart({ hosted }: { hosted: Hosted }) {
  const vaults = useVaults();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const host = new URL(hosted.hub).host;
  const signIn = async () => {
    setBusy(true); setError(null);
    try {
      const next = await startSignIn(hosted.hub, "mine", false);
      if ("go" in next) window.location.assign(next.go);
      else setBusy(false);
    } catch (e) { setBusy(false); setError(words(e)); }
  };
  if (vaults.length) return null;
  return (
    <main className="screen">
      <Bar title="Parachute" />
      <section className="card stack">
        <p className="lead">{hosted.cloud ? `Your notes on ${CLOUD_NAME}, in your browser.` : `Your notes on ${host}, in your browser.`}</p>
        <p className="quiet">Sign in once. Parachute reads and writes your home vault, and asks before it reads any other.</p>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="primary" type="button" disabled={busy} onClick={() => void signIn()}>{busy ? "Opening sign-in…" : "Sign in"}</button>
        <p className="small"><Link to="/add">Sign in to another Parachute</Link></p>
      </section>
    </main>
  );
}
