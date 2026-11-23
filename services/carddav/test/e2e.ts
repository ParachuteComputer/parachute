// End to end on this machine: a real Parachute hub (parachute-core in a throwaway home, test/hub.ts), the bridge in
// front of it with a token limited to the `person` type, and DAVx5's own requests (test/davx5.ts) in the order DAVx5
// makes them. Made-up people. Nothing else is touched; the hub and its home are removed at the end.
//   PARACHUTE_CORE=<path to parachute-core> (bun on PATH) npm run e2e
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { createBridge } from "../src/server.ts";
import { addDevice } from "../src/devices.ts";
import { vaultClient } from "../src/vault.ts";
import { CARDDAV, CS, DAV, child, children, parseXml, type El } from "../src/xml.ts";
import { startHub } from "./hub.ts";
import { DAVX5 } from "./davx5.ts";

const step = (s: string) => console.log(`· ${s}`);
const BODY = "## Memories and moments\n\nPRIVATE: she told me about the move to Lisbon before anyone else. ".repeat(40);
const VAULT_ONLY = { relation: "friend", status: "active", tags: ["boulder", "ceramics"], ways_of_working: ["voice notes, not long emails"], source: "pottery open house",
  favorite: true, how_we_met: "PRIVATE-how-we-met", met: "2019-05-04", talked: "2026-11-01", keep_in_touch: "monthly" };
// a 1×1 JPEG
const JPEG = Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==", "base64");

