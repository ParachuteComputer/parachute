// Unit tests for People applet pure logic (applets/people.tsx): vCard v3 & v4 import (folded lines, quoted-printable,
// photos, multiple numbers, Apple labels, yearless birthdays), deduplicating match priority (email → phone → name),
// additive merges preserving existing fields, vCard export round-trip, upcoming birthdays, reconnect list, and filters.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { transform } from "sucrase";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const src = readFileSync(`${process.cwd()}/applets/people.tsx`, "utf8");
const start = src.indexOf("// ── pure helpers (tested in src/applet/peopleApplet.test.ts) ──");
const end = src.indexOf("// ── end pure helpers ──");
if (start < 0 || end < 0 || end <= start) throw new Error("could not locate pure helpers block in applets/people.tsx");
const block = src.slice(start, end);
const code = transform(block, { transforms: ["typescript"] }).code;

type VCardPhoto = { mimeType: string; bytes: Uint8Array };
type VCardContact = {
  name: string;
  phones: string[];
  emails: string[];
  address: string;
  birthday: string;
  links: string[];
  groups: string[];
  tags: string[];
  summary: string;
  note: string;
  photo: VCardPhoto | null;
};
type PersonRecord = {
  id: string;
  path: string;
  createdAt?: string | null;
  updatedAt: string | null;
  fields?: Record<string, unknown>;
  body?: string;
  links?: {
    sourceId: string;
    targetId: string;
    relationship: string | null;
    createdAt?: string | null;
    sourceNote?: { id: string; path: string | null; updatedAt?: string | null; createdAt?: string | null };
    targetNote?: { id: string; path: string | null; updatedAt?: string | null; createdAt?: string | null };
  }[];
};

const api = new Function(
  `${code}; return { parseVCard, exportVCard, matchVCardContact, mergeVCardIntoPerson, fieldsForNewVCard, upcomingBirthdays, reconnectList, filterPeople, normalizePhoneKey, initialsOf, letterOf, readPersonFields, peopleIndex, withBodiesForCards, readFolder };`,
)() as {
  parseVCard: (text: string) => VCardContact[];
  exportVCard: (people: readonly PersonRecord[], photos?: Map<string, VCardPhoto>) => string;
  matchVCardContact: (card: VCardContact, people: readonly PersonRecord[]) => { person: PersonRecord; by: "email" | "phone" | "name" } | null;
  mergeVCardIntoPerson: (existing: PersonRecord, card: VCardContact) => { changed: boolean; fieldsPatch: Record<string, unknown>; nextBody?: string; attachPhoto: VCardPhoto | null };
  fieldsForNewVCard: (card: VCardContact) => Record<string, unknown>;
  upcomingBirthdays: (people: readonly PersonRecord[], todayYmd: string, windowDays?: number) => { name: string; nextDate: string; daysUntil: number; turning: number | null }[];
  reconnectList: (people: readonly PersonRecord[], nowMs: number, opts?: { staleDays?: number; includePast?: boolean }) => {
    stale: { name: string; daysSince: number | null; lastTitle: string | null }[];
    unlinked: { name: string }[];
  };
  filterPeople: (people: readonly PersonRecord[], opts: { query: string; relation: string; group: string; tag: string }) => PersonRecord[];
  normalizePhoneKey: (raw: string) => string;
  initialsOf: (name: string) => string;
  letterOf: (name: string) => string;
  readPersonFields: (fields?: Record<string, unknown>) => Record<string, unknown>;
  peopleIndex: (people: readonly PersonRecord[]) => {
    match: (card: VCardContact) => { person: PersonRecord; by: "email" | "phone" | "name" } | null;
    put: (person: PersonRecord) => void;
  };
  withBodiesForCards: (
    cards: readonly VCardContact[],
    people: readonly PersonRecord[],
    readOne: (id: string) => Promise<PersonRecord | null>,
    readAll: () => Promise<PersonRecord[]>,
  ) => Promise<PersonRecord[]>;
  readFolder: (query: (q: Record<string, unknown>) => Promise<PersonRecord[]>, base: Record<string, unknown>) => Promise<{ rows: PersonRecord[]; capped: boolean }>;
};

// Tiny valid 1x1 PNG bytes encoded as base64 (made-up fixture photo)
const TINY_PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const TINY_JPG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const TINY_JPG_B64 = Buffer.from(TINY_JPG_BYTES).toString("base64");

