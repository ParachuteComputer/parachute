// The mapping between a People record and a card, both ways; the privacy allowlist; the merge rules. Made-up people.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CARD_FACTS, cardText, etagOf, factsOf, patchFor, readPhoneCard, servedFields, type Person } from "../src/card.ts";
import { vaultClient } from "../src/vault.ts";
import { readCards } from "../src/vcard.ts";

const F = "People/";

// What DAVx5 uploads in vCard 3.0 (davx5-ose synctools ContactWriter: PRODID, UID, FN, N, phonetic names, itemN labels,
// a yearless birthday in Apple's form, REV), with lines folded at 75 octets as ez-vcard does.
const ANDROID = [
  "BEGIN:VCARD",
  "VERSION:3.0",
  "PRODID:+//IDN bitfire.at//DAVx5/4.5.21-ose ez-vcard/0.12.2",
  "UID:6b1f0c2e-8a7d-4d55-9a8e-2f3c4d5e6f70",
  "FN:Rosa Delgado",
  "N:Delgado;Rosa;;;",
  "X-PHONETIC-FIRST-NAME:ROH-sa",
  "ORG:Juniper Print Co.",
  "TITLE:Letterpress printer",
  "NICKNAME:Ro",
  "TEL;TYPE=cell:+1 720-555-0117",
  "item1.TEL:+1 720-555-0123",
  "item1.X-ABLabel:Studio",
  "TEL;TYPE=work,voice:+1 720-555-0199",
  "EMAIL;TYPE=home:rosa.home@example.test",
  "EMAIL;TYPE=work;TYPE=pref:Rosa@Juniper.example",
  "ADR;TYPE=home:;;18 Larkspur Ln;Lafayette;CO;80026;USA",
  "BDAY;X-APPLE-OMIT-YEAR=1604:1604-03-09",
  "URL:https://juniper.example",
  "URL:juniper-print",
  "CATEGORIES:Printers,Close friends",
  "NOTE:Printed the invitations for the spring fair\\, and the menus\\; asks for",
  "  proofs on paper",
  "PHOTO;ENCODING=b;TYPE=JPEG:/9j/4AAQSkZJRgABAQ",
  " AAAQABAAD/2wBDAA==",
  "REV:20261123T120000Z",
  "END:VCARD",
].join("\r\n") + "\r\n";

test("an Android 3.0 card reads into People's fields: labels, TYPE params, yearless birthday, folded lines", () => {
  const c = readPhoneCard(ANDROID);
  assert.equal(c.uid, "6b1f0c2e-8a7d-4d55-9a8e-2f3c4d5e6f70");
  assert.equal(c.name, "Rosa Delgado");
  assert.deepEqual(c.facts, {
    phones: ["mobile: +1 720-555-0117", "studio: +1 720-555-0123", "work: +1 720-555-0199"],
    email: "rosa@juniper.example", // the PREF one is primary
    emails: ["rosa.home@example.test"],
    address: "18 Larkspur Ln\nLafayette, CO 80026\nUSA",
    birthday: "--03-09",
    links: ["https://juniper.example"],
    groups: ["Printers", "Close friends"],
    summary: "Printed the invitations for the spring fair, and the menus; asks for proofs on paper",
  });
  // what People has no field for is kept as it came; what the bridge writes itself (PRODID, REV, UID, FN, an N the name
  // gives) is not
  assert.deepEqual(c.extra, ["X-PHONETIC-FIRST-NAME:ROH-sa", "ORG:Juniper Print Co.", "TITLE:Letterpress printer", "NICKNAME:Ro", "URL:juniper-print"]);
  assert.equal(c.photo?.mime, "image/jpeg");
  assert.equal(Buffer.from(c.photo!.bytes).toString("base64"), "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA==");
  assert.equal(c.group, false);
});

test("a 4.0 card reads too: tel: and data: URIs, --MMDD, PREF=1; a group card is known as one", () => {
  const c = readPhoneCard(["BEGIN:VCARD", "VERSION:4.0", "UID:urn:uuid:aa11", "FN:Ines Okafor", "TEL;VALUE=uri;TYPE=home:tel:+44 20 7946 0958",
    "EMAIL:ines@example.test", "EMAIL;PREF=1:ines.work@example.test", "BDAY:--1202", "PHOTO:data:image/png;base64,iVBORw0KGgo=", "END:VCARD"].join("\n"));
  assert.equal(c.uid, "aa11");
  assert.deepEqual(c.facts.phones, ["home: +44 20 7946 0958"]);
  assert.equal(c.facts.email, "ines.work@example.test");
  assert.deepEqual(c.facts.emails, ["ines@example.test"]);
  assert.equal(c.facts.birthday, "--12-02");
  assert.equal(c.photo?.mime, "image/png");
  assert.equal(readPhoneCard("BEGIN:VCARD\nVERSION:3.0\nFN:Climbing\nX-ADDRESSBOOKSERVER-KIND:group\nEND:VCARD").group, true);
  assert.throws(() => readPhoneCard("not a card"));
  assert.throws(() => readPhoneCard("BEGIN:VCARD\nFN:A\nEND:VCARD\nBEGIN:VCARD\nFN:B\nEND:VCARD"));
});

