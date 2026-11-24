// Reading real-world mail in Mail (applets/mail.tsx): HTML mail drawn as HTML, safely. Each message in
// e2e/fixtures/mail (made up, shaped like what Apple, Google, Stripe and Substack send: <style> blocks, layout tables,
// buttons that are links, remote pictures, tracking pixels, inline cid: pictures, quoted replies, a hostile one) is put
// straight into alice's Inbox on the stack's own Stalwart, as it would arrive, and read in the app the way a person
// does: no CSS or markup shows as text, every link is a link that opens its own address, the words come in the order the
// sender laid them out, pictures from the web wait for "Show pictures" (and tracking pixels never load), inline ones
// show at once, and nothing in a mail runs or covers the app. Needs the mail stack (e2e/services/README.md): MAIL_BRIDGE,
// BUZZ_KEYS, and STALWART with MAIL_SECRETS (up.sh writes them).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type FrameLocator, type Locator, type Page } from "@playwright/test";
import { api, hubState, record, VAULT } from "./hub";
import { ui } from "./helpers";
import { corsProxy, importMail } from "./services/client";
import { appletRecord } from "../applets/record.ts";

const BRIDGE = process.env.MAIL_BRIDGE, KEYS = process.env.BUZZ_KEYS ?? "", STALWART = process.env.STALWART, SECRETS = process.env.MAIL_SECRETS;
test.skip(!BRIDGE || !KEYS || !STALWART || !SECRETS, "needs the mail stack (MAIL_BRIDGE, BUZZ_KEYS, STALWART, MAIL_SECRETS): e2e/services/README.md");
test.use({ storageState: "e2e/.signed-in.json" });

const FIX = join(import.meta.dirname, "fixtures", "mail");
const stamp = Date.now().toString(36);
/** The fixture's subject, made this run's own (so a second run's messages are told apart). */
const subjectOf = (file: string) => `${/^Subject: (.*)$/m.exec(readFileSync(join(FIX, file), "utf8"))![1]} ${stamp}`;
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGNgYGD4z8DAwMDAAAAPAAHkJ8pVAAAAAElFTkSuQmCC", "base64");

test.beforeAll(async () => {
  const pw = readFileSync(join(SECRETS!, "alice.pw"), "utf8").trim();
  for (const f of ["apple-invite", "google-invite", "stripe-receipt", "substack-newsletter", "calendar-invite", "forwarded-thread", "plain-only", "cid-images", "hostile"]) {
    const mime = readFileSync(join(FIX, `${f}.eml`), "utf8").replace(/^Subject: (.*)$/m, `Subject: $1 ${stamp}`).replace(/\r?\n/g, "\r\n");
    await importMail(STALWART!, "alice@test.test", pw, Buffer.from(mime));
  }
});

/** Everything a person sees in it as words, the shadow roots' too (a mail's HTML is drawn in one), in document order:
 *  only text whose element is rendered (not display:none, not hidden). */
const shown = (l: Locator) => l.evaluate((root) => {
  const walk = (n: Node): string => {
    let out = "";
    for (const c of Array.from(n.childNodes)) {
      if (c.nodeType === Node.TEXT_NODE) {
        // drawn: its element is visible, and it isn't folded away in a closed <details> (but its summary)
        const p = c.parentElement, fold = p?.closest("details");
        if (p && p.checkVisibility({ visibilityProperty: true, opacityProperty: true }) && !(fold && !fold.open && !p.closest("summary"))) out += (c as Text).data;
      }
      else if (c instanceof Element) {
        if (c.shadowRoot) out += ` ${walk(c.shadowRoot)} `;
        if (!["STYLE", "SCRIPT", "TEMPLATE", "NOSCRIPT"].includes(c.tagName)) out += ` ${walk(c)} `;
      }
    }
    return out;
  };
  return walk(root).replace(/\s+/g, " ").trim();
});
/** A message's body: its words without the sender's name and the date above them. */
const bodyIn = (article: Locator) => article.locator(".body");
/** CSS, tags or entities shown as words: what raw HTML drawn as text looks like. */
const RAW = /[{}]|@media|@import|font-family|!important|mso-|<\/?[a-z][a-z0-9]*[\s>/]|&(?:nbsp|amp|lt|gt|quot);/i;
const inOrder = (text: string, words: string[]) => { const at = words.map((w) => text.indexOf(w)); expect(at.every((i) => i >= 0), `all of ${JSON.stringify(words)} in: ${text.slice(0, 400)}`).toBe(true); expect(at, "in the sender's order").toEqual([...at].sort((a, b) => a - b)); };