const hub = await startHub("home");
const dir = mkdtempSync(join(tmpdir(), "carddav-e2e-"));
let bridge: ReturnType<typeof createBridge> | undefined;
try {
  // ── the vault: three people, one with a long private body, vault-only fields and a photo; a note elsewhere ──
  const owner = vaultClient(`${hub.origin}/vault/home`, hub.mint("vault:home:write"));
  const seed = async (path: string, fields: Record<string, unknown>, body = "## Memories and moments\n\n") => owner.create({ path, body, fields, types: ["person"] });
  let maya = await seed("People/Maya Lin", { phones: ["mobile: +1 303-555-0142", "kiln: +1 303-555-0100"], email: "maya@example.test", emails: ["maya.studio@example.test"],
    address: "412 Pine St\nBoulder, CO 80302", birthday: "1991-12-02", links: ["https://mayastudio.example"], groups: ["Close friends", "Climbing"],
    summary: "Ceramicist and trail runner", ...VAULT_ONLY }, BODY);
  const photoPath = await owner.attach(maya.id, JPEG, "image/jpeg");
  maya = await owner.patch(maya.id, (await owner.get(maya.id))!.updatedAt, { photo: photoPath });
  const theo = await seed("People/Theo Park", { phones: ["+1 720-555-0123"], email: "theo@example.test", relation: "collaborator" });
  const priya = await seed("People/Priya Raman", { birthday: "--03-09", groups: ["Techne"], summary: "Runs the Thursday print night" });
  await seed("Notes/Lunch with Maya", { summary: "not a person in People/" });

  // ── the bridge, with a token that reaches only records of the `person` type (the hub can't narrow to a folder) ──
  const devices = join(dir, "devices");
  const password = addDevice(devices, "pixel");
  const logs: string[] = [];
  const token = hub.mint("vault:home:write", { scoped_tags: ["person"] });
  bridge = createBridge({ vault: vaultClient(`${hub.origin}/vault/home`, token), devices, log: (l) => logs.push(l) });
  await new Promise<void>((r) => bridge!.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(bridge.address() as AddressInfo).port}`;
  const auth = `Basic ${Buffer.from(`pixel:${password}`).toString("base64")}`;
  const dav = async (method: string, path: string, opts: { body?: string; depth?: string; headers?: Record<string, string>; auth?: string | null } = {}) => {
    const r = await fetch(base + path, { method, redirect: "manual", body: opts.body,
      headers: { ...(opts.auth === null ? {} : { authorization: opts.auth ?? auth }), ...(opts.depth ? { depth: opts.depth } : {}),
        ...(opts.body && !opts.headers?.["content-type"] ? { "content-type": "application/xml; charset=utf-8" } : {}), ...opts.headers } });
    return { status: r.status, headers: r.headers, text: await r.text() };
  };
  /** A multistatus as href → its found properties (by `ns name`) and the names answered 404. */
  const ms = (xml: string) => {
    const root = parseXml(xml);
    assert.equal(root.name, "multistatus");
    const out = new Map<string, { found: Map<string, El>; missing: Set<string>; status?: string }>();
    for (const r of children(root, DAV, "response")) {
      const found = new Map<string, El>(), missing = new Set<string>();
      for (const ps of children(r, DAV, "propstat")) {
        const ok = /200/.test(child(ps, DAV, "status")!.text);
        for (const p of child(ps, DAV, "prop")!.children) (ok ? found.set(`${p.ns} ${p.name}`, p) : missing.add(`${p.ns} ${p.name}`));
      }
      out.set(child(r, DAV, "href")!.text, { found, missing, status: child(r, DAV, "status")?.text });
    }
    return out;
  };
  const K = (ns: string, n: string) => `${ns} ${n}`;

  step("discovery: the typed address names the principal; /.well-known/carddav redirects; OPTIONS says addressbook");
  let r = await dav("PROPFIND", "/", { body: DAVX5.findPrincipal, depth: "0" });
  assert.equal(r.status, 207);
  assert.match(r.headers.get("content-type")!, /xml/);
  let m = ms(r.text);
  assert.equal(m.get("/")!.found.get(K(DAV, "current-user-principal"))!.children[0].text, "/dav/principal/");
  r = await dav("PROPFIND", "/.well-known/carddav", { body: DAVX5.wellKnown, depth: "0", auth: null });
  assert.equal(r.status, 301);
  assert.equal(r.headers.get("location"), "/dav/");
  r = await dav("PROPFIND", "/dav/", { body: DAVX5.wellKnown, depth: "0" });
  assert.equal(ms(r.text).get("/dav/")!.found.get(K(DAV, "current-user-principal"))!.children[0].text, "/dav/principal/");
  r = await dav("OPTIONS", "/dav/principal/");
  assert.match(r.headers.get("dav")!, /\baddressbook\b/);

  step("principal → home set → one address book, writable");
  m = ms((await dav("PROPFIND", "/dav/principal/", { body: DAVX5.principal, depth: "0" })).text);
  assert.equal(m.get("/dav/principal/")!.found.get(K(CARDDAV, "addressbook-home-set"))!.children[0].text, "/dav/addressbooks/");
  m = ms((await dav("PROPFIND", "/dav/addressbooks/", { body: DAVX5.homeSet, depth: "1" })).text);
  const book = m.get("/dav/addressbooks/people/")!;
  assert.ok(book.found.get(K(DAV, "resourcetype"))!.children.some((c) => c.ns === CARDDAV && c.name === "addressbook"));
  assert.equal(book.found.get(K(DAV, "displayname"))!.text, "People");
  assert.ok(book.found.get(K(DAV, "current-user-privilege-set"))!.children.some((p) => p.children.some((c) => c.name === "write")));
  assert.ok(book.missing.has(K("https://bitfire.at/webdav-push", "transports")));

  step("capabilities: getctag, multiget, no sync-collection, no sync-token");
  m = ms((await dav("PROPFIND", "/dav/addressbooks/people/", { body: DAVX5.capabilities, depth: "0" })).text);
  const caps = m.get("/dav/addressbooks/people/")!;
  const ctag1 = caps.found.get(K(CS, "getctag"))!.text;
  assert.ok(ctag1);
  const reports = caps.found.get(K(DAV, "supported-report-set"))!.children.flatMap((s) => child(s, DAV, "report")!.children.map((c) => c.name));
  assert.deepEqual(reports, ["addressbook-multiget"]);
  assert.ok(caps.missing.has(K(DAV, "sync-token")));
  assert.match(caps.found.get(K(CARDDAV, "supported-address-data"))!.children[0].attrs.version, /^3\.0$/);

  step("list (PROPFIND Depth 1): three cards with ETags, the note elsewhere not among them");
  const list = async () => {
    const l = ms((await dav("PROPFIND", "/dav/addressbooks/people/", { body: DAVX5.list, depth: "1" })).text);
    l.delete("/dav/addressbooks/people/");
    return new Map([...l].map(([h, v]) => [h, v.found.get(K(DAV, "getetag"))!.text]));
  };
  let cards = await list();
  assert.deepEqual([...cards.keys()].sort(), [maya.id, theo.id, priya.id].map((id) => `/dav/addressbooks/people/${id}.vcf`).sort());
  for (const e of cards.values()) assert.match(e, /^"[\w-]+"$/);
  const mayaHref = `/dav/addressbooks/people/${maya.id}.vcf`;
  const mayaEtag1 = cards.get(mayaHref)!;

  step("multiget: the cards, Maya's photo inline, nothing of her body or vault-only fields");
  m = ms((await dav("REPORT", "/dav/addressbooks/people/", { body: DAVX5.multiget([...cards.keys(), "/dav/addressbooks/people/nobody.vcf"]), depth: "0" })).text);
  const mayaCard = m.get(mayaHref)!.found.get(K(CARDDAV, "address-data"))!.text;
  assert.equal(m.get(mayaHref)!.found.get(K(DAV, "getetag"))!.text, mayaEtag1);
  assert.match(mayaCard, /^BEGIN:VCARD\r\nVERSION:3\.0\r\n/);
  assert.match(mayaCard, /\r\nFN:Maya Lin\r\n/);
  assert.match(mayaCard, /\r\nTEL;TYPE=CELL:\+1 303-555-0142\r\n/);
  assert.match(mayaCard, /\r\nitem1\.X-ABLabel:kiln\r\n/);
  assert.match(mayaCard, /\r\nPHOTO;ENCODING=b;TYPE=JPEG:\/9j\//);
  assert.ok(mayaCard.replace(/\r\n /g, "").includes(JPEG.toString("base64")));
  for (const secret of ["PRIVATE", "Lisbon", "Memories", "boulder", "ceramics", "voice notes", "pottery open house", "collaborator", "monthly", "2019-05-04"]) {
    for (const [, v] of m) assert.ok(!(v.found.get(K(CARDDAV, "address-data"))?.text ?? "").includes(secret), `${secret} leaked`);
  }
  assert.match(m.get(`/dav/addressbooks/people/${priya.id}.vcf`)!.found.get(K(CARDDAV, "address-data"))!.text, /\r\nBDAY;X-APPLE-OMIT-YEAR=1604:1604-03-09\r\n/);
  assert.match(m.get("/dav/addressbooks/people/nobody.vcf")!.status!, /404/);

  step("a body-only edit in the vault leaves Maya's ETag and the CTag as they were");
  maya = (await owner.get(maya.id))!;
  const bodyEdit = await fetch(`${hub.origin}/vault/home/api/records/${maya.id}`, { method: "PATCH", headers: { authorization: `Bearer ${hub.mint("vault:home:write")}`, "content-type": "application/json" },
    body: JSON.stringify({ if_updated_at: maya.updatedAt, body: `${BODY}\nPRIVATE: one more memory.\n`, fields: { talked: "2026-11-23" } }) });
  assert.equal(bodyEdit.status, 200);
  assert.equal((await list()).get(mayaHref), mayaEtag1);
  m = ms((await dav("PROPFIND", "/dav/addressbooks/people/", { body: DAVX5.syncState, depth: "0" })).text);
  assert.equal(m.get("/dav/addressbooks/people/")!.found.get(K(CS, "getctag"))!.text, ctag1);

  step("PUT an edit with If-Match, as DAVx5 sends it: a phone changed, the note emptied, a nickname added");
  const edited = mayaCard
    .replace("PRODID:-//Parachute//People CardDAV//EN", "PRODID:+//IDN bitfire.at//DAVx5/4.5.21-ose ez-vcard/0.12.2")
    .replace("TEL;TYPE=CELL:+1 303-555-0142", "TEL;TYPE=cell:+1 303-555-0143")
    .replace(/NOTE:[^\r]*\r\n/, "")
    .replace("END:VCARD", "NICKNAME:Mo\r\nREV:20261123T120000Z\r\nEND:VCARD");
  r = await dav("PUT", mayaHref, { body: edited, headers: { "if-match": mayaEtag1, "content-type": "text/vcard;charset=utf-8" } });
  assert.equal(r.status, 204, r.text);
  const after = (await owner.get(maya.id))!;
  assert.deepEqual(after.fields.phones, ["mobile: +1 303-555-0143", "kiln: +1 303-555-0100"]);
  assert.equal(after.fields.summary, undefined);
  assert.deepEqual(after.fields.vcard_extra, ["NICKNAME:Mo"]);
  // only card facts changed: the body and every other field as they were
  const afterBody = await fetch(`${hub.origin}/vault/home/api/records/${maya.id}`, { headers: { authorization: `Bearer ${hub.mint("vault:home:read")}` } }).then((x) => x.json()) as { body: string };
  assert.equal(afterBody.body, `${BODY}\nPRIVATE: one more memory.\n`);
  for (const [k, v] of Object.entries({ ...VAULT_ONLY, talked: "2026-11-23" })) assert.deepEqual(after.fields[k], v, k);
  for (const k of ["email", "emails", "address", "birthday", "links", "groups", "photo"]) assert.deepEqual(after.fields[k], maya.fields[k], k);
  // what was stored is what was sent: the ETag comes back, and it is the listing's
  const mayaEtag2 = r.headers.get("etag")!;
  assert.ok(mayaEtag2 && mayaEtag2 !== mayaEtag1);
  cards = await list();
  assert.equal(cards.get(mayaHref), mayaEtag2);

  step("a stale If-Match is refused: 412, and the vault is unchanged");
  r = await dav("PUT", mayaHref, { body: edited.replace("+1 303-555-0143", "+1 303-555-0199"), headers: { "if-match": mayaEtag1, "content-type": "text/vcard" } });
  assert.equal(r.status, 412);
  assert.deepEqual((await owner.get(maya.id))!.fields.phones, ["mobile: +1 303-555-0143", "kiln: +1 303-555-0100"]);

  step("the vault changed between the bridge's read and its write: the hub's 409 is the phone's 412");
  {
    const real = vaultClient(`${hub.origin}/vault/home`, token);
    // someone edits Maya in the vault just before the bridge writes (a real edit, so the hub's revision check refuses)
    const racing = { ...real, patch: async (id: string, at: string, f: Record<string, unknown>) => {
      const now = (await owner.get(id))!;
      await owner.patch(id, now.updatedAt, { talked: "2026-11-24" });
      return real.patch(id, at, f);
    } };
    const b2 = createBridge({ vault: racing, devices, log: () => {} });
    await new Promise<void>((res) => b2.listen(0, "127.0.0.1", res));
    const r2 = await fetch(`http://127.0.0.1:${(b2.address() as AddressInfo).port}${mayaHref}`, { method: "PUT", body: edited.replace("+1 303-555-0143", "+1 303-555-0177"),
      headers: { authorization: auth, "if-match": mayaEtag2, "content-type": "text/vcard" } });
    await new Promise<void>((res) => b2.close(() => res()));
    assert.equal(r2.status, 412);
    assert.deepEqual((await owner.get(maya.id))!.fields.phones, ["mobile: +1 303-555-0143", "kiln: +1 303-555-0100"]);
  }

  step("PUT a new card at <uuid>.vcf with If-None-Match: * → a new People/ note that stays at that address");
  const uuid = randomUUID();
  const newCard = ["BEGIN:VCARD", "VERSION:3.0", "PRODID:+//IDN bitfire.at//DAVx5/4.5.21-ose ez-vcard/0.12.2", `UID:${uuid}`, "FN:Jonas Weber", "N:Weber;Jonas;;;",
    "ORG:Weber Bikes", "TEL;TYPE=cell:+49 30 901820", "EMAIL;TYPE=home:jonas@example.test", "CATEGORIES:Climbing", `PHOTO;ENCODING=b;TYPE=JPEG:${JPEG.toString("base64")}`,
    "REV:20261123T120000Z", "END:VCARD", ""].join("\r\n");
  r = await dav("PUT", `/dav/addressbooks/people/${uuid}.vcf`, { body: newCard, headers: { "if-none-match": "*", "content-type": "text/vcard;charset=utf-8" } });
  assert.equal(r.status, 201, r.text);
  const people = await owner.list("People/");
  const jonas = people.find((p) => p.path === "People/Jonas Weber")!;
  assert.ok(jonas, "People/Jonas Weber made");
  assert.equal(jonas.fields.uid, uuid);
  assert.deepEqual(jonas.fields.phones, ["mobile: +49 30 901820"]);
  assert.deepEqual(jonas.fields.groups, ["Climbing"]);
  assert.deepEqual(jonas.fields.vcard_extra, ["ORG:Weber Bikes"]);
  assert.match(String(jonas.fields.photo), /\.jpg$/);
  assert.equal(r.headers.get("etag"), (await list()).get(`/dav/addressbooks/people/${uuid}.vcf`));
  r = await dav("GET", `/dav/addressbooks/people/${uuid}.vcf`);
  assert.equal(r.status, 200);
  assert.match(r.text, new RegExp(`\\r\\nUID:${uuid}\\r\\n`));
  // the same name again: a second note, as the applet names one
  const uuid2 = randomUUID();
  r = await dav("PUT", `/dav/addressbooks/people/${uuid2}.vcf`, { body: newCard.replace(uuid, uuid2).replace(/PHOTO[^\r]*\r\n/, ""), headers: { "if-none-match": "*", "content-type": "text/vcard" } });
  assert.equal(r.status, 201);
  assert.ok((await owner.list("People/")).some((p) => p.path === "People/Jonas Weber 2" && p.fields.uid === uuid2));
  // a file name that isn't the UID is kept too
  r = await dav("PUT", "/dav/addressbooks/people/other-name.vcf", { body: newCard.replace(uuid, "a-uid-of-its-own").replace("Jonas Weber", "Lea Weber").replace(/PHOTO[^\r]*\r\n/, ""), headers: { "if-none-match": "*", "content-type": "text/vcard" } });
  assert.equal(r.status, 201);
  assert.match((await dav("GET", "/dav/addressbooks/people/other-name.vcf")).text, /\r\nUID:a-uid-of-its-own\r\n/);
  // creating over an existing card is refused
  assert.equal((await dav("PUT", `/dav/addressbooks/people/${uuid}.vcf`, { body: newCard, headers: { "if-none-match": "*", "content-type": "text/vcard" } })).status, 412);

  step("DELETE → on_phone: false: still in the vault, gone from the address book");
  const theoHref = `/dav/addressbooks/people/${theo.id}.vcf`;
  const ctagBefore = ms((await dav("PROPFIND", "/dav/addressbooks/people/", { body: DAVX5.syncState, depth: "0" })).text).get("/dav/addressbooks/people/")!.found.get(K(CS, "getctag"))!.text;
  assert.equal((await dav("DELETE", theoHref, { headers: { "if-match": '"stale"' } })).status, 412);
  r = await dav("DELETE", theoHref, { headers: { "if-match": cards.get(theoHref)! } });
  assert.equal(r.status, 204);
  const theoAfter = (await owner.get(theo.id))!;
  assert.equal(theoAfter.fields.on_phone, false);
  assert.equal(theoAfter.fields.email, "theo@example.test");
  assert.ok(!(await list()).has(theoHref));
  assert.equal((await dav("GET", theoHref)).status, 404);
  const ctagAfter = ms((await dav("PROPFIND", "/dav/addressbooks/people/", { body: DAVX5.syncState, depth: "0" })).text).get("/dav/addressbooks/people/")!.found.get(K(CS, "getctag"))!.text;
  assert.notEqual(ctagAfter, ctagBefore);

  step("a group card (DAVx5's group-vCard method) is refused, not stored");
  r = await dav("PUT", "/dav/addressbooks/people/group-1.vcf", { body: "BEGIN:VCARD\r\nVERSION:3.0\r\nUID:group-1\r\nFN:Climbing\r\nX-ADDRESSBOOKSERVER-KIND:group\r\nEND:VCARD\r\n", headers: { "if-none-match": "*", "content-type": "text/vcard" } });
  assert.equal(r.status, 403);
  assert.ok(!(await owner.list("People/")).some((p) => p.path === "People/Climbing"));

  step("a wrong password, or none: 401 with a Basic challenge");
  r = await dav("PROPFIND", "/dav/addressbooks/people/", { body: DAVX5.list, depth: "1", auth: `Basic ${Buffer.from(`pixel:${password}x`).toString("base64")}` });
  assert.equal(r.status, 401);
  assert.match(r.headers.get("www-authenticate")!, /^Basic realm=/);
  assert.equal((await dav("GET", mayaHref, { auth: null })).status, 401);
  assert.equal((await dav("OPTIONS", "/", { auth: null })).status, 401);

  // the bridge's log names requests, never a password, a token or a person's words
  const joined = logs.join("\n");
  for (const s of [password, token, "PRIVATE", "Maya"]) assert.ok(!joined.includes(s), "log leak");
  console.log("ok: the end-to-end run passed");
} finally {
  await new Promise<void>((r) => (bridge ? bridge.close(() => r()) : r()));
  await hub.stop();
  rmSync(dir, { recursive: true, force: true });
}
