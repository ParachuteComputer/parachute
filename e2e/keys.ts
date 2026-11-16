// The person's Nostr key, for the tests: a throwaway made per run, and the hub's key door signed with it as the app's
// native side signs it (src-tauri/src/door.rs): a kind-27235 event naming the hub's verify address, POST and the
// single-use challenge, with the hub's own sentence as its content. The web build has no native side, so the test
// signs here and hands the browser the hub's session, as the shell does.
import { createHash, randomBytes } from "node:crypto";
import { schnorr } from "@noble/curves/secp256k1.js";

export const newKey = () => randomBytes(32).toString("hex");
export const pubOf = (secret: string) => Buffer.from(schnorr.getPublicKey(Buffer.from(secret, "hex"))).toString("hex");

/** Sign in to a hub with the key: its session cookies (name, value), or why not. */
export async function keyDoor(origin: string, secret: string): Promise<{ name: string; value: string }[]> {
  const ch = await (await fetch(`${origin}/api/auth/nostr/challenge`)).json() as { challenge: string; event_template: { content: string } };
  const ev: Record<string, unknown> = { pubkey: pubOf(secret), created_at: Math.floor(Date.now() / 1000), kind: 27235,
    tags: [["u", `${origin}/api/auth/nostr/verify`], ["method", "POST"], ["challenge", ch.challenge]], content: ch.event_template.content };
  const id = createHash("sha256").update(JSON.stringify([0, ev.pubkey, ev.created_at, ev.kind, ev.tags, ev.content])).digest();
  ev.id = id.toString("hex");
  ev.sig = Buffer.from(schnorr.sign(id, Buffer.from(secret, "hex"))).toString("hex");
  const r = await fetch(`${origin}/api/auth/nostr/verify`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ event: ev }), redirect: "manual" });
  if (r.status !== 200) throw new Error(`the key door refused: ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.headers.getSetCookie().map((c) => c.split(";")[0]).map((c) => ({ name: c.slice(0, c.indexOf("=")), value: c.slice(c.indexOf("=") + 1) }));
}