describe("People vCard parser (v3 and v4, photos, several numbers)", () => {
  it("parses a vCard 3.0 export with folded lines, multiple numbers, Apple labels, quoted-printable and base64 photo", () => {
    const vcf = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      "N:Lin;Maya;;;",
      "FN:Maya Lin",
      "ORG:Pine Street Studio;Ceramics",
      "TITLE:Lead Ceramicist",
      "TEL;TYPE=CELL,VOICE:+1 (303) 555-0142",
      "TEL;TYPE=WORK,VOICE:+1 303-555-0198",
      "item1.TEL:+1 303-555-0177",
      "item1.X-ABLabel:_$!<Studio>!$_",
      "EMAIL;TYPE=INTERNET,PREF:Maya@Example.Test",
      "EMAIL;TYPE=WORK:maya.studio@example.test",
      "ADR;TYPE=HOME:;;412 Pine St;Boulder;CO;80302;USA",
      "BDAY:19911202",
      "URL:https://mayastudio.example",
      "CATEGORIES:Close friends,Climbing",
      "NOTE;ENCODING=QUOTED-PRINTABLE;CHARSET=UTF-8:Met at the pottery=20",
      " open house=0ALikes oolong tea\\, especially roasted.",
      `PHOTO;ENCODING=b;TYPE=PNG:${TINY_PNG_B64.slice(0, 40)}`,
      ` ${TINY_PNG_B64.slice(40)}`,
      "END:VCARD",
    ].join("\r\n");

    const parsed = api.parseVCard(vcf);
    expect(parsed).toHaveLength(1);
    const c = parsed[0];
    expect(c.name).toBe("Maya Lin");
    expect(c.summary).toBe("Lead Ceramicist, Pine Street Studio · Ceramics");
    expect(c.phones).toEqual([
      "mobile: +1 (303) 555-0142",
      "work: +1 303-555-0198",
      "studio: +1 303-555-0177",
    ]);
    expect(c.emails).toEqual(["maya@example.test", "maya.studio@example.test"]);
    expect(c.address).toBe("412 Pine St\nBoulder, CO 80302\nUSA");
    expect(c.birthday).toBe("1991-12-02");
    expect(c.links).toEqual(["https://mayastudio.example"]);
    expect(c.groups).toEqual(["Close friends", "Climbing"]);
    expect(c.note).toBe("Met at the pottery open house\nLikes oolong tea, especially roasted.");
    expect(c.photo).not.toBeNull();
    expect(c.photo!.mimeType).toBe("image/png");
    expect(c.photo!.bytes.length).toBeGreaterThan(20);
  });

  it("parses a vCard 4.0 export with data URI photo, tel: URI, yearless birthday, and multiple cards", () => {
    const vcf = [
      "BEGIN:VCARD",
      "VERSION:4.0",
      "FN:Devon Park",
      "TEL;VALUE=uri;TYPE=\"work,voice\":tel:+1-415-555-0123",
      "TEL;TYPE=home:+1-415-555-0199",
      "TEL;TYPE=cell:415-555-0123", // duplicate of first number (10 vs 11 digits) -> deduplicated
      "EMAIL:devon@example.test",
      "BDAY:--0314",
      `PHOTO:data:image/jpeg;base64,${TINY_JPG_B64}`,
      "CATEGORIES:Collaborators,Sound",
      "END:VCARD",
      "BEGIN:VCARD",
      "VERSION:4.0",
      "N:Okafor;Nadia;;;",
      "BDAY;X-APPLE-OMIT-YEAR=1604:1604-07-19",
      "TEL:+44 20 7946 0958",
      "PHOTO:https://remote.example/avatar.jpg", // remote URLs ignored safely (no network)
      "END:VCARD",
    ].join("\n");

    const parsed = api.parseVCard(vcf);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].name).toBe("Devon Park");
    expect(parsed[0].phones).toEqual(["work: +1-415-555-0123", "home: +1-415-555-0199"]);
    expect(parsed[0].birthday).toBe("--03-14");
    expect(parsed[0].photo?.mimeType).toBe("image/jpeg");
    expect(Array.from(parsed[0].photo!.bytes)).toEqual(Array.from(TINY_JPG_BYTES));

    expect(parsed[1].name).toBe("Nadia Okafor");
    expect(parsed[1].birthday).toBe("--07-19");
    expect(parsed[1].phones).toEqual(["+44 20 7946 0958"]);
    expect(parsed[1].photo).toBeNull();
  });
});

