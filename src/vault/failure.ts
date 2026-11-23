// Why a vault read failed, as the shell says it (one classifier for the applet screen, the list and the embeds). T-476:
// Aaron's Mac said "Couldn't open this applet" over "Load failed", WebKit's words for a request that reached no one.
//   refused  the hub refused this device's sign-in (a 401; a 403 is the vault's plain answer, not a refusal)
//   offline  the request reached no hub (it is off, its address went away, the network is down)
//   large    the answer was bigger than the app takes from someone else's vault
//   other    anything else (a 5xx, an answer that couldn't be read): the screen's own words and the details
import { VaultAuthError, VaultPermissionError, VaultServerError, VaultUnreachableError } from "@openparachute/surface-client";
import { lastRefreshFailure, signInState } from "./client";
import { TooLargeError } from "./limited";
import type { VaultRecord } from "./store";

export type Failure = "refused" | "offline" | "large" | "other";

export function failureOf(e: unknown): Failure {
  if (e instanceof VaultAuthError && !(e instanceof VaultPermissionError) && e.status === 401) return "refused";
  if (e instanceof TooLargeError || (e instanceof Error && e.cause instanceof TooLargeError)) return "large";
  // a hub that answered with a 5xx was reached (the client's VaultServerError is a kind of VaultUnreachableError)
  if (e instanceof VaultServerError) return "other";
  // a fetch that threw (TypeError) reached no one, in every engine ("Load failed", "Failed to fetch")
  if (e instanceof VaultUnreachableError || e instanceof TypeError) return "offline";
  return "other";
}

/** A failure that looks like the network may be a refusal the browser couldn't read (core 0.9 sends a refused token no
 *  CORS headers): the sign-in says which. "alive": the hub answered and gave a fresh token, so it was neither; the read
 *  may be tried again. */
export async function settled(rec: Pick<VaultRecord, "key">, f: Failure): Promise<Failure | "alive"> {
  if (f !== "offline") return f;
  const s = await signInState(rec.key);
  return s === "refused" ? "refused" : s === "alive" ? "alive" : "offline";
}

/** The same, from what the app already knows and asking nothing: a read that reached no hub counts as a refused sign-in
 *  when this vault's last refresh was refused. (Refreshing to find out retires the sign-in on core 0.9 and is the
 *  person's to ask for, with Try again: `settled`.) */
export function failureNow(rec: Pick<VaultRecord, "key">, e: unknown): Failure {
  const f = failureOf(e);
  return f === "offline" && lastRefreshFailure(rec.key) === "refused" ? "refused" : f;
}
