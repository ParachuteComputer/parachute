// No machine words (T-476): every screen a person reaches reads in plain words. A made-up kitchen vault (books, journal
// lines, notes, a record an AI wrote with no title of its own) with the app's own housekeeping beside it (approvals,
// settings, the app's record, a saved view), and the official applets on fakes of their servers (Rooms on the fake relay,
// Mail on a small fake gateway, Calendar on the fake door). The walk visits Home, the vault list, a vault, a type, a
// record and its history, Changes, Sharing, Settings, Rooms, Mail, Journal, Calendar and an applet's Allow card, at a
// phone's width and a computer's, and fails on a ULID, an address with a port, a run of 16 or more hex digits, a
// `Parachute/` path, a raw scope or a piece of a key (`fd3fd141…`, `npub1…`) in any text on screen outside a Details tap (<details>).
// PLAIN_SHOTS=<dir>: also a picture of each screen, light, dark and Daylight (the before and after shots of T-476).
import { createServer } from "node:http";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { account, api, hubState, mintToken, record, VAULT } from "./hub";
import { installApplet } from "./helpers";
import { startCalendar, startRelay } from "./services/servers";
import { appletRecord } from "../applets/record.ts";

test.use({ storageState: "e2e/.signed-in.json", actionTimeout: 10_000 });

