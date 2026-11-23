// The CardDAV server: one address book, "People", over the vault's People/ folder (README.md).
//
//   /.well-known/carddav           301 → /dav/ (the only answer without a device password)
//   /, /dav/                       current-user-principal, addressbook-home-set
//   /dav/principal/                the device's principal: addressbook-home-set
//   /dav/addressbooks/             the home set: one collection
//   /dav/addressbooks/people/      the address book: getctag, supported-report-set (addressbook-multiget)
//   /dav/addressbooks/people/<name>.vcf   a person's card: GET, PUT, DELETE
//
// No sync-collection: DAVx5 then compares getctag, lists the book with PROPFIND Depth 1 (getetag) and fetches what
// changed with addressbook-multiget (davx5-ose core/…/sync/ContactsSyncManager.kt, resource/remote/CardDavCollection.kt).
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import { cardText, etagOf, factsToFields, patchFor, photoType, readPhoneCard, resourceOf, type Person, type PhoneCard } from "./card.ts";
import { deviceChecker } from "./devices.ts";
import { Conflict, VaultError, type Vault } from "./vault.ts";
import { CARDDAV, CS, DAV, child, children, esc, parseXml, type El } from "./xml.ts";

export type BridgeOptions = {
  vault: Vault;
  /** The folder served, ending in `/` (default `People/`). */
  folder?: string;
  /** The devices file (devices.ts). */
  devices: string;
  /** The type a person made on the phone gets (default `person`, People's own). */
  type?: string;
  /** The largest photo served, in bytes (default 5 MB). */
  photoMax?: number;
  log?: (line: string) => void;
};

const PRINCIPAL = "/dav/principal/";
const HOME = "/dav/addressbooks/";
const BOOK = "/dav/addressbooks/people/";
const BODY_MAX = 12 * 1024 * 1024;
const NAME = /^[A-Za-z0-9._@~+-]{1,200}$/;

type Target = { k: "root" } | { k: "principal" } | { k: "home" } | { k: "book" } | { k: "card"; name: string };

function targetOf(pathname: string): Target | null {
  let p: string;
  try { p = decodeURIComponent(pathname); } catch { return null; }
  const t = p.replace(/\/+$/, "");
  if (t === "" || t === "/dav") return { k: "root" };
  if (t === "/dav/principal") return { k: "principal" };
  if (t === "/dav/addressbooks") return { k: "home" };
  if (t === "/dav/addressbooks/people") return { k: "book" };
  const m = /^\/dav\/addressbooks\/people\/([^/]+)\.vcf$/.exec(p);
  return m && NAME.test(m[1]) ? { k: "card", name: m[1] } : null;
}

