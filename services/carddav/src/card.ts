// A People record ↔ a vCard. Only card facts cross; everything else on the record, and its body, stays in the vault.
//
// The card facts (docs/PEOPLE.md) and where they go:
//   phones    TEL (label → TYPE=cell/work/home, any other label as Apple/Android `itemN.X-ABLabel`)
//   email     EMAIL;TYPE=pref (the primary), emails → more EMAIL
//   address   ADR (the whole address in the street part, its lines kept)
//   birthday  BDAY (yearless as Apple's X-APPLE-OMIT-YEAR=1604, which DAVx5 reads and writes back unchanged)
//   links     URL      groups  CATEGORIES      summary  NOTE      photo  PHOTO (inline, from the record's attachment)
// Bridge fields on the record: `uid` (the card's UID when it isn't the record id), `href` (the card's file name when it
// isn't its UID), `vcard_extra` (raw lines the phone sent that People has no field for: ORG, TITLE, NICKNAME, X-…,
// served back as they came) and `on_phone` (false: left off the phone). The rest is vault-only and is never read here:
// `servedFields` is an allowlist, and a card is built from nothing else.
//
// Why vCard 3.0: DAVx5 asks for and uploads 4.0 only when the server advertises it (supported-address-data); 3.0 is
// what every Android sync client and server speaks, it carries Apple/Android `itemN.X-ABLabel` labels, and DAVx5 writes
// a yearless birthday in 3.0 as the Apple form served here, so a card round-trips unchanged.
import { createHash } from "node:crypto";
import { cleanName, dedupe, escapeValue, foldLine, parseBirthday, parsePhoneEntry, phoneKey, phoneLabelFromTypes, readCards, splitEscaped, unescapeValue, validBirthday, webLink, type Prop } from "./vcard.ts";

/** The record fields a card may show, and nothing else. */
export const CARD_FACTS = ["phones", "email", "emails", "address", "birthday", "links", "groups", "summary", "photo"] as const;
/** Fields the bridge itself keeps on a record (`uid`, `href`, `vcard_extra` shape the card; `on_phone` says if it's on the phone). */
export const BRIDGE_FIELDS = ["uid", "href", "vcard_extra", "on_phone"] as const;
const SERVED = new Set<string>([...CARD_FACTS, "uid", "href", "vcard_extra"]);

/** A record as the bridge holds it: no body, ever. */
export type Person = { id: string; path: string; updatedAt: string; fields: Record<string, unknown> };

/** Only the fields a card may show (the allowlist). */
export function servedFields(fields: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields ?? {})) if (SERVED.has(k)) out[k] = v;
  return out;
}

export type Facts = { phones: string[]; email: string; emails: string[]; address: string; birthday: string; links: string[]; groups: string[]; summary: string };

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
function strList(v: unknown): string[] {
  if (Array.isArray(v)) return v.flatMap((x) => (typeof x === "string" && x.trim() ? [x.trim()] : typeof x === "number" && Number.isFinite(x) ? [String(x)] : []));
  const s = str(v);
  return s ? [s] : [];
}

/** The card facts of a record, read as People reads them (the applet's `readPersonFields`). */
export function factsOf(fields: Record<string, unknown> | undefined): Facts {
  const f = servedFields(fields);
  const email = str(f.email).toLowerCase();
  return {
    phones: dedupe(strList(f.phones), (p) => phoneKey(p) || p.toLowerCase()),
    email,
    emails: dedupe(strList(f.emails).map((e) => e.toLowerCase()).filter((e) => e !== email)),
    address: str(f.address),
    birthday: validBirthday(str(f.birthday)) ? str(f.birthday) : "",
    links: dedupe(strList(f.links)).filter(webLink),
    groups: dedupe(strList(f.groups)),
    summary: str(f.summary),
  };
}

/** A person's name: the note's path below the folder (the applet's `personName`). */
export function nameOf(path: string, folder: string): string {
  return (path.startsWith(folder) ? path.slice(folder.length) : path).replace(/\.md$/i, "").trim() || path;
}

/** The card's UID: the record's `uid`, else the record's id. */
export const uidOf = (p: Person): string => str(p.fields.uid) || p.id;
/** The card's file name, without `.vcf`: `href` (a phone named it so), else `uid`, else the record id. */
export const resourceOf = (p: Person): string => str(p.fields.href) || str(p.fields.uid) || p.id;

