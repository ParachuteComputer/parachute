// The Parachute that serves this page (T-476, the browser build as a product). The web build may be served by a
// Parachute itself: Parachute Cloud at my.parachute.computer, its staging door, a door on someone's own Cloudflare, a
// hub's front page. Such a host answers /.well-known/parachute-account on the page's own origin, and says there which
// hub people sign in to (its `issuer`: Cloud's is cloud.parachute.computer while the page is on my.). The app then
// starts at that Parachute instead of asking for an address, and takes its word for where its vaults live: the page
// already runs the code that host sent, so trusting what it says of itself gives it nothing new. Nothing here applies
// in the app on a phone or a computer (the shell), or on a host that doesn't answer (the tests' own server, any plain
// file host): there the person names their Parachute, as before.
import { isLoopback } from "./address";

export type Hosted = {
  /** the hub people sign in to there: the origin its descriptor names as issuer */
  hub: string;
  /** it says it is Parachute Cloud (`door: "cloud"`): sign-in is by an emailed link, on its own pages */
  cloud: boolean;
};

const KEY = "parachute.hosted.v1";
const READ_MS = 4000;
let known: Hosted | null | undefined;
let reading: Promise<Hosted | null> | null = null;

const inShell = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** What a descriptor served on `origin` says of the page's host: null unless it names a hub by a plain https origin
 *  (http only on this machine). Pure. */
export function hostedFrom(d: unknown): Hosted | null {
  if (!d || typeof d !== "object" || Array.isArray(d)) return null;
  const raw = (d as { issuer?: unknown }).issuer;
  if (typeof raw !== "string" || raw.length > 300) return null;
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.username || u.password || !(u.protocol === "https:" || (u.protocol === "http:" && isLoopback(u.hostname)))) return null;
  return { hub: u.origin, cloud: (d as { door?: unknown }).door === "cloud" };
}

/** The Parachute serving this page, as last read (null: none, or not read yet). */
export function hostedNow(): Hosted | null {
  if (known !== undefined) return known;
  if (inShell() || typeof sessionStorage === "undefined") return null;
  try { const kept = hostedFrom(JSON.parse(sessionStorage.getItem(KEY) ?? "null")); if (kept) { known = { ...kept, cloud: sessionStorage.getItem(`${KEY}.cloud`) === "1" }; return known; } } catch { /* read below */ }
  return null;
}

/** Ask the page's own origin, once a tab: resolves to the Parachute serving it, or null. Never throws. */
export function readHosted(fetchImpl: typeof fetch = fetch.bind(globalThis)): Promise<Hosted | null> {
  if (known !== undefined) return Promise.resolve(known);
  if (inShell() || typeof location === "undefined" || !/^https?:$/.test(location.protocol)) { known = null; return Promise.resolve(null); }
  const kept = hostedNow();
  if (kept) return Promise.resolve(kept);
  reading ??= (async () => {
    let found: Hosted | null = null;
    try {
      // (never followed elsewhere: the answer is the serving origin's own, or none)
      const res = await fetchImpl(`${location.origin}/.well-known/parachute-account`, { headers: { Accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(READ_MS) });
      // a host in trouble for a moment hasn't said no
      if (res.status === 429 || res.status >= 500) throw new Error("no answer");
      // a plain file host answers its own page (text/html) to any address: only JSON is a descriptor
      if (res.ok && /json/i.test(res.headers.get("content-type") ?? "")) found = hostedFrom(await res.json());
    } catch {
      // no answer this time (the network, a slow moment): not kept as "no Parachute here", so the next ask asks again
      reading = null;
      return null;
    }
    known = found;
    try { if (found) { sessionStorage.setItem(KEY, JSON.stringify({ issuer: found.hub })); sessionStorage.setItem(`${KEY}.cloud`, found.cloud ? "1" : "0"); } } catch { /* a tab with no storage reads again */ }
    return found;
  })();
  return reading;
}

/** Is this page served by the Parachute whose hub is `hub`? Then what that hub says of itself (where its vaults and
 *  account live, on another host of its own) is taken, and its pages are its own (oauth.ts: the name "Parachute"). */
export const servedBy = (hub: string): boolean => hostedNow()?.hub === hub;

/** TEST ONLY: forget what was read. */
export function forgetHosted() { known = undefined; reading = null; try { sessionStorage.removeItem(KEY); sessionStorage.removeItem(`${KEY}.cloud`); } catch { /* none */ } }