describe("People vCard matching & additive merge (email → phone → name, never duplicating)", () => {
  const existing: PersonRecord[] = [
    {
      id: "p1",
      path: "People/Maya Lin",
      updatedAt: "2026-11-20T10:00:00Z",
      fields: {
        relation: "friend",
        status: "active",
        summary: "Ceramicist in Boulder",
        email: "maya@example.test",
        phones: ["mobile: +1 303-555-0142"],
        tags: ["boulder"],
        groups: ["Close friends"],
        ways_of_working: ["Voice notes"],
        source: "Pottery studio",
      },
      body: "## Memories and moments\n\nHiked Green Mountain.\n",
    },
    {
      id: "p2",
      path: "People/Sam Rivera",
      updatedAt: "2026-11-18T10:00:00Z",
      fields: {
        relation: "collaborator",
        status: "active",
        email: "sam@example.test",
        emails: ["sam.alt@example.test"],
        phones: ["work: +1 (415) 555-0188"],
      },
      body: "",
    },
  ];

  it("matches by email first (including secondary emails), then phone (normalized digits), then name", () => {
    // Email match beats a different name and phone
    const byEmail = api.matchVCardContact(
      { name: "Sam R.", emails: ["SAM.ALT@example.test"], phones: ["+1 999-555-0000"], address: "", birthday: "", links: [], groups: [], tags: [], summary: "", note: "", photo: null },
      existing,
    );
    expect(byEmail?.person.id).toBe("p2");
    expect(byEmail?.by).toBe("email");

    // Phone match works across formatting and leading US country code (1)
    const byPhone = api.matchVCardContact(
      { name: "M. Lin", emails: ["new@example.test"], phones: ["303.555.0142"], address: "", birthday: "", links: [], groups: [], tags: [], summary: "", note: "", photo: null },
      existing,
    );
    expect(byPhone?.person.id).toBe("p1");
    expect(byPhone?.by).toBe("phone");

    // Name match (case & whitespace insensitive) when email and phone don't match
    const byName = api.matchVCardContact(
      { name: "  maya   lin ", emails: [], phones: [], address: "", birthday: "", links: [], groups: [], tags: [], summary: "", note: "", photo: null },
      existing,
    );
    expect(byName?.person.id).toBe("p1");
    expect(byName?.by).toBe("name");

    // Unmatched contact returns null
    const none = api.matchVCardContact(
      { name: "Tessa Cho", emails: ["tessa@example.test"], phones: ["+1 212-555-0100"], address: "", birthday: "", links: [], groups: [], tags: [], summary: "", note: "", photo: null },
      existing,
    );
    expect(none).toBeNull();
  });

  it("merges additively without dropping or overwriting existing person fields", () => {
    const incoming: VCardContact = {
      name: "Maya Lin",
      emails: ["maya@example.test", "maya.work@example.test"],
      phones: ["mobile: 303-555-0142", "work: +1 303-555-0198"],
      address: "412 Pine St\nBoulder, CO",
      birthday: "1991-12-02",
      links: ["https://mayastudio.example"],
      groups: ["Close friends", "Climbing"],
      tags: ["ceramics"],
      summary: "Should not overwrite existing summary",
      note: "Prefers morning coffee.",
      photo: { mimeType: "image/jpeg", bytes: TINY_JPG_BYTES },
    };

    const merged = api.mergeVCardIntoPerson(existing[0], incoming);
    expect(merged.changed).toBe(true);
    // Existing primary email, summary, relation, status, ways_of_working, source are untouched
    expect(merged.fieldsPatch.email).toBeUndefined();
    expect(merged.fieldsPatch.summary).toBeUndefined();
    expect(merged.fieldsPatch.relation).toBeUndefined();
    // New secondary email & phone added without duplicating existing ones
    expect(merged.fieldsPatch.emails).toEqual(["maya.work@example.test"]);
    expect(merged.fieldsPatch.phones).toEqual(["mobile: +1 303-555-0142", "work: +1 303-555-0198"]);
    expect(merged.fieldsPatch.address).toBe("412 Pine St\nBoulder, CO");
    expect(merged.fieldsPatch.birthday).toBe("1991-12-02");
    expect(merged.fieldsPatch.links).toEqual(["https://mayastudio.example"]);
    expect(merged.fieldsPatch.groups).toEqual(["Close friends", "Climbing"]);
    expect(merged.fieldsPatch.tags).toEqual(["boulder", "ceramics"]);
    expect(merged.nextBody).toContain("Hiked Green Mountain.");
    expect(merged.nextBody).toContain("Prefers morning coffee.");
    expect(merged.attachPhoto?.mimeType).toBe("image/jpeg");

    // Re-importing the exact same data produces changed: false
    const alreadyMerged: PersonRecord = {
      ...existing[0],
      fields: { ...existing[0].fields, ...merged.fieldsPatch, photo: "2026-11-23/maya.jpg" },
      body: merged.nextBody,
    };
    const second = api.mergeVCardIntoPerson(alreadyMerged, incoming);
    expect(second.changed).toBe(false);
  });
});

