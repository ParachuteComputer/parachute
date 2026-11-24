// A rehearsal on this machine: a throwaway hub with six made-up people, and the bridge in front of it, until Ctrl-C.
// For the Android emulator, whose 10.0.2.2 is this machine's 127.0.0.1 (README.md "Rehearse with DAVx5").
//   PATH=$(dirname $(mise which bun)):$PATH PARACHUTE_CORE=<path to parachute-core> node scripts/seed-demo.ts
//   CARDDAV_LISTEN   default 127.0.0.1:5232
// Ctrl-C stops the bridge and the hub and removes the hub's home.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { createBridge } from "../src/server.ts";
import { addDevice } from "../src/devices.ts";
import { vaultClient } from "../src/vault.ts";
import { startHub } from "../test/hub.ts";

/** A plain square PNG of one colour, so a photo shows on the phone. */
function square(rgb: [number, number, number], size = 192): Uint8Array {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer) => { const t = Buffer.concat([Buffer.from(type), data]); const out = Buffer.alloc(12 + data.length); out.writeUInt32BE(data.length, 0); t.copy(out, 4); out.writeUInt32BE(crc(t), 8 + data.length); return out; };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: size }, () => rgb).flat())]);
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(Array(size).fill(row)))), chunk("IEND", Buffer.alloc(0))]));
}

const PEOPLE: { name: string; fields: Record<string, unknown>; body?: string; photo?: [number, number, number] }[] = [
  { name: "Maya Lin", photo: [196, 112, 84], body: "## Memories and moments\n\nHiked Green Mountain together in October. She is thinking about moving to Lisbon (private: never on the phone).\n",
    fields: { phones: ["mobile: +1 303-555-0142", "kiln: +1 303-555-0100"], email: "maya@example.test", emails: ["maya.studio@example.test"], address: "412 Pine St\nBoulder, CO 80302",
      birthday: "1991-12-02", links: ["https://mayastudio.example"], groups: ["Close friends", "Climbing"], summary: "Ceramicist and trail runner",
      relation: "friend", status: "active", tags: ["boulder", "ceramics"], favorite: true, ways_of_working: ["Prefers voice notes over long emails"] } },
  { name: "Theo Park", fields: { phones: ["+1 720-555-0123"], email: "theo@example.test", summary: "Builds the Thursday print night's website", relation: "collaborator" } },
  { name: "Priya Raman", photo: [72, 128, 176], fields: { birthday: "--03-09", groups: ["Techne"], phones: ["work: +1 303-555-0175"], summary: "Runs the Thursday print night" } },
  { name: "Jonas Weber", fields: { phones: ["mobile: +49 30 901820", "home: +49 30 901821"], email: "jonas@example.test", groups: ["Climbing"], links: ["https://weberbikes.example"] } },
  { name: "Ines Okafor", fields: { email: "ines@example.test", address: "7 Harbour Row\nLondon E14 5AB\nUnited Kingdom", birthday: "1988-07-21", relation: "family" } },
  { name: "Sam Hollis", fields: { email: "sam@example.test", on_phone: false, summary: "Left off the phone (on_phone: false)" } },
];

// Ctrl-C at any point (the hub takes a while to start) still stops everything and cleans up
const stopped = new Promise<void>((r) => { process.once("SIGINT", r); process.once("SIGTERM", r); });
const dir = mkdtempSync(join(tmpdir(), "carddav-demo-"));
const starting = startHub("home");
let hub: Awaited<typeof starting> | undefined;
try {
  hub = await Promise.race([starting, stopped.then(() => undefined)]);
  if (!hub) throw new Error("stopped before the hub was up");
  const owner = vaultClient(`${hub.origin}/vault/home`, hub.mint("vault:home:write"));
  for (const p of PEOPLE) {
    const rec = await owner.create({ path: `People/${p.name}`, body: p.body ?? "## Memories and moments\n\n", fields: p.fields, types: ["person"] });
    if (p.photo) {
      const path = await owner.attach(rec.id, square(p.photo), "image/png");
      await owner.patch(rec.id, (await owner.get(rec.id))!.updatedAt, { photo: path });
    }
  }
  // the bridge's own token: write, limited to records of the `person` type
  const tokenFile = join(dir, "vault-token");
  writeFileSync(tokenFile, hub.mint("vault:home:write", { scoped_tags: ["person"] }), { mode: 0o600 });
  const devices = join(dir, "devices");
  const password = addDevice(devices, "emulator");
  const listen = process.env.CARDDAV_LISTEN || "127.0.0.1:5232";
  const c = listen.lastIndexOf(":");
  const host = listen.slice(0, c), port = Number(listen.slice(c + 1));
  const bridge = createBridge({ vault: vaultClient(`${hub.origin}/vault/home`, readFileSync(tokenFile, "utf8").trim()), devices });
  await new Promise<void>((r) => bridge.listen(port, host, r));
  console.log(`
A throwaway hub at ${hub.origin} (vault "home") with ${PEOPLE.length} made-up people, and the bridge at http://${host}:${port}/.

In DAVx5 on the emulator: Add account → Login with URL and user name
  Base URL   http://10.0.2.2:${port}/
  User name  emulator
  Password   ${password}
Then choose "Groups are per-contact categories" as the contact group method.

The vault's REST API, to look at a record or change one:
  curl -s -H "authorization: Bearer $(cat ${tokenFile})" '${hub.origin}/vault/home/api/records?path_prefix=People/'
(that token file is removed with everything else at Ctrl-C)

Ctrl-C to stop the bridge and the hub.`);
  await stopped;
  await new Promise<void>((r) => bridge.close(() => r()));
} finally {
  await (hub ?? (await starting.catch(() => undefined)))?.stop();
  rmSync(dir, { recursive: true, force: true });
  console.log("Stopped; the hub's home is removed.");
}
