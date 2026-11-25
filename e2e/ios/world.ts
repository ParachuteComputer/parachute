// What the iPhone drive signs in to (scripts/ios-drive.sh): the e2e hubs (e2e/hub.ts: a person's Parachute on loopback,
// their throwaway key linked to its owner), the fake Buzz relay (e2e/services/servers.ts) holding one room the person
// is in, and the Rooms applet in the home vault, pointed at that relay, as it is installed for real. Writes the hub's
// address, the key and the room's name to the file named first, then keeps the servers up until it is stopped.
//   npx vite-node e2e/ios/world.ts <out.json>
import { writeFileSync } from "node:fs";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import globalSetup, { globalTeardown, hubState, record } from "../hub";
import { pubOf } from "../keys";
import { startRelay } from "../services/servers";
import { withImports } from "../../applets/record.ts";

const out = process.argv[2];
if (!out) throw new Error("usage: world.ts <out.json>");
await globalSetup();
const state = hubState();
const relay = await startRelay();
const host = generateSecretKey(), mira = generateSecretKey(), now = Math.floor(Date.now() / 1000);
const id = crypto.randomUUID(), room = "Garden";
relay.events.push(finalizeEvent({ kind: 0, created_at: now - 9000, content: JSON.stringify({ name: "Mira" }), tags: [] }, mira));
relay.events.push(finalizeEvent({ kind: 39002, created_at: now - 8000, content: "", tags: [["d", id], ["p", pubOf(state.key)], ["p", getPublicKey(mira)]] }, host));
relay.events.push(finalizeEvent({ kind: 39000, created_at: now - 8000, content: "", tags: [["d", id], ["name", room]] }, host));
relay.events.push(finalizeEvent({ kind: 9, created_at: now - 3000, content: "The beans are up along the fence.", tags: [["h", id]] }, mira));
for (const r of withImports("rooms", { relay: relay.url, uni: getPublicKey(generateSecretKey()) })) await record(state, "create", r);
writeFileSync(out, JSON.stringify({ hub: state.origin, key: state.key, room, relay: relay.url }), { mode: 0o600 });
console.log(`world: hub ${state.origin}, relay ${relay.url}, room ${room}`);
const stop = async () => { await relay.close().catch(() => {}); await globalTeardown(); process.exit(0); };
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