describe("People vCard export round-trip", () => {
  it("exports people with multiple numbers, emails, address, birthday, groups, tags and photo, and parses back cleanly", () => {
    const people: PersonRecord[] = [
      {
        id: "p1",
        path: "People/Maya Lin",
        updatedAt: "2026-11-23T09:00:00Z",
        fields: {
          relation: "friend",
          summary: "Ceramicist and trail runner",
          email: "maya@example.test",
          emails: ["studio@example.test"],
          phones: ["mobile: +1 303-555-0142", "work: +1 303-555-0198"],
          address: "412 Pine St\nBoulder, CO 80302",
          birthday: "1991-12-02",
          links: ["https://mayastudio.example"],
          groups: ["Close friends", "Climbing"],
          tags: ["boulder", "ceramics"],
          favorite: true,
        },
      },
    ];
    const photos = new Map<string, VCardPhoto>([["p1", { mimeType: "image/jpeg", bytes: TINY_JPG_BYTES }]]);
    const vcf = api.exportVCard(people, photos);

    expect(vcf).toContain("BEGIN:VCARD\r\nVERSION:4.0\r\n");
    expect(vcf).toContain("FN:Maya Lin\r\n");
    expect(vcf).toContain("N:Lin;Maya;;;\r\n");
    expect(vcf).toContain("TEL;TYPE=cell:+1 303-555-0142\r\n");
    expect(vcf).toContain("TEL;TYPE=work:+1 303-555-0198\r\n");
    expect(vcf).toContain("BDAY:19911202\r\n");
    expect(vcf).toContain("CATEGORIES:Close friends,Climbing\r\n");
    expect(vcf).toContain("X-PARACHUTE-TAGS:boulder,ceramics\r\n");
    expect(vcf).toContain(`PHOTO:data:image/jpeg;base64,${TINY_JPG_B64}`);

    const roundTripped = api.parseVCard(vcf);
    expect(roundTripped).toHaveLength(1);
    expect(roundTripped[0].name).toBe("Maya Lin");
    expect(roundTripped[0].emails).toEqual(["maya@example.test", "studio@example.test"]);
    expect(roundTripped[0].phones).toEqual(["mobile: +1 303-555-0142", "work: +1 303-555-0198"]);
    expect(roundTripped[0].birthday).toBe("1991-12-02");
    expect(roundTripped[0].groups).toEqual(["Close friends", "Climbing"]);
    expect(roundTripped[0].tags).toEqual(["boulder", "ceramics"]);
    expect(roundTripped[0].links).toEqual(["https://mayastudio.example"]);
    expect(Array.from(roundTripped[0].photo!.bytes)).toEqual(Array.from(TINY_JPG_BYTES));
  });
});