/** What a person shouldn't have to read: each with what it is, for the failure. */
const MACHINE: [string, RegExp][] = [
  ["an id (ULID)", /\b0[0-9A-HJKMNP-TV-Z]{25}\b/gi],
  ["an address with a port", /\b(?:localhost|\d{1,3}(?:\.\d{1,3}){3}|(?:[a-z0-9-]+\.)+[a-z]{2,})(?::\d{2,5})\b/gi],
  ["a run of hex", /\b[0-9a-f]{16,}\b/gi],
  ["a Parachute/ path", /(?<![\w.])\.?Parachute\/\S*/gi],
  ["a raw scope", /\bvault:[\w-]+:(?:read|write|admin)\b/gi],
  ["a raw answer (an encoded address, JSON)", /%7B|%22|\{"\w+":/g],
  ["a piece of a key", /\b[0-9a-f]{6,}…|\bnpub1[02-9ac-hj-np-z]{6,}/gi],
];
/** Every machine word in `text`, with a little of what is around it. */
export function machineWords(text: string): string[] {
  const out: string[] = [];
  for (const [what, re] of MACHINE) for (const m of text.matchAll(re)) out.push(`${what}: "${m[0]}" in "…${text.slice(Math.max(0, m.index! - 40), m.index! + m[0].length + 30).replace(/\s+/g, " ")}…"`);
  return out;
}

/** The words on screen in the page and every frame showing in it: text, and what a field holds or offers; not what is
 *  under a Details tap, nor what only a screen reader says. */
async function onScreen(page: Page): Promise<string> {
  const parts: string[] = [];
  for (const f of page.frames()) {
    let shown = true;
    for (let x: typeof f | null = f; x && x !== page.mainFrame(); x = x.parentFrame()) {
      const el = await x.frameElement().catch(() => null);
      if (!el || !(await el.isVisible().catch(() => false))) { shown = false; break; }
    }
    if (!shown) continue;
    parts.push(await f.evaluate(() => {
      const out: string[] = [];
      const seen = (el: Element) => !el.closest("details, script, style, noscript, template, .pa-unseen, .sr-only")
        && (!("checkVisibility" in el) || el.checkVisibility({ opacityProperty: true, visibilityProperty: true }));
      const walk = document.createTreeWalker(document.body ?? document.documentElement, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) { const t = n.nodeValue?.trim(); if (t && n.parentElement && seen(n.parentElement)) out.push(t); }
      for (const i of document.querySelectorAll<HTMLInputElement>("input:not([type=hidden], [type=password]), textarea")) if (seen(i)) out.push(i.value, i.placeholder);
      return out.filter(Boolean).join("\n");
    }).catch(() => ""));
  }
  return parts.join("\n");
}

/** Wait until `text` shows in the page or a frame showing, allowing an applet that asks on the way (its card is the
 *  Allow test's, below). */
async function see(page: Page, text: string | RegExp, tries = 30): Promise<void> {
  for (let i = 0; i < tries; i++) {
    for (const f of page.frames()) {
      const has = await f.evaluate((t) => { /* not innerText: a long list leaves rows far off screen undrawn */ const s = document.body?.textContent ?? ""; return typeof t === "string" ? s.toLowerCase().includes(t.toLowerCase()) : new RegExp(t[0], `${t[1]}i`).test(s); }, typeof text === "string" ? text : [text.source, text.flags] as const).catch(() => false);
      if (!has) continue;
      if (f === page.mainFrame()) return;
      const el = await f.frameElement().catch(() => null);
      if (el && (await el.isVisible().catch(() => false))) return;
    }
    const allow = page.getByRole("button", { name: "Allow", exact: true });
    if (await allow.isVisible().catch(() => false)) await allow.click().catch(() => {});
    // an applet stopped here (another screen took its place): opened again, as a person does
    const open = page.getByRole("button", { name: /^Open (Home|Vault|Journal|Rooms|Mail|Calendar|Habits)$/ }).first();
    if (await open.isVisible().catch(() => false)) await open.click().catch(() => {});
    await page.waitForTimeout(500);
  }
  throw new Error(`"${text}" never showed`);
}

const pad = (n: number) => String(n).padStart(2, "0");
const day = (back: number) => { const d = new Date(Date.now() - back * 86_400_000); return `${d.getFullYear()}/${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const vaultApplet = (page: Page) => page.frameLocator('iframe.applet-frame[title="Vault"]');

/** A mail gateway with one inbox (the Uni app's bridge, as Mail reads it: its session, JMAP reads, no held sends). */
async function fakeMail() {
  const at = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
  const mails = [
    { id: "m1", threadId: "t1", mailboxIds: { inbox: true }, keywords: {}, from: [{ name: "Mira Okafor", email: "mira@example.org" }], to: [{ email: "me@example.org" }], subject: "Friday's reading group", receivedAt: at(2), preview: "Bring the chapter on the mother tree, and bread if you can." },
    { id: "m2", threadId: "t2", mailboxIds: { inbox: true }, keywords: { $seen: true }, from: [{ name: "The lumber yard", email: "orders@yard.example" }], to: [{ email: "me@example.org" }], subject: "Your quote for the shed roof", receivedAt: at(26), preview: "Cedar shakes, 40 square feet, with flashing." },
  ];
  const server = createServer(async (req, res) => {
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-headers", "authorization, content-type");
    if (req.method === "OPTIONS") { res.writeHead(204).end(); return; }
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    const send = (x: unknown) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(x));
    if (req.url?.endsWith("/session")) return send({ account: "a1", primaryAccounts: { "urn:ietf:params:jmap:mail": "a1" }, accounts: { a1: { name: "Me" } }, roles: { a1: "owner" }, operations: { a1: ["mark_seen", "draft.save", "draft.review", "send"] } });
    if (req.url?.endsWith("/op")) return send({ parked: [] });
    const out = (body.calls ?? []).map(([name, , tag]: [string, unknown, string]) => {
      if (name === "Mailbox/get") return [name, { list: [{ id: "inbox", name: "Inbox", role: "inbox", unreadEmails: 1, totalEmails: 2 }, { id: "sent", name: "Sent", role: "sent", unreadEmails: 0, totalEmails: 0 }] }, tag];
      if (name === "Email/query") return [name, { ids: mails.map((m) => m.id) }, tag];
      return [name, { list: mails }, tag];
    });
    send({ methodResponses: out });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${port}/mail/`, close: () => new Promise<void>((r) => server.close(() => r())) };
}

/** Habits, as a cold agent wrote it from the docs: a box to tick on each row, one not done today. */
const HABITS = `import { useState } from "react";
import { Days, List, Page, when } from "parachute";

const START = [["Read", true, 5], ["Stretch", true, 1], ["Water the plants", false, 0], ["Write three lines", true, 2]];
const weeks = (n) => Array.from({ length: 28 }, (_, i) => (i * 7 + n * 3) % 5 < 3 ? 1 : 0);

export default function Habits() {
  const [habits, setHabits] = useState(START);
  const tick = (name) => setHabits((hs) => hs.map((h) => h[0] === name ? [h[0], !h[1], h[2]] : h));
  return (
    <Page kicker={when.date(new Date())} title="Habits">
      <p>{\`\${habits.filter((h) => h[1]).length} of \${habits.length} done today.\`}</p>
      <List label="Habits, the last four weeks" rows={habits.map(([name, done, streak], i) => ({ key: name, title: name, check: done, aside: \`\${streak}-day streak\`,
        meta: <Days inline counts={weeks(i)} />, label: \`\${name}, \${done ? "done today" : "not done today"}\`, onPress: () => tick(name) }))} />
    </Page>
  );
}
`;