const maya: Person = {
  id: "01M85B4DKWSBJQDC79V0CJ0EWT",
  path: "People/Maya Lin",
  updatedAt: "2026-11-23T10:00:00.000Z",
  fields: {
    phones: ["mobile: +1 303-555-0142", "work: +1 303-555-0198", "kiln: +1 303-555-0100", "+1 303-555-0111"],
    email: "maya@example.test",
    emails: ["maya.studio@example.test"],
    address: "412 Pine St\nBoulder, CO 80302",
    birthday: "1991-12-02",
    links: ["https://mayastudio.example"],
    groups: ["Close friends", "Climbing, bouldering"],
    summary: "Ceramicist and trail runner",
    vcard_extra: ["ORG:Pine Street Pottery", "item1.X-ABDATE:2019-06-01", "item1.X-ABLabel:_$!<Anniversary>!$_"],
  },
};

test("a record is served as a 3.0 card with only its card facts, folded, CRLF", () => {
  const text = cardText(maya, F);
  const lines = text.split("\r\n");
  assert.equal(lines[0], "BEGIN:VCARD");
  assert.equal(lines[1], "VERSION:3.0");
  for (const l of ["UID:01M85B4DKWSBJQDC79V0CJ0EWT", "FN:Maya Lin", "N:Lin;Maya;;;", "TEL;TYPE=CELL:+1 303-555-0142", "TEL;TYPE=WORK:+1 303-555-0198",
    "item2.TEL:+1 303-555-0100", "item2.X-ABLabel:kiln", "TEL:+1 303-555-0111", "EMAIL;TYPE=INTERNET;TYPE=PREF:maya@example.test",
    "EMAIL;TYPE=INTERNET:maya.studio@example.test", "ADR:;;412 Pine St\\nBoulder\\, CO 80302;;;;", "BDAY:1991-12-02",
    "URL:https://mayastudio.example", "CATEGORIES:Close friends,Climbing\\, bouldering", "NOTE:Ceramicist and trail runner",
    "ORG:Pine Street Pottery", "item1.X-ABDATE:2019-06-01"]) assert.ok(lines.includes(l), `${l} in\n${text}`);
  // the phone label's group skips item1, which a kept line uses
  assert.ok(text.endsWith("END:VCARD\r\n"));
  for (const l of lines) assert.ok(Buffer.byteLength(l) <= 75, `folded: ${l}`);
  const yearless = cardText({ ...maya, fields: { birthday: "--03-09" } }, F);
  assert.match(yearless, /\r\nBDAY;X-APPLE-OMIT-YEAR=1604:1604-03-09\r\n/);
  const long = cardText({ ...maya, fields: { summary: "ü".repeat(100) } }, F);
  assert.ok(long.split("\r\n").every((l) => Buffer.byteLength(l) <= 75));
  assert.equal(readPhoneCard(long).facts.summary, "ü".repeat(100));
});

test("a served card read back is the same record: nothing to change", () => {
  for (const p of [maya, { ...maya, fields: { ...maya.fields, birthday: "--03-09" } }, { ...maya, path: "People/Cher", fields: { phones: ["+1 720-555-0101"] } }]) {
    const back = readPhoneCard(cardText(p, F));
    assert.deepEqual(back.facts, factsOf(p.fields));
    assert.deepEqual(patchFor(p.fields, back), {});
  }
  // the Android card, stored and served, reads back the same
  const c = readPhoneCard(ANDROID);
  const stored: Person = { id: "x", path: "People/Rosa Delgado", updatedAt: "", fields: { phones: c.facts.phones, email: c.facts.email, emails: c.facts.emails, address: c.facts.address,
    birthday: c.facts.birthday, links: c.facts.links, groups: c.facts.groups, summary: c.facts.summary, vcard_extra: c.extra, uid: c.uid } };
  const served = cardText(stored, F);
  assert.match(served, /\r\nN:Delgado;Rosa;;;\r\n/);
  assert.equal(served.match(/\r\nN:/g)?.length, 1);
  assert.deepEqual(patchFor(stored.fields, readPhoneCard(served)), {});
});

