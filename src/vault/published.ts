// A published record's link, and who can open it (T-476 stranger walk: "anyone with its link can read it", with no
// link; and a link sent from a laptop hub that nobody else could open).
import { CLOUD } from "./parachute";
import { vaultUrlOf, type VaultRecord } from "./store";

/** Where anyone with the link reads a vault's published records: the hub's page for one, `<vault>/view/<id>` (core
 *  serves it to a reader with no sign-in). A Parachute Cloud door has no such page yet (Cloud, and your own Parachute
 *  on your own Cloudflare, which runs Cloud's workers: T-476 walk, the link was a 404): null, and the app says so. */
export function viewBase(r: Pick<VaultRecord, "issuer" | "vault" | "url" | "door">): string | null {
  if (r.issuer === CLOUD || r.door === "cloud") return null;
  return `${vaultUrlOf(r).replace(/\/$/, "")}/view/`;
}

/** Who can open an address: only this device (a loopback address), devices on the person's own network (a private,
 *  link-local or tailnet address, or a .local name), or anyone. */
export type Reach = "this-device" | "network" | "anyone";
export function reachOf(address: string): Reach {
  let host: string;
  try { host = new URL(address).hostname.toLowerCase().replace(/^\[|\]$/g, ""); } catch { return "anyone"; }
  if (host === "localhost" || host.endsWith(".localhost") || host === "::1" || host === "0.0.0.0" || /^127\.\d+\.\d+\.\d+$/.test(host)) return "this-device";
  const v4 = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(host);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127)) return "network";
    return "anyone";
  }
  if (/^f[cd][0-9a-f]{2}:/.test(host) || /^fe[89ab][0-9a-f]:/.test(host)) return "network";
  if ([".local", ".lan", ".internal", ".home.arpa", ".ts.net"].some((s) => host.endsWith(s))) return "network";
  return "anyone";
}