type World = { key: string; relay: Awaited<ReturnType<typeof startRelay>>; mail: Awaited<ReturnType<typeof fakeMail>>; cal: Awaited<ReturnType<typeof startCalendar>>;
  ids: Record<string, string>; undo: (() => Promise<unknown>)[];
  /** the hub lists types (0.9 on; 0.8 has none) */
  types: boolean };
let world: World;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  const sk = Uint8Array.from(Buffer.from(hubState().key, "hex")), me = getPublicKey(sk);
  const undo: World["undo"] = [];
  const w = { ...hubState(), token: mintToken(`vault:${VAULT}:write`) };
  const admin = { ...hubState(), token: mintToken(`vault:${VAULT}:admin`) };
  const made = async (path: string, rest: Record<string, unknown>) => { const r = await api(w, "POST", "notes", { path, ...rest }); undo.push(() => api(w, "DELETE", `notes/${r.id}`).catch(() => {})); return r.id as string; };
  // the person's own: books (a type with fields), journal lines, notes, and a record an AI wrote with no title (its path is its id)
  // a hub before types (0.8) has no types to list: nothing is made, so nothing is taken away
  const listed: { name: string }[] | null = await api(admin, "GET", "types").catch(() => null);
  const hadBook = !listed || listed.some((x) => x.name === "book");
  await api(admin, "PUT", "types/book", { fields: { author: { type: "string" }, status: { type: "string", enum: ["reading", "want", "done"] } } }).catch(() => {});
  const ids: Record<string, string> = {};
  if (!hadBook) undo.push(() => api(admin, "DELETE", "types/book").catch(() => {}));
  for (const [t, a, s] of [["The Overstory", "Richard Powers", "reading"], ["A Pattern Language", "Christopher Alexander", "want"], ["Gilead", "Marilynne Robinson", "done"]]) {
    const r = await record(w, "create", { path: `Books/${t}`, body: "", tags: ["book"], fields: { author: a, status: s } });
    undo.push(() => api(w, "DELETE", `notes/${r.id}`).catch(() => {}));
  }
  for (const [back, hm, text] of [[0, "07-10", "Tea on the step, frost on the bean rows."], [1, "21-05", "Finished the seed order: rye, late kale, the striped beans."], [3, "19-30", "Fixed the gate latch at last."]] as const)
    await made(`Journal/${day(back)}/${hm} ${text.split(" ").slice(0, 4).join(" ").replace(/[.,:]/g, "")}`, { content: text, tags: ["journal"] });
  ids.roof = await made("Notes/Shed roof", { content: "# Shed roof\n\nCorrugated or cedar shakes? Ask at the yard.\n\n- measure the span\n- order flashing" });
  await made("Notes/Garden plan", { content: "Beans by the fence, squash where the compost was." });
  ids.untitled = await made("Inbox/01KQ7Z3V9M4T2B8XJ6R5N1C0HD", { content: "Call the roofer about the flashing before the rain comes." });
  // the app's own: approvals, the settings note, an app record, a saved view (as the app writes them)
  const host = new URL(hubState().origin).host;
  for (const ulid of ["01KQ7Z4A1B2C3D4E5F6G7H8J9K", "01KQ7Z4A1B2C3D4E5F6G7H8J9M"]) await made(`Parachute/Approvals/${host}/${VAULT}/${ulid}`, { content: "{}", tags: ["parachute-approval"], metadata: { approval: { v: 1 } } });
  await made("Parachute/Views/book/Reading now", { content: "", tags: ["parachute-view"], metadata: { view: { contract: 1, layout: "list", sort: null, where: [{ field: "status", op: "eq", value: "reading" }], group: null } } });
  await made("Parachute/Receipts/kitchen", { content: "", tags: ["parachute-receipt"] });
  // the person's own theme (the look they have now, kept in the home): Settings says where it is kept
  if (!((await api(w, "GET", "notes?tag=parachute-theme")) as unknown[]).length) await made("Parachute/Theme", { content: "", tags: ["parachute-theme"], metadata: { theme: { look: "paper" } } });
  // someone the vault is shared with by their key alone (no name): Sharing shows them without the key
  const friend = getPublicKey(generateSecretKey());
  await account(hubState(), "grant-access", { pubkey: friend, vault: VAULT, role: "read" });
  undo.push(() => account(hubState(), "revoke-access", { pubkey: friend, vault: VAULT }).catch(() => {}));
  // the official applets' servers: a relay with three rooms (one person named, one not), a mail gateway, a calendar door
  const relay = await startRelay();
  const hostKey = generateSecretKey(), mira = generateSecretKey(), stranger = generateSecretKey(), now = Math.floor(Date.now() / 1000);
  relay.events.push(finalizeEvent({ kind: 0, created_at: now - 9000, content: JSON.stringify({ name: "Mira" }), tags: [] }, mira));
  const rooms = [["Garden", ["The beans are up along the fence.", "Frost tonight: cover the kale?"]], ["Reading group", ["Friday at six, at Mira's.", "I'll bring bread."]], ["Kitchen", ["Rye starter is lively this week."]]] as const;
  for (const [i, [name, lines]] of rooms.entries()) {
    const id = crypto.randomUUID();
    if (i === 0) ids.room = id;
    relay.events.push(finalizeEvent({ kind: 39002, created_at: now - 8000, content: "", tags: [["d", id], ["p", me], ["p", getPublicKey(mira)], ["p", getPublicKey(stranger)]] }, hostKey));
    relay.events.push(finalizeEvent({ kind: 39000, created_at: now - 8000, content: "", tags: [["d", id], ["name", name]] }, hostKey));
    lines.forEach((l, k) => relay.events.push(finalizeEvent({ kind: 9, created_at: now - 3000 + i * 100 + k, content: l, tags: [["h", id]] }, k % 2 ? stranger : mira)));
  }
  const mail = await fakeMail();
  const cal = await startCalendar(me);
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(10, 0, 0, 0);
  void cal; // events go in through the door's own op below
  const rec = async (r: Record<string, unknown>) => { const x = await record(hubState(), "create", r); undo.push(() => api(hubState(), "DELETE", `notes/${x.id}`).catch(() => {})); return x.id as string; };
  for (const [name, vars] of [["rooms", { relay: relay.url, uni: getPublicKey(generateSecretKey()) }], ["mail", { mail: mail.url }]] as const) {
    const m = await installApplet(name, vars);
    ids[name] = m.id;
    undo.push(m.remove);
  }
  ids.calendar = await rec(appletRecord("calendar", { calendar: `${cal.origin}/cal/v1/` }));
  ids.habits = await rec({ path: "Applets/Habits", extension: "tsx", tags: ["applet"], body: HABITS, fields: { applet: { contract: 2, id: "habits", name: "Habits", glyph: "✓", note: "tick what you did today", access: [] } } });
  world = { key: hubState().key, relay, mail, cal, ids, undo, types: !!listed };
  // one event tomorrow, put in as the owner (the door's own op, signed)
  const { createHash, randomBytes } = await import("node:crypto");
  const url = `${cal.origin}/cal/v1/op`, raw = JSON.stringify({ op: "create", opId: "seed-1", fields: { title: "Seed swap at the library", start: tomorrow.toISOString(), end: new Date(tomorrow.getTime() + 3_600_000).toISOString(), location: "The library" } });
  const ev = finalizeEvent({ kind: 27235, created_at: Math.floor(Date.now() / 1000), content: "", tags: [["u", url], ["method", "POST"], ["nonce", randomBytes(8).toString("hex")], ["payload", createHash("sha256").update(raw).digest("hex")]] }, sk);
  await fetch(url, { method: "POST", headers: { authorization: `Nostr ${Buffer.from(JSON.stringify(ev)).toString("base64")}`, "content-type": "application/json" }, body: raw });
});