// Every field docs/PEOPLE.md lists as the vault's own, and the body.
const VAULT_ONLY = { relation: "SECRET-relation", status: "SECRET-status", tags: ["SECRET-tag"], ways_of_working: ["SECRET-wow"], source: "SECRET-source",
  favorite: true, how_we_met: "SECRET-met-at", met: "SECRET-met", talked: "SECRET-talked", keep_in_touch: "SECRET-kit", on_phone: true, some_future_field: "SECRET-future" };

test("privacy: the body and every vault-only field never reach a served card", async () => {
  // a vault row as the hub's list answers it: with the body's first words in preview and displayTitle
  const row = { id: maya.id, path: maya.path, extension: "md", updatedAt: maya.updatedAt, body: "SECRET-body: she told me about the move",
    preview: "SECRET-body: she told me", displayTitle: "SECRET-body", fields: { ...maya.fields, ...VAULT_ONLY } };
  let calls = 0;
  const fake = (async () => new Response(JSON.stringify(calls++ ? [] : [row]), { status: 200 })) as unknown as typeof fetch;
  const [p] = await vaultClient("http://hub.test/vault/v", "t", fake).list(F);
  assert.equal(Object.hasOwn(p, "body"), false);
  const text = cardText(p, F);
  assert.doesNotMatch(text, /SECRET/);
  assert.doesNotMatch(etagOf(p, F), /SECRET/);
  // the allowlist: only card facts and the bridge's card fields pass
  assert.deepEqual(Object.keys(servedFields(p.fields)).sort(), [...CARD_FACTS.filter((k) => k !== "photo"), "vcard_extra"].sort());
  // a body or vault-only change leaves the ETag as it was; a card fact changes it
  const changed = { ...p, fields: { ...p.fields, relation: "SECRET-other", tags: ["x"] } };
  assert.equal(etagOf(changed, F), etagOf(p, F));
  assert.notEqual(etagOf({ ...p, fields: { ...p.fields, summary: "Potter" } }, F), etagOf(p, F));
});

test("merge: a phone edit replaces the card facts only; an emptied fact is removed; extra lines kept", () => {
  const fields = { ...maya.fields, ...VAULT_ONLY, photo: "2026-11-23/1-photo.jpg" };
  const edited = cardText({ ...maya, fields }, F)
    .replace("TEL;TYPE=CELL:+1 303-555-0142", "TEL;TYPE=CELL:+1 303-555-0143") // changed
    .replace(/NOTE:[^\r]*\r\n/, "") // emptied
    .replace(/CATEGORIES:[^\r]*\r\n/, "") // emptied
    .replace("END:VCARD", "NICKNAME:Mo\r\nEND:VCARD"); // new, People has no field for it
  const patch = patchFor(fields, readPhoneCard(edited));
  assert.deepEqual(patch, {
    phones: ["mobile: +1 303-555-0143", "work: +1 303-555-0198", "kiln: +1 303-555-0100", "+1 303-555-0111"],
    summary: null,
    groups: null,
    vcard_extra: ["ORG:Pine Street Pottery", "item1.X-ABDATE:2019-06-01", "item1.X-ABLabel:_$!<Anniversary>!$_", "NICKNAME:Mo"],
  });
  // nothing else is named: every vault-only field, the photo and the body stay as they are
  for (const k of [...Object.keys(VAULT_ONLY), "photo", "body", "uid"]) assert.equal(Object.hasOwn(patch, k), false, k);
});

test("merge: a fact held in another shape is left alone when the phone didn't change it", () => {
  const fields = { email: "Maya@Example.TEST", phones: "+1 303-555-0142" };
  const p: Person = { ...maya, fields };
  assert.deepEqual(patchFor(fields, readPhoneCard(cardText(p, F))), {});
});

test("vcard_extra can't break a card: no own lines, no line breaks", () => {
  const text = cardText({ ...maya, fields: { vcard_extra: ["END:VCARD", "UID:other", "VERSION:4.0", "X-A:1\r\nBEGIN:VCARD", "X-OK:yes"] } }, F);
  assert.equal(readCards(text).length, 1);
  assert.equal(text.match(/\r\nUID:/g)?.length, 1);
  assert.match(text, /\r\nX-OK:yes\r\n/);
  assert.doesNotMatch(text, /X-A:1/);
});

