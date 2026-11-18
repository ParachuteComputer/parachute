// Run the gateway from its environment (README.md):
//   PUSH_GATEWAY_URL      its public address, ending in / (https://push.example/)
//   PUSH_GATEWAY_RELAYS   the relays it watches, comma-separated (wss://relay.example)
//   PUSH_GATEWAY_KEY_FILE its own key (64 hex), a file only it reads
//   PUSH_GATEWAY_DATA     where registrations are kept (a directory)
//   PUSH_GATEWAY_BIND / PUSH_GATEWAY_PORT   default 127.0.0.1:8790 (put a TLS proxy in front)
//   PUSH_GATEWAY_PRIVATE_HOSTS             push servers on a private network you trust (a tailnet's ntfy), comma-separated,
//                                           each host[:port][/path/]: port 443 and ntfy's /up<topic> unless named
//   PUSH_GATEWAY_TRUST_PROXY=1              behind your own TLS proxy: count new registrations per client address by the
//                                           last hop of X-Forwarded-For (without it, by the socket's address)
//   PUSH_GATEWAY_ALLOW_LOOPBACK=1           tests only: http endpoints on this machine
import { readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { getPublicKey } from "nostr-tools/pure";
import { createGateway } from "./server.ts";
import { trustedHosts } from "./urls.ts";

const env = (k: string, d?: string) => {
  const v = process.env[k] ?? d;
  if (v === undefined) { console.error(`${k} is required (README.md)`); process.exit(2); }
  return v;
};
const keyHex = readFileSync(env("PUSH_GATEWAY_KEY_FILE"), "utf8").trim();
if (!/^[0-9a-f]{64}$/.test(keyHex)) { console.error("PUSH_GATEWAY_KEY_FILE holds 64 hex characters"); process.exit(2); }
const secret = Uint8Array.from(Buffer.from(keyHex, "hex"));
const privateHosts = (process.env.PUSH_GATEWAY_PRIVATE_HOSTS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
try { trustedHosts(privateHosts); } catch (e) { console.error((e as Error).message); process.exit(2); }
const data = env("PUSH_GATEWAY_DATA");
mkdirSync(data, { recursive: true, mode: 0o700 });
const g = createGateway({
  url: env("PUSH_GATEWAY_URL"),
  relays: env("PUSH_GATEWAY_RELAYS").split(",").map((s) => s.trim()).filter(Boolean),
  secret,
  file: join(data, "registrations.json"),
  allowLoopback: process.env.PUSH_GATEWAY_ALLOW_LOOPBACK === "1",
  trustProxy: process.env.PUSH_GATEWAY_TRUST_PROXY === "1",
  privateHosts,
});
const port = Number(env("PUSH_GATEWAY_PORT", "8790")), bind = env("PUSH_GATEWAY_BIND", "127.0.0.1");
g.server.listen(port, bind, () => {
  console.log(`push gateway on ${bind}:${port} as ${getPublicKey(secret)}; let this key into the relay and add it to the rooms it should watch`);
  g.start();
});
for (const s of ["SIGINT", "SIGTERM"] as const) process.on(s, () => { g.close(); process.exit(0); });