test.afterAll(async () => {
  for (const u of (world?.undo ?? []).reverse()) await u();
  await world?.relay.close(); await world?.mail.close(); await world?.cal.close?.();
});

type Stop = { name: string; go: (page: Page) => Promise<void> };
const official = (name: string, q = "") => `/v/${VAULT}/a/${encodeURIComponent(`parachute:${name}`)}${q}`;
const STOPS: Stop[] = [
  { name: "home", go: async (p) => { await p.goto(official("home")); await see(p, "Lately"); } },
  { name: "applets", go: async (p) => { await p.goto("/"); await see(p, "Applets"); await p.waitForTimeout(1500); } },
  // Vault reaches the home until more is ticked (docs/ACCESS.md proposal 5): the person ticks letters and pantry on
  // its sheet, from its menu (whatever an earlier walk picked: this device has the key, so picks are signed and stay)
  { name: "vault's vaults", go: async (p) => { await p.goto(official("vault"));
    await p.locator("header.bar").getByRole("button", { name: "Menu" }).click();
    await p.getByRole("button", { name: "Vaults it reaches" }).click();
    const sheet = p.getByRole("dialog", { name: /^Vaults Vault reaches$|^Which vaults may Vault reach\?$/ });
    for (const v of ["letters", "pantry"]) await sheet.getByRole("checkbox", { name: new RegExp(`^${v}\\b`) }).check();
    await p.waitForTimeout(800);
    await sheet.getByRole("button", { name: "Save" }).click();
    await sheet.waitFor({ state: "detached" });
    await see(p, "letters"); } },
  // Vault opens where it was left (a vault, its Sharing): back, as a person goes, to the list of vaults
  { name: "vault list", go: async (p) => { await p.goto(official("vault")); await see(p, /Your vaults|Types|Sharing|Changes|History/);
    for (let i = 0; i < 4 && !(await vaultApplet(p).getByRole("button", { name: /^letters/ }).first().isVisible().catch(() => false)); i++) {
      await vaultApplet(p).getByRole("button", { name: /^← |Your vaults/ }).first().click({ timeout: 4000 }).catch(() => {});
      await p.waitForTimeout(600);
    }
    await see(p, "letters"); } },
  { name: "vault", go: async (p) => { await vaultApplet(p).getByRole("button", { name: new RegExp(`^${VAULT}`) }).first().click(); await see(p, "Lately"); } },
  // the app's own records: out of Lately, a tap away under Parachute's own, by plain names
  { name: "parachute's own", go: async (p) => { await vaultApplet(p).getByRole("button", { name: "Parachute's own" }).click(); await see(p, "Approval"); await expect(vaultApplet(p).getByRole("region", { name: "Parachute's own" })).toContainText("Approval"); } },
  { name: "vault, Lately again", go: async (p) => { await vaultApplet(p).getByRole("button", { name: "Parachute's own" }).click(); await see(p, "Lately"); await expect(vaultApplet(p).getByRole("region", { name: "Lately" })).not.toContainText("Approval"); } },
  { name: "vault search", go: async (p) => { await vaultApplet(p).getByRole("searchbox").first().fill("roof"); await see(p, "Found"); } },
  { name: "type", go: async (p) => { if (!world.types) return; await vaultApplet(p).getByRole("searchbox").first().fill(""); await vaultApplet(p).locator('[data-type="book"]').click(); await see(p, "The Overstory"); } },
  { name: "record and its history", go: async (p) => { await p.goto(official("vault", `?vault=${VAULT}&record=${world.ids.untitled}`)); await see(p, "History"); } },
  { name: "changes", go: async (p) => { await p.goto(official("vault", `?vault=${VAULT}&show=changes`)); await see(p, /Changes/); await p.waitForTimeout(1500); } },
  { name: "sharing", go: async (p) => { await p.goto(official("vault", `?vault=${VAULT}&show=sharing`)); await see(p, "Sharing"); await p.waitForTimeout(2500); } },
  { name: "the app's vault view", go: async (p) => { await p.goto(`/v/${VAULT}?with=vault`); await see(p, "Applets"); } },
  { name: "the app's record", go: async (p) => { await p.goto(`/v/${VAULT}/n/${world.ids.untitled}?with=vault`); await see(p, "roofer"); } },
  { name: "settings", go: async (p) => { await p.goto("/settings"); await see(p, /approved code only|run sealed/); } },
  { name: "journal", go: async (p) => { await p.goto(official("journal")); await see(p, "gate latch"); } },
  { name: "rooms", go: async (p) => { await p.goto(`/v/${VAULT}/a/${world.ids.rooms}`); await see(p, "Reading group"); } },
  { name: "a room", go: async (p) => { await p.frameLocator("iframe.applet-frame").getByRole("button", { name: /Garden/ }).first().click(); await see(p, "cover the kale"); } },
  { name: "mail", go: async (p) => { await p.goto(`/v/${VAULT}/a/${world.ids.mail}`); await see(p, "shed roof"); } },
  { name: "calendar", go: async (p) => { await p.goto(`/v/${VAULT}/a/${world.ids.calendar}`); await see(p, "Seed swap"); } },
  { name: "habits", go: async (p) => { await p.goto(`/v/${VAULT}/a/${world.ids.habits}`); await see(p, "Water the plants"); } },
];