/** N for a name, as the applet's export splits it: the last word is the family name. */
function nFor(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  const family = parts.length > 1 ? parts[parts.length - 1] : "";
  const given = parts.length > 1 ? parts.slice(0, -1).join(" ") : (parts[0] ?? name);
  return `${escapeValue(family)};${escapeValue(given)};;;`;
}
/** The name an N value spells (the applet's order: prefix, given, middle, family, suffix). */
function nameFromN(value: string): string {
  const p = splitEscaped(value, ";").map((x) => unescapeValue(x).trim());
  return [p[3], p[1], p[2], p[0], p[4]].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

/** Lines of vcard_extra that may be served: a property line, not one the bridge writes itself. */
const OWN = new Set(["BEGIN", "END", "VERSION", "PRODID", "REV", "UID", "FN"]);
function extraLines(fields: Record<string, unknown>): Prop[] {
  const lines = strList(fields.vcard_extra).filter((l) => !/[\r\n]/.test(l) && !/^(BEGIN|END):VCARD$/i.test(l.trim()));
  const props = readCards(`BEGIN:VCARD\n${lines.join("\n")}\nEND:VCARD`)[0] ?? [];
  return props.filter((p) => !OWN.has(p.name));
}

export type PhotoLine = { type: string; base64: string };
export const photoType = (pathOrMime: string): string => {
  const ext = pathOrMime.toLowerCase().replace(/^image\//, "").replace(/^.*\./, "");
  return ext === "jpg" ? "JPEG" : ext.toUpperCase().replace(/[^A-Z0-9-]/g, "") || "JPEG";
};

/** The card for a person: vCard 3.0, CRLF, folded. `photo` is the PHOTO line's value: the picture's base64 when served,
 *  its storage path when the ETag is reckoned (an attachment's bytes never change, so the path stands for them). */
export function cardText(p: Person, folder: string, photo?: PhotoLine | null): string {
  const f = p.fields;
  const facts = factsOf(f);
  const name = nameOf(p.path, folder);
  const extra = extraLines(f);
  const lines = ["BEGIN:VCARD", "VERSION:3.0", "PRODID:-//Parachute//People CardDAV//EN", `UID:${escapeValue(uidOf(p))}`, `FN:${escapeValue(name)}`];
  // the phone's own N while it still spells this name (it keeps a middle name or a title); else one from the name
  const keptN = extra.find((x) => x.name === "N" && !x.group && nameFromN(x.value) === name.replace(/\s+/g, " "));
  lines.push(keptN ? `N:${keptN.value}` : `N:${nFor(name)}`);
  const usedGroups = new Set(extra.map((x) => x.group.toLowerCase()).filter(Boolean));
  let item = 0;
  const nextGroup = () => { do item++; while (usedGroups.has(`item${item}`)); return `item${item}`; };
  for (const entry of facts.phones) {
    const { label, number } = parsePhoneEntry(entry);
    const type = label === "mobile" ? "CELL" : label === "work" || label === "home" ? label.toUpperCase() : "";
    if (!label) lines.push(`TEL:${escapeValue(number)}`);
    else if (type) lines.push(`TEL;TYPE=${type}:${escapeValue(number)}`);
    else { const g = nextGroup(); lines.push(`${g}.TEL:${escapeValue(number)}`, `${g}.X-ABLabel:${escapeValue(label)}`); }
  }
  if (facts.email) lines.push(`EMAIL;TYPE=INTERNET;TYPE=PREF:${escapeValue(facts.email)}`);
  for (const e of facts.emails) lines.push(`EMAIL;TYPE=INTERNET:${escapeValue(e)}`);
  if (facts.address) lines.push(`ADR:;;${escapeValue(facts.address)};;;;`);
  if (facts.birthday) lines.push(facts.birthday.startsWith("--") ? `BDAY;X-APPLE-OMIT-YEAR=1604:1604-${facts.birthday.slice(2)}` : `BDAY:${facts.birthday}`);
  for (const u of facts.links) lines.push(`URL:${u}`);
  if (facts.groups.length) lines.push(`CATEGORIES:${facts.groups.map(escapeValue).join(",")}`);
  if (facts.summary) lines.push(`NOTE:${escapeValue(facts.summary)}`);
  if (photo) lines.push(`PHOTO;ENCODING=b;TYPE=${photo.type}:${photo.base64}`);
  for (const x of extra) if (x.name !== "N") lines.push(x.line);
  lines.push("END:VCARD");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

/** The ETag of a person's card: a hash of its text with the photo's storage path for its bytes. A change to the body
 *  or any vault-only field leaves it as it was. */
export function etagOf(p: Person, folder: string): string {
  const photo = str(p.fields.photo);
  return `"${createHash("sha256").update(cardText(p, folder, photo ? { type: photoType(photo), base64: photo } : null)).digest("base64url").slice(0, 27)}"`;
}

/** What a card from the phone says, in People's words. */
export type PhoneCard = {
  uid: string;
  /** The name the card spells (FN, else N, ORG, an email, a phone), cleaned as a note name; "" if it names nothing. */
  name: string;
  fn: string;
  facts: Facts;
  /** Lines People has no field for, raw (unfolded), kept as they came. */
  extra: string[];
  photo: { mime: string; bytes: Uint8Array } | null;
  /** A group card (DAVx5's group-vCard method), which People doesn't take. */
  group: boolean;
  /** Something the card said that won't be kept: a line too long to keep, a picture that isn't inline, a second one. */
  lost: boolean;
};

/** A label as a phone entry can hold it (`"<label>: <number>"`, the applet's `parsePhoneEntry`): letters, digits,
 *  space, _ and -, starting with a letter, up to 21 characters; anything else is dropped from it. A label left empty
 *  leaves the number unlabelled (a label People couldn't read back would end up inside the number). */
export function labelFor(raw: string): string {
  const cleaned = raw.toLowerCase().replace(/[^a-z0-9 _-]+/g, " ").replace(/\s+/g, " ").trim().replace(/^[^a-z]+/, "").slice(0, 21).trim();
  return parsePhoneEntry(`${cleaned}: 1`).label === cleaned ? cleaned : "";
}

const KIND_GROUP = (p: Prop) => (p.name === "KIND" || p.name === "X-ADDRESSBOOKSERVER-KIND") && p.value.trim().toLowerCase() === "group";
const LONGEST_EXTRA = 8192;

/** Read one card from the phone. Throws on a text that isn't exactly one card. */
export function readPhoneCard(text: string): PhoneCard {
  const cards = readCards(text);
  if (cards.length !== 1) throw new Error(cards.length ? "one card per resource" : "no vCard in the body");
  const props = cards[0];
  const used = new Set<Prop>();
  const take = (p: Prop) => { used.add(p); };
  const groupLabels = new Map<string, Prop>();
  for (const p of props) if (p.group && p.name === "X-ABLABEL") groupLabels.set(p.group.toLowerCase(), p);

  let uid = "", fn = "", nName = "", org = "";
  const phones: string[] = [];
  const emails: { v: string; pref: boolean }[] = [];
  let address = "", birthday = "", summary = "";
  const links: string[] = [];
  const groups: string[] = [];
  let photo: PhoneCard["photo"] = null;
  let lost = false;
  const labelled = new Set<string>();

  for (const p of props) {
    const val = p.value;
    const types = (p.params.TYPE ?? []).map((t) => t.toLowerCase());
    switch (p.name) {
      case "VERSION": case "PRODID": case "REV": case "LABEL": take(p); break;
      case "UID": take(p); uid = unescapeValue(val).trim().replace(/^urn:uuid:/i, ""); break;
      case "FN": take(p); if (!fn) fn = unescapeValue(val).trim(); break;
      // N is kept in vcard_extra (served back while it still spells the person's name) unless it says no more than the
      // one made from the name would
      case "N": if (!nName) nName = nameFromN(val); if (val === nFor(fn || nName)) take(p); break;
      case "ORG": if (!org) org = splitEscaped(val, ";").map((x) => unescapeValue(x).trim()).filter(Boolean).join(" · "); break;
      case "TEL": {
        const n = unescapeValue(val).replace(/^tel:/i, "").trim();
        take(p);
        if (!n) break;
        const gl = p.group ? groupLabels.get(p.group.toLowerCase()) : undefined;
        if (gl) labelled.add(p.group.toLowerCase());
        const label = labelFor(phoneLabelFromTypes(p.params.TYPE ?? [], gl ? unescapeValue(gl.value).trim() : undefined));
        phones.push(label ? `${label}: ${n}` : n);
        break;
      }
      case "EMAIL": {
        const e = unescapeValue(val).replace(/^mailto:/i, "").trim().toLowerCase();
        take(p);
        if (p.group && groupLabels.has(p.group.toLowerCase())) labelled.add(p.group.toLowerCase());
        if (e) emails.push({ v: e, pref: types.includes("pref") || (p.params.PREF ?? []).length > 0 });
        break;
      }
      case "ADR": {
        if (address) break;
        // each part may be a list (an unescaped comma between items): Android sends an address's lines as a list in the
        // street part, so a list's items are its lines
        const parts = splitEscaped(val, ";").map((x) => splitEscaped(x, ",").map((y) => unescapeValue(y).trim()).filter(Boolean).join("\n"));
        // the applet's reading: po;ext;street on one line, city, region postal on the next, country last
        const street = [parts[0], parts[1], parts[2]].filter(Boolean).join(", ");
        const cityLine = [[parts[3], parts[4]].filter(Boolean).join(", "), parts[5]].filter(Boolean).join(" ").trim();
        const full = [street, cityLine, parts[6]].filter(Boolean).join("\n").trim();
        take(p);
        if (p.group && groupLabels.has(p.group.toLowerCase())) labelled.add(p.group.toLowerCase());
        address = full;
        break;
      }
      case "BDAY": {
        if (birthday) break;
        const b = parseBirthday(val, p.params);
        if (b) { birthday = b; take(p); }
        break;
      }
      case "URL": {
        const u = unescapeValue(val).trim();
        if (webLink(u)) { links.push(u); take(p); if (p.group && groupLabels.has(p.group.toLowerCase())) labelled.add(p.group.toLowerCase()); }
        break;
      }
      case "CATEGORIES": take(p); for (const c of splitEscaped(val, ",").map((x) => unescapeValue(x).trim()).filter(Boolean)) groups.push(c); break;
      case "NOTE": { const n = unescapeValue(val).trim(); if (!summary) { take(p); summary = n; } else if (!n) take(p); break; }
      case "PHOTO": {
        take(p);
        if (photo) { lost = true; break; }
        const data = /^data:([^;,]+);base64,(.+)$/i.exec(val.trim());
        const encs = (p.params.ENCODING ?? []).map((e) => e.toUpperCase());
        const b64 = data ? data[2] : encs.includes("B") || encs.includes("BASE64") ? val : "";
        const mime = data ? data[1].toLowerCase() : `image/${((p.params.TYPE ?? p.params.MEDIATYPE ?? ["jpeg"])[0] ?? "jpeg").toLowerCase().replace(/^image\//, "").replace(/^jpg$/, "jpeg")}`;
        const bytes = b64 ? Buffer.from(b64.replace(/\s+/g, ""), "base64") : null;
        if (bytes && bytes.length && mime.startsWith("image/")) photo = { mime, bytes: new Uint8Array(bytes) };
        else lost = true;
        break;
      }
    }
  }
  // a label goes with the property it names; one left over stays with what it labels, in vcard_extra
  for (const g of labelled) { const l = groupLabels.get(g); if (l) used.add(l); }
  const left = props.filter((p) => !used.has(p));
  if (left.some((p) => p.line.length > LONGEST_EXTRA)) lost = true;
  const extra = left.filter((p) => p.line.length <= LONGEST_EXTRA).map((p) => p.line);

  const pref = emails.find((e) => e.pref);
  const ordered = dedupe([...(pref ? [pref.v] : []), ...emails.map((e) => e.v)]);
  const dedupedPhones = dedupe(phones, (p) => phoneKey(p) || p.toLowerCase());
  const facts: Facts = {
    phones: dedupedPhones,
    email: ordered[0] ?? "",
    emails: ordered.slice(1),
    address,
    birthday,
    links: dedupe(links),
    groups: dedupe(groups),
    summary,
  };
  // the first of these that makes a note name (an FN of dots makes none)
  const name = [fn, nName, org, facts.email, dedupedPhones[0] ? parsePhoneEntry(dedupedPhones[0]).number : ""].map(cleanName).find(Boolean) ?? "";
  return { uid, name, fn, facts, extra, photo, group: props.some(KIND_GROUP), lost };
}

/** The fields a card's facts become on a record: empty facts left out. */
export function factsToFields(f: Facts): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (f.phones.length) out.phones = f.phones;
  if (f.email) out.email = f.email;
  if (f.emails.length) out.emails = f.emails;
  if (f.address) out.address = f.address;
  if (f.birthday) out.birthday = f.birthday;
  if (f.links.length) out.links = f.links;
  if (f.groups.length) out.groups = f.groups;
  if (f.summary) out.summary = f.summary;
  return out;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The change a phone's card makes to a record: its facts REPLACE the record's card facts (a fact emptied on the phone
 *  is removed: `null`), and its extra lines replace `vcard_extra`. Nothing else is named, so every other field and the
 *  body stay as they are. The photo is not here (see the server: the phone's picture is taken only when the record has
 *  none). Empty when nothing changes. */
export function patchFor(fields: Record<string, unknown>, card: PhoneCard): Record<string, unknown> {
  const now = factsOf(fields), want = card.facts;
  const patch: Record<string, unknown> = {};
  // compared as People reads them: a fact the phone left as it was isn't rewritten, whatever shape it is held in
  for (const k of Object.keys(want) as (keyof Facts)[]) {
    const v = want[k];
    if (same(now[k], v)) continue;
    patch[k] = (Array.isArray(v) ? v.length === 0 : v === "") ? null : v;
  }
  // links the card couldn't show (not http/https) were never on the phone: they stay
  if ("links" in patch) {
    const unseen = strList(fields.links).filter((l) => !webLink(l));
    if (unseen.length) patch.links = [...want.links, ...unseen];
  }
  const extraNow = strList(fields.vcard_extra);
  if (!same(extraNow, card.extra)) patch.vcard_extra = card.extra.length ? card.extra : null;
  return patch;
}