/** Mail opened in the app, alice's key in front, its card allowed; the web addresses the shell fetched are recorded. */
async function openMail(page: Page) {
  const proxy = await corsProxy(BRIDGE!, 19952);
  const secret = readFileSync(join(KEYS, "alice.hex"), "utf8").trim();
  await page.addInitScript((k) => { if (window === window.top) (window as unknown as { __parachuteE2EKey: string }).__parachuteE2EKey = k; }, secret);
  const fetched: string[] = [];
  // the made-up senders' own hosts: any request to one is recorded, and a picture is answered with a small PNG
  await page.context().route(/^https?:\/\/[^/]*example(-apple)?\.test\//, (route) => {
    // a link opened in a new tab is the browser going there, not the mail loading something
    if (!route.request().isNavigationRequest()) fetched.push(route.request().url());
    return route.fulfill({ status: 200, headers: { "content-type": "image/png", "access-control-allow-origin": "*" }, body: PNG });
  });
  if (process.env.MAIL_DEBUG) page.on("console", (m) => console.log(`[console ${m.type()}] ${m.text()}`));
  const dialogs: string[] = [];
  page.on("dialog", (d) => { dialogs.push(d.message()); void d.dismiss(); });
  const note = await record(hubState(), "create", appletRecord("mail", { mail: `${proxy.url}/mail/` }));
  await page.goto(`/v/${VAULT}?with=vault`);
  await ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name: /Mail/ }).click();
  await page.getByRole("button", { name: "Allow" }).click();
  const app = page.frameLocator("iframe.applet-frame");
  const inbox = app.getByRole("region", { name: "Inbox" });
  await expect(inbox.getByRole("button", { name: new RegExp(subjectOf("plain-only.eml").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) })).toBeVisible({ timeout: 30_000 });
  const read = async (file: string) => {
    const subject = subjectOf(file);
    await inbox.getByRole("button", { name: new RegExp(subject.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).click();
    const article = app.getByRole("article", { name: subject });
    await expect(article).toBeVisible();
    return article;
  };
  const back = async () => { await app.getByRole("button", { name: "← Mail" }).click(); await expect(inbox).toBeVisible(); };
  const done = async () => { await proxy.close(); await api(hubState(), "DELETE", `notes/${note.id}`); };
  return { app, inbox, read, back, done, fetched, dialogs };
}

/** A tap on the link opens its own address in the browser (the shell's open-link: a new tab in the web build). */
async function opens(page: Page, app: FrameLocator | Locator, name: string | RegExp, href: string) {
  const link = app.getByRole("link", { name });
  await expect(link).toBeVisible();
  // the shell opens one link a second (applet/files.ts LINK_GAP_MS); a person's taps are further apart than a test's
  await page.waitForTimeout(1100);
  const tab = page.context().waitForEvent("page");
  await link.click();
  const opened = await tab;
  expect(opened.url()).toBe(href);
  await opened.close();
}

test("an Apple invite with no plain text is drawn as HTML: no CSS shows, Accept is a button that opens, pictures wait, the pixel never loads", async ({ page }) => {
  test.setTimeout(120_000);
  const m = await openMail(page);
  try {
    const a = await m.read("apple-invite.eml");
    await expect(a.getByText("Garden Supper", { exact: true })).toBeVisible();
    const text = await shown(bodyIn(a));
    expect(text).not.toMatch(RAW);
    inOrder(text, ["Garden Supper", "Saturday, 28 November", "Bring a dish to share", "Accept Invitation", "Can't make it", "View in Apple Invites", "Apple Invites"]);
    // the hidden preheader stays hidden
    expect(text).not.toContain("Maya invited you. Saturday");
    await opens(page, a, "Accept Invitation", "https://invites.example-apple.test/rsvp/7f3a9?answer=accept");
    // nothing from the web until Show pictures; then the header picture, and never the 1×1 pixel
    expect(m.fetched).toEqual([]);
    await expect(a.getByRole("img", { name: "A long table set in a garden at dusk" })).toHaveCount(0);
    await m.app.getByRole("button", { name: "Show pictures" }).click();
    const hero = a.getByRole("img", { name: "A long table set in a garden at dusk" });
    await expect(hero).toBeVisible();
    expect(await hero.evaluate((i: HTMLImageElement) => i.src.startsWith("blob:") && i.naturalWidth > 0)).toBe(true);
    expect(m.fetched).toContain("https://invites.example-apple.test/img/header-garden.jpg");
    expect(m.fetched.filter((u) => u.includes("/o/7f3a9.gif"))).toEqual([]);
    // the sender is remembered: the next open shows them at once
    await m.back();
    const again = await m.read("apple-invite.eml");
    await expect(again.getByRole("img", { name: "A long table set in a garden at dusk" })).toBeVisible();
    await expect(m.app.getByRole("button", { name: "Show pictures" })).toHaveCount(0);
    expect(m.dialogs).toEqual([]);
  } finally { await m.done(); }
});

test("a Stripe receipt, a Substack newsletter and a Google invite: words in order, every link opens, CSS and @import never load or show", async ({ page }) => {
  test.setTimeout(150_000);
  const m = await openMail(page);
  try {
    const r = await m.read("stripe-receipt.eml");
    let text = await shown(bodyIn(r));
    expect(text).not.toMatch(RAW);
    inOrder(text, ["Receipt from Fern & Fig Nursery", "Receipt #2291-4471", "Amount paid", "$42.50", "Basil seedlings × 6", "$18.00", "Terracotta pot (large)", "our help page", "Download receipt"]);
    await opens(page, r, "our help page", "https://fernandfig.example.test/help");
    await opens(page, r, "Download receipt", "https://pay.stripe.example.test/receipts/acct_1Q9/rcpt_2291/pdf");
    await m.back();

    const n = await m.read("substack-newsletter.eml");
    text = await shown(bodyIn(n));
    expect(text).not.toMatch(RAW);
    inOrder(text, ["View in browser", "Winter sowing, and why it works", "Milk jugs, a sharp knife, and patience", "Here is the method I use every January", "The cold does the work", "Patience is the main ingredient", "Leave a comment", "Unsubscribe"]);
    await opens(page, n, "Leave a comment", "https://substack.example.test/redirect/3/eyJlIjoiaHR0cHM6Ly9zbG93Z2FyZGVuL2NvbW1lbnRzIn0");
    await opens(page, n, "Unsubscribe", "https://slowgarden.substack.example.test/action/disable_email?token=abc");
    expect(m.fetched).toEqual([]);
    await m.app.getByRole("button", { name: "Show pictures" }).click();
    await expect(n.getByRole("img", { name: "Milk jugs lined up on snow" })).toBeVisible();
    // the hero's CSS background loads with the pictures; the open-tracking pixel and the @import'ed font never do
    await expect.poll(() => m.fetched.some((u) => u.endsWith("/hero-bg.png"))).toBe(true);
    expect(m.fetched.filter((u) => u.includes("eotrx.") || u.includes("fonts.example.test"))).toEqual([]);
    await m.back();

    const g = await m.read("google-invite.eml");
    text = await shown(bodyIn(g));
    expect(text).not.toMatch(RAW);
    inOrder(text, ["Seed swap planning", "When", "Tuesday 1 Dec 2026", "Join with Google Meet", "Going (alice@test.test)?", "Yes", "No", "Maybe", "more options"]);
    await opens(page, g, "Join with Google Meet", "https://meet.example.test/abc-defg-hij");
    await opens(page, g, "Yes", "https://calendar.example.test/calendar/event?action=RESPOND&eid=X1&rst=1");
    await expect(m.app.getByRole("button", { name: /Save invite\.ics/ })).toBeVisible();
    expect(m.dialogs).toEqual([]);
  } finally { await m.done(); }
});

test("plain text and a forwarded thread: links are links, long lines wrap, quoted replies fold away until asked", async ({ page }) => {
  test.setTimeout(120_000);
  const m = await openMail(page);
  try {
    const p = await m.read("plain-only.eml");
    await opens(page, p, "https://trails.example.test/notes/mesa-loop?ref=ruth", "https://trails.example.test/notes/mesa-loop?ref=ruth");
    // the long address wraps inside the screen
    const wide = await p.evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
    expect(wide).toBe(true);
    let text = await shown(bodyIn(p));
    inOrder(text, ["Yes, Saturday works", "I'll bring the long thermos", "Ruth"]);
    expect(text).not.toContain("Does Saturday still work for the mesa loop?");
    await p.getByText("Quoted text").click();
    await expect(p.getByText("Does Saturday still work for the mesa loop?")).toBeVisible();
    await m.back();

    const f = await m.read("forwarded-thread.eml");
    text = await shown(bodyIn(f));
    expect(text).not.toMatch(RAW);
    inOrder(text, ["Alice, see below. Can you take this one?", "Forwarded message", "Dan Ortiz", "The shutoff is behind the shed"]);
    // the forwarded message is what was sent, so it shows; the reply it quotes folds
    expect(text).not.toContain("the line to plot 14 froze again");
    // a mail address is a link too (the browser hands mailto: to the mail program, so no tab opens to check)
    await expect(f.getByRole("link", { name: "dan@ortiz.example.test" })).toHaveAttribute("href", "mailto:dan@ortiz.example.test");
    await m.back();

    const c = await m.read("calendar-invite.eml");
    inOrder(await shown(bodyIn(c)), ["Jordan Lee has invited you to Compost workday", "Bring gloves"]);
    await expect(m.app.getByRole("button", { name: /Save Compost workday\.ics/ })).toBeVisible();
  } finally { await m.done(); }
});

test("inline cid: pictures show at once, from the message itself; they aren't listed again as files", async ({ page }) => {
  test.setTimeout(90_000);
  const m = await openMail(page);
  try {
    const c = await m.read("cid-images.eml");
    const bin = c.getByRole("img", { name: "A bin of winter squash" });
    await expect(bin).toBeVisible();
    expect(await bin.evaluate((i: HTMLImageElement) => i.src.startsWith("blob:") && i.naturalWidth === 120)).toBe(true);
    await expect(c.getByRole("img", { name: "Oak Street Co-op" })).toBeVisible();
    await expect(m.app.getByRole("button", { name: "Show pictures" })).toHaveCount(0);
    await expect(m.app.getByRole("button", { name: /Save (logo|squash)\.png/ })).toHaveCount(0);
    await opens(page, c, "Hours and directions", "https://oakstreet.example.test/hours");
    expect(m.fetched).toEqual([]);
  } finally { await m.done(); }
});

test("a hostile mail runs nothing, loads nothing, can't cover the app, and only its real link opens", async ({ page }) => {
  test.setTimeout(90_000);
  const m = await openMail(page);
  try {
    const h = await m.read("hostile.eml");
    await expect(h.getByText("Please confirm your details.")).toBeVisible();
    // nothing of its own runs or reaches out: no script, frame, form or handler anywhere in Mail's frame
    const found = await m.app.locator("body").evaluate((b) => {
      const all: Element[] = [];
      const walk = (r: ParentNode) => { for (const e of Array.from(r.querySelectorAll("*"))) { all.push(e); if (e.shadowRoot) walk(e.shadowRoot); } };
      walk(b);
      const mail = all.filter((e) => e.closest("[data-pa-mail]") || (e.getRootNode() as ShadowRoot).host?.matches?.("[data-pa-mail]"));
      return {
        bad: mail.filter((e) => /^(script|iframe|object|embed|form|input|button|textarea|select|link|meta|base|video|audio|svg|math|template|noscript)$/i.test(e.tagName)).map((e) => e.tagName),
        handlers: mail.flatMap((e) => Array.from(e.attributes).filter((a) => /^on/i.test(a.name)).map((a) => `${e.tagName}.${a.name}`)),
        hrefs: mail.filter((e) => e.hasAttribute("href")).map((e) => e.getAttribute("href")),
        mailNodes: mail.length,
      };
    });
    expect(found.mailNodes).toBeGreaterThan(5);
    expect(found.bad).toEqual([]);
    expect(found.handlers).toEqual([]);
    expect(found.hrefs).toEqual(["https://hostile.example.test/confirm"]);
    for (const name of ["Confirm with JavaScript", "Confirm with data", "Confirm with vbscript"]) await expect(h.getByRole("link", { name })).toHaveCount(0);
    await opens(page, h, "Confirm here", "https://hostile.example.test/confirm");
    // its full-screen "cover" stays inside the message: the app's own Reply is still the thing under a tap
    await m.app.getByRole("button", { name: "Reply" }).click({ trial: true });
    // even with pictures shown, its stylesheet, @import, font and frames never load; nothing ran
    await m.app.getByRole("button", { name: "Show pictures" }).click();
    await expect.poll(() => m.fetched.some((u) => u.endsWith("/pic.png"))).toBe(true);
    expect(m.fetched.filter((u) => /style\.css|imported\.css|font\.woff|\/frame|\/obj|\/embed|v\.mp4|poster|pic2x|landing/.test(u))).toEqual([]);
    expect(m.dialogs).toEqual([]);
    expect(await page.evaluate(() => (window as unknown as { hijack?: unknown }).hijack)).toBeUndefined();
  } finally { await m.done(); }
});
