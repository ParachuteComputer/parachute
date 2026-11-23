// What kind of failure a vault read is, for the words a screen says about it (T-476: Aaron's Mac said "Couldn't open this
// applet" over "Load failed", WebKit's words for a request that reached no one):
//   unreached  the request reached no Parachute (it is off, its address went away, the network is down)
//   refused    the Parachute answered and refused this device's sign-in (401/403)
//   other      anything else (its answer couldn't be read, the code is wrong): the screen's own words and the details
import { RefreshHttpError, VaultAuthError, VaultUnreachableError } from "@openparachute/surface-client";

export type Failure = "unreached" | "refused" | "other";

export function failureOf(e: unknown): Failure {
  // a fetch that threw (TypeError) is one that reached no one, in every engine ("Load failed", "Failed to fetch")
  if (e instanceof VaultUnreachableError || e instanceof TypeError) return "unreached";
  // (a sign-in the hub won't renew is refused too)
  if (e instanceof VaultAuthError || e instanceof RefreshHttpError) return "refused";
  return "other";
}
