// The mail sanitizer (mailClean.ts) over the fixtures e2e/mailread.spec.ts reads in the app (e2e/fixtures/mail: made
// up, shaped like what Apple, Google, Stripe and Substack send, and a hostile one): no CSS or markup left as words,
// every link the sender made kept (and only http, https, mailto), the words in the sender's order, web pictures only
// when shown and tracking pixels never, nothing that runs or loads. scripts/mutate-mail.ts breaks each rule once and
// checks something here goes red.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cleanMail, cleanSheet, lastWalk, splitQuote, webHref, type Pictures } from "./mailClean";

const FIX = join(process.cwd(), "e2e", "fixtures", "mail");

/** The parts of a message (enough MIME for the fixtures: nested multiparts, quoted-printable, base64). */
type Part = { type: string; headers: string; body: string };
function parts(raw: string): Part[] {
  const text = raw.replace(/\r\n/g, "\n");
  const cut = text.indexOf("\n\n");
  const headers = text.slice(0, cut).replace(/\n[ \t]+/g, " "), body = text.slice(cut + 2);
  const type = (/^content-type:\s*([^;\s]+)/im.exec(headers)?.[1] ?? "text/plain").toLowerCase();
  if (type.startsWith("multipart/")) {
    const b = /boundary="?([^";]+)"?/i.exec(headers)![1];
    return body.split(`--${b}`).slice(1).filter((p) => !p.startsWith("--")).flatMap((p) => parts(p.replace(/^\n/, "")));
  }
  const enc = (/^content-transfer-encoding:\s*(\S+)/im.exec(headers)?.[1] ?? "").toLowerCase();
  const decoded = enc === "quoted-printable" ? Buffer.from(body.replace(/=\n/g, "").replace(/=([0-9A-F]{2})/g, (_m, h) => String.fromCharCode(parseInt(h, 16))), "latin1").toString("utf8")
    : enc === "base64" ? Buffer.from(body, "base64").toString("latin1") : body;
  return [{ type, headers, body: decoded }];
}
const fixture = (name: string) => parts(readFileSync(join(FIX, `${name}.eml`), "utf8"));
const htmlOf = (name: string) => fixture(name).find((p) => p.type === "text/html")!.body;
const HIDDEN: Pictures = { show: false };
/** The cleaned root in a document, and its words. */
function drawn(html: string, pictures: Pictures = HIDDEN) {
  const c = cleanMail(html, pictures);
  const host = document.createElement("div");
  host.append(c.root);
  // the words a person sees: not what the sender hid (a preheader, display:none)
  const seen = host.cloneNode(true) as HTMLElement;
  for (const el of seen.querySelectorAll("[style]")) if (/display:\s*none/i.test(el.getAttribute("style")!)) el.remove();
  return { c, host, text: (seen.textContent ?? "").replace(/\s+/g, " ").trim() };
}
const RAW = /[{}]|@media|@import|font-family|!important|mso-|<\/?[a-z][a-z0-9]*[\s>/]|&(?:nbsp|amp|lt|gt|quot);/i;
const inOrder = (text: string, words: string[]) => {
  const at = words.map((w) => text.indexOf(w));
  expect(at.filter((i) => i < 0), `missing from: ${text.slice(0, 300)}`).toEqual([]);
  expect(at).toEqual([...at].sort((a, b) => a - b));
};
/** Every http, https or mailto link the sender wrote, in order. */
const sourceLinks = (html: string) => Array.from(new DOMParser().parseFromString(html, "text/html").querySelectorAll("a[href]")).map((a) => a.getAttribute("href")!.trim()).filter((h) => /^(https?:|mailto:)/i.test(h));
const links = (host: Element) => Array.from(host.querySelectorAll("a[href]")).map((a) => a.getAttribute("href"));