const hrefOf = (name: string) => `${BOOK}${encodeURIComponent(name)}.vcf`;
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const strong = (tag: string) => tag.trim().replace(/^W\//, "");
const matches = (header: string, etag: string) => header.trim() === "*" || header.split(",").some((t) => strong(t) === etag);

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

function readBody(req: IncomingMessage, max = BODY_MAX): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > max) { reject(new HttpError(413, "too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

// ── multistatus ──
const PREFIX: Record<string, string> = { [DAV]: "d", [CARDDAV]: "card", [CS]: "cs" };
type PropName = { ns: string; name: string };
const keyOf = (p: PropName) => `${p.ns} ${p.name}`;
function propXml(p: PropName, inner: string | null) {
  const pre = PREFIX[p.ns];
  const open = pre ? `${pre}:${p.name}` : `x:${p.name} xmlns:x="${esc(p.ns)}"`;
  const close = pre ? `${pre}:${p.name}` : `x:${p.name}`;
  return inner === null || inner === "" ? `<${open}/>` : `<${open}>${inner}</${close}>`;
}
function responseXml(href: string, found: [PropName, string][], missing: PropName[]) {
  let out = `<d:response><d:href>${esc(href)}</d:href>`;
  if (found.length) out += `<d:propstat><d:prop>${found.map(([p, v]) => propXml(p, v)).join("")}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>`;
  if (missing.length) out += `<d:propstat><d:prop>${missing.map((p) => propXml(p, null)).join("")}</d:prop><d:status>HTTP/1.1 404 Not Found</d:status></d:propstat>`;
  return out + "</d:response>";
}
const multistatus = (inner: string) =>
  `<?xml version="1.0" encoding="utf-8"?>\n<d:multistatus xmlns:d="DAV:" xmlns:card="${CARDDAV}" xmlns:cs="${CS}">${inner}</d:multistatus>\n`;

const P = (ns: string, name: string): PropName => ({ ns, name });
/** What an allprop PROPFIND gets (RFC 4918 leaves the set to the server; address-data only when asked). */
const ALLPROP = [P(DAV, "resourcetype"), P(DAV, "displayname"), P(DAV, "getetag"), P(DAV, "getcontenttype"), P(CS, "getctag"), P(DAV, "current-user-principal")];

const PRIVILEGES = ["read", "write", "write-content", "write-properties", "bind", "unbind"].map((p) => `<d:privilege><d:${p}/></d:privilege>`).join("");

export function createBridge(o: BridgeOptions) {
  const folder = o.folder ?? "People/";
  const type = o.type ?? "person";
  const photoMax = o.photoMax ?? 5 * 1024 * 1024;
  const log = o.log ?? ((l: string) => console.log(l));
  const check = deviceChecker(o.devices);
  const vault = o.vault;

  /** Every person in the folder, and which are on the phone (all but `on_phone: false`), by card name. */
  async function members() {
    const all = await vault.list(folder);
    const byName = new Map<string, Person>();
    for (const p of all) if (!byName.has(resourceOf(p))) byName.set(resourceOf(p), p);
    const shown = all.filter((p) => p.fields.on_phone !== false);
    return { all, byName, shown };
  }
  const ctagOf = (shown: Person[]) =>
    `"${createHash("sha256").update(shown.map((p) => `${hrefOf(resourceOf(p))} ${etagOf(p, folder)}`).sort().join("\n")).digest("base64url").slice(0, 27)}"`;

  /** The card as served: its photo inline, read from the record's attachment. */
  async function served(p: Person): Promise<string> {
    const path = str(p.fields.photo);
    const photo = path ? await vault.file(path, photoMax).catch(() => null) : null;
    return cardText(p, folder, photo ? { type: photoType(path), base64: Buffer.from(photo.bytes).toString("base64") } : null);
  }

  /** The properties of one resource, for the names asked; `card` the person when it is a card. */
  async function props(t: Target, asked: PropName[], ctx: { shown?: Person[]; person?: Person }): Promise<[[PropName, string][], PropName[]]> {
    const found: [PropName, string][] = [], missing: PropName[] = [];
    for (const p of asked) {
      const v = await propValue(t, p, ctx);
      if (v === undefined) missing.push(p); else found.push([p, v]);
    }
    return [found, missing];
  }
  async function propValue(t: Target, p: PropName, ctx: { shown?: Person[]; person?: Person }): Promise<string | undefined> {
    const k = keyOf(p);
    if (k === keyOf(P(DAV, "current-user-principal"))) return `<d:href>${PRINCIPAL}</d:href>`;
    if (k === keyOf(P(DAV, "current-user-privilege-set"))) return PRIVILEGES;
    switch (t.k) {
      case "root":
        if (k === keyOf(P(DAV, "resourcetype"))) return "<d:collection/>";
        if (k === keyOf(P(CARDDAV, "addressbook-home-set"))) return `<d:href>${HOME}</d:href>`;
        if (k === keyOf(P(DAV, "principal-URL"))) return `<d:href>${PRINCIPAL}</d:href>`;
        return undefined;
      case "principal":
        if (k === keyOf(P(DAV, "resourcetype"))) return "<d:collection/><d:principal/>";
        if (k === keyOf(P(CARDDAV, "addressbook-home-set"))) return `<d:href>${HOME}</d:href>`;
        if (k === keyOf(P(DAV, "principal-URL"))) return `<d:href>${PRINCIPAL}</d:href>`;
        if (k === keyOf(P(DAV, "displayname"))) return "Parachute";
        return undefined;
      case "home":
        if (k === keyOf(P(DAV, "resourcetype"))) return "<d:collection/>";
        if (k === keyOf(P(DAV, "owner"))) return `<d:href>${PRINCIPAL}</d:href>`;
        return undefined;
      case "book":
        if (k === keyOf(P(DAV, "resourcetype"))) return "<d:collection/><card:addressbook/>";
        if (k === keyOf(P(DAV, "displayname"))) return "People";
        if (k === keyOf(P(CARDDAV, "addressbook-description"))) return "The people in your vault";
        if (k === keyOf(P(DAV, "owner"))) return `<d:href>${PRINCIPAL}</d:href>`;
        if (k === keyOf(P(CS, "getctag"))) return esc(ctagOf(ctx.shown ?? (await members()).shown));
        if (k === keyOf(P(DAV, "supported-report-set"))) return "<d:supported-report><d:report><card:addressbook-multiget/></d:report></d:supported-report>";
        if (k === keyOf(P(CARDDAV, "supported-address-data"))) return `<card:address-data-type content-type="text/vcard" version="3.0"/>`;
        return undefined;
      case "card": {
        const person = ctx.person;
        if (!person) return undefined;
        if (k === keyOf(P(DAV, "resourcetype"))) return "";
        if (k === keyOf(P(DAV, "getetag"))) return esc(etagOf(person, folder));
        if (k === keyOf(P(DAV, "getcontenttype"))) return "text/vcard; charset=utf-8";
        if (k === keyOf(P(CARDDAV, "address-data"))) return esc(await served(person));
        return undefined;
      }
    }
  }

  function askedProps(root: El | null): PropName[] {
    if (!root) return ALLPROP;
    const prop = child(root, DAV, "prop");
    if (prop) return prop.children.map((c) => P(c.ns, c.name));
    return ALLPROP;
  }

  async function propfind(req: IncomingMessage, res: ServerResponse, t: Target) {
    const body = await readBody(req, 1024 * 1024);
    let root: El | null = null;
    if (body.trim()) { try { root = parseXml(body); } catch { throw new HttpError(400, "bad XML"); } }
    if (root && !(root.ns === DAV && root.name === "propfind")) throw new HttpError(400, "not a propfind");
    const asked = askedProps(root);
    const depth = String(req.headers.depth ?? "infinity").toLowerCase() === "0" ? 0 : 1;
    const parts: string[] = [];
    const add = async (href: string, tt: Target, ctx: { shown?: Person[]; person?: Person }) => {
      const [found, missing] = await props(tt, asked, ctx);
      parts.push(responseXml(href, found, missing));
    };
    if (t.k === "card") {
      const { byName } = await members();
      const person = byName.get(t.name);
      if (!person || person.fields.on_phone === false) throw new HttpError(404, "no such card");
      await add(hrefOf(t.name), t, { person });
    } else if (t.k === "book") {
      const { shown } = await members();
      await add(BOOK, t, { shown });
      if (depth) for (const person of shown) await add(hrefOf(resourceOf(person)), { k: "card", name: resourceOf(person) }, { person, shown });
    } else {
      const href = t.k === "root" ? (req.url?.split("?")[0] ?? "/") : t.k === "principal" ? PRINCIPAL : HOME;
      await add(href, t, {});
      if (depth && t.k === "home") await add(BOOK, { k: "book" }, {});
    }
    send(res, 207, multistatus(parts.join("")), { "content-type": "application/xml; charset=utf-8" });
  }

  async function report(req: IncomingMessage, res: ServerResponse, t: Target) {
    const body = await readBody(req, 1024 * 1024);
    let root: El;
    try { root = parseXml(body); } catch { throw new HttpError(400, "bad XML"); }
    if (t.k !== "book" || !(root.ns === CARDDAV && root.name === "addressbook-multiget")) {
      send(res, 403, `<?xml version="1.0" encoding="utf-8"?>\n<d:error xmlns:d="DAV:"><d:supported-report/></d:error>\n`, { "content-type": "application/xml; charset=utf-8" });
      return;
    }
    const asked = askedProps(root);
    const { byName, shown } = await members();
    const parts = await Promise.all(children(root, DAV, "href").map(async (h) => {
      const href = h.text.trim();
      let path = href;
      try { path = new URL(href, "http://x").pathname; } catch { /* as given */ }
      const tt = targetOf(path);
      const person = tt?.k === "card" ? byName.get(tt.name) : undefined;
      if (!tt || tt.k !== "card" || !person || person.fields.on_phone === false) return `<d:response><d:href>${esc(href)}</d:href><d:status>HTTP/1.1 404 Not Found</d:status></d:response>`;
      const [found, missing] = await props(tt, asked, { person, shown });
      return responseXml(href, found, missing);
    }));
    send(res, 207, multistatus(parts.join("")), { "content-type": "application/xml; charset=utf-8" });
  }

  async function get(res: ServerResponse, t: Target, head: boolean) {
    if (t.k !== "card") { send(res, 200, head ? "" : "Parachute People (CardDAV). Add this address in DAVx5.\n", { "content-type": "text/plain; charset=utf-8" }); return; }
    const { byName } = await members();
    const person = byName.get(t.name);
    if (!person || person.fields.on_phone === false) throw new HttpError(404, "no such card");
    const text = await served(person);
    send(res, 200, head ? "" : text, { "content-type": "text/vcard; charset=utf-8", etag: etagOf(person, folder), ...(head ? { "content-length": String(Buffer.byteLength(text)) } : {}) });
  }

  /** Whether the record as now stored is what the phone sent: then the phone's copy is the server's, and the PUT
   *  answers the ETag. Compared as cards (the phone's card put in a record's shape and served the same way), so a
   *  different PRODID, REV or line order doesn't count; a name People kept, a fact it reads differently or a photo it
   *  didn't take does. */
  async function storedAsSent(card: PhoneCard, rec: Person, tookPhoto: boolean): Promise<boolean> {
    const asSent: Person = {
      id: rec.id, path: `${folder}${card.fn || card.name}`, updatedAt: "",
      fields: { ...factsToFields(card.facts), vcard_extra: card.extra, uid: card.uid, href: rec.fields.href },
    };
    if (cardText(asSent, folder, null) !== cardText(rec, folder, null)) return false;
    const held = str(rec.fields.photo);
    if (!card.photo) return !held;
    if (tookPhoto) return true;
    if (!held) return false;
    const file = await vault.file(held, photoMax).catch(() => null);
    return !!file && Buffer.from(file.bytes).equals(Buffer.from(card.photo.bytes));
  }

  /** The phone's picture, taken only when the person has none in the vault (Android sends back its own re-encoded
   *  copy of every photo on each edit, so a picture the vault holds isn't replaced from the phone). */
  async function takePhoto(rec: Person, card: PhoneCard): Promise<[Person, boolean]> {
    if (!card.photo || str(rec.fields.photo)) return [rec, false];
    const path = await vault.attach(rec.id, card.photo.bytes, card.photo.mime);
    const fresh = (await vault.get(rec.id)) ?? rec;
    return [await vault.patch(rec.id, fresh.updatedAt, { photo: path }), true];
  }

  async function put(req: IncomingMessage, res: ServerResponse, t: Target) {
    if (t.k !== "card") throw new HttpError(405, "PUT a card into the address book");
    const ct = String(req.headers["content-type"] ?? "text/vcard").toLowerCase();
    if (!/^text\/(vcard|x-vcard|directory)\b/.test(ct)) throw new HttpError(415, "a vCard (text/vcard)");
    const body = await readBody(req);
    let card: PhoneCard;
    try { card = readPhoneCard(body); } catch (e) { throw new HttpError(400, (e as Error).message); }
    if (card.group) {
      log("a group card came: set DAVx5's contact group method to \"Groups are per-contact categories\"");
      throw new HttpError(403, "People keeps groups on each person (CATEGORIES): set the contact group method to per-contact categories");
    }
    const ifMatch = req.headers["if-match"], ifNoneMatch = req.headers["if-none-match"];
    const { all, byName } = await members();
    const existing = byName.get(t.name);
    const visible = existing && existing.fields.on_phone !== false;
    if (visible) {
      if (ifNoneMatch && String(ifNoneMatch).trim() === "*") throw new HttpError(412, "the card exists");
      if (ifMatch && !matches(String(ifMatch), etagOf(existing, folder))) throw new HttpError(412, "the card changed");
    } else if (ifMatch) throw new HttpError(412, "no such card");

    let rec: Person, created: boolean;
    if (existing) {
      // a phone edit: its facts replace the card facts; a card left off the phone and sent again is back on it
      const patch = patchFor(existing.fields, card);
      if (!visible) patch.on_phone = null;
      rec = Object.keys(patch).length ? await vault.patch(existing.id, existing.updatedAt, patch) : existing;
      created = !visible;
    } else {
      rec = await create(card, t.name, all);
      created = true;
    }
    const [after, took] = await takePhoto(rec, card);
    const same = await storedAsSent(card, after, took);
    send(res, created ? 201 : 204, "", same ? { etag: etagOf(after, folder) } : {});
  }

  /** A new person from the phone: `People/<name>` (` 2`, ` 3`… when taken, as the applet does), its UID kept, and its
   *  file name kept when it isn't the UID, so the card stays at the address the phone gave it. */
  async function create(card: PhoneCard, resource: string, all: Person[]): Promise<Person> {
    const base = card.name || "Unnamed";
    const taken = new Set(all.map((p) => p.path.toLowerCase()));
    const uid = card.uid || resource;
    const fields: Record<string, unknown> = { ...factsToFields(card.facts), status: "active", source: "phone", uid };
    if (resource !== uid) fields.href = resource;
    if (card.extra.length) fields.vcard_extra = card.extra;
    for (let n = 1; n < 50; n++) {
      const path = `${folder}${base}${n > 1 ? ` ${n}` : ""}`;
      if (taken.has(path.toLowerCase())) continue;
      try {
        return await vault.create({ path, body: "## Memories and moments\n\n", fields, types: [type] });
      } catch (e) {
        // a note the bridge can't see holds the path: try the next
        if (e instanceof VaultError && e.status === 409 && !(e instanceof Conflict)) { taken.add(path.toLowerCase()); continue; }
        throw e;
      }
    }
    throw new HttpError(409, "no free name");
  }

  async function del(req: IncomingMessage, res: ServerResponse, t: Target) {
    if (t.k !== "card") throw new HttpError(403, "only a card can be deleted");
    const { byName } = await members();
    const person = byName.get(t.name);
    if (!person || person.fields.on_phone === false) throw new HttpError(404, "no such card");
    const ifMatch = req.headers["if-match"];
    if (ifMatch && !matches(String(ifMatch), etagOf(person, folder))) throw new HttpError(412, "the card changed");
    // the person stays in the vault, off the phone
    await vault.patch(person.id, person.updatedAt, { on_phone: false });
    send(res, 204, "");
  }

  // writes one at a time: two new cards at one name make one person
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => { const run = chain.then(fn, fn); chain = run.catch(() => undefined); return run; };

  function send(res: ServerResponse, status: number, body: string, headers: Record<string, string> = {}) {
    if (res.headersSent) return;
    res.writeHead(status, { "content-length": String(Buffer.byteLength(body)), ...headers });
    res.end(body);
  }

  const server = createServer(async (req, res) => {
    const started = Date.now();
    let user = "-";
    res.on("finish", () => log(`${req.method} ${(req.url ?? "").split("?")[0]} ${res.statusCode} ${Date.now() - started}ms ${user}`));
    try {
      const pathname = new URL(req.url ?? "/", "http://x").pathname;
      if (/^\/\.well-known\/carddav\/?$/.test(pathname)) { send(res, 301, "", { location: "/dav/" }); return; }
      const who = check(req.headers.authorization);
      if (!who) {
        req.resume();
        send(res, 401, "A device name and app password (node src/main.ts add-device <name>)\n", { "www-authenticate": 'Basic realm="Parachute People", charset="UTF-8"', "content-type": "text/plain; charset=utf-8" });
        return;
      }
      user = who;
      const t = targetOf(pathname);
      if (req.method === "OPTIONS") {
        send(res, 200, "", { dav: "1, 3, addressbook", allow: "OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, REPORT" });
        return;
      }
      if (!t) throw new HttpError(404, "not here");
      switch (req.method) {
        case "PROPFIND": await propfind(req, res, t); break;
        case "REPORT": await report(req, res, t); break;
        case "GET": await get(res, t, false); break;
        case "HEAD": await get(res, t, true); break;
        case "PUT": await serial(() => put(req, res, t)); break;
        case "DELETE": await serial(() => del(req, res, t)); break;
        default: throw new HttpError(405, "not allowed");
      }
    } catch (e) {
      if (e instanceof HttpError) send(res, e.status, `${e.message}\n`, { "content-type": "text/plain; charset=utf-8", ...(e.status === 405 ? { allow: "OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, REPORT" } : {}) });
      else if (e instanceof Conflict) send(res, 412, "the person changed in the vault meanwhile\n", { "content-type": "text/plain; charset=utf-8" });
      else {
        log(`error: ${e instanceof VaultError ? e.message : (e as Error)?.stack ?? String(e)}`);
        send(res, 502, "the vault didn't answer as expected\n", { "content-type": "text/plain; charset=utf-8" });
      }
    }
  });
  return server;
}