describe("Birthdays coming up, Reconnect, and Search/Filter", () => {
  const people: PersonRecord[] = [
    {
      id: "p1",
      path: "People/Maya Lin",
      updatedAt: "2026-11-20T00:00:00Z",
      fields: { relation: "friend", status: "active", birthday: "1991-11-25", groups: ["Close friends"], tags: ["boulder"], phones: ["+1 303-555-0142"] },
      links: [{ sourceId: "m1", targetId: "p1", relationship: "mentions", sourceNote: { id: "m1", path: "Meetings/2026-11-18 Coffee", updatedAt: "2026-11-18T15:00:00Z" } }],
    },
    {
      id: "p2",
      path: "People/Devon Park",
      updatedAt: "2026-10-01T00:00:00Z",
      fields: { relation: "collaborator", status: "active", birthday: "--01-03", groups: ["Techne"], tags: ["audio"] },
      links: [{ sourceId: "j1", targetId: "p2", relationship: "mentions", sourceNote: { id: "j1", path: "Journal/2026/08-10/09-00", updatedAt: "2026-08-10T09:00:00Z" } }],
    },
    {
      id: "p3",
      path: "People/Nadia Okafor",
      updatedAt: "2026-09-01T00:00:00Z",
      fields: { relation: "family", status: "past", birthday: "1988-02-29" },
      links: [],
    },
    {
      id: "p4",
      path: "People/Leo Vance",
      updatedAt: "2026-09-01T00:00:00Z",
      fields: { relation: "influence", status: "active" },
      links: [],
    },
  ];

  it("computes upcoming birthdays across year boundaries and leap days", () => {
    const soon = api.upcomingBirthdays(people, "2026-11-23", 60);
    expect(soon.map((b) => [b.name, b.daysUntil, b.nextDate, b.turning])).toEqual([
      ["Maya Lin", 2, "2026-11-25", 35],
      ["Devon Park", 41, "2027-01-03", null],
    ]);

    // Leap-day birthday (1988-02-29) falls on 2027-02-28 in a non-leap year
    const feb = api.upcomingBirthdays(people, "2027-02-20", 15);
    expect(feb).toEqual([
      expect.objectContaining({ name: "Nadia Okafor", nextDate: "2027-02-28", daysUntil: 8, turning: 39 }),
    ]);
  });

  it("identifies people you haven't talked with in a while from newest linked note", () => {
    const nowMs = Date.parse("2026-11-23T12:00:00Z");
    const rec = api.reconnectList(people, nowMs, { staleDays: 30, includePast: false });
    // Maya had a meeting 5 days ago -> not stale; Nadia is status=past -> excluded by default
    expect(rec.stale.map((x) => x.name)).toEqual(["Devon Park"]);
    expect(rec.stale[0].daysSince).toBeGreaterThan(100);
    expect(rec.stale[0].lastTitle).toBe("2026 / 08-10 / 09-00");
    expect(rec.unlinked.map((x) => x.name)).toEqual(["Leo Vance"]);

    const withPast = api.reconnectList(people, nowMs, { staleDays: 30, includePast: true });
    expect(withPast.unlinked.map((x) => x.name)).toEqual(["Leo Vance", "Nadia Okafor"]);
  });

  it("filters by search query (including phone digits), relation, group, and tag", () => {
    expect(api.filterPeople(people, { query: "5550142", relation: "", group: "", tag: "" }).map((p) => p.id)).toEqual(["p1"]);
    expect(api.filterPeople(people, { query: "", relation: "collaborator", group: "", tag: "" }).map((p) => p.id)).toEqual(["p2"]);
    expect(api.filterPeople(people, { query: "", relation: "", group: "Techne", tag: "" }).map((p) => p.id)).toEqual(["p2"]);
    expect(api.filterPeople(people, { query: "", relation: "", group: "", tag: "boulder" }).map((p) => p.id)).toEqual(["p1"]);
    expect(api.initialsOf("Maya Lin")).toBe("ML");
    expect(api.letterOf("Maya Lin")).toBe("M");
    expect(api.letterOf("123 Club")).toBe("#");
  });

  it("applets/people.tsx type-checks cleanly against applets/parachute.d.ts", () => {
    const root = process.cwd();
    const program = ts.createProgram(
      [join(root, "applets", "parachute.d.ts"), join(root, "applets", "people.tsx")],
      {
        strict: true, noEmit: true, skipLibCheck: true, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
        types: [], typeRoots: [join(root, "node_modules", "@types")],
      },
    );
    const said = ts.getPreEmitDiagnostics(program).map((d) => `${d.file?.fileName.replace(root, "") ?? ""}:${d.start ?? 0}: ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`);
    expect(said).toEqual([]);
  }, 30_000);
});