const SHOTS = process.env.PLAIN_SHOTS;
const SIZES = { phone: { width: 390, height: 844 }, computer: { width: 1440, height: 900 } } as const;

/** Every stop at one width in one look, in the page given. */
async function walk(page: Page, size: keyof typeof SIZES, look: "light" | "dark" | "daylight", found: string[]) {
  await page.setViewportSize(SIZES[size]);
  await page.emulateMedia({ colorScheme: look === "dark" ? "dark" : "light" });
  await page.goto("/settings");
  await page.getByRole("radio", { name: look === "daylight" ? /^Daylight/ : "As the theme" }).check();
  for (const s of STOPS) {
    try { await s.go(page); } catch (e) { found.push(`${size} · ${s.name}: didn't open (${String(e).split("\n")[0].slice(0, 160)})`); }
    for (const w of machineWords(await onScreen(page))) found.push(`${size} · ${s.name}: ${w}`);
    if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: join(SHOTS, `${s.name.replace(/\W+/g, "-")}-${size}-${look}.png`), fullPage: false }); }
  }
}

// The one address the card's face keeps whole: where the applet's requests go is what is being granted (src/applet/face.ts
// holds every stressed fact on the face, the port too; a server on its default port shows none). Everything else on the
// card is plain words: the vault by its name, its hub out of the sentence.
test("the Allow card says what an applet asks for in plain words", async ({ page }) => {
  const m = await installApplet("mail", { mail: world.mail.url }, (r) => ({ ...r, path: "Applets/Post office" }));
  try {
    await page.goto(`/v/${VAULT}/a/${m.id}`);
    await expect(page.getByRole("button", { name: "Allow", exact: true })).toBeVisible({ timeout: 20_000 });
    if (SHOTS) await page.screenshot({ path: join(SHOTS, "allow-card-phone-light.png") });
    const granted = new URL(world.mail.url).host;
    expect(machineWords(await onScreen(page)).filter((w) => !w.includes(`"${granted}"`))).toEqual([]);
  } finally { await m.remove(); }
});