test("an N with more than the name gives (a middle name, a title) is kept while it spells the name", () => {
  const c = readPhoneCard("BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Dr. Ana María Ruiz\r\nN:Ruiz;Ana;María;Dr.;\r\nEND:VCARD\r\n");
  assert.deepEqual(c.extra, ["N:Ruiz;Ana;María;Dr.;"]);
  const p: Person = { id: "r", path: "People/Dr. Ana María Ruiz", updatedAt: "", fields: { vcard_extra: c.extra } };
  assert.match(cardText(p, F), /\r\nN:Ruiz;Ana;María;Dr\.;\r\n/);
  // renamed in the vault: the kept N no longer spells it, so one is made from the new name
  assert.match(cardText({ ...p, path: "People/Ana Ruiz" }, F), /\r\nN:Ruiz;Ana;;;\r\n/);
});

test("a phone label People can't hold is reduced to one it can, never left inside the number", () => {
  const c = readPhoneCard("BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Ada Byrne\r\nitem1.TEL:123 4567\r\nitem1.X-ABLabel:Dr. Office\r\nitem2.TEL:+1 303-555-0188\r\nitem2.X-ABLabel:★\r\nEND:VCARD\r\n");
  assert.deepEqual(c.facts.phones, ["dr office: 123 4567", "+1 303-555-0188"]);
  const served = cardText({ id: "a", path: "People/Ada Byrne", updatedAt: "", fields: { phones: c.facts.phones } }, F);
  assert.match(served, /\r\nitem1\.TEL:123 4567\r\nitem1\.X-ABLabel:dr office\r\n/);
  assert.match(served, /\r\nTEL:\+1 303-555-0188\r\n/);
});

test("merge: links the card couldn't show stay when the phone changes its links", () => {
  const fields = { links: ["https://maya.example", "ftp://files.maya.example"] };
  const p: Person = { ...maya, fields };
  const edited = cardText(p, F).replace("URL:https://maya.example", "URL:https://maya.example/new");
  assert.deepEqual(patchFor(fields, readPhoneCard(edited)), { links: ["https://maya.example/new", "ftp://files.maya.example"] });
  const emptied = cardText(p, F).replace(/URL:[^\r]*\r\n/, "");
  assert.deepEqual(patchFor(fields, readPhoneCard(emptied)), { links: ["ftp://files.maya.example"] });
});

test("a name of dots names no note", () => {
  assert.equal(readPhoneCard("BEGIN:VCARD\r\nVERSION:3.0\r\nFN:..\r\nEND:VCARD\r\n").name, "");
  assert.equal(readPhoneCard("BEGIN:VCARD\r\nVERSION:3.0\r\nFN:.\r\nEMAIL:dot@example.test\r\nEND:VCARD\r\n").name, "dot@example.test");
});

test("an address the phone sends back with its lines as a street list keeps its lines (seen from DAVx5 on Android 15)", () => {
  // People's "412 Pine St\nBoulder, CO 80302" comes back from Android as a list in the street part: an unescaped comma
  // between lines, the escaped one inside a line
  const card = ["BEGIN:VCARD", "VERSION:3.0", "UID:x1", "FN:Maya Lin", "N:Lin;Maya;;;", "ADR;TYPE=home:;;412 Pine St,Boulder\\, CO 80302;;;;", "END:VCARD", ""].join("\r\n");
  assert.equal(readPhoneCard(card).facts.address, "412 Pine St\nBoulder, CO 80302");
  // and a street with an escaped newline reads the same
  const escaped = card.replace("412 Pine St,Boulder", "412 Pine St\\nBoulder");
  assert.equal(readPhoneCard(escaped).facts.address, "412 Pine St\nBoulder, CO 80302");
});

test("only a picture goes to the phone as the photo: a photo field naming another file (a PDF) is left off the card", () => {
  const p = (photo: string): Person => ({ id: "r1", path: "People/Ana Ruiz", updatedAt: "2026-11-23T00:00:00Z", fields: { photo } });
  assert.ok(cardText(p("2026-11-23/x.pdf"), "People/", { type: "PDF", base64: "JVBERi0=" }).includes("PHOTO") === false);
  assert.equal(etagOf(p("2026-11-23/x.pdf"), "People/"), etagOf({ ...p(""), fields: {} }, "People/"));
  assert.ok(cardText(p("2026-11-23/x.png"), "People/", { type: "PNG", base64: "iVBORw0=" }).includes("PHOTO;ENCODING=b;TYPE=PNG"));
});