describe("People vCard edge cases from review", () => {
  it("joins vCard 2.1 quoted-printable soft line breaks and keeps emoji whole", () => {
    const vcf = [
      "BEGIN:VCARD",
      "VERSION:2.1",
      "N;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:Ortega;Ana =F0=9F=8C=BB;;;",
      "FN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:Ana Ortega =",
      "=F0=9F=8C=BB",
      "TEL;CELL:+1 720-555-0110",
      "NOTE;ENCODING=QUOTED-PRINTABLE:Met at the =",
      "pottery open house: brought figs",
      "END:VCARD",
    ].join("\r\n");
    const [card] = api.parseVCard(vcf);
    expect(card.name).toBe("Ana Ortega 🌻");
    expect(card.note).toBe("Met at the pottery open house: brought figs");
    expect(card.phones).toEqual(["mobile: +1 720-555-0110"]);

    // a raw (unencoded) emoji inside a quoted-printable value survives too
    const [raw] = api.parseVCard("BEGIN:VCARD\r\nVERSION:2.1\r\nFN;ENCODING=QUOTED-PRINTABLE:Bo 🌻 Reyes\r\nEND:VCARD\r\n");
    expect(raw.name).toBe("Bo 🌻 Reyes");
  });

  it("export then re-import changes nothing: the summary written as NOTE comes back as the summary", () => {
    const person: PersonRecord = {
      id: "p9", path: "People/Rosa Lind", updatedAt: "2026-11-01T00:00:00Z",
      fields: { summary: "Beekeeper on the north side", email: "rosa@example.test", phones: ["mobile: +1 720-555-0123"] },
      body: "## Memories and moments\n\nShared a honey harvest.\n",
    };
    const [card] = api.parseVCard(api.exportVCard([person]));
    const merged = api.mergeVCardIntoPerson(person, card);
    expect(merged.nextBody).toBeUndefined();
    expect(merged.changed).toBe(false);
    // into an empty vault, it becomes the summary, not body text
    expect(api.fieldsForNewVCard(card).summary).toBe("Beekeeper on the north side");
  });

  it("plans no body change for a list record, which comes without its body", () => {
    const listed: PersonRecord = { id: "p8", path: "People/Kai Moss", updatedAt: null, fields: { email: "kai@example.test" } };
    const [card] = api.parseVCard("BEGIN:VCARD\r\nVERSION:4.0\r\nFN:Kai Moss\r\nEMAIL:kai@example.test\r\nNOTE:Climbs on Tuesdays\r\nEND:VCARD\r\n");
    expect(api.mergeVCardIntoPerson(listed, card).changed).toBe(false);
    expect(api.mergeVCardIntoPerson({ ...listed, body: "## Memories and moments\n\nClimbs on Tuesdays\n" }, card).changed).toBe(false);
    expect(api.mergeVCardIntoPerson({ ...listed, body: "" }, card).nextBody).toContain("Climbs on Tuesdays");
  });
});

describe("People second review round", () => {
  it("decodes quoted-printable in the card's CHARSET (Latin-1 from older phones)", () => {
    const [card] = api.parseVCard("BEGIN:VCARD\r\nVERSION:2.1\r\nFN;CHARSET=ISO-8859-1;ENCODING=QUOTED-PRINTABLE:J=F6rg M=FCller\r\nEND:VCARD\r\n");
    expect(card.name).toBe("Jörg Müller");
  });

  it("finds phones by digits only when the search is a number", () => {
    const people: PersonRecord[] = [
      { id: "a", path: "People/Ada Fox", updatedAt: null, fields: { phones: ["mobile: +1 303-555-0101"] } },
      { id: "b", path: "People/Bo Lee", updatedAt: null, fields: { address: "Suite 101, Pearl St" } },
    ];
    const names = (q: string) => api.filterPeople(people, { query: q, relation: "", group: "", tag: "" }).map((p) => p.path);
    expect(names("303 555")).toEqual(["People/Ada Fox"]);
    expect(names("Suite 101")).toEqual(["People/Bo Lee"]);
  });

  it("drops impossible birthdays instead of rolling them into the next month", () => {
    const people: PersonRecord[] = [
      { id: "a", path: "People/Ada Fox", updatedAt: null, fields: { birthday: "1990-02-30" } },
      { id: "b", path: "People/Bo Lee", updatedAt: null, fields: { birthday: "--02-29" } },
    ];
    expect(api.upcomingBirthdays(people, "2026-11-23", 366).map((b) => b.name)).toEqual(["Bo Lee"]);
  });
});