describe("the vendored DOMPurify is the one VENDORED.md names", () => {
  it("its sha256 matches", () => {
    const sum = createHash("sha256").update(readFileSync(join(process.cwd(), "src/kit/vendor/purify.es.mjs"))).digest("hex");
    expect(sum).toBe("5e8c53cd086a012531fc754ee6a7ad7a02e8a06fc4dadd805b912e128c3f6c58");
    expect(readFileSync(join(process.cwd(), "src/kit/vendor/VENDORED.md"), "utf8")).toContain(sum);
  });
});

describe("real-world HTML mail, cleaned", () => {
  const cases: [string, string[]][] = [
    ["apple-invite", ["Garden Supper", "Saturday, 28 November", "Bring a dish to share", "Accept Invitation", "Can't make it", "View in Apple Invites", "Privacy Policy"]],
    ["google-invite", ["Seed swap planning", "When", "Tuesday 1 Dec 2026", "Join with Google Meet", "Going (alice@test.test)?", "Yes", "No", "Maybe", "more options"]],
    ["stripe-receipt", ["Receipt from Fern & Fig Nursery", "Receipt #2291-4471", "Amount paid", "$42.50", "Basil seedlings × 6", "$18.00", "our help page", "Download receipt"]],
    ["substack-newsletter", ["View in browser", "Winter sowing, and why it works", "Milk jugs, a sharp knife", "Here is the method", "The cold does the work", "Patience is the main ingredient", "Leave a comment", "Unsubscribe"]],
    ["forwarded-thread", ["Alice, see below", "Forwarded message", "Dan Ortiz", "The shutoff is behind the shed", "Quoted text", "the line to plot 14 froze again"]],
    ["cid-images", ["This week at the co-op", "Squash is in", "Hours and directions"]],
  ];
  for (const [name, words] of cases) {
    it(`${name}: no CSS or markup as words, the words in order, every link kept, nothing refused`, () => {
      const html = htmlOf(name);
      const { c, host, text } = drawn(html);
      expect(text).not.toMatch(RAW);
      inOrder(text, words);
      expect(links(host)).toEqual(sourceLinks(html));
      for (const a of host.querySelectorAll("a[href]")) expect(a.getAttribute("rel")).toBe("noreferrer");
      expect(host.querySelector("style, script, img[src^='http'], [target]")).toBeNull();
      expect(c.refused).toBe(0);
    });
  }

  it("a preheader the sender hid stays out of what is drawn (it is display:none in the cleaned style)", () => {
    const { host } = drawn(htmlOf("apple-invite"));
    const pre = Array.from(host.querySelectorAll("div")).find((d) => d.textContent?.startsWith("Maya invited you."))!;
    expect(pre.getAttribute("style")).toMatch(/display:\s*none/);
  });

  it("web pictures wait until shown; tracking pixels never come, shown or not", () => {
    for (const [name, pixels] of [["apple-invite", 1], ["stripe-receipt", 1], ["substack-newsletter", 1]] as const) {
      const hiddenAsked: string[] = [];
      const hidden = drawn(htmlOf(name), { show: false, web: (u) => { hiddenAsked.push(u); return "blob:x"; } });
      expect(hiddenAsked).toEqual([]);
      expect(hidden.c.trackers).toBe(pixels);
      expect(hidden.c.hidden).toBeGreaterThan(0);
      expect(hidden.host.querySelector("img[src]")).toBeNull();
      expect(hidden.c.web.some((u) => /\/o\/|\/open\?|eotrx/.test(u))).toBe(false);
      const asked: string[] = [];
      const shown = drawn(htmlOf(name), { show: true, web: (u) => { asked.push(u); return `blob:${u.length}`; } });
      expect(shown.c.trackers).toBe(pixels);
      expect(shown.c.hidden).toBe(0);
      expect(asked.some((u) => /\/o\/|\/open\?|eotrx/.test(u))).toBe(false);
      for (const img of shown.host.querySelectorAll("img")) expect(img.getAttribute("src")).toMatch(/^blob:/);
    }
  });

  it("a CSS background loads only with the pictures; @import and remote fonts never", () => {
    const html = htmlOf("substack-newsletter");
    expect(drawn(html).c.css).not.toMatch(/https?:/);
    const shown = cleanMail(html, { show: true, web: (u) => (u.endsWith("hero-bg.png") ? "blob:hero" : null) });
    expect(shown.css).toContain('url("blob:hero")');
    expect(shown.css).not.toMatch(/@import|fonts\.example/);
    expect(shown.web).toContain("https://substackcdn.example.test/image/fetch/hero-bg.png");
  });

  it("cid: pictures come from the message's own parts, shown at once", () => {
    const asked: string[] = [];
    const { c, host } = drawn(htmlOf("cid-images"), { show: false, cid: (id) => { asked.push(id); return `blob:${id}`; } });
    expect(c.cids).toEqual(["logo-coop@oakstreet", "squash-bin@oakstreet"]);
    expect(asked).toEqual(c.cids);
    expect(host.querySelector('img[alt="A bin of winter squash"]')!.getAttribute("src")).toBe("blob:squash-bin@oakstreet");
    expect(c.hidden).toBe(0);
  });

  it("a mail that sets colours of its own is drawn on paper; one that doesn't takes the app's look", () => {
    expect(cleanMail(htmlOf("apple-invite"), HIDDEN).colored).toBe(true);
    expect(cleanMail(htmlOf("stripe-receipt"), HIDDEN).colored).toBe(true);
    expect(cleanMail(htmlOf("cid-images"), HIDDEN).colored).toBe(false);
    expect(cleanMail('<div dir="ltr">Thanks!<br>Sam</div>', HIDDEN).colored).toBe(false);
    expect(cleanMail('<body bgcolor="#000000"><p>dark</p></body>', HIDDEN).colored).toBe(true);
    expect(cleanMail('<p><font color="#333">grey</font></p>', HIDDEN).colored).toBe(true);
    // white words with no background of their own: on the app's paper they'd vanish, so they get the sender's
    expect(cleanMail('<p style="color:#ffffff">white</p>', HIDDEN).colored).toBe(true);
    expect(cleanMail('<p style="color: inherit">plain</p>', HIDDEN).colored).toBe(false);
  });

  it("its <body>'s background and rules for body/html apply to the root, not the app", () => {
    const c = cleanMail(htmlOf("apple-invite"), HIDDEN);
    expect(c.css).toMatch(/\.pa-mail-doc\{[^}]*background-color:\s*#f5f5f7/);
    const host = document.createElement("div"); host.append(c.root);
    expect(host.querySelector(".pa-mail-doc")!.getAttribute("style")).toMatch(/background-color:\s*#f5f5f7/);
  });
});

describe("a hostile mail", () => {
  const html = htmlOf("hostile");
  const { c, host, text } = drawn(html, { show: true, web: (u) => `blob:${u.length}` });
  it("keeps no script, frame, form, field, media, svg, math, template, link, meta or base; its <style> in the body is read as CSS, not kept", () => {
    expect(c.css).toMatch(/\.trap\{color: #c00\}/);
    expect(c.css).not.toMatch(/body\.css/);
    expect(host.querySelector("script, iframe, frame, object, embed, form, input, button, textarea, select, video, audio, source, svg, math, template, noscript, link, meta, base, style, map, area")).toBeNull();
  });
  it("keeps no handler, target, srcset, ping or poster, and only its real web links", () => {
    for (const el of host.querySelectorAll("*")) for (const a of Array.from(el.attributes)) expect(a.name).not.toMatch(/^on|^target$|^srcset$|^ping$|^poster$|^formaction$|^popover|^commandfor$/i);
    expect(links(host)).toEqual(["https://hostile.example.test/confirm", "https://hostile.example.test/ping"]);
    // the words of a link it can't open stay, as words: a script's, a phone number's, a path's, a part's
    for (const w of ["Confirm with JavaScript", "Confirm with data", "Call us", "Your account", "A part", "a span with an href"]) expect(text).toContain(w);
    expect(host.querySelector("[href]:not(a), [src]:not(img)")).toBeNull();
  });
  it("draws no data: picture but PNG, JPEG, GIF or WebP, and takes its hidden pixel out", () => {
    expect(host.querySelector('img[alt="svg as data"]')).toBeNull();
    expect(c.trackers).toBe(1);
  });
  it("loads nothing but its pictures, each through `web`: no stylesheet, @import, font or frame", () => {
    expect(c.web.sort()).toEqual(["http://hostile.example.test/nbsp\u00a0.png", "https://hostile.example.test/bg.png?who=alice", "https://hostile.example.test/inline.png", "https://hostile.example.test/pic.png", "https://hostile.example.test/tablebg.png", "https://hostile.example.test/tdbg.png"]);
    expect(c.css).not.toMatch(/@import|@font-face|font\.woff|expression|behavior|binding/);
    for (const el of host.querySelectorAll("[style]")) expect(el.getAttribute("style")).not.toMatch(/url\(\s*(?!"?blob:)/);
    expect(c.refused).toBe(0);
  });
  it("its CSS can't reach the app: no :host; nothing pinned over the screen (its .cover is in the flow)", () => {
    expect(c.css).not.toMatch(/:host|slotted|::part/);
    expect(c.css).toMatch(/\.cover\{top: 0; left: 0; width: 100vw; height: 100vh; z-index: 2147483647; background: #fff\}/);
    expect(host.querySelector('[style*="position"]')).toBeNull();
    expect(cleanSheet(".a { position: sticky; top: 0 } .b { position: absolute }", () => null)).toBe(".a{top: 0}.b{position: absolute}");
  });
});

describe("cleanSheet", () => {
  const none = () => null;
  it("an at-rule with no block ends at its semicolon: the rule after it stays", () => {
    expect(cleanSheet("@import url(x.css); .a { color: red }", none)).toBe(".a{color: red}");
  });
  it("drops @import, @font-face, @charset, @namespace and @page, keeps @media with what is in it", () => {
    const out = cleanSheet('@charset "utf-8"; @import url(x.css); @namespace svg url(http://www.w3.org/2000/svg); @font-face { font-family: X; src: url(https://f/x.woff) } @page { margin: 0 } @media (max-width: 600px) { .a { color: red } } .b { color: blue }', none);
    expect(out).toBe("@media (max-width: 600px){.a{color: red}}.b{color: blue}");
  });
  it("an escape can't spell url( or :host past it", () => {
    expect(cleanSheet(".a { background: \\75 rl(https://x/y.png) }", none)).not.toMatch(/url\(/i);
    expect(cleanSheet(":\\68 ost { position: fixed }", none)).toBe("");
    expect(cleanSheet(".a { background: u\\rl(https://x/y.png) }", none)).not.toMatch(/url\(/i);
  });
  it("image-set, image(), src() and cross-fade() go with their declaration; url() asks", () => {
    expect(cleanSheet('.a { background-image: image-set("https://x/1.png" 1x); color: red }', none)).toBe(".a{color: red}");
    expect(cleanSheet('.a { background: url("https://x/1.png") no-repeat }', (u) => (u === "https://x/1.png" ? "blob:1" : null))).toBe('.a{background: url("blob:1") no-repeat}');
    expect(cleanSheet(".a { background: url(https://x/1.png) no-repeat }", none)).toBe(".a{background: none no-repeat}");
  });
  it("::slotted and ::part are dropped; body, html and :root mean the root; a class named body stays", () => {
    expect(cleanSheet("::slotted(p) { color: red } p::part(x) { color: red }", none)).toBe("");
    expect(cleanSheet("body { margin: 0 } html, .body-text, #body { color: #111 } :root { color: #222 }", none)).toBe(".pa-mail-doc{margin: 0}.pa-mail-doc, .body-text, #body{color: #111}.pa-mail-doc{color: #222}");
  });
  it("reads strings and url()s as the browser does: a :host rule can't hide in one (security review, T-476)", () => {
    const host = ":host{position:fixed;inset:0;z-index:2147483647;contain:none;background:red}";
    // only what would hide it goes: the rules around it stay
    expect(cleanSheet(`.a{content:"x\n}\n${host}\n.z{color:red}`, none)).toBe(".a{}.z{color:red}");
    expect(cleanSheet(`.a{background:url(x"y); color: red}\n${host}\n.c{content:"c"}`, none)).toBe('.a{color: red}.c{content:"c"}');
    expect(cleanSheet(`:host{color:red} .b{color:blue}`, none)).toBe(".b{color:blue}");
    // and when our reading and the browser's could still differ (a rule nested in a declaration list), none of it
    expect(cleanSheet(".a{color:red; & .b{position:fixed}}", none)).toBe("");
  });
  it("a condition or a string that only names a position or a url() keeps the sheet (closing review, T-476)", () => {
    expect(cleanSheet("@supports (position: sticky) { .hdr { top: 0 } } .b { color: blue }", none)).toBe("@supports (position: sticky){.hdr{top: 0}}.b{color: blue}");
    expect(cleanSheet('.a { content: "position: fixed" } .b { color: blue }', none)).toBe('.a{content: "position: fixed"}.b{color: blue}');
    // and a condition can't carry a rule out of sight
    expect(cleanSheet("@media x } :host{position:fixed} .z{color:red}", none)).not.toMatch(/:host/);
  });
  it("strings and url()s are read as tokens everywhere: neither a quoted url() nor a { in a selector's string hides a rule (review of #225)", () => {
    const host = ":host{contain:none;position:fixed;inset:0;z-index:2147483647;background:red}";
    const pic = (u: string) => (u.startsWith("data:") ? u : null);
    for (const css of [
      `.a{background:url(data:image/png;base64,AAAA)} .z[title="{"]{} ${host} .y{content:"}`,
      `.z[title="{"]{} :is(@a,:host){contain:none;background:red} .y{content:"}`,
      `.a{background:url(data:image/png;base64,AAAA)} .z[title="{"]{} .b{color:red; div{position:fixed}} .y{content:"}`,
      '!z"{"{}@import "http://host/evil.css"; .y{content:"}',
    ]) {
      const out = cleanSheet(css, pic);
      expect(out, css).not.toMatch(/:host|position:\s*fixed|@import/i);
    }
    // a function whose name ends in url( isn't a url(: a quote in it opens a string, for us as for the browser
    expect(cleanSheet(`@media (min-width:1px) and xurl("x) {} .a{color:red} ${host} .b{content:"}`, pic)).not.toMatch(/:host|position:\s*fixed/i);
    expect(cleanSheet(`.a{background:xurl("x) ${host}")} .b{color:blue}`, pic)).not.toMatch(/:host|position:\s*fixed/i);
    expect(cleanSheet(`.a{b:xurl(x"y)} ${host} .c{content:"}`, pic)).not.toMatch(/:host|position:\s*fixed/i);
    expect(cleanSheet(`@media (min-width:1px){.a{b:xurl(x"y)}} ${host} .c{content:"}`, pic)).not.toMatch(/:host|position:\s*fixed/i);
    // as the browser reads it: after `xurl(x` the quote opens a string to the line's end, so no rule follows
    expect(cleanSheet('.q:is(xurl(x"y)){} .z{color:red}', none)).toBe("");
    // a url( with a long run of spaces before its quote is still a quoted one
    expect(cleanSheet(`.a{background:url(${" ".repeat(80)}"x)") ; color: red} .b{color:blue}`, none)).toBe(".a{background:none; color: red}.b{color:blue}");
    // a condition is plain: one with a string, a url( or a bracket left open goes, with what is in it
    expect(cleanSheet('@media "x" {.a{color:red}} @media (a {.b{color:red}} .c{color:blue}', none)).toBe(".c{color:blue}");
    // a { in a selector's string is a string: the rule after it is its own, and stays
    expect(cleanSheet('.z[title="{"]{color:red} .b{color:blue}', none)).toBe('.z[title="{"]{color:red}.b{color:blue}');
  });
  it("a comment is a space: taking one out can't make a new comment, or :host (second security review)", () => {
    expect(cleanSheet("://**/* c */host{contain:none;margin-top:-180px} .b{color:blue}", none)).not.toMatch(/:\s*host|:\/\*/);
    expect(cleanSheet(".a{position: /**/ fixed; color: red}", none)).toBe(".a{color: red}");
  });
  it("a position is static, relative or absolute, or it goes; a var() could be fixed", () => {
    expect(cleanSheet(".a{--p:fixed;position:var(--p);color:red} .b{position:absolute}", none)).toBe(".a{--p:fixed; color:red}.b{position:absolute}");
    expect(cleanSheet("@media (min-width:1px){.a{--p:fixed} .b{position:var(--p)}}", none)).toBe("@media (min-width:1px){.a{--p:fixed}.b{}}");
    expect(cleanSheet(".a{background-position: center; color: red}", none)).toBe(".a{background-position: center; color: red}");
  });
  it("a quoted url( with space before its quote is read as quoted", () => {
    expect(cleanSheet('.a{background:url( "x)")} .b{color:blue}', none)).toBe(".a{background:none}.b{color:blue}");
  });
  it("a long run of spaces, or many url(, can't make the cleaning slow (no backtracking through it; third review of #225)", () => {
    const ws = " ".repeat(190_000);
    const letters = "a".repeat(190_000);
    for (const css of [`.a{background:url(${ws}`, `.a{color:${ws}red}`, `.a{position:${ws}fixed}`, `.a{b:${"url( ".repeat(45_000)}}`, `p{b:${"url(".repeat(47_500)}}`, `@${letters}#{}`, `p{color:${ws}transparent;x:y}`]) {
      const t0 = performance.now();
      cleanSheet(css, none);
      expect(performance.now() - t0, css.slice(0, 30)).toBeLessThan(1500);
    }
    for (const html of [`<p style="background:url(${ws}">x</p>`, `<p style="${"url(".repeat(120_000)}">x</p>`, `<img src="https://x.example/p.png" width="1${" ".repeat(480_000)}x">`]) {
      const t1 = performance.now();
      expect(cleanMail(html, HIDDEN).root).toBeTruthy();
      expect(performance.now() - t1, html.slice(0, 30)).toBeLessThan(1500);
    }
  });
  it("CSS nested deeper than 32 (which crashes the browser's style pass) leaves the sheet out; 32 is kept", () => {
    expect(cleanSheet(`p{${"a{".repeat(10_000)}color:red${"}".repeat(10_001)}`, none)).toBe("");
    expect(cleanSheet(`${":is(".repeat(10_000)}p${")".repeat(10_000)}{color:red}`, none)).toBe("");
    expect(cleanSheet(`${"(]".repeat(5_000)}p{color:red}`, none)).toBe("");
    expect(cleanSheet(`${":is(".repeat(30)}p${")".repeat(30)}{color:red}`, none)).toBe(`${":is(".repeat(30)}p${")".repeat(30)}{color:red}`);
  });
  it("depth counts a condition's brackets and a style attribute's too; a rule nested in a rule may hold no at-rule (fourth review of #225)", () => {
    expect(cleanSheet(`@supports selector(${":is(".repeat(10_000)}p${")".repeat(10_000)}){.a{color:red}} .b{color:blue}`, none)).toBe("");
    expect(cleanSheet(`@media ${"(".repeat(5_000)}x${")".repeat(5_000)}{.a{color:red}}`, none)).toBe("");
    expect(cleanSheet("@media (min-width:1px) and (max-width:2px){.a{color:red}}", none)).toBe("@media (min-width:1px) and (max-width:2px){.a{color:red}}");
    const deep = cleanMail(`<p style="color: ${"var(--a, ".repeat(10_000)}red${")".repeat(10_000)}">x</p>`, HIDDEN);
    const host = document.createElement("div"); host.append(deep.root);
    expect(host.querySelector("p")!.hasAttribute("style")).toBe(false);
    expect(cleanSheet("p{@scope{:scope{margin-left:77px}}} .b{color:blue}", none)).toBe("");
    expect(cleanSheet("@media all{p{@starting-style{opacity:0}}}", none)).toBe("");
  });
  it("an element unwrapped with a great many children doesn't take the stack", () => {
    const { host } = drawn(`<canvas>${"<br>".repeat(125_000)}</canvas><p>after</p>`);
    expect(host.querySelectorAll("br")).toHaveLength(125_000);
  }, 30_000);
  it("<!-- or --> in front of an at-rule doesn't hide it: it goes", () => {
    expect(cleanSheet("<!--@font-face{font-family:Zed;src:local(Arial)} .b{color:blue}", none)).toBe(".b{color:blue}");
    expect(cleanSheet("-->@property --text{syntax:'*'} .b{color:blue}", none)).toBe(".b{color:blue}");
  });
  it("@media nested past 8 deep, or more CSS than 200,000 characters, is left out; neither takes the stack", () => {
    const deep = `${"@media a{".repeat(20000)}.x{color:red}${"}".repeat(20000)} .ok{color:blue}`;
    const t0 = performance.now();
    expect(() => cleanMail(`<style>${deep}</style><p>hi</p>`, HIDDEN)).not.toThrow();
    expect(performance.now() - t0).toBeLessThan(3000);
    expect(cleanSheet(`${"@media a{".repeat(9)}.x{color:red}${"}".repeat(9)}.ok{color:blue}`, none)).toBe(`${"@media a{".repeat(8)}${"}".repeat(8)}.ok{color:blue}`);
    expect(cleanSheet(`.a{color:red}${" ".repeat(200_001)}`, none)).toBe("");
    // many rules and no semicolon after them: read in one pass
    const t1 = performance.now();
    expect(cleanSheet("a{}".repeat(66_000), none).length).toBe(3 * 66_000);
    expect(cleanSheet("a;".repeat(99_000), none)).toBe("");
    expect(performance.now() - t1).toBeLessThan(3000);
  });
  it("a url() the cleaning can't read goes with its declaration; the rules around it stay", () => {
    expect(cleanSheet('.a { background: url( "https://x/1.png" y); color: red } .b { color: blue }', none)).toBe(".a{color: red}.b{color: blue}");
  });
  it("a url() with a no-break space in it is still asked, and loads nothing", () => {
    const asked: string[] = [];
    const out = cleanSheet(".a{background:url(http://evil.example/t\u00a0.png)}", (u) => { asked.push(u); return null; });
    expect(out).not.toMatch(/evil/);
    expect(cleanMail("<style>.a{background:url(http://evil.example/t\u00a0.png)}</style><p class=a>x</p>", HIDDEN).hidden).toBe(1);
  });
  it("keyframes keep their steps, cleaned", () => {
    expect(cleanSheet("@keyframes k { from { background: url(https://x) } to { opacity: 1 } }", none)).toBe("@keyframes k{from{background: none}to{opacity: 1}}");
  });
});

describe("the last walk takes out what the steps before it should have", () => {
  it("an element it doesn't allow, a handler, a bad href, src or style, a javascript: value", () => {
    const root = document.createElement("div");
    root.innerHTML = '<p onclick="x()">a</p><a href="javascript:x()">b</a><span href="https://x">c</span><img src="https://x/y.png"><img src="data:text/html,x"><div style="background:url(https://x)">d</div><div title="javascript:x">e</div><table background="https://x/t.png"></table><img srcset="https://x/2x.png 2x"><a target="_top" ping="https://x/p">f</a>';
    // an SVG <a> has an allowed name in another namespace
    root.append(document.createElementNS("http://www.w3.org/2000/svg", "a"));
    // a script goes whole: its words are code, not words to keep
    const script = document.createElement("script"); script.textContent = "steal()"; root.append(script);
    expect(lastWalk(root)).toBe(13);
    expect(root.innerHTML).toBe("<p>a</p><a>b</a><span>c</span><img><img><div>d</div><div>e</div><table></table><img><a>f</a>");
  });
  it("leaves what is allowed as it was", () => {
    const root = document.createElement("div");
    root.innerHTML = '<a href="https://x/y" rel="noreferrer">a</a><img src="blob:abc" alt="p"><img src="data:image/png;base64,iVBO"><div style="color: red">d</div><details class="pa-quote"><summary>Quoted text</summary></details>';
    const before = root.innerHTML;
    expect(lastWalk(root)).toBe(0);
    expect(root.innerHTML).toBe(before);
  });
});

describe("cleanMail's last walk runs", () => {
  it("an element DOMPurify keeps but a mail has no use for goes, its words staying; counted", () => {
    const { c, host, text } = drawn('<p>words</p><canvas width="9"><p>Your order #123 total $40</p></canvas><spacer type="block"></spacer>');
    expect(host.querySelector("canvas, spacer")).toBeNull();
    expect(text).toContain("Your order #123 total $40");
    expect(c.refused).toBe(2);
  });
});

describe("webHref", () => {
  it("keeps http, https and mailto; nothing else, nothing hidden or spaced", () => {
    expect(webHref(" https://x.test/a?b=1 ")).toBe("https://x.test/a?b=1");
    expect(webHref("mailto:a@b.test")).toBe("mailto:a@b.test");
    expect(webHref("mailto:a@b.test?subject=Hi&attach=/etc/passwd")).toBe("mailto:a@b.test?subject=Hi");
    expect(webHref("mailto:list@x.org?subject=Please%20unsubscribe%20me&body=a+b")).toBe("mailto:list@x.org?subject=Please%20unsubscribe%20me&body=a+b");
    expect(webHref("https://www.apple.com@evil.example/login")).toBeNull();
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "vbscript:x", "/relative", "x.test", "tel:+1555", "https://x.test/a b", "https://x\u200b.test", "https://", "ftp://x.test", "cid:abc"]) expect(webHref(bad), bad).toBeNull();
  });
});

describe("plain text: the quoted reply at its end", () => {
  it("splits what was written from the reply it quotes, with its 'On … wrote:' line", () => {
    const text = fixture("plain-only").find((p) => p.type === "text/plain")!.body;
    const { said, quoted } = splitQuote(text);
    expect(said.trim().endsWith("Ruth")).toBe(true);
    expect(quoted.startsWith("On Mon, 23 Nov 2026 at 6:02 PM, Alice <alice@test.test> wrote:")).toBe(true);
    expect(quoted).toContain("> Does Saturday still work");
  });
  it("an HTML message that is all quote is left whole; many quotes fold in one pass", () => {
    expect(drawn('<blockquote type="cite">only a quote</blockquote>').host.querySelector("details")).toBeNull();
    const many = `<p>top</p>${'<blockquote type="cite">q</blockquote>'.repeat(3000)}`;
    const t0 = performance.now();
    expect(drawn(many).host.querySelectorAll("details.pa-quote")).toHaveLength(3000);
    expect(performance.now() - t0).toBeLessThan(3000);
  });
  it("leaves a message that is only a quote, or has none, whole", () => {
    expect(splitQuote("> just a quote\n> more")).toEqual({ said: "> just a quote\n> more", quoted: "" });
    expect(splitQuote("Hello\n\nNo quote here.")).toEqual({ said: "Hello\n\nNo quote here.", quoted: "" });
    expect(splitQuote("Top\n> inline quote\nMy answer").quoted).toBe("");
  });
});