test("a box not ticked is the same circle as a ticked one, empty, and every row's title lines up", async ({ page }) => {
  await page.goto(`/v/${VAULT}/a/${world.ids.habits}`);
  await see(page, "Water the plants");
  const f = page.frameLocator("iframe.applet-frame");
  const marks = f.locator(".pa-row .pa-row-mark");
  await expect(marks).toHaveCount(4);
  const boxes = await marks.evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.left), text: (e.textContent ?? "").replace(/\ufe0e/g, "").trim() }; }));
  expect(boxes.map((b) => b.text)).toEqual(["✓", "✓", "", "✓"]);
  expect(new Set(boxes.map((b) => `${b.w}x${b.h}@${b.x}`)).size, JSON.stringify(boxes)).toBe(1);
  expect(boxes[0].w).toBeGreaterThan(20);
  const titles = await f.locator(".pa-row .pa-row-title").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().left)));
  expect(new Set(titles).size).toBe(1);
  // a screen reader hears whether each is ticked; a tap ticks it
  const water = f.getByRole("button", { name: /^Water the plants/ });
  await expect(water).toHaveAttribute("aria-pressed", "false");
  await water.click();
  await expect(water).toHaveAttribute("aria-pressed", "true");
  await expect(water.locator(".pa-row-mark")).toHaveText(/✓/);
});

// last in the file: on an older hub the walk reaches what it refuses, and the app signs in again (playwright.config.ts)
// One page for both widths (and every look): the walk is long enough for the app to refresh its sign-in, and a second
// page started from the saved sign-in would then hold one the hub has retired.
test("no machine words on any screen, at a phone's width and a computer's", async ({ page }) => {
  test.setTimeout(SHOTS ? 1_500_000 : 480_000);
  page.setDefaultTimeout(10_000);
  await page.addInitScript((k) => { if (window === window.top) (window as unknown as { __parachuteE2EKey: string }).__parachuteE2EKey = k; }, world.key);
  const found: string[] = [];
  for (const size of Object.keys(SIZES) as (keyof typeof SIZES)[])
    for (const look of SHOTS ? (["light", "dark", "daylight"] as const) : (["light"] as const)) await walk(page, size, look, found);
  if (process.env.PLAIN_REPORT) appendFileSync(process.env.PLAIN_REPORT, [...new Set(found)].join("\n") + "\n");
  expect([...new Set(found)], "machine words on screen").toEqual([]);
});