// Thousands of people (T-476 land): made-up records, a hub that pages and orders as Parachute's does
// (created_at or updated_at, ties by id; 50 at most a page), and records that change while the list reads.
describe("People at thousands of people", () => {
  const stamp = (n: number) => new Date(Date.UTC(2026, 0, 1) + n * 60_000).toISOString();
  const many = (n: number): PersonRecord[] => Array.from({ length: n }, (_, i) => ({
    id: `p${String(i).padStart(5, "0")}`,
    path: `People/Person ${i}`,
    createdAt: stamp(i),
    updatedAt: stamp(i),
    fields: { email: `person${i}@example.test`, phones: [`mobile: +1 303-555-${String(i).padStart(4, "0")}`] },
    body: `## Memories and moments\n\nMet person ${i}.\n`,
  }));
  const blank = (over: Partial<VCardContact>): VCardContact => ({
    name: "", phones: [], emails: [], address: "", birthday: "", links: [], groups: [], tags: [], summary: "", note: "", photo: null, ...over,
  });

  /** A hub over `rows`; `between(page)` runs after each page is handed back (an edit, a delete, a new record). */
  function hub(rows: PersonRecord[], between: (page: number) => void = () => {}, oldHub = false) {
    let pages = 0;
    const query = async (q: Record<string, unknown>) => {
      if (oldHub && q.orderBy === "created_at") throw Object.assign(new Error("bad_params"), { status: 400 });
      const key = q.orderBy === "created_at" ? "createdAt" : "updatedAt";
      const dir = q.orderBy === undefined ? "desc" : q.sort;
      const sorted = [...rows].sort((a, b) => {
        const c = String(a[key] ?? "").localeCompare(String(b[key] ?? "")) || a.id.localeCompare(b.id);
        return dir === "desc" ? -c : c;
      });
      const offset = Number(q.offset ?? 0);
      // the app pages no further than an offset of 5,000
      if (offset > 5000) throw Object.assign(new Error("bad_params"), { status: 400 });
      const page = sorted.slice(offset, offset + Math.min(Number(q.limit ?? 50), 50)).map((r) => ({ ...r }));
      between(pages++);
      return page;
    };
    return { query, pages: () => pages };
  }

  it("lists everyone once, in their newest version, while records change and arrive during the read", async () => {
    const rows = many(3000);
    let clock = 10_000;
    const { query } = hub(rows, (page) => {
      if (page === 3) {
        // already read, then changed; and one not read yet, changed
        rows[10] = { ...rows[10], updatedAt: stamp(clock++), fields: { ...rows[10].fields, summary: "changed" } };
        rows[2500] = { ...rows[2500], updatedAt: stamp(clock++) };
      }
      if (page === 7) rows.push({ id: "znew", path: "People/New Person", createdAt: stamp(clock), updatedAt: stamp(clock++) });
    });
    const { rows: got, capped } = await api.readFolder(query, { pathPrefix: "People/", includeFields: true });
    expect(capped).toBe(false);
    const ids = got.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    // every record there now, none missed by one that changed while it read (a delete behind it: the app's to go on
    // past, src/applet/vault.test.ts)
    expect(new Set(ids)).toEqual(new Set(rows.map((r) => r.id)));
    expect(got.find((r) => r.id === "p00010")?.fields?.summary).toBe("changed");
  });

  it("reads a hub that can't order by when a record was made newest-changed first, and one changed meanwhile comes in", async () => {
    const rows = many(120);
    // the oldest-changed, not read yet, changed while it reads: it jumps ahead of where the read is
    const { query } = hub(rows, (page) => { if (page === 1) rows[0] = { ...rows[0], updatedAt: stamp(99_999) }; }, true);
    const { rows: got } = await api.readFolder(query, { pathPrefix: "People/" });
    expect(got.map((r) => r.id).sort()).toEqual(rows.map((r) => r.id).sort());
  });

  it("past the furthest offset the app pages to, lists what it has and says there are more", async () => {
    const { query } = hub(many(5100));
    const { rows, capped } = await api.readFolder(query, { pathPrefix: "People/" });
    expect(capped).toBe(true);
    expect(rows.length).toBeGreaterThanOrEqual(5050);
    expect((await api.readFolder(hub(many(5049)).query, { pathPrefix: "People/" })).capped).toBe(false);
  });

  it("reads bodies only for the people a card's note merges into", async () => {
    const people = many(3000).map(({ body: _b, ...p }) => p);
    let one = 0, all = 0;
    const full = many(3000);
    const readOne = async (id: string) => { one++; return full.find((p) => p.id === id) ?? null; };
    const readAll = async () => { all++; return full; };
    const cards = [
      blank({ name: "Person 7", emails: ["person7@example.test"], note: "Plays cello" }),
      blank({ name: "Person 2999", phones: ["+1 303 555 2999"], note: "Met person 2999." }),
      blank({ name: "Someone New", note: "New" }),
      blank({ name: "Person 12", emails: ["person12@example.test"] }),
    ];
    const got = await api.withBodiesForCards(cards, people, readOne, readAll);
    expect([one, all]).toEqual([2, 0]);
    expect(got.find((p) => p.id === "p00007")?.body).toContain("Met person 7.");
    expect(got.find((p) => p.id === "p00012")?.body).toBeUndefined();
    // the preview's answer is then true: the note already there is "Same"; the other merges
    const index = api.peopleIndex(got);
    expect(api.mergeVCardIntoPerson(index.match(cards[1])!.person, cards[1]).changed).toBe(false);
    expect(api.mergeVCardIntoPerson(index.match(cards[0])!.person, cards[0]).changed).toBe(true);

    // a phone's whole address book, every card with a note: the folder in pages, not one read each
    one = 0; all = 0;
    const every = people.map((_, i) => blank({ name: `Person ${i}`, emails: [`person${i}@example.test`], note: "x" }));
    await api.withBodiesForCards(every, people, readOne, readAll);
    expect([one, all]).toEqual([0, 1]);

    // no card brings a note: nothing is read
    one = 0; all = 0;
    await api.withBodiesForCards([cards[3]], people, readOne, readAll);
    expect([one, all]).toEqual([0, 0]);
  });

  it("a merge adds to a list as the record holds it: numbers, labelled objects and near-duplicates an AI wrote stay", () => {
    const phones = [3035550142, "home: +1 303-555-0199", "work: 303 555 0199", { type: "cell", number: "303-555-0100", ext: "7" }];
    const person: PersonRecord = { id: "p", path: "People/Ann Lee", updatedAt: null, fields: { phones, groups: ["Book club", "book club"], email: "ann@example.test" } };
    const merged = api.mergeVCardIntoPerson(person, blank({ name: "Ann Lee", phones: ["+1 720 555 0111", "(303) 555-0142"], groups: ["Climbing"], emails: ["ann.lee@example.test"] }));
    expect(merged.fieldsPatch.phones).toEqual([...phones, "+1 720 555 0111"]);
    expect(merged.fieldsPatch.groups).toEqual(["Book club", "book club", "Climbing"]);
    expect(merged.fieldsPatch.emails).toEqual(["ann.lee@example.test"]);
    // and the number written as a number is read as one: matched, shown
    expect(api.readPersonFields(person.fields).phones).toContain("3035550142");
  });

  it("never lets a link carry a second card: one with a newline is dropped on import and on export", () => {
    const [card] = api.parseVCard("BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Ann Lee\r\nURL:https://ann.example\\nEND:VCARD\\nBEGIN:VCARD\\nFN:Mallory\r\nURL:https://ann.example/ok\r\nEND:VCARD\r\n");
    expect(card.links).toEqual(["https://ann.example/ok"]);
    // written by an AI straight into the field
    const out = api.exportVCard([{ id: "a", path: "People/Ann Lee", updatedAt: null, fields: { links: ["https://ann.example\nEND:VCARD\nBEGIN:VCARD\nFN:Mallory", "https://ann.example/ok"] } }]);
    expect(api.parseVCard(out).map((c) => c.name)).toEqual(["Ann Lee"]);
    expect(out).toContain("URL:https://ann.example/ok");
  });

  it("a person gone since the list was read leaves the preview standing", async () => {
    const people = many(100).map(({ body: _b, ...p }) => p);
    const got = await api.withBodiesForCards([blank({ emails: ["person3@example.test"], note: "x" })], people, async () => { throw new Error("gone"); }, async () => []);
    expect(got).toHaveLength(100);
  });

  it("matches as a scan of the list would: email, then phone, then name, the first person holding the key", () => {
    const people: PersonRecord[] = [
      { id: "a", path: "People/Ada Fox", updatedAt: null, fields: { phones: ["+1 303-555-0101"] } },
      { id: "b", path: "People/Bo Lee", updatedAt: null, fields: { email: "shared@example.test", phones: ["+1 303-555-0101"] } },
      { id: "c", path: "People/Ada Fox", updatedAt: null, fields: { emails: ["shared@example.test"] } },
    ];
    const index = api.peopleIndex(people);
    expect(index.match(blank({ name: "Ada Fox", phones: ["303 555 0101"], emails: ["shared@example.test"] }))).toMatchObject({ person: { id: "b" }, by: "email" });
    expect(index.match(blank({ name: "Ada Fox", phones: ["(303) 555-0101"] }))).toMatchObject({ person: { id: "a" }, by: "phone" });
    expect(index.match(blank({ name: "ada fox" }))).toMatchObject({ person: { id: "a" }, by: "name" });
    // a merge adds a key to an earlier person: it is theirs now, as a scan would find it
    index.put({ ...people[0], fields: { ...people[0].fields, email: "shared@example.test" } });
    expect(index.match(blank({ emails: ["shared@example.test"] }))?.person.id).toBe("a");
    // a new person from the same file is found by the next card, never made twice
    index.put({ id: "pending:0", path: "People/Cy Moss", updatedAt: null, fields: { email: "cy@example.test" } });
    expect(index.match(blank({ name: "Cy M", emails: ["CY@example.test"] }))?.person.id).toBe("pending:0");
  });
});
