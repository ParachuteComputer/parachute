// What an Android drive signs in to (scripts/android-drive.sh): the e2e hubs (e2e/hub.ts: a person's Parachute on
// loopback, their throwaway key linked to its owner). Writes the hub's address and the key (as nsec, as a person pastes
// it) to the file named first, then keeps the hubs up until it is stopped. A walk puts in what it needs itself.
//   npx vite-node e2e/android/world.ts <out.json>
import { writeFileSync } from "node:fs";
import { nip19 } from "nostr-tools";
import globalSetup, { globalTeardown, hubState } from "../hub";

const out = process.argv[2];
if (!out) throw new Error("usage: world.ts <out.json>");
await globalSetup();
const state = hubState();
writeFileSync(out, JSON.stringify({ hub: state.origin, nsec: nip19.nsecEncode(Uint8Array.from(Buffer.from(state.key, "hex"))) }), { mode: 0o600 });
console.log(`world: hub ${state.origin}`);
const stop = async () => { await globalTeardown(); process.exit(0); };
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
